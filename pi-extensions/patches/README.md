# Dependency patches

## `pi-subagents@0.74.0.patch`

Pi 1.0 removed the `@earendil-works/pi-agent-core/node` export
([release notes](https://github.com/earendil-works/pi/blob/v1.0.0/packages/agent/CHANGELOG.md)).
Subagents 0.74.0 still requires it in the detached runner's host-alias preflight,
even though no module in that release imports it. This blocks background children
before launch.

The patch removes that unused alias. Resolution of the remaining host peers still
fails closed; nothing falls back to development dependencies. Bun applies the
version-specific patch through `patchedDependencies` during `bun ci`.

Upstream fixed the compatibility check in
[nicobailon/pi-subagents#2634](https://github.com/nicobailon/pi-subagents/pull/2634).
Remove this patch once that PR is included in the next published release and the
repository has upgraded to it; verify inclusion rather than assuming any newer
version contains the fix. Track removal in
[soodoh/dotfiles#216](https://github.com/soodoh/dotfiles/issues/216).

Remove the patch file and its `patchedDependencies` entry, update this README,
regenerate `bun.lock`, verify a fresh `bun ci`, and run:

```bash
mise run validate:agents:fast
mise run validate:agents:integration
```

`subagents-host.test.mjs` verifies actual-host alias resolution and native ESM
imports, then exercises the runner's preload in a credential-free subprocess with
a deterministic provider. This covers loader identity and session execution, not
an end-to-end delegated workflow or live-provider authentication.
