// SEC-R3-001: the default agent provider must not route conversations over a
// cleartext HTTP endpoint. Prompts, source snippets, tool output and any
// accidentally-exposed credentials would otherwise be readable on the wire.
//
// Run: node work/.pi/agent/settings.security.test.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const settings = JSON.parse(readFileSync(join(here, 'settings.json'), 'utf8'))
const models = JSON.parse(readFileSync(join(here, 'models.json'), 'utf8'))

const provider = settings.defaultProvider
const cfg = (models.providers || {})[provider]

// Resolve the endpoint the default provider would use. A provider with no
// baseUrl uses a built-in (TLS) SDK endpoint and is fine; only an explicit
// cleartext http:// URL is a confidentiality regression.
const baseUrl = cfg && cfg.baseUrl

let failed = 0
const test = (name, fn) => {
  try { fn(); console.log('PASS ' + name) }
  catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + (e && e.message)) }
}

test('default provider does not use a cleartext HTTP endpoint', () => {
  assert.ok(
    !(typeof baseUrl === 'string' && baseUrl.startsWith('http://')),
    `defaultProvider "${provider}" routes over cleartext HTTP (${baseUrl}); use an https:// endpoint`,
  )
})

console.log(`\n${failed ? 0 : 1}/1 passed`)
process.exit(failed ? 1 : 0)
