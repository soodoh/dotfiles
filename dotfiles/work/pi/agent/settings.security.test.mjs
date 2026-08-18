// SEC-R3-001: the default agent provider must not route conversations over a
// cleartext HTTP endpoint. Prompts, source snippets, tool output and any
// accidentally-exposed credentials would otherwise be readable on the wire.
//
// Run: node dotfiles/work/pi/agent/settings.security.test.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const settings = JSON.parse(readFileSync(join(here, 'settings.json'), 'utf8'))
const models = JSON.parse(readFileSync(join(here, 'models.json'), 'utf8'))

const providers = models.providers || {}

// Resolve the endpoint a provider would use. A provider with no baseUrl uses a
// built-in (TLS) SDK endpoint and is fine; only an explicit cleartext http://
// URL is a confidentiality regression.
const endpointOf = (name) => {
  const cfg = providers[name]
  return cfg && cfg.baseUrl
}
const isCleartext = (baseUrl) =>
  typeof baseUrl === 'string' && baseUrl.startsWith('http://')

// Review workflows also carry prompts, repository snippets, and tool output.
// Check every provider selected by their model tiers, not only Pi's default.
const tiersPath = join(here, '..', '..', 'pi', 'workflows', 'model-tiers.json')
const modelTiers = JSON.parse(readFileSync(tiersPath, 'utf8'))
const tierProviders = new Map()
for (const [tier, ref] of Object.entries(modelTiers.tiers || {})) {
  if (typeof ref !== 'string') continue
  const provider = ref.split('/')[0]
  if (!tierProviders.has(provider)) tierProviders.set(provider, [])
  tierProviders.get(provider).push(tier)
}

let failed = 0
const test = (name, fn) => {
  try { fn(); console.log('PASS ' + name) }
  catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + (e && e.message)) }
}

const provider = settings.defaultProvider
test('default provider does not use a cleartext HTTP endpoint', () => {
  const baseUrl = endpointOf(provider)
  assert.ok(
    !isCleartext(baseUrl),
    `defaultProvider "${provider}" routes over cleartext HTTP (${baseUrl}); use an https:// endpoint`,
  )
})

for (const [tierProvider, tiers] of tierProviders) {
  test(`workflow tier provider "${tierProvider}" does not use a cleartext HTTP endpoint`, () => {
    const baseUrl = endpointOf(tierProvider)
    assert.ok(
      !isCleartext(baseUrl),
      `model-tiers.json tier(s) [${tiers.join(', ')}] use provider "${tierProvider}" over cleartext HTTP (${baseUrl}); use an https:// endpoint`,
    )
  })
}

const total = 1 + tierProviders.size
console.log(`\n${failed ? total - failed : total}/${total} passed`)
process.exit(failed ? 1 : 0)
