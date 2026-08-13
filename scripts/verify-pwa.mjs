import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputDirectory = resolve(process.argv[2] ?? 'dist')
const expectedBase = process.argv[3] ?? '/'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const indexHtml = await readFile(resolve(outputDirectory, 'index.html'), 'utf8')
const manifest = JSON.parse(
  await readFile(resolve(outputDirectory, 'manifest.webmanifest'), 'utf8'),
)
const worker = await readFile(resolve(outputDirectory, 'service-worker.js'), 'utf8')

assert(indexHtml.includes(`href="${expectedBase}manifest.webmanifest"`), 'Manifest link does not use the expected base')
assert(indexHtml.includes(`${expectedBase}assets/`), 'Hashed assets do not use the expected base')
assert(manifest.name === 'English Recall', 'Manifest name is missing')
assert(manifest.short_name === 'Recall', 'Manifest short_name is missing')
assert(manifest.start_url === './' && manifest.scope === './', 'Manifest must remain scope-relative')
assert(manifest.display === 'standalone', 'Manifest display must be standalone')
assert(manifest.theme_color === '#070a12', 'Manifest theme color is invalid')
assert(manifest.background_color === '#070a12', 'Manifest background color is invalid')
assert(manifest.icons.some((icon) => icon.purpose === 'any' && icon.sizes === '192x192'), 'Normal 192px install icon is missing')
assert(manifest.icons.some((icon) => icon.purpose === 'any' && icon.sizes === '512x512'), 'Normal 512px install icon is missing')
assert(manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '192x192'), 'Maskable 192px install icon is missing')
assert(manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512'), 'Maskable 512px install icon is missing')

for (const icon of manifest.icons) {
  const iconPath = icon.src.replace(/^\.\//, '')
  assert((await stat(resolve(outputDirectory, iconPath))).isFile(), `Missing icon ${icon.src}`)
}

assert(!worker.includes('__PWA_CACHE_VERSION__'), 'Service worker cache revision was not injected')
assert(worker.includes("new URL(self.registration.scope)"), 'Service worker is not scope-relative')
assert(worker.includes("url.pathname.includes('/assets/')"), 'Hashed asset caching is missing')

process.stdout.write(`PWA output verified for base ${expectedBase}\n`)
