import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import { existsSync as fileExistsSync } from 'node:fs'
import ejs from 'ejs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicOutDir = path.resolve(__dirname, '../public')
const publicDir = path.resolve(__dirname, './public')
const distDir = path.resolve(__dirname, '../dist')
const RAW_HOST = 'https://raw.githubusercontent.com'

async function generateRuleList() {
  const fileList = await fs.readdir(distDir)
  return fileList.map(file => ({
    name: file,
    url: `${RAW_HOST}/SharerMax/V2ray2ClashRule/release/${file}`,
  }))
}

async function renderPage() {
  const ruleList = await generateRuleList()
  const latestUpdateDate = new Date().toUTCString()
  return ejs.renderFile(path.resolve(__dirname, './ejs/index.ejs'), { latestUpdateDate, ruleList })
}

export async function generateRulePage() {
  if (!fileExistsSync(publicOutDir))
    await fs.mkdir(publicOutDir, { recursive: true })
  await fs.writeFile(path.resolve(publicOutDir, 'index.html'), await renderPage())
  await fs.cp(publicDir, publicOutDir, { recursive: true })
}

export default {
  generateRuleList,
}
