import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const androidDirectory = resolve('android')
const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
const result = spawnSync(wrapper, ['assembleDebug'], {
  cwd: androidDirectory,
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
