# BetterWright routing and Bitwarden CLI

`index.ts` configures BetterWright's native Pi tools with the read-only
`createBitwardenVault()` adapter. Mise owns `bw`; the Bun package owns
BetterWright. No browser extension, dependency patch, second credential store,
or local credential-capture workflow is required.

## Tool routing

`index.ts` owns the shared routing guardrails injected into both profiles.
They take precedence over upstream instructions that broadly recommend browser
use for live-web tasks. The local `skills/browser/SKILL.md` supplies narrow
invocation metadata and references the locked upstream API documentation; the
upstream end-to-end review skill remains registered separately. No dependency
files are modified. Work-specific services and environment boundaries remain
in `dotfiles/work/pi/agent/AGENTS.md`.

Routing is prompt guidance, not a security boundary or a guarantee. Browser
tools remain available for legitimate UI workflows; there are no keyword gates
or additional user confirmations.

### Routing evaluation

The opt-in evaluation uses real model inference with the effective adapter
prompt, the local skill, and work instructions where applicable. It intercepts
operational calls before execution: no browser, vault, or cloud operation runs.
Only the local browser skill can be read. Model-provider inference and provider
initialization still use the normal configured connection and may incur cost.

From the repository root, using a configured model:

```sh
mise exec -- node --use-env-proxy pi-extensions/packages/betterwright/routing.eval.mjs \
  "$(mise which pi)" cliproxyapi/gpt-6.1-sol
```

Omit `--use-env-proxy` on a direct connection. The evaluation defaults to high
thinking; `PI_REASONING_LEVEL` can override it. It prints JSON lines with the
selected route, duration, token usage, and any final answer, then exits nonzero
for an incorrect route or inference failure. Sessions are disposable and
in-memory; provider configuration/caches retain their normal behavior.

`routing.evals.json` covers research, public URLs, Test/Prod Kusto, service-tool
discovery, visual UI work, browser-only content, unsupported service UI, an
authentication failure, and an empty query. Cases accept tool families rather
than exact call sequences. Service/search schemas are representative fixtures;
this checks the first operational choice, not end-to-end completion, live MCP
discovery ranking, or query correctness. Failure scenarios are supplied in the
prompt, not produced by a live service. `targetMentioned` is informational: an
initial command-discovery call may legitimately omit the cluster URI. Review
answers and arguments alongside the pass count, and repeat across usual models
before treating a change as a reliability improvement.

## Session setup

Follow the [root setup instructions](../../../README.md#browser-automation-betterwright).
Server selection and initial SSO login remain human-owned CLI configuration.
Start Pi normally, without exporting `BW_SESSION`, and invoke `/bw unlock`.
The human-only command waits until the agent is idle, then opens a dedicated
masked terminal component. Tool calls are temporarily blocked during secret
entry and unlock, including calls from a background wake. The prompt never uses
the chat editor or its history. Enter
submits, Escape/Ctrl+C cancels, Ctrl+U clears, and Backspace removes a grapheme;
Unicode typing and bracketed paste are supported. Unlock is refused outside
interactive terminal mode rather than falling back to an unmasked prompt.

`bitwarden-session.ts` owns one private key per Pi extension instance. It invokes
`bw unlock --raw --passwordenv BW_PI_UNLOCK_PASSWORD --nointeraction`, placing
the master password only in that child's temporary environment. The returned
key stays in host memory; credential commands receive it as child-only
`BW_SESSION`. Neither value is placed in Pi's global environment or command
arguments, returned by a tool, or written to disk. Inherited sessions and
implicit CLI login credentials are ignored. Repeated `/bw unlock` while already
unlocked is a no-op, avoiding unnecessary CLI key invalidation.

`/bw status` reports only this adapter's local locked/unlocked state. `/bw lock`
clears the key and aborts pending operations without invoking the CLI's global
lock or changing other clients. Late subprocess results cannot restore a locked
session or return credential data after a lock. Keys are also cleared after
15 minutes without credential activity, on shutdown, `/reload`, and session
replacement. Status checks do not extend that timeout; browser visibility
restarts do not clear an otherwise valid session. A failed credential command
locks the adapter. There is no model-callable unlock tool.

The CLI warns that each new unlock invalidates previous session keys. Pi
instances or terminals sharing the same CLI configuration can therefore
invalidate each other's keys; this integration does not promise independently
unlockable shared-configuration sessions.

All `bw` commands run without a shell, with `--nointeraction`, an 8 MiB output
limit, and a deadline (60 seconds for unlock, 20 seconds for credential reads).
Cancellation kills pending subprocesses. Failed commands produce static errors,
never captured stdout/stderr, process error objects, or their causes.

## Supported operations

- `credentials.list({text?, category?})`: metadata for matching password logins.
  Search uses only usernames and item names. Other categories return no records.
- `credentials.fill({id?, username?, submit?})` / `browser_login`: fill the chosen
  matching login, or the sole match. Multiple matches require disambiguation.
  `submit` is handled by BetterWright, not the adapter.
- `credentials.listPending()`: no pending records, since generation is disabled.
- All mutations, generation, rotation, and other backend actions are refused.
  Manage vault items in Bitwarden instead.

Every list and fill uses `bw list items --url <current-origin> --nointeraction`.
Bitwarden's CLI is authoritative for Default/domain/host matching; the adapter applies
the supported-rule and access restrictions below. Every fill re-queries that
scoped match set, even when an item ID was selected earlier. It never bypasses
matching by fetching an ID directly or reading an unscoped vault. No item or
authorization is cached between requests. When other clients change vault data,
sync through the CLI manually; that terminal needs its own normal CLI unlock.
If it invalidates Pi's key, use
`/bw lock` then `/bw unlock` again after syncing. Login and sync are not exposed
to the model, and no extra background CLI server is started.

### Bitwarden URI matching

For **Default, Base domain and Host** URI settings, the adapter trusts the
Bitwarden CLI's URL-filtered results for the supplied origin. It does not
reimplement public-suffix or equivalent-domain logic, impose an exact-origin
restriction on saved URIs, or add scheme/port restrictions beyond Bitwarden's
chosen strategy. Default (null or an omitted match setting) inherits the CLI's
configured strategy; it is neither rejected nor forced to Base domain.

The returned credential's `origin` and `matchMode: "exact-origin"` bind delivery
to the _current request's_ origin. They do not describe or overwrite the saved
Bitwarden matching setting.

- **Default, Base domain, Host:** delegate matching to `bw --url <origin>`.
- **Never:** cannot authorize a match; another supported URI may.
- **Explicit Starts with, Exact, Regular expression:** exclude the item because
  the credential request does not include the full current URL.
- **Unknown or malformed rules:** exclude the item.

The CLI returns whole matching items, not the particular URI that matched.
One explicit URL-based, unknown, or malformed URI therefore excludes the whole
item, even alongside a supported URI; otherwise the supported URI could mask
an unsupported match. Never-only items are excluded too.

**Accepted limitation:** this is origin-based matching, not full-page URL
matching. If Default inherits a URL-sensitive strategy, the CLI evaluates that
strategy against the origin, not the current path, query or fragment. The
adapter deliberately accepts the CLI's result rather than requiring users to
change ordinary Default entries. Explicit URL-sensitive rules remain blocked.

A YNAB login can keep its base-domain URI and Default setting; no exact
`https://app.ynab.com` URI or explicit Base domain override is required by the
adapter. Bitwarden must still return the item as a match for the current
origin. Save changes and run `bw sync` in your normal terminal when updating
vault items; the adapter never rewrites them.

#### Full URL availability

Stock BetterWright 2.9.1 exposes `page.url()` in browser code, but its custom
vault interface is `handleRequest(action, payload, origin)`. The credential
worker reduces the target URL to an origin before sending the vault request;
it does not provide a trusted full target URL to this adapter. A separate URL
read or caller-supplied payload field is not bound to that credential target.

If upstream adds trusted target-URL context at the credential matching/fill
seam, the adapter can pass that URL to Bitwarden and support explicit
URL-sensitive strategies. For now, use the existing origin interface and the
lenient policy above. No SDK/dependency patch is installed.

Trashed entries, non-login items, entries requiring master-password reprompt,
and entries without a password are excluded. There is no bypass for reprompt.

## Secret handling

`bw list items` returns decrypted candidate items to trusted host code. The
adapter constructs metadata from an explicit field allowlist; passwords, notes,
TOTP seeds, custom fields, and raw CLI responses are never returned by `list`.
Only the internal `fill` response carries the selected password. BetterWright
consumes that response in its worker, tracks the password for output redaction,
and returns only fill metadata to the agent. The adapter does not retain a
separate secret cache or persist plaintext.

This protects the normal tool path, not against hostile code running with the
same OS permissions. Only the adapter's CLI children receive its session, but
same-user processes and trusted extensions can still inspect process memory,
terminal input, or child environments. Strings are released on cleanup; this
is not a guarantee of cryptographic memory erasure. Filled secrets necessarily
exist in the destination page. A local lock cannot revoke credentials already
delivered to the browser, including an in-flight fill, or undo website logins.
BetterWright retains its own output-redaction material until the affected
browser pages close.

Do not expose passwords, session keys, or decrypted `bw` output to agent-visible
shell tools, logs, or chat. Start Pi without an externally exported session:
the adapter ignores inherited `BW_SESSION` but does not remove environment
variables the caller supplied to unrelated tools.

The adapter applies to Pi's native tools only. The separately mise-managed
BetterWright CLI does not load this adapter, and its built-in vault remains
disabled by `configure:betterwright`.

## Tests

```sh
cd pi-extensions
bun run test packages/betterwright
bun run ci:fast
```

Tests use synthetic vault records and a fake `bw` executable. Default/domain/host tests
verify delegation of already-matched CLI results and scoped re-queries; they do
not reproduce Bitwarden's matcher or prove a real-vault login. They exercise
supported-rule restrictions, freshness, ambiguity, read-only behavior, metadata
filtering, error sanitization, child-only secret delivery, idle/shutdown cleanup,
late-result races, masked Unicode/paste/cancellation handling, and the real upstream Pi
factory across visibility restarts. They never query a real unlocked vault.
