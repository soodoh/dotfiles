# Browser automation

Mise pins `@playwright/mcp`; Pi connects through native MCP with deferred tool discovery. This package contains only routing guidance and the local `playwright-browser` skill, not a browser bridge or credential adapter. Bootstrap supplies signed Google Chrome as a macOS-scoped cask. Personal uses `/Applications`; work respects its declared `~/Applications` cask directory. If Chrome is installed elsewhere, update both the MCP executable path and that profile's setup task explicitly.

## Provisioning

Choose the explicit profile (use `work-macos` for work):

```sh
mise --env personal-macos install --locked npm:@playwright/mcp
mise --env personal-macos dot apply --yes
mise run bootstrap:pi
```

This installs the CLI, links configuration, and installs Pi package dependencies; it does not run workstation bootstrap. Restart Pi to reconnect native MCP and load the changed skill. Discover the `playwright` tools with `tool_search` or inspect the connection with `/mcp`.

Each profile's `mcp.json` fixes its own browser, data directory, output directory, and headed mode independently of the working directory. Data lives under `~/.local/share/playwright-mcp/profiles/<profile>`; automatically named artifacts are under the sibling `artifacts/<profile>`. Explicit artifact filenames resolve against the workspace instead. No everyday Chrome profile is attached, copied, or adopted. Existing retired-browser profiles and installations remain untouched.

The portable shared `dotfiles/common/playwright-mcp/config.json` uses supported `launchOptions.ignoreDefaultArgs` to retain Chrome Sync, background/component updates, and native Keychain use rather than Playwright's test-only basic/mock password storage. Persistent Playwright MCP already leaves extensions enabled. There are no unpacked-extension launch flags, initialization hooks, CDP extension installers, or vault adapters. Renovate maintains the MCP pin and mise locks; Chrome manages Bitwarden according to its sync/update policies. The common tool/config layer is Linux-compatible; the explicit macOS profiles select signed macOS Chrome. No Linux browser is provisioned by these macOS setup tasks.

## One-time native profile setup

Before MCP opens the profile, run:

```sh
mise --env personal-macos run browser:setup
```

This opens the same dedicated profile directly in Chrome, without automation or debugging attached. In Chrome's native UI:

1. Sign into the intended Google account and enable extension sync, **or** install Bitwarden once from the Chrome Web Store. A new profile does not inherit extensions from regular Chrome automatically.
2. Select the self-hosted Vaultwarden server in Bitwarden, complete SSO, and unlock. Keep normal HTTPS callbacks.
3. When Authentik requests the Apple Passwords passkey, approve Chrome's macOS access and biometric/system prompt yourself.
4. Close this Chrome instance completely before requesting a browser action in Pi. MCP opens the same profile on first use. Repeat setup independently for work if needed.

If MCP already owns the profile, close it with `browser_close` before running setup. One browser/client at a time may own a profile; never delete locks or switch accounts to work around a conflict. Chrome owns extension updates, so periodic native setup launches also allow it to reconcile sync and update state. No mise or Renovate task installs or updates Bitwarden.

Update Chrome before credential entry if it is out of date. Native passkey support depends on signed Chrome, macOS permissions, and provider behavior. Real Vaultwarden SSO, Apple Passwords approval, and Google sign-in are human acceptance checks, not guarantees made by repository tests.

## Security

Prefer specialist search, fetch, documentation, and service tools; browser fallback is for UI or unsupported authenticated content. Bitwarden fills credentials. SSO, unlock, and biometric approval are human steps: pause browser actions, observations, screenshots, and recordings until the human confirms completion. Never inspect populated secret fields or extension storage.

The server configuration disables page-provided WebMCP tools and code echo, lowers console output to errors, and does not enable session/video/trace recording. The shared configuration also redacts common OAuth/SAML query and fragment parameters in returned URLs without changing actual callbacks. These choices reduce exposure, not eliminate it: snapshots, errors, other URL parameters, and requested artifacts can contain sensitive content. Stop observations before credential or SSO callback screens. Downloads require explicit approval in agent guidance. Playwright MCP is not a security boundary, transport-level egress guarantee, or comprehensive secret redactor. Protect profile and artifact directories as authenticated local state.

## Tests and evaluation

```sh
python3 mise.bootstrap.test.py
bun run --cwd pi-extensions ci:fast
node pi-extensions/extensions-host.test.mjs "$(mise which pi)"
node pi-extensions/native-mcp-host.test.mjs "$(mise which pi)"
```

Tests use disposable homes, fake Chrome launchers, and local MCP fixtures. They check that native setup and automation select the same isolated profiles, Pi resolves each server's paths, and the local skill/prompt is discoverable. They do not inspect vaults or complete authentication.

The optional first-route evaluation uses real inference while intercepting operational calls, including MCP discovery, before execution:

```sh
mise exec -- node --use-env-proxy pi-extensions/packages/browser/routing.eval.mjs \
  "$(mise which pi)" cliproxyapi/gpt-6.1-sol
```

It checks routing rather than browser UX or service correctness; inference may incur cost. Omit `--use-env-proxy` on a direct connection.
