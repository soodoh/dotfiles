# grafana-bridge

A session-scoped stdio → authenticated loopback HTTP launcher for the official
Grafana MCP. It keeps Azure CLI tokens fresh without reconnecting Pi or changing
the Grafana tool catalog.

This is a standalone MCP process, **not a Pi extension**. It lives with the other
local packages for shared TypeScript, Biome, and Vitest tooling, but is not listed
in `pi.extensions` or loaded through Pi's extension API.

## Configuration

The work `dotfiles/work/pi/agent/mcp.json` launches both `grafana-prod` and
`grafana-dev` with:

```json
{
	"command": "node",
	"args": ["~/.pi/agent/pi-extensions/packages/grafana-bridge/index.ts"]
}
```

The mise-pinned Node runtime executes TypeScript directly; no build, additional
dependencies, token files, OAuth registration, or permanent service is required.
The existing `~/.pi/agent/pi-extensions` link resolves into this checkout. Run
`/reload` after changing the launcher configuration. When adding credential
environment variables, start Pi from a freshly loaded work-profile shell instead:
`/reload` cannot update an already-running Pi process's inherited environment.

Each entry supplies its isolated `HOME` / `AZURE_CONFIG_DIR` and resolves these
values from the age-encrypted work `mise-credentials.toml` environment:

| Bridge variable          | Dev source                   | Prod source                   |
| ------------------------ | ---------------------------- | ----------------------------- |
| `GRAFANA_AZURE_TENANT`   | `AZURE_DEV_TENANT_ID`        | `AZURE_PROD_TENANT_ID`        |
| `GRAFANA_AZURE_RESOURCE` | `GRAFANA_DEV_AZURE_RESOURCE` | `GRAFANA_PROD_AZURE_RESOURCE` |
| `GRAFANA_URL`            | `GRAFANA_DEV_URL`            | `GRAFANA_PROD_URL`            |

Dev and prod retain their separate Azure profiles and existing user permissions.
Write-tool availability is unchanged; usage statistics remain disabled. The
stored dev resource was verified against the live instance using Microsoft's
[current guidance](https://learn.microsoft.com/en-us/azure/managed-grafana/grafana-mcp-server),
not the older internal guide's audience, which returned 401. Prod retains its
working custom resource.

## Behavior

- Launches one official Grafana MCP child on an ephemeral loopback port with a
  random per-process caller credential. Local requests bypass corporate proxies.
- Supplies Azure CLI tokens per request and removes inherited static Grafana
  credentials from the child so they cannot override the current token.
- Caches tokens in memory until two minutes before expiry. Concurrent refreshes
  share one CLI invocation.
- Invalidates the cache on request/tool errors so the next request can pick up a
  new login. Failed requests are **never replayed**: a write may have executed.
- Reports login instructions without captured credential output.
- Stops the child on EOF or termination; kills a stuck child after two seconds.
  A crashed child ends the bridge instead of silently restarting or replaying.

When interactive authentication is required, log in to the corresponding profile
and retry the request—no MCP reconnect:

```sh
AZURE_CONFIG_DIR="$HOME/.azure/dev/.azure" az login --tenant "$AZURE_DEV_TENANT_ID"
AZURE_CONFIG_DIR="$HOME/.azure/prod/.azure" az login --tenant "$AZURE_PROD_TENANT_ID"
```

## Development

From the repository root:

```sh
bun run --cwd pi-extensions test -- packages/grafana-bridge/bridge.test.ts
bun run --cwd pi-extensions typecheck
bun run --cwd pi-extensions check
bun run --cwd pi-extensions test:coverage

# Optional smoke test with the actual pinned Grafana binary; still no cloud access.
node pi-extensions/packages/grafana-bridge/integration-host.test.mjs "$(mise which mcp-grafana)"
```

`bridge.test.ts` runs in the standard Vitest suite and covers proactive expiry,
concurrent refresh, login recovery, configured dev/prod launches, JSON/SSE,
non-replay, and EOF/signal cleanup. Package-local `test-support/` provides only
synthetic executables, temporary files, and loopback endpoints. These helpers are
typechecked but excluded from production coverage. The `.mjs` integration harness
follows the other packages' host-test convention and verifies the real binary's
per-request authentication behavior.
