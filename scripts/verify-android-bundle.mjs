import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const assetRoot = resolve(process.argv[2] ?? 'android/app/src/main/assets/public')
const configPath = resolve(
  process.argv[3] ?? 'android/app/src/main/assets/capacitor.config.json',
)

function fail(message) {
  console.error(`Android bundle verification failed: ${message}`)
  process.exitCode = 1
}

const indexPath = resolve(assetRoot, 'index.html')
if (!existsSync(indexPath)) fail('bundled index.html is missing')
if (!existsSync(configPath)) fail('generated Capacitor config is missing')

if (!process.exitCode) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  if (config.server?.url) fail('Capacitor is configured to load a remote URL')
  if (config.appId !== 'com.englishrecall.app') fail('unexpected Android app id')

  const html = readFileSync(indexPath, 'utf8')
  if (/<(?:script|link)\b[^>]*(?:src|href)=["']https?:\/\//iu.test(html)) {
    fail('index.html references a remote script or stylesheet')
  }

  const assetsPath = resolve(assetRoot, 'assets')
  if (!existsSync(assetsPath) || readdirSync(assetsPath).length === 0) {
    fail('bundled Vite assets are missing')
  }
  if (!existsSync(resolve(assetRoot, 'assets/english-recall-lesson-pack-template.xlsx'))) {
    fail('bundled Excel lesson template is missing')
  }
}

if (!process.exitCode) console.log('Android bundle verification passed: local assets only.')
