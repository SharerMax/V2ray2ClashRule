import { existsSync as fileExistsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import debug from 'debug'
import { LRUCache } from 'lru-cache'
import { stringify as yamlStringify } from 'yaml'

interface V2rayRule {
  content: string
  attr: string[]
}

interface V2RayRules {
  fullDomain: V2rayRule[]
  subdomain: V2rayRule[]
  keyword: V2rayRule[]
  regex: V2rayRule[]
}

interface ClashRule {
  payload: string[]
  type: 'classic' | 'domain'
}
const debugLogger = debug('v2ray-2-clash-rule:convetor')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cache = new LRUCache<string, V2RayRules>({
  max: 100,
})
function isFullDomainRule(rule: string) {
  return rule.startsWith('full:')
}
function isKeywordRule(rule: string) {
  return rule.startsWith('keyword:')
}
function isRegexDomainRule(rule: string) {
  return rule.startsWith('regexp:')
}

function isIncludeRule(rule: string) {
  return rule.startsWith('include:')
}

function isInvalidRule(rule?: string) {
  return !rule || !rule.trim() || rule.startsWith('#')
}

const EOL_REGEX = /\r?\n/
function generateCacheKey(v2rayRuleFilePath: string, options?: { attr?: {
  include?: string[]
  exclude?: string[]
} }) {
  return `${v2rayRuleFilePath}-${options?.attr?.include?.join('-') || ''}-${options?.attr?.exclude?.join('-') || ''}`
}
async function parseV2rayRuleFile(v2rayRuleFilePath: string, options?: { attr?: {
  include?: string[]
  exclude?: string[]
} }) {
  debugLogger('parse v2ray rule file: ', v2rayRuleFilePath)

  // filter attr effect when exclude or include is not empty
  const excludeAttr = options?.attr?.exclude
  const includeAttr = options?.attr?.include
  const enableExclude = excludeAttr && excludeAttr.length > 0
  const enableInclude = includeAttr && includeAttr.length > 0

  const cacheKey = generateCacheKey(v2rayRuleFilePath, options)
  debugLogger('cache key: ', cacheKey)
  if (cache.has(cacheKey)) {
    debugLogger('cache hit', cacheKey)
    return cache.get(cacheKey)!
  }

  const fileContent = await fs.readFile(path.resolve(v2rayRuleFilePath), 'utf-8')
  const result: V2RayRules = {
    fullDomain: new Array<V2rayRule>(),
    subdomain: new Array<V2rayRule>(),
    keyword: new Array<V2rayRule>(),
    regex: new Array<V2rayRule>(),
  }
  const lines = fileContent.split(EOL_REGEX)

  for await (let rule of lines) {
    // remove comment same line
    const commentIndex = rule.indexOf('#')
    if (commentIndex >= 0)
      rule = rule.slice(0, commentIndex).trim()

    // get multiple attr(start @) from rule with regex
    const matchAllAttr = rule.matchAll(/@(\S+)/g)
    const ruleAttr = new Array<string>()
    for (const attr of matchAllAttr) {
      debugLogger('attr: ', attr[1])
      ruleAttr.push(attr[1])
    }

    if (enableExclude && excludeAttr.some(attr => ruleAttr.includes(attr)))
      continue

    if (enableInclude && !includeAttr.some(attr => ruleAttr.includes(attr)))
      continue

    // remove rule attribute
    rule = rule.replaceAll(/@\S+/g, '').trim()

    if (isInvalidRule(rule)) {
      debugLogger('ignore invalid rule: ', rule)
      continue
    }
    else if (isFullDomainRule(rule)) {
      // full: xxx
      result.fullDomain.push({
        content: rule.slice(5).trim(),
        attr: ruleAttr,
      })
    }
    else if (isKeywordRule(rule)) {
      // keyword: xxx
      result.keyword.push({
        content: rule.slice(8).trim(),
        attr: ruleAttr,
      })
    }
    else if (isRegexDomainRule(rule)) {
      // regexp: xxx
      result.regex.push({
        content: rule.slice(7).trim(),
        attr: ruleAttr,
      })
    }
    else if (isIncludeRule(rule)) {
      debugLogger('include rule: ', rule, 'attr: ', ruleAttr)
      const v2rayRuleFileName = rule.slice(8).trim()
      const includeFilePath = path.resolve(path.dirname(v2rayRuleFilePath), v2rayRuleFileName)
      const includeAttr: string[] = []
      const excludeAttr: string[] = []
      ruleAttr.forEach((attr) => {
        if (attr.startsWith('-'))
          excludeAttr.push(attr.slice(1))
        else
          includeAttr.push(attr)
      })
      const includeCacheKey = generateCacheKey(includeFilePath, { attr: { include: includeAttr, exclude: excludeAttr } })
      debugLogger('include cache key: ', includeCacheKey)
      const cacheResult = cache.get(includeCacheKey)
      if (cacheResult) {
        debugLogger('hit cache: ', v2rayRuleFileName, 'cache key: ', cacheKey)
        result.fullDomain = result.fullDomain.concat(cacheResult.fullDomain)
        result.subdomain = result.subdomain.concat(cacheResult.subdomain)
        result.keyword = result.keyword.concat(cacheResult.keyword)
      }
      else {
        debugLogger('include file path: ', includeFilePath)

        const includeResult = await parseV2rayRuleFile(includeFilePath, {
          attr: {
            include: includeAttr,
            exclude: excludeAttr,
          },
        })
        result.fullDomain = result.fullDomain.concat(includeResult.fullDomain)
        result.subdomain = result.subdomain.concat(includeResult.subdomain)
        result.keyword = result.keyword.concat(includeResult.keyword)
      }
    }
    else {
      // Subdomain begins with `domain:`, followed by a valid domain name. The prefix `domain:` may be omitted.
      if (rule.startsWith('domain:')) {
        result.subdomain.push({
          content: rule.slice(7).trim(),
          attr: ruleAttr,
        })
      }
      else {
        result.subdomain.push({
          content: rule,
          attr: ruleAttr,
        })
      }
    }
  }
  cache.set(cacheKey, result)
  debugLogger('save cache: ', cacheKey)
  return result
}

function convertV2rayRuleToClashRule(v2rayRule: V2RayRules): ClashRule {
  const result: ClashRule = {
    payload: new Array<string>(),
    type: 'domain',
  }
  const domainSuffixRule = new Array<string>()
  const domainRule = new Array<string>()
  const domainKeywordRule = new Array<string>()
  const domainRegexRule = new Array<string>()
  const ruleType = (domainKeywordRule.length > 0 || domainRegexRule.length > 0) ? 'classic' : 'domain'
  result.type = ruleType
  if (ruleType === 'classic') {
    for (const fullDomain of v2rayRule.fullDomain)
      domainRule.push(`DOMAIN,${fullDomain.content}`)

    for (const subdomain of v2rayRule.subdomain)
      domainSuffixRule.push(`DOMAIN-SUFFIX,${subdomain.content}`)

    for (const keyword of v2rayRule.keyword)
      domainKeywordRule.push(`DOMAIN-KEYWORD,${keyword.content}`)

    for (const regex of v2rayRule.regex)
      domainRegexRule.push(`DOMAIN-REGEX,${regex.content}`)
  }
  else {
    for (const fullDomain of v2rayRule.fullDomain)
      domainRule.push(fullDomain.content)
    for (const subdomain of v2rayRule.subdomain)
      domainSuffixRule.push(`+.${subdomain.content}`)
  }
  result.payload = result.payload.concat(domainSuffixRule)
  result.payload = result.payload.concat(domainRule)
  result.payload = result.payload.concat(domainKeywordRule)

  return result
}

export async function generateRuleList(domainDataDir: string, rulesDistPath: string) {
  const dataListFiles = await fs.readdir(domainDataDir, { withFileTypes: true })

  if (!fileExistsSync(rulesDistPath))
    await fs.mkdir(rulesDistPath, { recursive: true })
  for (const file of dataListFiles) {
    if (file.isFile()) {
      const v2rayRules = await parseV2rayRuleFile(path.join(file.parentPath, file.name))
      const clashRules = convertV2rayRuleToClashRule(v2rayRules)
      const yamlObj = {
        payload: new Array<string>(),
      }
      yamlObj.payload = clashRules.payload
      const yamlFile = await fs.open(path.join(rulesDistPath, `${file.name}.yaml`), 'w')
      const writeStream = yamlFile.createWriteStream()
      writeStream.write('# Generated by v2ray2clashrule\n')
      if (clashRules.type === 'domain')
        writeStream.write('# type: domain\n')
      else
        writeStream.write('# type: classic\n')
      writeStream.write(yamlStringify(yamlObj))
      writeStream.end()
      writeStream.close()
    }
  }
}

export default {
  generateRuleList,
}
