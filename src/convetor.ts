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
  if (options?.attr) {
    const { include, exclude } = options.attr
    const attrKey = `+${include?.join('+')}-${exclude?.join('-')}`
    return `${v2rayRuleFilePath}-${attrKey}`
  }
  return `${v2rayRuleFilePath}`
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
    debugLogger('rule-line: ', rule)
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
    debugLogger('rule-no-attr: ', rule)
    if (isInvalidRule(rule)) {
      debugLogger('ignore invalid rule: ', rule)
      continue
    }
    else if (isFullDomainRule(rule)) {
      // full: xxx
      debugLogger('full domain rule: ', rule, 'attr: ', ruleAttr)
      result.fullDomain.push({
        content: rule.slice(5).trim(),
        attr: ruleAttr,
      })
    }
    else if (isKeywordRule(rule)) {
      // keyword: xxx
      debugLogger('keyword rule: ', rule, 'attr: ', ruleAttr)
      result.keyword.push({
        content: rule.slice(8).trim(),
        attr: ruleAttr,
      })
    }
    else if (isRegexDomainRule(rule)) {
      // regexp: xxx
      debugLogger('regex domain rule: ', rule, 'attr: ', ruleAttr)
      result.regex.push({
        content: rule.slice(7).trim(),
        attr: ruleAttr,
      })
    }
    else if (isIncludeRule(rule)) {
      debugLogger('include rule: ', rule, 'attr: ', ruleAttr)
      const v2rayRuleFileName = rule.slice(8).trim()
      const includeFilePath = path.resolve(path.dirname(v2rayRuleFilePath), v2rayRuleFileName)
      debugLogger('include file path: ', includeFilePath)
      const includeAttr: string[] = []
      const excludeAttr: string[] = []
      ruleAttr.forEach((attr) => {
        if (attr.startsWith('-'))
          excludeAttr.push(attr.slice(1))
        else
          includeAttr.push(attr)
      })
      const includeResult = await parseV2rayRuleFile(includeFilePath, {
        attr: {
          include: includeAttr,
          exclude: excludeAttr,
        },
      })
      result.fullDomain = result.fullDomain.concat(includeResult.fullDomain)
      result.subdomain = result.subdomain.concat(includeResult.subdomain)
      result.keyword = result.keyword.concat(includeResult.keyword)
      result.regex = result.regex.concat(includeResult.regex)
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
  debugLogger(`result-${cacheKey}:`, result)
  return result
}

function convertV2rayRuleToClashRule(v2rayRule: V2RayRules): Record<string, ClashRule> {
  const ruleType = 'classic'
  const attrRule: Record<string, string[]> = {
    '#': new Array<string>(),
  }
  for (const fullDomain of v2rayRule.fullDomain) {
    const payload = `DOMAIN,${fullDomain.content}`
    attrRule['#'].push(payload)
    for (const attr of fullDomain.attr) {
      if (!attrRule[attr])
        attrRule[attr] = new Array<string>()
      attrRule[attr].push(payload)
    }
  }

  for (const subdomain of v2rayRule.subdomain) {
    const payload = `DOMAIN-SUFFIX,${subdomain.content}`
    attrRule['#'].push(payload)
    for (const attr of subdomain.attr) {
      if (!attrRule[attr])
        attrRule[attr] = new Array<string>()
      attrRule[attr].push(payload)
    }
  }

  for (const keyword of v2rayRule.keyword) {
    const payload = `DOMAIN-KEYWORD,${keyword.content}`
    attrRule['#'].push(payload)
    for (const attr of keyword.attr) {
      if (!attrRule[attr])
        attrRule[attr] = new Array<string>()
      attrRule[attr].push(payload)
    }
  }

  for (const regex of v2rayRule.regex) {
    const payload = `DOMAIN-REGEX,${regex.content}`
    attrRule['#'].push(payload)
    for (const attr of regex.attr) {
      if (!attrRule[attr])
        attrRule[attr] = new Array<string>()
      attrRule[attr].push(payload)
    }
  }
  const result: Record<string, ClashRule> = {}
  for (const attr in attrRule) {
    result[attr] = {
      payload: attrRule[attr],
      type: ruleType,
    }
  }
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
      for (const key in clashRules) {
        if (!Object.hasOwn(clashRules, key))
          continue

        yamlObj.payload = clashRules[key].payload
        const fileName = `${file.name}${key === '#' ? '' : `@${key}`}.yaml`
        const yamlFile = await fs.open(path.join(rulesDistPath, fileName), 'w')
        const writeStream = yamlFile.createWriteStream()
        writeStream.write('# Generated by v2ray2clashrule\n')
        if (clashRules['#'].type === 'domain')
          writeStream.write('# type: domain\n')
        else
          writeStream.write('# type: classic\n')
        writeStream.write(yamlStringify(yamlObj))
        writeStream.end()
        writeStream.close()
        yamlFile.close()
      }
    }
  }
}

export default {
  generateRuleList,
}
