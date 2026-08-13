import { createHash } from 'node:crypto'
import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { relative, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const CACHE_VERSION_PLACEHOLDER = '__PWA_CACHE_VERSION__'
const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { readonly version: string }

export function normalizeBasePath(value: string | undefined): string {
  if (!value || value === '/') return '/'
  return `/${value.replace(/^\/+|\/+$/g, '')}/`
}

function listFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = resolve(directory, entry)
      return statSync(path).isDirectory() ? listFiles(path) : [path]
    })
    .sort()
}

/**
 * Gives each production shell a content-derived cache namespace. This is
 * intentionally independent from the human-facing package/app version.
 */
function pwaCacheRevision(): Plugin {
  let outputDirectory = resolve(process.cwd(), 'dist')

  return {
    name: 'english-recall-pwa-cache-revision',
    apply: 'build',
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const workerPath = resolve(outputDirectory, 'service-worker.js')
      const workerSource = readFileSync(workerPath, 'utf8')
      const hash = createHash('sha256')

      for (const filePath of listFiles(outputDirectory)) {
        const fileName = relative(outputDirectory, filePath).replaceAll('\\', '/')
        hash.update(fileName)
        hash.update(filePath === workerPath ? workerSource : readFileSync(filePath))
      }

      const revision = hash.digest('hex').slice(0, 16)
      writeFileSync(
        workerPath,
        workerSource.replaceAll(CACHE_VERSION_PLACEHOLDER, revision),
      )
    },
  }
}

export default defineConfig({
  base: normalizeBasePath(process.env.VITE_BASE_PATH),
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [react(), pwaCacheRevision()],
})
