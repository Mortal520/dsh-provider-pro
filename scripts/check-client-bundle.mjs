// Minimal offline validation of the built plugin, mirroring the guide §9.4.
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'

const root = new URL('..', import.meta.url)

function fail(message) {
  console.error(`check-client-bundle: ${message}`)
  process.exit(1)
}

// package.json manifest
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
if (pkg.dsh?.client?.platform !== 'web') fail('dsh.client.platform must be "web"')
const clientExport = pkg.exports?.['./client']
if (typeof clientExport !== 'string' || !existsSync(new URL('lib/client.js', root))) {
  fail('exports["./client"] must point at an existing lib/client.js')
}

// Host half exports apply
const host = readFileSync(new URL('lib/index.js', root), 'utf8')
if (!host.includes('apply')) fail('lib/index.js must export apply')

// Client bundle banner/footer (rolldown may pretty-print the banner)
const client = readFileSync(new URL('lib/client.js', root), 'utf8')
const bannerRe = /window\.__ModuleLoader__\.load\(\{\s*id: "dsh-provider-pro",\s*factory: \(require\) => \{/
if (!bannerRe.test(client)) fail(`bundle must start with the ModuleLoader banner (found: ${client.slice(0, 80).replace(/\n/g, '\\n')})`)
if (!/return module\.exports;\s*\}\s*\}\);?/.test(client)) {
  fail('bundle must end with the ModuleLoader footer')
}

// pivot: the bundled 'src' path in sourcemap should exist
console.log('check-client-bundle: OK')
console.log(`  lib/index.js   (${host.split('\n').length} lines)`)
console.log(`  lib/client.js  (${client.split('\n').length} lines)`)