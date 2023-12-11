import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import { existsSync as fileExistsSync } from 'node:fs'
import ejs from 'ejs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.resolve(__dirname, '../public')
// const RAW_BASE_URL = 'https://raw.githubusercontent.com/SharerMax/V2ray2ClashRule/release'
const RAW_BASE_URL = 'https://cdn.jsdelivr.net/gh/SharerMax/V2ray2ClashRule@release'

async function generateRuleList(rulesSourceDir: string) {
  const fileList = await fs.readdir(rulesSourceDir)
  return fileList.map(file => ({
    name: file,
    url: `${RAW_BASE_URL}/${file}`,
  }))
}

async function renderPage(rulesSourceDir: string) {
  const ruleList = await generateRuleList(rulesSourceDir)
  const latestUpdateDate = new Date().toUTCString()
  return ejs.renderFile(path.resolve(__dirname, './ejs/index.ejs'), { latestUpdateDate, ruleList })
}

export async function generateRulePage(rulesSourceDir: string, pageDestDir: string) {
  if (!fileExistsSync(pageDestDir))
    await fs.mkdir(pageDestDir, { recursive: true })
  await fs.writeFile(path.resolve(pageDestDir, 'index.html'), await renderPage(rulesSourceDir))
  await fs.cp(publicDir, pageDestDir, { recursive: true })
}

export default {
  generateRuleList,
}
