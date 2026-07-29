// Tests for review-loop.json workflow script convergence/verdict logic.
// Runs the REAL script body from review-loop.json with mocked agent primitives.
// Faithful copies of loopUntilDry + verify come from @quintinshaw/pi-dynamic-workflows.
//
// Run: node work/.pi/workflows/saved/review-loop.test.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
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

const makeFinding = (id, overrides = {}) => ({
  ...highFinding,
  id,
  location: 'src/' + id.toLowerCase() + '.ts:1',
  description: 'finding ' + id,
  ...overrides,
})

function makeAgent(handlers) {
  const calls = []
  const prompts = []
  const options = []
  const agent = async (prompt, opts = {}) => {
    const label = (opts && opts.label) || ''
    calls.push(label)
    prompts.push({ label, prompt })
    options.push({ label, opts })
    for (const [prefix, fn] of handlers) {
      if (label.startsWith(prefix)) return typeof fn === 'function' ? fn(label) : fn
    }
    return null
  }
  agent.calls = calls
  agent.prompts = prompts
  agent.options = options
  return agent
}

const emptyLanes = { findings: [] }
// Chunked-scope schema: a safe git diff command + deterministic numstat counts.
const scanResp = { diffCmd: 'git diff', files: [{ path: 'src/x.ts', lineCount: 10 }], totalLines: 10 }
const focusedPass = {
  applied: true,
  focusedTestsStatus: 'passed',
  commands: [{ command: 'node --test src/x.test.ts', status: 'passed', purpose: 'exercise the fixed boundary' }],
  checkedFindingIds: ['F1'],
  changedFiles: ['src/x.ts', 'src/x.test.ts'],
  notes: 'Focused regression passed.',
}
const finalPass = {
  status: 'passed',
  commands: [{ command: 'npm test', status: 'passed', purpose: 'full repository suite' }],
  summary: 'Full suite passed.',
  failures: [],
}
const fixReport = {
  summary: 'Guarded the boundary and added a regression test.',
  fixes: [{ findingId: 'F1', location: highFinding.location, change: 'Reject the invalid boundary before use.', files: ['src/x.ts'], tests: ['src/x.test.ts'] }],
  focusedTestCommands: ['node --test src/x.test.ts'],
}

// --- Tests ----------------------------------------------------------------
const tests = []
const test = (name, fn) => tests.push([name, fn])

// COR-R2-001: null validation must NOT be certified CONVERGED CLEAN.
test('COR-R2-001: null post-fix validation is not CONVERGED CLEAN', async () => {
  const agent = makeAgent([
    ['scope + sizes', scanResp],
    // round 1 (r0): correctness lane surfaces one high finding; later rounds empty.
    ['maint', emptyLanes],
    ['sec', emptyLanes],
    ['correct c0 r1', { findings: [highFinding] }],
    ['correct', emptyLanes],
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
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['sec', emptyLanes],
    ['correct c0 r1', { findings: [highFinding] }],
    ['correct', emptyLanes],
    ['verify 1', { real: true }], // reviewer 1 votes real
    ['verify 2', null], // reviewer 2 FAILED -> dropped, total becomes 1 (< reviewers=2)
    ['fix', 'SHOULD NOT RUN'],
    ['validate', focusedPass],
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
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['sec', emptyLanes],
    // SAME finding surfaces every round (same category+location key).
    ['correct', { findings: [highFinding] }],
    ['verify', { real: true }],
    ['fix', 'applied'],
    ['validate', focusedPass], // each round validates as landed
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
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['sec', emptyLanes],
    // round 1 (r0): one verified high finding, fixed + validated; round 2 (r1) empty.
    ['correct c0 r1', { findings: [highFinding] }],
    ['correct', emptyLanes],
    ['verify', { real: true }],
    ['fix', 'applied a fix'],
    ['validate', focusedPass],
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
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['sec', emptyLanes],
    // r0 and r1 both surface the SAME high finding (identical category+location key);
    // each round runs + validates the fixer. r2 is the first genuinely empty critic round.
    ['correct c0 r1', { findings: [highFinding] }],
    ['correct c0 r2', { findings: [highFinding] }],
    ['correct', emptyLanes],
    ['verify', { real: true }],
    ['fix', 'applied a fix'],
    ['validate', focusedPass],
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
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['correct', emptyLanes],
    ['sec c0 r1', { findings: [secFinding] }],
    ['sec', emptyLanes],
    ['verify 1', { real: true }],  // reviewer 1 reproduces it
    ['verify 2', { real: false }], // reviewer 2 disagrees -> 1/2 < 1.0 threshold
    ['fix', 'SHOULD NOT RUN'],
    ['validate', focusedPass],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 3, reviewers: 2, threshold: 1.0 } })
  assert.ok(!agent.calls.some((l) => l.startsWith('fix')), 'disputed finding must NOT be handed to the fixer')
  assert.equal(res.disputed.length, 1, 'split-vote finding is escalated as disputed')
  assert.equal(res.disputed[0].location, secFinding.location)
  assert.notEqual(res.verdict, 'CONVERGED CLEAN', 'disagreement must not be certified clean')
  assert.match(res.verdict, /DISPUTED/, 'verdict should flag disputed findings')
})

// CORR-C0R1-001: a null scope agent result must ABORT gracefully, not throw.
test('CORR-C0R1-001: null scope result returns ABORTED instead of throwing', async () => {
  const agent = makeAgent([
    ['scope + sizes', null], // scope agent failed / schema mismatch
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 3 } })
  assert.match(res.verdict, /^ABORTED/, 'null scope must yield a structured ABORTED verdict')
  assert.ok(!agent.calls.some((l) => l.startsWith('maint') || l.startsWith('correct') || l.startsWith('sec')),
    'no critic lanes should run when scope could not be resolved')
})

// CORR-C0R1-003: maxChunks is a HARD cap even under first-fit fragmentation.
test('CORR-C0R1-003: chunk count never exceeds maxChunks', async () => {
  // 13 files x 600 lines, maxChunks=12, chunkTarget=400 => perChunk=650. First-fit
  // gives each 600-line file its own chunk (13 > 12) unless the hard cap is enforced.
  const files = Array.from({ length: 13 }, (_v, i) => ({ path: 'f' + i + '.ts', lineCount: 600 }))
  const scan = { diffCmd: 'git diff', files, totalLines: 7800 }
  const agent = makeAgent([
    ['scope + sizes', scan],
    ['maint', emptyLanes],
    ['correct', emptyLanes],
    ['sec', emptyLanes],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 2, maxChunks: 12, chunkTargetLines: 400 } })
  assert.ok(res.chunks <= 12, 'chunk count (' + res.chunks + ') must be clamped to maxChunks=12')
})

// SEC-CHUNK-001: untrusted filenames must be shell-quoted in the lane instruction so a
// crafted path cannot inject shell commands when a lane "runs" the diff command.
test('SEC-CHUNK-001: crafted filename cannot inject shell commands', async () => {
  const marker = '/tmp/review_loop_pwn_' + process.pid + '_' + Date.now()
  if (existsSync(marker)) rmSync(marker)
  const evil = 'pwn.txt; touch ' + marker + ' #'
  const scan = { diffCmd: 'git diff', files: [{ path: evil, lineCount: 5 }], totalLines: 5 }
  const agent = makeAgent([
    ['scope + sizes', scan],
    ['maint', emptyLanes],
    ['correct', emptyLanes],
    ['sec', emptyLanes],
    ['synthesis', 'report text'],
  ])
  await runWorkflow({ agent, args: { maxRounds: 2 } })
  // Recover the exact command the lane was instructed to run.
  const lane = agent.prompts.find((p) => /^(maint|correct|sec)/.test(p.label))
  assert.ok(lane, 'a critic lane ran')
  const cmd = lane.prompt.split('running: ')[1].split('\n')[0]
  // Execute it the way an agent asked to "run" this instruction would.
  try { execFileSync('bash', ['-c', cmd], { stdio: 'ignore' }) } catch { /* diff cmd may exit nonzero; irrelevant */ }
  const injected = existsSync(marker)
  if (injected) rmSync(marker)
  assert.ok(!injected, 'shell metacharacters in a filename must NOT execute arbitrary commands')
})

// SEC-CHUNK-002: every critic lane must use the dedicated criticBig route.
test('SEC-CHUNK-002: critic lanes use criticBig', async () => {
  const tiers = []
  const agent = async (_prompt, opts = {}) => {
    const label = (opts && opts.label) || ''
    if (/^(maint|correct|sec)/.test(label)) tiers.push({ label, tier: opts.tier })
    if (label.startsWith('scope + sizes')) return scanResp
    return label ? (label.startsWith('synthesis') ? 'report' : { findings: [] }) : null
  }
  await runWorkflow({ agent, args: { maxRounds: 2 } })
  assert.ok(tiers.length > 0, 'critic lanes ran')
  for (const lane of tiers) assert.equal(lane.tier, 'criticBig', lane.label + ' must use criticBig')
})

// SEC-CHUNK-003: a finding whose verify() returns null must be escalated (unverified),
// never silently dropped from the report.
test('SEC-CHUNK-003: verify-null finding is escalated, not silently dropped', async () => {
  const secFinding = {
    id: 'S9', severity: 'high', category: 'security', location: 'src/auth.ts:42',
    description: 'real exploitable injection', evidence: 'e', repro_test: 'fails now', boundary_owner: 'current', confidence: 'high',
  }
  const agent = makeAgent([
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['correct', emptyLanes],
    ['sec c0 r1', { findings: [secFinding] }],
    ['sec', emptyLanes],
    ['verify', null], // verifier agent timed out / failed entirely
    ['fix', 'SHOULD NOT RUN'],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 3, reviewers: 2, threshold: 1.0 } })
  assert.ok(!agent.calls.some((l) => l.startsWith('fix')), 'unverified finding must not be handed to the fixer')
  assert.ok(res.unverified.some((f) => f.location === secFinding.location),
    'a verify-null security finding must surface in the unverified escalation list')
  assert.notEqual(res.verdict, 'CONVERGED CLEAN', 'a lost/unverified blocker must not certify clean')
})


// PERF-VALIDATE-001: per-round validators stay focused; the expensive full suite runs
// exactly once after two clean rounds, and structured fix details reach the report.
test('PERF-VALIDATE-001: focused tests per round and one final full validation', async () => {
  const agent = makeAgent([
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['sec', emptyLanes],
    ['correct c0 r1', { findings: [highFinding] }],
    ['correct', emptyLanes],
    ['verify', { real: true }],
    ['fix', fixReport],
    ['validate focused', focusedPass],
    ['final validation', finalPass],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 3, reviewers: 2, threshold: 1.0, focusedTestMaxCommands: 2 } })
  const focusedCalls = agent.prompts.filter((p) => p.label.startsWith('validate focused'))
  const finalCalls = agent.prompts.filter((p) => p.label === 'final validation')
  assert.equal(focusedCalls.length, 1, 'one focused validation runs for the one fix round')
  assert.equal(finalCalls.length, 1, 'the full validation runs exactly once after convergence')
  assert.match(focusedCalls[0].prompt, /DO NOT run the full repository test suite/, 'round validation must prohibit the full suite')
  assert.match(focusedCalls[0].prompt, /at most 2 focused commands/, 'round validation honors the focused command cap')
  assert.match(finalCalls[0].prompt, /FULL test suite now, once/, 'final validation owns the full suite')
  assert.equal(res.finalValidation.status, 'passed')
  assert.equal(res.verdict, 'CONVERGED CLEAN')
  assert.equal(res.fixLog[0].fixer.fixes[0].change, fixReport.fixes[0].change, 'structured fix detail is retained')
  const fixer = agent.options.find((entry) => entry.label.startsWith('fix'))
  assert.equal(fixer.opts.tier, 'fixerBig', 'fixer must use the dedicated fixerBig route')
  const synthesis = agent.prompts.find((p) => p.label === 'synthesis')
  assert.match(synthesis.prompt, /Fixed by round/, 'summary asks for detailed per-round fixes')
  assert.match(synthesis.prompt, /Reject the invalid boundary before use/, 'summary receives exact fix details')
  const scopePrompt = agent.prompts.find((p) => p.label === 'scope + sizes')
  assert.match(scopePrompt.prompt, /numstat/, 'scope sizing uses deterministic numstat')
  assert.match(scopePrompt.prompt, /do not eyeball/, 'scope sizing forbids estimates')
})

// PERF-VALIDATE-002: do not spend a full-suite run on a review that has not converged.
test('PERF-VALIDATE-002: full validation is skipped before clean convergence', async () => {
  const agent = makeAgent([
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['correct', emptyLanes],
    ['sec', emptyLanes],
    ['final validation', finalPass],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 1 } })
  assert.ok(!agent.calls.includes('final validation'), 'full validation must not run without consecutive clean rounds')
  assert.equal(res.finalValidation.status, 'skipped')
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})

// PERF-VERIFY-001: duplicate lane reports should consume one verifier panel and one fixer item.
test('PERF-VERIFY-001: duplicate gated findings are verified once per round', async () => {
  const agent = makeAgent([
    ['scope + sizes', scanResp],
    ['maint c0 r1', { findings: [highFinding] }],
    ['maint', emptyLanes],
    ['correct c0 r1', { findings: [highFinding] }],
    ['correct', emptyLanes],
    ['sec', emptyLanes],
    ['verify', { real: true }],
    ['fix', fixReport],
    ['validate focused', focusedPass],
    ['final validation', finalPass],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 3, reviewers: 2, threshold: 1.0 } })
  assert.equal(agent.calls.filter((label) => label.startsWith('verify')).length, 2, 'one two-vote verifier panel handles both lane reports')
  assert.equal(res.trajectory[0].gatedRaw, 2)
  assert.equal(res.trajectory[0].gated, 1)
  assert.equal(res.efficiency.duplicateVerificationClaimsSkipped, 1)
})

// SEC-SCOPE-001: free-form shell commands from the scope agent are never propagated.
test('SEC-SCOPE-001: unsafe diff command aborts before critic lanes', async () => {
  const agent = makeAgent([
    ['scope + sizes', { ...scanResp, diffCmd: 'git diff; touch /tmp/review-loop-pwn' }],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 3 } })
  assert.match(res.verdict, /^ABORTED/)
  assert.ok(!agent.calls.some((label) => /^(maint|correct|sec)/.test(label)), 'unsafe command never reaches a critic lane')
})


// COR-FINAL-001: convergence is never certified clean when the one full-suite run fails.
test('COR-FINAL-001: failed final full validation blocks clean verdict', async () => {
  const finalFail = {
    status: 'failed',
    commands: [{ command: 'npm test', status: 'failed', purpose: 'full repository suite', notes: 'one regression failed' }],
    summary: 'Full suite failed.',
    failures: ['boundary regression'],
  }
  const agent = makeAgent([
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['correct', emptyLanes],
    ['sec', emptyLanes],
    ['final validation', finalFail],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 2 } })
  assert.equal(agent.calls.filter((label) => label === 'final validation').length, 1)
  assert.equal(res.finalValidation.status, 'failed')
  assert.match(res.verdict, /FINAL FULL VALIDATION FAILED/)
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})

// SAFE-MUTATION-001: mutating work is never retried, and a missing fixer result
// halts the loop while preserving unresolved findings and partial-change risk.
test('SAFE-MUTATION-001: null fixer halts rounds and blocks clean validation', async () => {
  const agent = makeAgent([
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['sec', emptyLanes],
    ['correct c0 r1', { findings: [highFinding] }],
    ['correct', emptyLanes],
    ['verify', { real: true }],
    ['fix', null],
    // Even an optimistic read-only inspection cannot convert fixer failure to success.
    ['validate focused failed fixer', focusedPass],
    ['final validation', finalPass],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: {
    maxRounds: 5, reviewers: 2, threshold: 1, fixerTimeoutMs: 123456,
    focusedValidationTimeoutMs: 654321,
  } })
  const fixer = agent.options.find((entry) => entry.label.startsWith('fix'))
  assert.equal(fixer.opts.tier, 'fixerBig', 'fixer route remains fixerBig')
  assert.equal(fixer.opts.retries, 0, 'mutating fixer is never automatically retried')
  assert.equal(fixer.opts.timeoutMs, 123456, 'fixer receives configured timeout')
  assert.equal(res.roundsRun, 1, 'no later critic/fixer round is scheduled')
  assert.equal(agent.calls.filter((label) => /^(maint|correct|sec)/.test(label)).length, 3,
    'only one three-lane critic barrier runs')
  assert.equal(res.unresolved.length, 1, 'survivor remains unresolved')
  assert.equal(res.fixerFailure.round, 1)
  assert.equal(res.fixerFailure.timeoutOrFailure, true)
  assert.equal(res.fixerFailure.partialWorkingTreeChangesMayExist, true)
  assert.equal(res.fixLog[0].applied, null, 'validator inspection cannot confirm a failed fixer')
  assert.equal(res.fixLog[0].partialWorkingTreeChangesMayExist, true)
  assert.equal(res.finalValidation.status, 'skipped')
  assert.equal(res.finalValidation.reason, 'fixer-failed-or-timed-out')
  assert.ok(!agent.calls.includes('final validation'), 'full validation is ineligible after fixer failure')
  assert.match(res.verdict, /fixer failed or timed out; inspect partial working-tree changes/)
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})

// PERF-BOUND-001: the critic contract itself caps each lane and asks the model to
// spend that capacity only on its highest-priority actionable findings.
test('PERF-BOUND-001: critic finding arrays are schema-bounded', async () => {
  const tooMany = Array.from({ length: 7 }, (_v, i) => makeFinding('L' + i))
  const agent = makeAgent([
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['correct c0 r1', { findings: tooMany }],
    ['correct', emptyLanes],
    ['sec', emptyLanes],
    ['verify', { real: false }],
    ['synthesis', 'report text'],
  ])
  await runWorkflow({ agent, args: { maxRounds: 1, reviewers: 1, maxFindingsPerLane: 4, maxVerifyClaimsPerRound: 1 } })
  const critic = agent.options.find((entry) => entry.label === 'correct c0 r1')
  assert.equal(critic.opts.schema.properties.findings.maxItems, 4, 'finding schema enforces the configured lane cap')
  const prompt = agent.prompts.find((entry) => entry.label === 'correct c0 r1').prompt
  assert.match(prompt, /highest-priority actionable findings, up to 4 total/, 'critic prompt prioritizes within the cap')
})

// PERF-BOUND-002: verifier cardinality is capped after deterministic prioritization,
// and every unverified overflow claim remains visible and blocks clean certification.
test('PERF-BOUND-002: verifier fan-out is capped and overflow is preserved', async () => {
  const findings = [
    makeFinding('Z', { severity: 'high', confidence: 'low', location: 'src/z.ts:1' }),
    makeFinding('B', { severity: 'blocker', confidence: 'low', location: 'src/b.ts:1' }),
    makeFinding('C', { severity: 'high', confidence: 'high', location: 'src/c.ts:1' }),
    makeFinding('A', { severity: 'high', confidence: 'high', location: 'src/a.ts:1' }),
    makeFinding('M', { severity: 'high', confidence: 'medium', location: 'src/m.ts:1' }),
  ]
  const agent = makeAgent([
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['correct c0 r1', { findings }],
    ['correct', emptyLanes],
    ['sec', emptyLanes],
    ['verify', { real: false }],
    ['final validation', finalPass],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: {
    maxRounds: 1, reviewers: 3, maxFindingsPerLane: 5, maxVerifyClaimsPerRound: 2,
  } })
  const verifyCalls = agent.calls.filter((label) => label.startsWith('verify'))
  assert.equal(verifyCalls.length, 2 * 3, 'verifier calls never exceed claim cap times reviewers')
  const firstVotes = agent.prompts.filter((entry) => entry.label === 'verify 1')
  assert.match(firstVotes[0].prompt, /src\/b\.ts:1/, 'blocker is verified first')
  assert.match(firstVotes[1].prompt, /src\/a\.ts:1/, 'high-confidence stable key ordering breaks ties')
  assert.equal(res.verificationOverflow.length, 3, 'every overflow claim is recorded')
  assert.equal(res.unresolvedVerificationOverflow.length, 3, 'unverified overflow remains unresolved')
  assert.deepEqual(res.trajectory[0].verificationOverflow.map((finding) => finding.id), ['C', 'M', 'Z'])
  assert.equal(res.efficiency.verificationOverflowClaims, 3)
  assert.equal(res.finalValidation.status, 'skipped')
  assert.equal(res.finalValidation.reason, 'verification-overflow')
  assert.ok(!agent.calls.includes('final validation'), 'overflow blocks final full validation')
  assert.match(res.verdict, /verification overflow/)
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
  const synthesis = agent.prompts.find((entry) => entry.label === 'synthesis').prompt
  assert.match(synthesis, /VERIFICATION OVERFLOW LEDGER/)
  assert.match(synthesis, /src\/c\.ts:1/, 'synthesis receives overflow findings')
})

// CONFIG-BOUND-001: malformed or extreme numeric arguments cannot expand work past
// the documented bounds, and omitted values retain the documented defaults.
test('CONFIG-BOUND-001: numeric arguments are clamped to documented ranges', async () => {
  const cleanAgent = () => makeAgent([
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['correct', emptyLanes],
    ['sec', emptyLanes],
    ['final validation', finalPass],
    ['synthesis', 'report text'],
  ])
  const highAgent = cleanAgent()
  const high = await runWorkflow({ agent: highAgent, args: {
    maxRounds: 999, reviewers: 999, maxChunks: 999, maxFindingsPerLane: 999, maxVerifyClaimsPerRound: 999,
    fixerTimeoutMs: 99999999, focusedValidationTimeoutMs: 99999999, finalValidationTimeoutMs: 99999999,
  } })
  assert.deepEqual(
    { maxRounds: high.limits.maxRounds, reviewers: high.limits.reviewers, maxChunks: high.limits.maxChunks,
      maxFindingsPerLane: high.limits.maxFindingsPerLane, maxVerifyClaimsPerRound: high.limits.maxVerifyClaimsPerRound,
      fixerTimeoutMs: high.limits.fixerTimeoutMs, focusedValidationTimeoutMs: high.limits.focusedValidationTimeoutMs,
      finalValidationTimeoutMs: high.limits.finalValidationTimeoutMs },
    { maxRounds: 5, reviewers: 3, maxChunks: 12, maxFindingsPerLane: 10, maxVerifyClaimsPerRound: 16,
      fixerTimeoutMs: 1800000, focusedValidationTimeoutMs: 1800000, finalValidationTimeoutMs: 3600000 })

  const low = await runWorkflow({ agent: cleanAgent(), args: {
    maxRounds: -1, reviewers: -1, maxChunks: -1, maxFindingsPerLane: -1, maxVerifyClaimsPerRound: -1,
    fixerTimeoutMs: -1, focusedValidationTimeoutMs: -1, finalValidationTimeoutMs: -1,
  } })
  assert.deepEqual(
    { maxRounds: low.limits.maxRounds, reviewers: low.limits.reviewers, maxChunks: low.limits.maxChunks,
      maxFindingsPerLane: low.limits.maxFindingsPerLane, maxVerifyClaimsPerRound: low.limits.maxVerifyClaimsPerRound,
      fixerTimeoutMs: low.limits.fixerTimeoutMs, focusedValidationTimeoutMs: low.limits.focusedValidationTimeoutMs,
      finalValidationTimeoutMs: low.limits.finalValidationTimeoutMs },
    { maxRounds: 1, reviewers: 1, maxChunks: 1, maxFindingsPerLane: 1, maxVerifyClaimsPerRound: 1,
      fixerTimeoutMs: 60000, focusedValidationTimeoutMs: 60000, finalValidationTimeoutMs: 300000 })

  const defaults = await runWorkflow({ agent: cleanAgent(), args: {} })
  assert.equal(defaults.limits.maxRounds, 3)
  assert.equal(defaults.limits.reviewers, 2)
  assert.equal(defaults.limits.maxChunks, 6)
  assert.equal(defaults.limits.maxFindingsPerLane, 5)
  assert.equal(defaults.limits.maxVerifyClaimsPerRound, 8)
  assert.equal(defaults.limits.fixerTimeoutMs, 900000)
  assert.equal(defaults.limits.focusedValidationTimeoutMs, 600000)
  assert.equal(defaults.limits.finalValidationTimeoutMs, 1800000)
})

// PERF-TIMEOUT-001: longer read-only validators get explicit independent timeout
// boundaries; only the focused validator receives one recoverable retry.
test('PERF-TIMEOUT-001: validators receive configured timeout and retry options', async () => {
  const agent = makeAgent([
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['sec', emptyLanes],
    ['correct c0 r1', { findings: [highFinding] }],
    ['correct', emptyLanes],
    ['verify', { real: true }],
    ['fix', fixReport],
    ['validate focused', focusedPass],
    ['final validation', finalPass],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: {
    maxRounds: 3, reviewers: 2, threshold: 1,
    focusedValidationTimeoutMs: 777000, finalValidationTimeoutMs: 2345000,
  } })
  const focused = agent.options.find((entry) => entry.label.startsWith('validate focused'))
  const final = agent.options.find((entry) => entry.label === 'final validation')
  assert.equal(focused.opts.timeoutMs, 777000)
  assert.equal(focused.opts.retries, 1, 'focused read-only validation retries at most once')
  assert.equal(final.opts.timeoutMs, 2345000)
  assert.equal(final.opts.retries, 0, 'expensive full validation is not automatically retried')
  assert.match(agent.prompts.find((entry) => entry.label === 'final validation').prompt, /Work read-only/)
  assert.equal(res.verdict, 'CONVERGED CLEAN', 'normal clean workflow still converges')
})

// COR-FINAL-002: a timed-out/null full validator is missing coverage, never clean.
test('COR-FINAL-002: null final validator blocks clean verdict', async () => {
  const agent = makeAgent([
    ['scope + sizes', scanResp],
    ['maint', emptyLanes],
    ['correct', emptyLanes],
    ['sec', emptyLanes],
    ['final validation', null],
    ['synthesis', 'report text'],
  ])
  const res = await runWorkflow({ agent, args: { maxRounds: 2 } })
  assert.equal(res.finalValidation.status, 'unavailable')
  assert.equal(res.finalValidation.reason, 'validator-null')
  assert.match(res.verdict, /FINAL FULL VALIDATION UNAVAILABLE/)
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})

// --- Runner ---------------------------------------------------------------
let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log('PASS ' + name) }
  catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + (e && e.message)) }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`)
process.exit(failed ? 1 : 0)
