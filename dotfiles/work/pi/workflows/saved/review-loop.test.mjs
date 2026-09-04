import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const wf = JSON.parse(readFileSync(join(here, 'review-loop.json'), 'utf8'))
const parallel = async (thunks) => Promise.all(thunks.map((thunk) => thunk()))

async function runWorkflow({ agent, args = {} }) {
  const body = wf.script.replace(/export const meta/, 'const meta')
  const log = () => {}
  const phase = () => {}
  const fn = new Function('agent', 'parallel', 'log', 'phase', 'args', 'return (async () => {' + body + '})()')
  return fn(agent, parallel, log, phase, args)
}

function makeAgent(handlers) {
  const calls = []
  const prompts = []
  const options = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || ''
    calls.push(label)
    prompts.push({ label, prompt })
    options.push({ label, opts })
    for (const [prefix, value] of handlers) {
      if (label.startsWith(prefix)) return typeof value === 'function' ? value(label, prompt, opts) : value
    }
    return null
  }
  agent.calls = calls
  agent.prompts = prompts
  agent.options = options
  return agent
}

const file = (path, lineCount, overrides = {}) => ({
  path,
  lineCount,
  role: 'implementation',
  reason: 'Changed hunk',
  selected: true,
  kind: 'file',
  resolvedPathContained: true,
  ...overrides,
})
const discovery = (files, overrides = {}) => ({
  files,
  exclusions: [],
  coverage: { complete: true, warnings: [] },
  evidence: ['deterministic inventory'],
  disagreements: [],
  requestedCoverage: [],
  includedCount: files.length,
  trackedRelevantCount: files.length,
  ...overrides,
})
const diffDiscovery = discovery([file('src/x.ts', 10)])
const emptyLanes = { findings: [] }
const highFinding = {
  id: 'F1',
  severity: 'high',
  category: 'correctness',
  location: 'src/x.ts:10',
  description: 'boundary bug',
  evidence: 'bad boundary is accepted',
  repro_test: 'fails now',
  fix_scope: 'target',
  confidence: 'high',
}
const makeFinding = (id, overrides = {}) => ({
  ...highFinding,
  id,
  location: 'src/' + id.toLowerCase() + '.ts:1',
  description: 'finding ' + id,
  ...overrides,
})
const fixReport = {
  summary: 'Guarded the boundary and added a regression test.',
  fixes: [{ findingId: 'F1', location: highFinding.location, change: 'Reject invalid input.', files: ['src/x.ts'], tests: ['src/x.test.ts'] }],
  focusedTestCommands: ['node --test src/x.test.ts'],
}
const focusedPass = {
  applied: true,
  focusedTestsStatus: 'passed',
  commands: [{ command: 'node --test src/x.test.ts', status: 'passed', purpose: 'focused regression' }],
  checkedFindingIds: ['F1'],
  changedFiles: ['src/x.ts', 'src/x.test.ts'],
  notes: 'Focused regression passed.',
}
const refreshWithTest = {
  actualChangedFiles: ['src/x.ts', 'src/x.test.ts'],
  files: [
    { path: 'src/x.ts', lineCount: 12, role: 'implementation', reason: 'Verified fix changed the target.', kind: 'file', resolvedPathContained: true, policy: 'allowed' },
    { path: 'src/x.test.ts', lineCount: 20, role: 'test', reason: 'Regression test added by the fix.', kind: 'file', resolvedPathContained: true, policy: 'allowed' },
  ],
  warnings: [],
}
const refreshNoManifestChange = {
  actualChangedFiles: ['src/x.ts', 'src/x.test.ts'],
  files: [
    { path: 'src/x.ts', lineCount: 10, role: 'implementation', reason: 'Changed hunk', kind: 'file', resolvedPathContained: true, policy: 'allowed' },
    { path: 'src/x.test.ts', lineCount: 20, role: 'test', reason: 'Regression test added by the fix.', kind: 'file', resolvedPathContained: true, policy: 'allowed' },
  ],
  warnings: [],
}
const finalPass = {
  status: 'passed',
  commands: [{ command: 'npm test', status: 'passed', purpose: 'full repository suite' }],
  summary: 'Full suite passed.',
  failures: [],
}
const baseHandlers = (extra = []) => [
  ['discover diff', diffDiscovery],
  ...extra,
  ['maint', emptyLanes],
  ['correct', emptyLanes],
  ['sec', emptyLanes],
  ['final validation', finalPass],
  ['synthesis', 'report text'],
]


// Public contract and parser behavior.
test('PARAM-001: parameter schema exposes exactly optional target', async () => {
  assert.deepEqual(Object.keys(wf.parameters), ['target'])
  assert.equal(wf.parameters.target.type, 'string')
  assert.ok(!Object.hasOwn(wf.parameters.target, 'default'))
  assert.ok(!Object.hasOwn(wf.parameters, 'required'))
})

test('PARAM-002: removed named tuning arguments are rejected', async () => {
  const agent = makeAgent([])
  const res = await runWorkflow({ agent, args: { maxRounds: '1' } })
  assert.equal(res.terminationReason, 'unknown-arguments')
  assert.match(res.verdict, /^ABORTED/)
  assert.match(res.report, /Only target is supported/)
  assert.equal(agent.calls.length, 0)
})

test('PARAM-003: no arguments select the default diff target', async () => {
  const agent = makeAgent(baseHandlers())
  const res = await runWorkflow({ agent })
  assert.equal(res.parsedTarget.kind, 'diff')
  assert.equal(res.parsedTarget.mode, 'default')
  assert.equal(res.parsedTarget.basis, 'diff')
})

test('PARAM-004: positional selector reaches the script without a metadata default', async () => {
  const agent = makeAgent([
    ['discover pr', diffDiscovery],
    ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent, args: { _: 'pr 123', _raw: 'pr 123' } })
  assert.equal(res.parsedTarget.kind, 'pr')
  assert.equal(res.parsedTarget.selector.number, 123)
})

test('PARAM-005: named target supports programmatic invocation', async () => {
  const feature = discovery([file('src/checkout.ts', 120, { reason: 'Checkout retry implementation' })])
  const agent = makeAgent([
    ['feature discover structure', feature], ['feature discover behavior', feature], ['feature reconcile', feature],
    ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent, args: { target: 'feature checkout retry and idempotency' } })
  assert.equal(res.parsedTarget.kind, 'feature')
  assert.equal(res.parsedTarget.selector.description, 'checkout retry and idempotency')
})

test('PARAM-006: named and positional targets conflict clearly', async () => {
  const res = await runWorkflow({ agent: makeAgent([]), args: { target: 'repo', _: 'diff' } })
  assert.equal(res.terminationReason, 'conflicting-targets')
  assert.match(res.report, /cannot be supplied together/)
})

test('PARAM-007: unknown target mode aborts with usage', async () => {
  const res = await runWorkflow({ agent: makeAgent([]), args: { _: 'banana src' } })
  assert.equal(res.terminationReason, 'invalid-target-selector')
  assert.match(res.report, /Usage: \/review-loop/)
})

test('PARAM-008: removed tuning cannot alter internal limits', async () => {
  const res = await runWorkflow({ agent: makeAgent([]), args: { maxRounds: 999, threshold: 0, fixerTimeoutMs: 1 } })
  assert.equal(res.limits.maxRounds, 3)
  assert.equal(res.limits.threshold, 0.51)
  assert.equal(res.limits.fixerTimeoutMs, 900000)
  assert.equal(res.terminationReason, 'unknown-arguments')
})

// Target semantics.
test('TARGET-001: explicit diff range uses diff-basis changed-line review', async () => {
  const agent = makeAgent(baseHandlers())
  const res = await runWorkflow({ agent, args: { target: 'diff main...HEAD' } })
  assert.equal(res.targetPlan.basis, 'diff')
  assert.equal(res.targetPlan.selector.range, 'main...HEAD')
  assert.equal(res.targetManifest.totalLines, 10)
  const critic = agent.prompts.find((entry) => entry.label.startsWith('maint'))
  assert.match(critic.prompt, /git diff 'main\.\.\.HEAD'/)
})

test('TARGET-002: pull request uses diff-basis review', async () => {
  const agent = makeAgent([
    ['discover pr', diffDiscovery], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent, args: { target: 'pr 42' } })
  assert.equal(res.targetPlan.kind, 'pr')
  assert.equal(res.targetPlan.basis, 'diff')
  assert.match(agent.prompts.find((entry) => entry.label.startsWith('maint')).prompt, /PR #42/)
})

test('TARGET-003: paths file reviews complete current contents without a diff', async () => {
  const pathPlan = discovery([file('src/auth.ts', 321, { reason: 'Explicit selected file' })], {
    requestedCoverage: [{ request: 'src/auth.ts', matchedFiles: 1 }],
  })
  const agent = makeAgent([
    ['discover paths', pathPlan], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent, args: { target: 'paths src/auth.ts' } })
  assert.equal(res.targetPlan.basis, 'snapshot')
  assert.equal(res.targetManifest.totalLines, 321)
  const prompt = agent.prompts.find((entry) => entry.label.startsWith('maint')).prompt
  assert.match(prompt, /COMPLETE CURRENT contents/)
  assert.doesNotMatch(prompt, /git diff/)
})

test('TARGET-004: paths directory expands every relevant tracked file', async () => {
  const files = [file('src/auth/a.ts', 50), file('src/auth/b.ts', 75)]
  const pathPlan = discovery(files, { requestedCoverage: [{ request: 'src/auth', matchedFiles: 2 }] })
  const agent = makeAgent([
    ['discover paths', pathPlan], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent, args: { target: 'paths src/auth' } })
  assert.deepEqual(res.targetManifest.files.map((entry) => entry.path), ['src/auth/a.ts', 'src/auth/b.ts'])
  assert.equal(res.targetManifest.totalLines, 125)
})

test('TARGET-005: invalid, escaping, and empty paths abort safely', async () => {
  for (const target of ['paths', 'paths ../secret', 'paths /etc/passwd', 'paths -rf']) {
    const agent = makeAgent([])
    const res = await runWorkflow({ agent, args: { target } })
    assert.match(res.verdict, /^ABORTED/, target)
    assert.equal(agent.calls.length, 0, target)
  }
})

test('TARGET-006: unresolved paths abort instead of becoming clean', async () => {
  const unresolved = discovery([], { requestedCoverage: [{ request: 'src/missing', matchedFiles: 0 }] })
  const agent = makeAgent([['discover paths', unresolved]])
  const res = await runWorkflow({ agent, args: { target: 'paths src/missing' } })
  assert.equal(res.terminationReason, 'path-resolution-failed')
  assert.ok(!agent.calls.some((label) => /^(maint|correct|sec)/.test(label)))
})

test('TARGET-007: feature uses two independent discoveries and reconciliation', async () => {
  const structure = discovery([file('src/checkout.ts', 100, { role: 'entry-point', reason: 'Route entry' })])
  const behavior = discovery([file('src/retry.ts', 80, { role: 'implementation', reason: 'Retry behavior' })])
  const reconciled = discovery([
    file('src/checkout.ts', 100, { role: 'entry-point', reason: 'Route entry' }),
    file('src/retry.ts', 80, { role: 'implementation', reason: 'Retry behavior' }),
    file('src/checkout.test.ts', 120, { role: 'test', reason: 'Feature regression coverage', selected: false }),
  ], { evidence: ['structure search', 'behavior trace'] })
  const agent = makeAgent([
    ['feature discover structure', structure], ['feature discover behavior', behavior], ['feature reconcile', reconciled],
    ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent, args: { target: 'feature checkout retry' } })
  assert.equal(agent.calls.filter((label) => label.startsWith('feature discover')).length, 2)
  assert.ok(agent.calls.includes('feature reconcile'))
  assert.equal(res.targetManifest.fileCount, 3)
  assert.match(agent.prompts.find((entry) => entry.label.startsWith('maint')).prompt, /COMPLETE CURRENT contents/)
  assert.equal(res.discovery.runs.length, 2)
})

test('TARGET-008: incomplete or conflicting feature discovery blocks clean', async () => {
  const complete = discovery([file('src/feature.ts', 20)])
  const conflict = discovery([file('src/feature.ts', 20)], { disagreements: ['Behavior discovery found an unresolved dynamic consumer.'] })
  const agent = makeAgent([
    ['feature discover structure', complete], ['feature discover behavior', complete], ['feature reconcile', conflict],
    ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes], ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent, args: { target: 'feature dynamic registration' } })
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
  assert.match(res.verdict, /discovery is incomplete/i)
  assert.equal(agent.calls.includes('final validation'), false)
  assert.match(res.residualRisk, /Semantic feature discovery/)
})

test('TARGET-009: repo inventories relevant tracked files and reports exclusions', async () => {
  const repoFiles = [file('package.json', 30, { role: 'build' }), file('src/a.ts', 100), file('src/a.test.ts', 80, { role: 'test' })]
  const repoPlan = discovery(repoFiles, {
    exclusions: [
      { category: 'dependencies', path: 'node_modules', reason: 'Dependency artifact', count: 2000 },
      { category: 'generated', path: 'dist', reason: 'Generated output', count: 20 },
    ],
  })
  const agent = makeAgent([
    ['discover repo', repoPlan], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent, args: { target: 'repo' } })
  assert.equal(res.targetPlan.kind, 'repo')
  assert.equal(res.targetPlan.basis, 'snapshot')
  assert.deepEqual(res.discovery.exclusions.map((entry) => entry.category), ['dependencies', 'generated'])
})

test('TARGET-010: every included repo file is assigned before clean certification', async () => {
  const repoFiles = [file('src/a.ts', 100), file('src/b.ts', 100), file('src/c.test.ts', 100, { role: 'test' })]
  const agent = makeAgent([
    ['discover repo', discovery(repoFiles)], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent, args: { target: 'repo' } })
  assert.equal(res.verdict, 'CONVERGED CLEAN')
  assert.ok(res.chunkCoverage.length >= 2)
  assert.ok(res.chunkCoverage.every((entry) => entry.everyFileAssigned))
  assert.equal(new Set(res.chunkCoverage.at(-1).assignedPaths).size, repoFiles.length)
})

test('TARGET-011: empty diff returns NO CHANGES without critic or final validation', async () => {
  const agent = makeAgent([['discover diff', discovery([])]])
  const res = await runWorkflow({ agent })
  assert.equal(res.verdict, 'NO CHANGES TO REVIEW')
  assert.equal(res.terminationReason, 'no-changes')
  assert.ok(!agent.calls.some((label) => /^(maint|correct|sec)/.test(label)))
  assert.ok(!agent.calls.includes('final validation'))
})

test('TARGET-012: empty feature and repo manifests do not become clean', async () => {
  const empty = discovery([])
  const featureAgent = makeAgent([
    ['feature discover structure', empty], ['feature discover behavior', empty], ['feature reconcile', empty],
  ])
  const featureRes = await runWorkflow({ agent: featureAgent, args: { target: 'feature missing' } })
  assert.match(featureRes.verdict, /^ABORTED/)
  const repoRes = await runWorkflow({ agent: makeAgent([['discover repo', empty]]), args: { target: 'repo' } })
  assert.match(repoRes.verdict, /^ABORTED/)
})

test('TARGET-013: null target discovery aborts without critic coverage', async () => {
  const agent = makeAgent([['discover diff', null]])
  const res = await runWorkflow({ agent })
  assert.equal(res.terminationReason, 'target-discovery-failed')
  assert.match(res.verdict, /^ABORTED/)
  assert.ok(!agent.calls.some((label) => /^(maint|correct|sec)/.test(label)))
})

// Coverage and command safety.
test('COVERAGE-001: hard target overflow is inconclusive with no partial critics', async () => {
  const files = Array.from({ length: 7 }, (_unused, index) => file('src/f' + index + '.ts', 12000))
  const agent = makeAgent([['discover repo', discovery(files)], ['synthesis', 'report']])
  const res = await runWorkflow({ agent, args: { target: 'repo' } })
  assert.equal(res.verdict, 'INCONCLUSIVE - target exceeds coverage limit')
  assert.equal(res.skippedCoverage.fileCount, 7)
  assert.equal(res.skippedCoverage.lineCount, 84000)
  assert.ok(!agent.calls.some((label) => /^(maint|correct|sec)/.test(label)))
})

test('COVERAGE-002: chunk overflow is never merged into an unbounded last chunk', async () => {
  const files = Array.from({ length: 13 }, (_unused, index) => file('f' + index + '.ts', 600))
  const agent = makeAgent([['discover diff', discovery(files)]])
  const res = await runWorkflow({ agent })
  assert.equal(res.terminationReason, 'coverage-limit-exceeded')
  assert.equal(res.chunks, 0)
  assert.ok(res.proposedChunks > res.limits.maxChunks)
  assert.ok(!res.chunkSummary.some((chunk) => chunk.lines > res.limits.maxChunkLines.diff))
})

test('COVERAGE-003: resolver shell command cannot reach critic instructions', async () => {
  const poisoned = { ...diffDiscovery, diffCmd: 'git diff; touch /tmp/review-loop-pwn' }
  const agent = makeAgent([
    ['discover diff', poisoned], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  await runWorkflow({ agent })
  const critics = agent.prompts.filter((entry) => /^(maint|correct|sec)/.test(entry.label))
  assert.ok(critics.length > 0)
  for (const critic of critics) assert.doesNotMatch(critic.prompt, /touch \/tmp\/review-loop-pwn/)
})

test('COVERAGE-004: snapshot uses full-file lines while diff uses changed lines', async () => {
  const diffAgent = makeAgent(baseHandlers())
  const diffRes = await runWorkflow({ agent: diffAgent })
  const pathPlan = discovery([file('src/x.ts', 1000)], { requestedCoverage: [{ request: 'src/x.ts', matchedFiles: 1 }] })
  const pathAgent = makeAgent([
    ['discover paths', pathPlan], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const pathRes = await runWorkflow({ agent: pathAgent, args: { target: 'paths src/x.ts' } })
  assert.equal(diffRes.targetManifest.totalLines, 10)
  assert.equal(pathRes.targetManifest.totalLines, 1000)
  assert.equal(diffRes.targetPlan.basis, 'diff')
  assert.equal(pathRes.targetPlan.basis, 'snapshot')
})

test('SEC-CHUNK-001: crafted discovered filename remains shell-quoted', async () => {
  const marker = '/tmp/review_loop_pwn_' + process.pid + '_' + Date.now()
  const evil = 'pwn.txt; touch ' + marker + ' #'
  const agent = makeAgent([
    ['discover diff', discovery([file(evil, 5)])], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  await runWorkflow({ agent, args: { target: 'diff HEAD' } })
  const prompt = agent.prompts.find((entry) => entry.label.startsWith('maint')).prompt
  const command = prompt.match(/git diff 'HEAD' -- (.*?)\. Never execute/)[0].replace(/\. Never execute$/, '')
  try { execFileSync('bash', ['-c', command], { stdio: 'ignore' }) } catch {}
  const injected = existsSync(marker)
  if (injected) rmSync(marker)
  assert.equal(injected, false)
})

test('COVERAGE-005: lane file permutations are deterministic, complete, and diverse', async () => {
  const files = Array.from({ length: 6 }, (_unused, index) => file('src/file-' + index + '.ts', 1))
  const run = async () => {
    const agent = makeAgent([
      ['discover diff', discovery(files)], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
      ['final validation', finalPass], ['synthesis', 'report'],
    ])
    await runWorkflow({ agent, args: { target: 'diff HEAD' } })
    return Object.fromEntries(agent.prompts.filter((entry) => /^(maint|correct|sec)/.test(entry.label)).map((entry) => {
      const pathList = entry.prompt.split("git diff 'HEAD' -- ")[1].split('. Never execute')[0]
      return [entry.label, Array.from(pathList.matchAll(/'([^']+)'/g), (match) => match[1])]
    }))
  }
  const first = await run()
  const second = await run()
  assert.deepEqual(first, second)
  const expected = files.map((entry) => entry.path).sort()
  for (const paths of Object.values(first)) assert.deepEqual(paths.slice().sort(), expected)
  assert.notDeepEqual(first['maint c0 r1 v1'], first['correct c0 r1 v1'])
  assert.notDeepEqual(first['maint c0 r1 v1'], first['maint c0 r2 v1'])
})

// Manifest refresh and mutation policy.
test('MANIFEST-001: fixer-added tests enter the next manifest and critic coverage', async () => {
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }],
    ['verify', { real: true }], ['fix', fixReport], ['validate focused', focusedPass], ['refresh manifest', refreshWithTest],
  ]))
  const res = await runWorkflow({ agent })
  assert.ok(res.targetManifest.files.some((entry) => entry.path === 'src/x.test.ts'))
  assert.ok(res.manifestChanges.some((entry) => entry.added.includes('src/x.test.ts')))
  const roundTwo = agent.prompts.find((entry) => entry.label.includes('r2') && entry.label.startsWith('maint'))
  assert.match(roundTwo.prompt, /src\/x\.test\.ts/)
  assert.ok(res.chunkCoverage.some((entry) => entry.manifestVersion === 2 && entry.assignedPaths.includes('src/x.test.ts')))
})

test('MANIFEST-002: out-of-policy fixer changes are escalated and block clean', async () => {
  const outOfPolicyRefresh = {
    actualChangedFiles: ['src/x.ts', '../outside.ts'],
    files: [
      { path: 'src/x.ts', lineCount: 10, role: 'implementation', reason: 'Changed hunk', kind: 'file', resolvedPathContained: true, policy: 'allowed' },
      { path: 'infra/prod.tf', lineCount: 30, role: 'external', reason: 'Outside selected path policy', kind: 'file', resolvedPathContained: true, policy: 'external' },
      { path: 'src/x.test.ts', lineCount: 20, role: 'test', reason: 'Regression test', kind: 'file', resolvedPathContained: true, policy: 'allowed' },
    ],
    warnings: [],
  }
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: true }], ['fix', fixReport],
    ['validate focused', focusedPass], ['refresh manifest', outOfPolicyRefresh],
  ]))
  const res = await runWorkflow({ agent })
  assert.ok(res.outOfPolicyChanges.length >= 1)
  assert.match(res.verdict, /outside the target mutation policy/)
  assert.ok(!agent.calls.includes('final validation'))
})

test('MANIFEST-003: manifest changes reset clean-round convergence', async () => {
  const agent = makeAgent(baseHandlers([
    ['correct c0 r2', { findings: [highFinding] }], ['verify', { real: true }], ['fix', fixReport],
    ['validate focused', focusedPass], ['refresh manifest', refreshWithTest],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(res.manifestChanges.at(-1).version, 2)
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
  assert.match(res.verdict, /STOPPED AT CAP|dry rounds/)
})

test('MANIFEST-004: refresh coverage gaps block clean certification', async () => {
  const incompleteRefresh = { actualChangedFiles: ['src/x.ts', 'src/x.test.ts'], files: [], warnings: [] }
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: true }], ['fix', fixReport],
    ['validate focused', focusedPass], ['refresh manifest', incompleteRefresh],
  ]))
  const res = await runWorkflow({ agent })
  assert.match(res.verdict, /manifest refresh is incomplete/)
  assert.ok(!agent.calls.includes('final validation'))
})

test('SEC-AUTH-001: supporting-scope findings outside the repository are external, never fixed', async () => {
  const feature = discovery([file('src/x.ts', 10)])
  const externalFinding = {
    ...highFinding,
    id: 'EXT1',
    category: 'security',
    path: '../../.ssh/config',
    location: '../../.ssh/config:1',
    fix_scope: 'supporting',
  }
  const agent = makeAgent([
    ['feature discover structure', feature], ['feature discover behavior', feature], ['feature reconcile', feature],
    ['sec c0 r1', { findings: [externalFinding] }],
    ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['verify', { real: true }], ['fix', fixReport],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent, args: { target: 'feature ssh config' } })
  assert.ok(!agent.calls.some((label) => label.startsWith('fix')))
  assert.ok(agent.calls.some((label) => label.startsWith('verify')))
  assert.ok(res.escalated.some((finding) => finding.location === '../../.ssh/config:1'))
  assert.ok(!res.tracked.some((finding) => finding.location === '../../.ssh/config:1'))
  assert.ok(!res.fixLog.some((entry) => JSON.stringify(entry).includes('.ssh/config')))
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})

// Routing, bounds, verification, convergence, and validation regressions.
test('ROUTE-001: all critic calls retain criticBig and no exact model override', async () => {
  const agent = makeAgent(baseHandlers())
  await runWorkflow({ agent })
  const critics = agent.options.filter((entry) => /^(maint|correct|sec)/.test(entry.label))
  assert.ok(critics.length > 0)
  for (const critic of critics) {
    assert.equal(critic.opts.tier, 'criticBig')
    assert.ok(!Object.hasOwn(critic.opts, 'model'))
  }
})

test('ROUTE-002: fixer uses fixerBig, zero retries, and internal timeout', async () => {
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: true }], ['fix', null],
    ['validate focused failed fixer', focusedPass],
  ]))
  const res = await runWorkflow({ agent })
  const fixer = agent.options.find((entry) => entry.label.startsWith('fix'))
  assert.equal(fixer.opts.tier, 'fixerBig')
  assert.equal(fixer.opts.retries, 0)
  assert.equal(fixer.opts.timeoutMs, 900000)
  assert.ok(!Object.hasOwn(fixer.opts, 'model'))
  assert.equal(res.roundsRun, 1)
  assert.match(res.verdict, /fixer failed or timed out/)
})

test('ROUTE-003: verifiers remain pinned independently to medium', async () => {
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: false }],
  ]))
  await runWorkflow({ agent })
  const verifiers = agent.options.filter((entry) => entry.label.startsWith('verify'))
  assert.equal(verifiers.length, 2)
  assert.ok(verifiers.every((entry) => entry.opts.tier === 'medium'))
})

test('ROUTE-004: focused and final validators use internal limits', async () => {
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: true }], ['fix', fixReport],
    ['validate focused', focusedPass], ['refresh manifest', refreshWithTest],
  ]))
  const res = await runWorkflow({ agent })
  const focused = agent.options.find((entry) => entry.label.startsWith('validate focused'))
  const final = agent.options.find((entry) => entry.label === 'final validation')
  assert.equal(focused.opts.timeoutMs, 600000)
  assert.equal(focused.opts.retries, 1)
  assert.equal(final.opts.timeoutMs, 1800000)
  assert.equal(final.opts.retries, 0)
  assert.equal(res.verdict, 'CONVERGED CLEAN')
})

test('COVERAGE-006: zero completed critic lanes cannot pass vacuously', async () => {
  const agent = makeAgent([
    ['discover diff', diffDiscovery], ['maint', null], ['correct', null], ['sec', null], ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent })
  assert.ok(res.trajectory.every((entry) => entry.lanesOk === 0))
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
  assert.ok(!agent.calls.includes('final validation'))
})

test('VERIFY-001: partial verifier coverage is unverified and never fixed', async () => {
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }],
    ['verify r1 c1 v1', { real: true }], ['verify r1 c1 v2', null], ['fix', fixReport],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(res.unverified.length, 1)
  assert.ok(!agent.calls.some((label) => label.startsWith('fix')))
  assert.match(res.verdict, /UNVERIFIED/)
})

test('VERIFY-002: split verifier votes remain disputed at the internal threshold', async () => {
  const agent = makeAgent(baseHandlers([
    ['sec c0 r1', { findings: [{ ...highFinding, id: 'S1', category: 'security', location: 'src/x.ts:5' }] }],
    ['verify r1 c1 v1', { real: true }], ['verify r1 c1 v2', { real: false }], ['fix', fixReport],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(res.disputed.length, 1)
  assert.ok(!agent.calls.some((label) => label.startsWith('fix')))
  assert.match(res.verdict, /DISPUTED/)
})

test('VERIFY-003: unanimously refuted findings cannot be approved by threshold input', async () => {
  const agent = makeAgent([])
  const res = await runWorkflow({ agent, args: { threshold: 0 } })
  assert.equal(res.terminationReason, 'unknown-arguments')
  assert.equal(agent.calls.length, 0)
})

test('VERIFY-004: duplicate lane findings consume one verifier panel', async () => {
  const agent = makeAgent(baseHandlers([
    ['maint c0 r1', { findings: [highFinding] }], ['correct c0 r1', { findings: [highFinding] }],
    ['verify', { real: false }],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(agent.calls.filter((label) => label.startsWith('verify r1')).length, 2)
  assert.equal(res.trajectory[0].gatedRaw, 2)
  assert.equal(res.trajectory[0].gated, 1)
  assert.equal(res.efficiency.duplicateVerificationClaimsSkipped, 1)
})

test('VERIFY-005: verifier overflow is preserved and blocks final validation', async () => {
  const findings = Array.from({ length: 10 }, (_unused, index) => makeFinding(String.fromCharCode(65 + index), {
    severity: index === 0 ? 'blocker' : 'high',
    location: 'src/x.ts:' + (index + 1),
  }))
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: findings.slice(0, 5) }],
    ['sec c0 r1', { findings: findings.slice(5) }],
    ['verify', { real: false }],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(agent.calls.filter((label) => label.startsWith('verify r1')).length, 16)
  assert.equal(res.verificationOverflow.length, 2)
  assert.equal(res.unresolvedVerificationOverflow.length, 2)
  assert.equal(res.seriousLedger.length, findings.length)
  assert.equal(new Set(res.seriousLedger.map((entry) => entry.claimId)).size, findings.length)
  assert.ok(res.seriousLedger.every((entry) => ['refuted', 'fixed-and-validated', 'disputed', 'unverified', 'escalated'].includes(entry.status)))
  assert.match(res.verdict, /verification overflow/)
  assert.ok(!agent.calls.includes('final validation'))
})

test('BOUND-001: critic finding schema keeps the internal lane cap', async () => {
  const agent = makeAgent(baseHandlers())
  await runWorkflow({ agent })
  const critic = agent.options.find((entry) => entry.label.startsWith('correct'))
  assert.equal(critic.opts.schema.properties.findings.maxItems, 5)
  assert.match(agent.prompts.find((entry) => entry.label.startsWith('correct')).prompt, /up to 5/)
})

test('CONVERGE-001: one dry round after a late fix is not clean', async () => {
  const agent = makeAgent(baseHandlers([
    ['correct c0 r2', { findings: [highFinding] }], ['verify', { real: true }], ['fix', fixReport],
    ['validate focused', focusedPass], ['refresh manifest', refreshWithTest],
  ]))
  const res = await runWorkflow({ agent })
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
  assert.match(res.verdict, /STOPPED AT CAP|dry rounds/)
})

test('CONVERGE-002: duplicate survivor rounds are not dry', async () => {
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['correct c0 r2', { findings: [highFinding] }],
    ['verify', { real: true }], ['fix', fixReport], ['validate focused', focusedPass], ['refresh manifest', refreshWithTest],
  ]))
  const res = await runWorkflow({ agent })
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
  assert.equal(res.trajectory.filter((entry) => entry.genuinelyDry).length, 1)
})

test('CONVERGE-003: recurring finding never inflates resolved count', async () => {
  const agent = makeAgent(baseHandlers([
    ['correct', { findings: [highFinding] }], ['verify', { real: true }], ['fix', fixReport],
    ['validate focused', focusedPass], ['refresh manifest', refreshWithTest],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(res.totalAddressed, 1)
  assert.ok(res.totalResolved <= res.totalAddressed)
  assert.equal(res.totalResolved, 0)
  assert.ok(res.unresolved.some((finding) => finding.location === highFinding.location))
})

test('VALIDATE-001: null focused validation never certifies clean', async () => {
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: true }], ['fix', fixReport],
    ['validate focused', null], ['refresh manifest', refreshWithTest],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(res.totalAddressed, 1)
  assert.equal(res.totalResolved, 0)
  assert.match(res.verdict, /UNCONFIRMED/)
})

test('VALIDATE-002: failed final full validation blocks clean', async () => {
  const finalFail = { status: 'failed', commands: [{ command: 'npm test', status: 'failed', purpose: 'suite' }], summary: 'failed', failures: ['regression'] }
  const agent = makeAgent([
    ['discover diff', diffDiscovery], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalFail], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent })
  assert.equal(res.finalValidation.status, 'failed')
  assert.match(res.verdict, /FINAL FULL VALIDATION FAILED/)
})

test('VALIDATE-003: null final validator is unavailable, never clean', async () => {
  const agent = makeAgent([
    ['discover diff', diffDiscovery], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', null], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent })
  assert.equal(res.finalValidation.status, 'unavailable')
  assert.equal(res.finalValidation.reason, 'validator-null')
  assert.match(res.verdict, /FINAL FULL VALIDATION UNAVAILABLE/)
})

test('VALIDATE-004: full validation runs once only after two dry rounds', async () => {
  const agent = makeAgent(baseHandlers())
  const res = await runWorkflow({ agent })
  assert.equal(agent.calls.filter((label) => label === 'final validation').length, 1)
  assert.equal(res.efficiency.finalFullValidationRuns, 1)
  assert.equal(res.verdict, 'CONVERGED CLEAN')
})

test('REPORT-001: report data is target-aware and retains round evidence', async () => {
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: true }], ['fix', fixReport],
    ['validate focused', focusedPass], ['refresh manifest', refreshWithTest],
  ]))
  const res = await runWorkflow({ agent })
  const synthesis = agent.prompts.find((entry) => entry.label === 'synthesis').prompt
  assert.match(synthesis, /TARGET-AWARE/)
  assert.match(synthesis, /manifestChanges/)
  assert.match(synthesis, /chunkCoverage/)
  assert.match(synthesis, /tier:criticBig/)
  assert.equal(res.fixLog[0].fixer.fixes[0].change, 'Reject invalid input.')
})

// Hardening invariants characterized from the self-review control-plane failures.
const emptyRefresh = { actualChangedFiles: [], files: [], warnings: [] }
const makeFix = (findings) => ({
  summary: 'Applied the specifically bound fixes.',
  fixes: findings.map((finding) => ({
    findingId: finding.id,
    location: finding.location,
    change: 'Fix ' + finding.id,
    files: ['src/x.ts'],
    tests: ['src/x.test.ts'],
  })),
  focusedTestCommands: ['node --test src/x.test.ts'],
})
const makeFocused = (findingIds, overrides = {}) => ({
  applied: true,
  focusedTestsStatus: 'passed',
  commands: [{ command: 'node --test src/x.test.ts', status: 'passed', purpose: 'focused regression' }],
  checkedFindingIds: findingIds,
  changedFiles: ['src/x.ts', 'src/x.test.ts'],
  notes: 'Confirmed only the listed findings.',
  ...overrides,
})

// Adjudication is independent from mutation eligibility.
test('ADJUDICATE-001: malformed serious locations are unresolved and never dry', async () => {
  const malformed = { ...highFinding, id: 'MALFORMED', location: 'not a repository location (embedded line 7)' }
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [malformed] }], ['verify', { real: true }],
  ]))
  const res = await runWorkflow({ agent })
  assert.ok(agent.calls.some((label) => label.startsWith('verify')))
  assert.ok(res.escalated.some((finding) => finding.id === 'MALFORMED'))
  assert.ok(res.trajectory.every((entry) => entry.genuinelyDry === false))
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})

test('ADJUDICATE-002: serious findings outside mutation scope never reach the fixer', async () => {
  const outsideScope = { ...highFinding, id: 'OUTSIDE', path: 'src/unrelated.ts', location: 'src/unrelated.ts:4' }
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [outsideScope] }], ['verify', { real: true }], ['fix', makeFix([outsideScope])],
  ]))
  const res = await runWorkflow({ agent })
  assert.ok(agent.calls.some((label) => label.startsWith('verify')))
  assert.ok(!agent.calls.some((label) => label.startsWith('fix')))
  assert.ok(res.escalated.some((finding) => finding.id === 'OUTSIDE'))
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})

test('ADJUDICATE-003: lower-severity findings remain informational only', async () => {
  const informational = { ...highFinding, id: 'INFO', severity: 'medium', path: 'src/x.ts', repro_test: undefined }
  const agent = makeAgent(baseHandlers([['maint c0 r1', { findings: [informational] }]]))
  const res = await runWorkflow({ agent })
  assert.ok(!agent.calls.some((label) => label.startsWith('verify')))
  assert.ok(res.tracked.some((finding) => finding.id === 'INFO' && finding.adjudication === 'informational'))
  assert.ok(!res.verified.some((finding) => finding.id === 'INFO'))
})

// Structured paths and repository-relative authorization.
test('PATH-001: decorated display locations authorize only through canonical path', async () => {
  const decorated = {
    ...highFinding,
    id: 'DECORATED',
    path: 'src/x.ts',
    location: 'src/x.ts:10 (embedded script line 737)',
  }
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [decorated] }], ['verify', { real: false }],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(agent.calls.filter((label) => label.startsWith('verify r1')).length, 2)
  assert.ok(res.refuted.some((finding) => finding.canonicalPath === 'src/x.ts'))
})

test('PATH-002: unsafe path forms are rejected before discovery', async () => {
  const unsafe = [
    '../../outside',
    '..\\outside',
    'C:\\Users\\victim\\.ssh\\config',
    'C:relative\\path',
    '\\\\server\\share\\file',
    '/absolute/path',
    'src//empty.ts',
    'src/./dot.ts',
    'src/\0bad.ts',
  ]
  for (const path of unsafe) {
    const agent = makeAgent([])
    const res = await runWorkflow({ agent, args: { target: 'paths ' + path } })
    assert.match(res.verdict, /^ABORTED/, path)
    assert.equal(agent.calls.length, 0, path)
  }
  const valid = discovery([file('src/normal.ts', 4)], { requestedCoverage: [{ request: 'src/normal.ts', matchedFiles: 1 }] })
  const validAgent = makeAgent([
    ['discover paths', valid], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const validResult = await runWorkflow({ agent: validAgent, args: { target: 'paths src/normal.ts' } })
  assert.equal(validResult.targetManifest.files[0].path, 'src/normal.ts')
})

test('PATH-003: external symlink targets are never mutation-authorized', async () => {
  const symlinkDiscovery = discovery([file('src/x.ts', 10, { kind: 'symlink', resolvedPathContained: false })])
  const finding = { ...highFinding, path: 'src/x.ts' }
  const agent = makeAgent([
    ['discover diff', symlinkDiscovery], ['correct c0 r1', { findings: [finding] }],
    ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['verify', { real: true }], ['fix', fixReport], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent })
  assert.ok(!agent.calls.some((label) => label.startsWith('fix')))
  assert.ok(res.escalated.some((entry) => entry.id === 'F1'))
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})

test('PATH-004: discovery and findings expose dedicated path and file-kind contracts', async () => {
  const agent = makeAgent(baseHandlers())
  await runWorkflow({ agent })
  const discover = agent.options.find((entry) => entry.label === 'discover diff')
  const critic = agent.options.find((entry) => entry.label.startsWith('correct'))
  const fileContract = discover.opts.schema.properties.files.items
  assert.ok(fileContract.required.includes('kind'))
  assert.ok(fileContract.required.includes('resolvedPathContained'))
  assert.ok(Object.hasOwn(critic.opts.schema.properties.findings.items.properties, 'path'))
})

// Claim identity is semantic rather than a coarse category/location key.
test('IDENTITY-001: distinct co-located defects receive distinct verifier panels', async () => {
  const first = { ...highFinding, id: 'COLOCATED-A', path: 'src/x.ts', description: 'authorization bypass', repro_test: 'unauthorized user succeeds' }
  const second = { ...highFinding, id: 'COLOCATED-B', path: 'src/x.ts', description: 'unsafe command execution', repro_test: 'crafted script executes' }
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [first, second] }], ['verify', { real: false }],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(agent.calls.filter((label) => label.startsWith('verify r1')).length, 4)
  assert.equal(res.refuted.filter((finding) => finding.canonicalPath === 'src/x.ts').length, 2)
})

test('IDENTITY-002: a new co-located claim cannot resolve prior overflow', async () => {
  const initial = Array.from({ length: 9 }, (_unused, index) => makeFinding('OVERFLOW-' + index, {
    path: 'src/x.ts',
    location: 'src/x.ts:10',
    description: 'distinct overflow claim ' + index,
    repro_test: 'repro ' + index,
  }))
  const later = { ...initial[8], id: 'LATER', description: 'different later claim', repro_test: 'different later repro' }
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: initial.slice(0, 5) }],
    ['sec c0 r1', { findings: initial.slice(5) }],
    ['correct c0 r2', { findings: [later] }],
    ['verify', { real: false }],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(res.unresolvedVerificationOverflow.length, 1)
  assert.match(res.unresolvedVerificationOverflow[0].finding.description, /^distinct overflow claim /)
  assert.notEqual(res.unresolvedVerificationOverflow[0].finding.description, later.description)
})

test('IDENTITY-003: addressed totals count distinct claims at one location', async () => {
  const first = { ...highFinding, id: 'COUNT-A', path: 'src/x.ts', description: 'first defect', repro_test: 'first repro' }
  const second = { ...highFinding, id: 'COUNT-B', path: 'src/x.ts', description: 'second defect', repro_test: 'second repro' }
  const fix = makeFix([first, second])
  const validation = makeFocused(['COUNT-A', 'COUNT-B'])
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [first, second] }], ['verify', { real: true }],
    ['fix', fix], ['validate focused', validation], ['refresh manifest', refreshWithTest],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(res.totalAddressed, 2)
  assert.equal(res.totalResolved, 2)
})

// Fixes and focused validation resolve only explicitly bound claims.
test('FOCUSED-001: an empty fixer response resolves no findings', async () => {
  const emptyFix = { summary: 'No fixes', fixes: [], focusedTestCommands: [] }
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: true }], ['fix', emptyFix],
    ['validate focused', focusedPass], ['refresh manifest', emptyRefresh],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(res.totalResolved, 0)
  assert.ok(res.escalated.some((finding) => finding.id === 'F1'))
})

test('FOCUSED-002: omitted fixer survivors remain unresolved', async () => {
  const second = makeFinding('F2', { path: 'src/x.ts', location: 'src/x.ts:20' })
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding, second] }], ['verify', { real: true }],
    ['fix', makeFix([highFinding])], ['validate focused', makeFocused(['F1'])], ['refresh manifest', refreshWithTest],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(res.totalResolved, 1)
  assert.ok(res.escalated.some((finding) => finding.id === 'F2'))
})

test('FOCUSED-003: unchecked survivors remain unresolved', async () => {
  const second = makeFinding('F2', { path: 'src/x.ts', location: 'src/x.ts:20' })
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding, second] }], ['verify', { real: true }],
    ['fix', makeFix([highFinding, second])], ['validate focused', makeFocused(['F1'])], ['refresh manifest', refreshWithTest],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(res.totalResolved, 1)
  assert.ok(res.escalated.some((finding) => finding.id === 'F2'))
})

test('FOCUSED-004: passed focused validation requires executed passing commands', async () => {
  const invalidLedgers = [
    makeFocused(['F1'], { commands: [] }),
    makeFocused(['F1'], { commands: [{ command: 'node --test', status: 'failed', purpose: 'focused' }] }),
    makeFocused(['F1'], { commands: [{ command: 'node --test', status: 'not_run', purpose: 'focused' }] }),
  ]
  for (const validation of invalidLedgers) {
    const agent = makeAgent(baseHandlers([
      ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: true }], ['fix', fixReport],
      ['validate focused', validation], ['refresh manifest', refreshWithTest],
    ]))
    const res = await runWorkflow({ agent })
    assert.equal(res.totalResolved, 0)
    assert.notEqual(res.verdict, 'CONVERGED CLEAN')
  }
})

test('FOCUSED-005: complete bound fix and evidence resolve the intended claim', async () => {
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: true }], ['fix', fixReport],
    ['validate focused', focusedPass], ['refresh manifest', refreshWithTest],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(res.totalResolved, 1)
  assert.ok(res.totalResolved <= new Set(focusedPass.checkedFindingIds).size)
})

test('FOCUSED-006: changed-file evidence must cover the finding-bound fix', async () => {
  const incompleteEvidence = makeFocused(['F1'], { changedFiles: ['src/x.ts'] })
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: true }], ['fix', fixReport],
    ['validate focused', incompleteEvidence], ['refresh manifest', refreshWithTest],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(res.totalResolved, 0)
  assert.ok(res.escalated.some((finding) => finding.id === 'F1'))
})

// Final validation status is derived mechanically from its command ledger.
test('FINAL-001: inconsistent passed ledgers cannot certify clean', async () => {
  const invalidResults = [
    { status: 'passed', commands: [], summary: 'empty', failures: [] },
    { status: 'passed', commands: [{ command: 'npm test', status: 'failed', purpose: 'suite', required: true }], summary: 'contradiction', failures: [] },
    { status: 'passed', commands: [{ command: 'npm test', status: 'not_run', purpose: 'suite', required: true }], summary: 'not run', failures: [] },
    { status: 'passed', commands: [{ command: 'npm test', status: 'passed', purpose: 'suite', required: true }], summary: 'contradiction', failures: ['reported failure'] },
    { status: 'passed', commands: [{ command: 'npm test', status: 'passed', purpose: 'suite', required: false }], summary: 'no canonical command', failures: [] },
  ]
  for (const finalResult of invalidResults) {
    const agent = makeAgent([
      ['discover diff', diffDiscovery], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
      ['final validation', finalResult], ['synthesis', 'report'],
    ])
    const res = await runWorkflow({ agent })
    assert.notEqual(res.finalValidation.status, 'passed')
    assert.notEqual(res.verdict, 'CONVERGED CLEAN')
  }
})

test('FINAL-002: a canonical all-passing ledger can certify clean', async () => {
  const agent = makeAgent(baseHandlers())
  const res = await runWorkflow({ agent })
  assert.equal(res.finalValidation.status, 'passed')
  assert.equal(res.verdict, 'CONVERGED CLEAN')
})

// Feature reconciliation and empty discovery are fail-closed.
test('DISCOVERY-001: reconciliation cannot omit a discovered union path', async () => {
  const structure = discovery([file('src/a.ts', 10)])
  const behavior = discovery([file('src/b.ts', 20)])
  const reconciled = discovery([file('src/a.ts', 10)])
  const agent = makeAgent([
    ['feature discover structure', structure], ['feature discover behavior', behavior], ['feature reconcile', reconciled],
    ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent, args: { target: 'feature union coverage' } })
  assert.ok(res.targetManifest.files.some((entry) => entry.path === 'src/b.ts'))
  assert.equal(res.discovery.complete, false)
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})

test('DISCOVERY-002: missing or incomplete feature perspectives stay incomplete', async () => {
  const complete = discovery([file('src/a.ts', 10)])
  const incomplete = discovery([file('src/a.ts', 10)], { coverage: { complete: false, warnings: ['incomplete'] } })
  for (const handlers of [
    [['feature discover structure', complete], ['feature discover behavior', null], ['feature reconcile', complete]],
    [['feature discover structure', complete], ['feature discover behavior', incomplete], ['feature reconcile', complete]],
  ]) {
    const agent = makeAgent([...handlers, ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes], ['synthesis', 'report']])
    const res = await runWorkflow({ agent, args: { target: 'feature incomplete' } })
    assert.equal(res.discovery.complete, false)
    assert.notEqual(res.verdict, 'CONVERGED CLEAN')
  }
})

test('DISCOVERY-003: conflicting source metadata creates a material disagreement', async () => {
  const structure = discovery([file('src/a.ts', 10, { role: 'entry-point' })])
  const behavior = discovery([file('src/a.ts', 99, { role: 'implementation' })])
  const reconciled = discovery([file('src/a.ts', 10, { role: 'entry-point' })])
  const agent = makeAgent([
    ['feature discover structure', structure], ['feature discover behavior', behavior], ['feature reconcile', reconciled],
    ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent, args: { target: 'feature metadata conflict' } })
  assert.equal(res.discovery.complete, false)
  assert.ok(res.discovery.disagreements.some((entry) => /src\/a\.ts/.test(String(entry))))
})

test('DISCOVERY-004: only complete empty diffs are no-changes', async () => {
  const completeAgent = makeAgent([['discover diff', discovery([])]])
  assert.equal((await runWorkflow({ agent: completeAgent })).verdict, 'NO CHANGES TO REVIEW')

  const incompleteAgent = makeAgent([['discover diff', discovery([], { coverage: { complete: false, warnings: ['Git data unavailable'] } })]])
  const incomplete = await runWorkflow({ agent: incompleteAgent })
  assert.notEqual(incomplete.verdict, 'NO CHANGES TO REVIEW')
  assert.equal(incomplete.discovery.complete, false)

  const failedPr = await runWorkflow({ agent: makeAgent([['discover pr', null]]), args: { target: 'pr 42' } })
  assert.match(failedPr.verdict, /^ABORTED/)
  assert.equal(failedPr.discovery.complete, false)
})

// Manifest refresh reports observations but cannot grant mutation authority.
test('MUTATION-001: refresh cannot add an unreported extra file', async () => {
  const extraRefresh = {
    actualChangedFiles: ['src/x.ts', 'src/x.test.ts'],
    files: [...refreshWithTest.files, { path: 'infra/prod.tf', lineCount: 20, role: 'supporting', reason: 'extra', kind: 'file', resolvedPathContained: true, policy: 'allowed' }],
    warnings: [],
  }
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: true }], ['fix', fixReport],
    ['validate focused', focusedPass], ['refresh manifest', extraRefresh],
  ]))
  const res = await runWorkflow({ agent })
  assert.ok(res.outOfPolicyChanges.some((entry) => entry.path === 'infra/prod.tf'))
  assert.ok(!res.targetManifest.files.some((entry) => entry.path === 'infra/prod.tf'))
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})

test('MUTATION-002: fixer reports cannot authorize unrelated new support files', async () => {
  const unsafeFix = {
    summary: 'Touched infrastructure',
    fixes: [{ findingId: 'F1', location: highFinding.location, change: 'unrelated', files: ['src/x.ts', 'infra/prod.tf'], tests: [] }],
    focusedTestCommands: ['node --test src/x.test.ts'],
  }
  const refresh = {
    actualChangedFiles: ['src/x.ts', 'infra/prod.tf'],
    files: [
      { path: 'src/x.ts', lineCount: 10, role: 'implementation', reason: 'target', kind: 'file', resolvedPathContained: true, policy: 'allowed' },
      { path: 'infra/prod.tf', lineCount: 20, role: 'supporting', reason: 'fixer requested it', kind: 'file', resolvedPathContained: true, policy: 'allowed' },
    ],
    warnings: [],
  }
  const validation = makeFocused(['F1'], { changedFiles: ['src/x.ts', 'infra/prod.tf'] })
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: true }], ['fix', unsafeFix],
    ['validate focused', validation], ['refresh manifest', refresh],
  ]))
  const res = await runWorkflow({ agent })
  assert.ok(res.outOfPolicyChanges.some((entry) => entry.path === 'infra/prod.tf'))
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})

test('SEC-AUTH-TESTPATH-001: a .test.yml basename is not an authorized regression test', async () => {
  const unsafeFix = {
    summary: 'Added CI config disguised as a regression test.',
    fixes: [{ findingId: 'F1', location: highFinding.location, change: 'guard input', files: ['src/x.ts'], tests: ['.github/workflows/release.test.yml'] }],
    focusedTestCommands: ['node --test src/x.test.ts'],
  }
  const refresh = {
    actualChangedFiles: ['src/x.ts', '.github/workflows/release.test.yml'],
    files: [
      { path: 'src/x.ts', lineCount: 12, role: 'implementation', reason: 'target', kind: 'file', resolvedPathContained: true, policy: 'allowed' },
      { path: '.github/workflows/release.test.yml', lineCount: 20, role: 'test', reason: 'fixer claimed regression test', kind: 'file', resolvedPathContained: true, policy: 'allowed' },
    ],
    warnings: [],
  }
  const validation = makeFocused(['F1'], { changedFiles: ['src/x.ts', '.github/workflows/release.test.yml'] })
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: true }], ['fix', unsafeFix],
    ['validate focused', validation], ['refresh manifest', refresh],
  ]))
  const res = await runWorkflow({ agent })
  assert.ok(res.outOfPolicyChanges.some((entry) => entry.path === '.github/workflows/release.test.yml'))
  assert.ok(!res.targetManifest.files.some((entry) => entry.path === '.github/workflows/release.test.yml'))
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})

test('MUTATION-003: target files and explicitly associated regression tests are authorized', async () => {
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [highFinding] }], ['verify', { real: true }], ['fix', fixReport],
    ['validate focused', focusedPass], ['refresh manifest', refreshWithTest],
  ]))
  const res = await runWorkflow({ agent })
  assert.equal(res.outOfPolicyChanges.length, 0)
  assert.ok(res.targetManifest.files.some((entry) => entry.path === 'src/x.ts'))
  assert.ok(res.targetManifest.files.some((entry) => entry.path === 'src/x.test.ts'))
  const refreshContract = agent.options.find((entry) => entry.label.startsWith('refresh manifest')).opts.schema.properties.files.items
  assert.ok(refreshContract.required.includes('kind'))
  assert.ok(refreshContract.required.includes('resolvedPathContained'))
})

// Command execution trust must not be inferred from prompt wording.
test('TRUST-001: untrusted pull-request validation is unavailable without enforceable isolation', async () => {
  const agent = makeAgent([
    ['discover pr', diffDiscovery], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent, args: { target: 'pr 42' } })
  assert.ok(!agent.calls.includes('final validation'))
  assert.equal(res.commandTrust.executionAllowed, false)
  assert.equal(res.commandTrust.enforceableIsolation, false)
  assert.equal(res.finalValidation.status, 'unavailable')
  assert.match(res.finalValidation.reason, /untrusted/i)
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})

// Redaction occurs before any downstream model boundary or returned artifact.
test('REDACT-001: sentinel secrets never propagate downstream or into results', async () => {
  const sentinel = 'SECRET_SENTINEL_DO_NOT_FORWARD_42'
  const secretFinding = {
    ...highFinding,
    path: 'src/x.ts',
    description: 'credential leak ' + sentinel,
    evidence: 'token=' + sentinel,
    repro_test: 'observe ' + sentinel,
  }
  const secretFix = { ...fixReport, summary: 'removed ' + sentinel }
  const secretValidation = { ...focusedPass, notes: 'validated ' + sentinel }
  const secretRefresh = {
    ...refreshWithTest,
    files: refreshWithTest.files.map((entry) => ({ ...entry, reason: entry.reason + ' ' + sentinel })),
  }
  const agent = makeAgent(baseHandlers([
    ['correct c0 r1', { findings: [secretFinding] }], ['verify', { real: true }], ['fix', secretFix],
    ['validate focused', secretValidation], ['refresh manifest', secretRefresh],
    ['synthesis', 'report ' + sentinel],
  ]))
  const res = await runWorkflow({ agent })
  const downstream = agent.prompts.filter((entry) => /^(verify|fix|validate|refresh|final validation|synthesis)/.test(entry.label))
  assert.ok(downstream.length > 0)
  for (const entry of downstream) assert.doesNotMatch(entry.prompt, new RegExp(sentinel), entry.label)
  assert.doesNotMatch(JSON.stringify(res), new RegExp(sentinel))
})

// Verification scope and critic coverage remain immutable and fail-closed.
test('VERIFY-SCOPE-001: feature verifiers receive immutable snapshot scope', async () => {
  const feature = discovery([file('src/x.ts', 10)])
  const finding = { ...highFinding, path: 'src/x.ts', location: 'src/x.ts:10 (embedded script line 7)' }
  const agent = makeAgent([
    ['feature discover structure', feature], ['feature discover behavior', feature], ['feature reconcile', feature],
    ['correct c0 r1', { findings: [finding] }], ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['verify', { real: false }], ['synthesis', 'report'],
  ])
  await runWorkflow({ agent, args: { target: 'feature review loop' } })
  const verifier = agent.prompts.find((entry) => entry.label.startsWith('verify'))
  assert.match(verifier.prompt, /\"basis\":\"snapshot\"/)
  assert.match(verifier.prompt, /do not reinterpret/i)
  assert.match(verifier.prompt, /\"claimPath\":\"src\/x\.ts\"/)
})

test('COVERAGE-007: critic timeouts are overridden and missing lanes remain visible', async () => {
  const agent = makeAgent([
    ['discover diff', diffDiscovery], ['maint', null], ['correct', emptyLanes], ['sec', emptyLanes], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent })
  const critics = agent.options.filter((entry) => /^(maint|correct|sec)/.test(entry.label))
  assert.ok(critics.every((entry) => entry.opts.timeoutMs === null))
  assert.ok(res.missingCriticLanes.some((entry) => entry.lane === 'maintainability'))
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})

test('SEC-PATH-001: a tracked file named __proto__ survives discovery', async () => {
  const agent = makeAgent([['discover diff', discovery([file('__proto__', 5)])]])
  const res = await runWorkflow({ agent })
  assert.notEqual(res.verdict, 'NO CHANGES TO REVIEW')
  assert.ok(res.targetManifest.files.some((entry) => entry.path === '__proto__'))
})

test('C0-COVERAGE-PHANTOM: unproven feature paths cannot converge clean', async () => {
  const manifest = discovery([file('missing/nope.ts', 1)])
  const agent = makeAgent([
    ['feature discover structure', manifest], ['feature discover behavior', manifest], ['feature reconcile', manifest],
    ['maint', emptyLanes], ['correct', emptyLanes], ['sec', emptyLanes],
    ['final validation', finalPass], ['synthesis', 'report'],
  ])
  const res = await runWorkflow({ agent, args: { target: 'feature phantom coverage' } })
  assert.notEqual(res.verdict, 'CONVERGED CLEAN')
})
