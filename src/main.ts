import path from 'node:path'
import { fileURLToPath } from 'node:url'
import debug from 'debug'

import { generateRuleList } from './convetor'
import { generateRulePage } from './page'

const debugLogger = debug('v2ray-2-clash-rule')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const v2rayRuleDataPath = path.resolve(__dirname, '../data')

const pageDistPath = path.resolve(__dirname, '../dist/public')
const rulesDistPath = path.resolve(__dirname, '../dist/rules')

await generateRuleList(v2rayRuleDataPath, rulesDistPath)
debugLogger('generate rule list done')
await generateRulePage(rulesDistPath, pageDistPath)
debugLogger('generate rule page done')
