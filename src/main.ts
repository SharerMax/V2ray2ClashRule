import fs from 'node:fs/promises'
import { existsSync as fileExistsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Readline from 'node:readline/promises'
import debug from 'debug'
import { stringify as yamlStringify } from 'yaml'

const debugLogger = debug('v2ray-2-clash-rule')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataPath = path.resolve(__dirname, '../data')
const distPath = path.resolve(__dirname, '../dist')
function isFullDomainRule(rule: string) {
  return rule.startsWith('full:')
}
function isRegexDomainRule(rule: string) {
  return rule.startsWith('regexp:')
}

function isIncludeRule(rule: string) {
  return rule.startsWith('include:')
}

function isInvalidRule(rule?: string) {
  return !rule || !rule.trim() || rule.startsWith('#') || rule.includes('@')
}

async function parseFile(fileFullPath: string) {
  const openedFile = await fs.open(path.resolve(fileFullPath), 'r')
  const fileReadStream = openedFile.createReadStream()
  const rl = Readline.createInterface({
    input: fileReadStream,
  })
  const result = {
    fullDomain: Array<string>(),
    subdomain: Array<string>(),
  }
  for await (let rule of rl) {
    const commentIndex = rule.indexOf('#')
    if (commentIndex >= 0)
      rule = rule.slice(0, commentIndex).trim()

    if (isInvalidRule(rule)) {
      debugLogger('ignore invalid rule: ', rule)
      continue
    }
    else if (isFullDomainRule(rule)) {
      result.fullDomain.push(rule.slice(5).trim())
    }
    else if (isRegexDomainRule(rule)) {
      debugLogger('ignore regex rule: ', rule)
    }
    else if (isIncludeRule(rule)) {
      const includeFilePath = path.resolve(dataPath, rule.slice(8).trim())
      const includeResult = await parseFile(includeFilePath)
      result.fullDomain = result.fullDomain.concat(includeResult.fullDomain)
      result.subdomain = result.subdomain.concat(includeResult.subdomain)
    }
    else {
      result.subdomain.push(`+.${rule}`)
    }
  }
  return result
}

const dataListFiles = await fs.readdir(dataPath, { withFileTypes: true })

if (!fileExistsSync(distPath))
  await fs.mkdir(distPath)

for (const file of dataListFiles) {
  if (file.isFile()) {
    const rules = await parseFile(path.join(file.path, file.name))
    const yamlObj = {
      payload: Array<string>(),
    }
    yamlObj.payload = yamlObj.payload.concat(rules.fullDomain)
    yamlObj.payload = yamlObj.payload.concat(rules.subdomain)
    await fs.writeFile(path.join(distPath, `${file.name}.yaml`), yamlStringify(yamlObj))
  }
}
