# BetterWright with Bitwarden CLI

`index.ts` configures BetterWright's native Pi tools with the read-only
`createBitwardenVault()` adapter. Mise owns `bw`; the Bun package owns
BetterWright. No browser extension, dependency patch, second credential store,
or local credential-capture workflow is required.

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

Every fill re-reads the current CLI data and revalidates the item against the
current canonical HTTP(S) origin. No item or authorization is cached between
requests. When other clients change vault data, sync through the CLI manually;
that terminal needs its own normal CLI unlock. If it invalidates Pi's key, use
`/bw lock` then `/bw unlock` again after syncing. Login and sync are not exposed
to the model, and no extra background CLI server is started.

### Conservative URI matching

Bitwarden's CLI URL filter is not treated as authorization. The adapter
independently requires the saved URI's scheme, hostname, and effective port to
match the current origin. HTTPS credentials cannot be offered on HTTP;
sibling subdomains and alternate ports do not share credentials implicitly.

Default/domain and host rules are deliberately narrowed to exact-origin.
Never-match items are excluded. Starts-with, exact-URL, regex, and unknown match
rules are also excluded: BetterWright supplies only the origin, which cannot
safely enforce path-specific rules. An item can still match through another
eligible URI. Configure an appropriate domain/host URI explicitly in Bitwarden
when needed; the adapter never rewrites an item's matching rules.

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

Tests use synthetic vault records and a fake `bw` executable. They exercise
matching, freshness, ambiguity, read-only behavior, metadata filtering, error
sanitization, child-only secret delivery, idle/shutdown cleanup, late-result
races, masked Unicode/paste/cancellation handling, and the real upstream Pi
factory across visibility restarts. They never query a real unlocked vault.
