# Browser automation

Mise pins `@playwright/mcp`; Pi connects through native HTTP MCP with deferred tool discovery. One upstream server per profile uses `--shared-browser-context`, allowing concurrent Pi sessions without competing Chrome profile locks. This package contains only routing guidance and the local `playwright-browser` skill, not a browser bridge, coordinator, or credential adapter. Bootstrap supplies signed Google Chrome as a macOS-scoped cask. Personal uses `/Applications`; work respects its declared `~/Applications` cask directory. If Chrome is installed elsewhere, update both the MCP executable path and that profile's setup task explicitly.

## Provisioning

Choose the explicit profile (use `work-macos` for work):

```sh
mise --env personal-macos install --locked npm:@playwright/mcp
mise --env personal-macos dot apply --yes
mise run bootstrap:pi
```

This installs the CLI, links configuration, and installs Pi package dependencies; it does not start services or run workstation bootstrap. Before switching existing sessions from stdio, release their MCP-owned Chrome instances and close native setup windows. Start the shared server as described below, then restart Pi to reconnect native MCP and load the changed skill. Discover the `playwright` tools with `tool_search` or inspect the connection with `/mcp`.

Each profile's `mcp.json` selects its own loopback `/mcp` endpoint (personal port 8931, work 8932). Its `browser:serve` task fixes the browser, data directory, output directory, and headed mode independently of the client's working directory. Data lives under `~/.local/share/playwright-mcp/profiles/<profile>`; automatically named artifacts are under the sibling `artifacts/<profile>`. Explicit artifact filenames resolve against the workspace instead. No everyday Chrome profile is attached, copied, or adopted. Existing retired-browser profiles and installations remain untouched.

The portable shared `dotfiles/common/playwright-mcp/config.json` uses supported `launchOptions.ignoreDefaultArgs` to retain Chrome Sync, background/component updates, and native Keychain use rather than Playwright's test-only basic/mock password storage. Persistent Playwright MCP already leaves extensions enabled. There are no unpacked-extension launch flags, initialization hooks, CDP extension installers, or vault adapters. Renovate maintains the MCP pin and mise locks; Chrome manages Bitwarden according to its sync/update policies. The common tool/config layer is Linux-compatible; the explicit macOS profiles select signed macOS Chrome. No Linux browser is provisioned by these macOS setup tasks.

## Server lifecycle

For a repository-only rollout, run one foreground server in a separate terminal:

```sh
mise --env personal-macos run browser:serve
# Work instead: mise --env work-macos run browser:serve
```

All Pi sessions for that environment connect to the same endpoint. Keep this terminal open; Ctrl-C stops the server. Do not run a foreground copy while its LaunchAgent is active.

Normal workstation bootstrap installs and loads the profile's native mise LaunchAgent, which invokes the same task and restarts it on failure. To reconcile LaunchAgents separately, `mise --env personal-macos bootstrap macos launchd-agents apply` applies **all declared agents**, not just the browser. Do not run it during repository-only implementation or CI. Logs are under `~/Library/Logs/playwright-mcp-<profile>.{log,error.log}`.

Once the agent is installed, stop and resume only this service with native launchctl (substitute `work-macos` for work):

```sh
launchctl bootout "gui/$(id -u)/dev.mise.playwright-mcp-personal-macos"
# After native setup Chrome is completely closed:
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.mise.playwright-mcp-personal-macos.plist"
```

Coordinate restarts with every connected session. `browser_close` is not a service-stop command: the HTTP server remains available and another client can relaunch Chrome. Connection-refused errors mean the configured server needs attention; do not launch a second owner of its profile.

### Shared-state limits

This is upstream context sharing, not agent isolation. Sessions share cookies, logins, and tabs. Each session should create and use its own task tab, leave other tabs alone, and coordinate logout, account switching, browser closure, and server restarts. Before credential entry, pause browser work in **every connected session** until the human confirms completion. For independent browser state, upstream supports `--isolated` or distinct `--user-data-dir` directories; neither is enabled here.

The HTTP endpoint controls an authenticated browser. Keep its loopback bind and host checks; do not expose it through a reverse proxy or bind it to the network. Localhost is not an authorization boundary against other local processes.

## One-time native profile setup

Coordinate with other sessions, stop the shared server using the lifecycle instructions above, then run:

```sh
mise --env personal-macos run browser:setup
```

This opens the same dedicated profile directly in Chrome, without automation or debugging attached. In Chrome's native UI:

1. Sign into the intended Google account and enable extension sync, **or** install Bitwarden once from the Chrome Web Store. A new profile does not inherit extensions from regular Chrome automatically.
2. Select the self-hosted Vaultwarden server in Bitwarden, complete SSO, and unlock. Keep normal HTTPS callbacks.
3. When Authentik requests the Apple Passwords passkey, approve Chrome's macOS access and biometric/system prompt yourself.
4. Close this Chrome instance completely, then resume the shared server before requesting a browser action in Pi. MCP opens the same profile on first use. Repeat setup independently for work if needed.

One server/browser owner at a time may use a profile; multiple HTTP clients connect to that owner. Never delete locks or switch accounts to work around a conflict. Chrome owns extension updates, so periodic native setup launches also allow it to reconcile sync and update state. No mise or Renovate task installs or updates Bitwarden.

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

Tests use disposable homes, fake Chrome launchers, local MCP fixtures, and the pinned upstream HTTP server without launching Chrome. They check setup/profile parity, endpoint/service wiring, concurrent native Pi HTTP discovery and independent client disconnect, remaining stdio environment routing, and skill/prompt discovery. They do not prove concurrent UI isolation, inspect vaults, or complete authentication.

The optional first-route evaluation uses real inference while intercepting operational calls, including MCP discovery, before execution:

```sh
mise exec -- node --use-env-proxy pi-extensions/packages/browser/routing.eval.mjs \
  "$(mise which pi)" cliproxyapi/gpt-6.1-sol
```

It checks routing rather than browser UX or service correctness; inference may incur cost. Omit `--use-env-proxy` on a direct connection.
