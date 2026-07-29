// Tests for review-loop.json workflow script convergence/verdict logic.
// Runs the REAL script body from review-loop.json with mocked agent primitives.
// Faithful copies of loopUntilDry + verify come from @quintinshaw/pi-dynamic-workflows.
//
// Run: node work/.pi/workflows/saved/review-loop.test.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const wf = JSON.parse(readFileSync(join(here, 'review-loop.json'), 'utf8'))

// --- Faithful primitives (copied from dist/workflow.js) -------------------
const parallel = async (thunks) => Promise.all(thunks.map((t) => (typeof t === 'function' ? t() : t)))

const loopUntilDry = async (opts) => {
  const key = opts.key ?? ((x) => JSON.stringify(x))
  const consecutiveEmpty = Math.max(1, opts.consecutiveEmpty ?? 2)
  const maxRounds = opts.maxRounds ?? 50
  const seen = new Set()
  const all = []
  let dry = 0
  for (let r = 0; r < maxRounds && dry < consecutiveEmpty; r++) {
    const items = (await opts.round(r)) ?? []
    const fresh = (Array.isArray(items) ? items : []).filter((x) => x != null && !seen.has(key(x)))
    if (!fresh.length) { dry++; continue }
    dry = 0
    for (const x of fresh) { seen.add(key(x)); all.push(x) }
  }
  return all
}

// verify uses agent+parallel internally; faithful ratio-over-successful-votes shape.
const makeVerify = (agent) => async (item, opts = {}) => {
  const reviewers = Math.max(1, opts.reviewers ?? 2)
  const threshold = opts.threshold ?? 0.5
  const lenses = opts.lens ? (Array.isArray(opts.lens) ? opts.lens : [opts.lens]) : []
  const claim = typeof item === 'string' ? item : JSON.stringify(item)
  const votes = (await parallel(Array.from({ length: reviewers }, (_v, i) => () =>
    agent(`verify claim. lens ${lenses[i % (lenses.length || 1)]}\n${claim}`, { label: `verify ${i + 1}` })))).filter(Boolean)
  const realCount = votes.filter((v) => v?.real).length
  return { real: votes.length > 0 && realCount / votes.length >= threshold, realCount, total: votes.length, votes }
}

async function runWorkflow({ agent, args }) {
  const body = wf.script.replace(/export const meta/, 'const meta')
  const verify = makeVerify(agent)
  const log = () => {}
  const phase = () => {}
  const fn = new Function('agent', 'parallel', 'verify', 'loopUntilDry', 'log', 'phase', 'args',
    'return (async () => {' + body + '})()')
  return fn(agent, parallel, verify, loopUntilDry, log, phase, args)
}

// --- Mock agent builder ---------------------------------------------------
// dispatch tells each labelled agent call what to return; verify votes are
// keyed by verify-index so we can simulate a failed reviewer (null vote).
const highFinding = {
  id: 'F1', severity: 'high', category: 'correctness', location: 'src/x.ts:10',
  description: 'boundary bug', evidence: 'e', repro_test: 'fails now', boundary_owner: 'current', confidence: 'high',
}

function makeAgent(handlers) {
  const calls = []
  const agent = async (_prompt, opts = {}) => {
    const label = (opts && opts.label) || ''
    calls.push(label)
    for (const [prefix, fn] of handlers) {
      if (label.startsWith(prefix)) return typeof fn === 'function' ? fn(label) : fn
    }
    return null
  }
  agent.calls = calls
  return agent
}

const emptyLanes = { findings: [] }
const scanResp = { diff: 'diff --git a b', files: ['src/x.ts'], lineCount: 10 }

// --- Tests ----------------------------------------------------------------
const tests = []
const test = (name, fn) => tests.push([name, fn])

// COR-R2-001: null validation must NOT be certified CONVERGED CLEAN.
test('COR-R2-001: null post-fix validation is not CONVERGED CLEAN', async () => {
  let round = 0
  const agent = makeAgent([
    ['scope + diff', scanResp],
    ['rescan', { diff: 'diff', lineCount: 10 }],
    // round 1 (r0): correctness lane surfaces one high finding; later rounds empty.
    ['maintainability', emptyLanes],
    ['security', emptyLanes],
    ['correctness r1', { findings: [highFinding] }],
    ['correctness', emptyLanes],
    ['verify', { real: true }], // both reviewers vote real -> survivor
    ['fix', 'applied a fix'],
    ['validate', null], // MISSING coverage: validation returned null
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 3, reviewers: 2, threshold: 1.0 } })
  assert.equal(res.totalAddressed, 1, 'one finding was addressed')
  assert.equal(res.totalResolved, 0, 'unconfirmed fix must not count as resolved')
  assert.notEqual(res.verdict, 'CONVERGED CLEAN', 'must NOT falsely certify clean after null validation')
  assert.match(res.verdict, /UNCONFIRMED/, 'verdict should flag unconfirmed fixes')
})

// COR-R2-003: threshold 1.0 with a failed reviewer (partial coverage) must NOT pass.
test('COR-R2-003: partial verify coverage routes to unverified, not the fixer', async () => {
  const agent = makeAgent([
    ['scope + diff', scanResp],
    ['rescan', { diff: 'diff', lineCount: 10 }],
    ['maintainability', emptyLanes],
    ['security', emptyLanes],
    ['correctness r1', { findings: [highFinding] }],
    ['correctness', emptyLanes],
    ['verify 1', { real: true }], // reviewer 1 votes real
    ['verify 2', null], // reviewer 2 FAILED -> dropped, total becomes 1 (< reviewers=2)
    ['fix', 'SHOULD NOT RUN'],
    ['validate', { applied: true, testsPass: true }],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 3, reviewers: 2, threshold: 1.0 } })
  assert.ok(!agent.calls.some((l) => l.startsWith('fix')), 'fixer must NOT run on half-covered verification')
  assert.equal(res.unverified.length, 1, 'finding routed to unverified escalation')
  assert.equal(res.unverified[0].location, highFinding.location)
  assert.match(res.verdict, /UNVERIFIED/, 'verdict should flag unverified findings')
})

// COR-R2-004: resolved count must be unique-keyed and never exceed addressed.
test('COR-R2-004: recurring finding does not inflate totalResolved', async () => {
  const agent = makeAgent([
    ['scope + diff', scanResp],
    ['rescan', { diff: 'diff', lineCount: 10 }],
    ['maintainability', emptyLanes],
    ['security', emptyLanes],
    // SAME finding surfaces every round (same category+location key).
    ['correctness', { findings: [highFinding] }],
    ['verify', { real: true }],
    ['fix', 'applied'],
    ['validate', { applied: true, testsPass: true }], // each round validates as landed
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 3, reviewers: 2, threshold: 1.0 } })
  assert.equal(res.totalAddressed, 1, 'deduped addressed count')
  assert.ok(res.totalResolved <= res.totalAddressed, 'resolved must never exceed addressed')
  assert.equal(res.totalResolved, 0, 'a finding still unresolved at loop end is not counted resolved')
  assert.ok(res.unresolved.some((f) => f.location === highFinding.location), 'finding remains unresolved')
})

// MAINT-R3-001: hitting maxRounds after only ONE dry round is NOT convergence.
test('MAINT-R3-001: one dry round at the cap is not CONVERGED CLEAN', async () => {
  const agent = makeAgent([
    ['scope + diff', scanResp],
    ['rescan', { diff: 'diff', lineCount: 10 }],
    ['maintainability', emptyLanes],
    ['security', emptyLanes],
    // round 1 (r0): one verified high finding, fixed + validated; round 2 (r1) empty.
    ['correctness r1', { findings: [highFinding] }],
    ['correctness', emptyLanes],
    ['verify', { real: true }],
    ['fix', 'applied a fix'],
    ['validate', { applied: true, testsPass: true }],
    ['synthesis', 'report text'],
  ])
  // maxRounds: 2 => loop ends at the cap with only ONE trailing dry round (r1).
  const res = await runWorkflow({ agent, args: { maxRounds: 2, reviewers: 2, threshold: 1.0 } })
  assert.notEqual(res.verdict, 'CONVERGED CLEAN', 'a single dry round at the cap must not certify clean')
  assert.match(res.verdict, /STOPPED AT CAP|consecutive dry/, 'verdict should flag the premature cap')
})

// MAINT-R4-001: a duplicate survivor round (same key as a prior round) still ran the
// fixer, so it is NOT a dry round for convergence. Only genuinely-empty post-fix critic
// rounds count toward the consecutive-dry certification.
test('MAINT-R4-001: duplicate survivor round is not a dry round for convergence', async () => {
  const agent = makeAgent([
    ['scope + diff', scanResp],
    ['rescan', { diff: 'diff', lineCount: 10 }],
    ['maintainability', emptyLanes],
    ['security', emptyLanes],
    // r0 and r1 both surface the SAME high finding (identical category+location key);
    // each round runs + validates the fixer. r2 is the first genuinely empty critic round.
    ['correctness r1', { findings: [highFinding] }],
    ['correctness r2', { findings: [highFinding] }],
    ['correctness', emptyLanes],
    ['verify', { real: true }],
    ['fix', 'applied a fix'],
    ['validate', { applied: true, testsPass: true }],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 3, reviewers: 2, threshold: 1.0 } })
  assert.notEqual(res.verdict, 'CONVERGED CLEAN', 'only ONE empty critic round follows the final fix; must not certify clean')
  assert.match(res.verdict, /STOPPED AT CAP|consecutive dry/, 'verdict should flag the premature cap')
})

// SEC-R3-002: unanimous threshold with a split vote must be DISPUTED, not clean/dropped.
test('SEC-R3-002: split verifier votes escalate as disputed, not CONVERGED CLEAN', async () => {
  const secFinding = {
    id: 'S1', severity: 'high', category: 'security', location: 'src/auth.ts:5',
    description: 'injection', evidence: 'e', repro_test: 'fails now', boundary_owner: 'current', confidence: 'high',
  }
  const agent = makeAgent([
    ['scope + diff', scanResp],
    ['rescan', { diff: 'diff', lineCount: 10 }],
    ['maintainability', emptyLanes],
    ['correctness', emptyLanes],
    ['security r1', { findings: [secFinding] }],
    ['security', emptyLanes],
    ['verify 1', { real: true }],  // reviewer 1 reproduces it
    ['verify 2', { real: false }], // reviewer 2 disagrees -> 1/2 < 1.0 threshold
    ['fix', 'SHOULD NOT RUN'],
    ['validate', { applied: true, testsPass: true }],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 3, reviewers: 2, threshold: 1.0 } })
  assert.ok(!agent.calls.some((l) => l.startsWith('fix')), 'disputed finding must NOT be handed to the fixer')
  assert.equal(res.disputed.length, 1, 'split-vote finding is escalated as disputed')
  assert.equal(res.disputed[0].location, secFinding.location)
  assert.notEqual(res.verdict, 'CONVERGED CLEAN', 'disagreement must not be certified clean')
  assert.match(res.verdict, /DISPUTED/, 'verdict should flag disputed findings')
})

// --- Runner ---------------------------------------------------------------
let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log('PASS ' + name) }
  catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + (e && e.message)) }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`)
process.exit(failed ? 1 : 0)
