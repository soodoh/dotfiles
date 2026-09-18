# Work environment

## Azure and Kusto

Use the configured MCP servers for Azure service checks before browser automation. For telemetry investigations, runtime debugging, or rollout verification, search MCP for the exact environment-specific Kusto tool name below with `limit: 1` before querying; this activates only that tool and only for sessions that need it.

- For Integration telemetry, call `azure-test_kusto` with cluster URI `https://docusigntestfollower.westus.kusto.windows.net/`, database `KazMonTestDb`, and environment `Test`.
- For Stage, Demo, and Prod telemetry, call `azure_kusto` with cluster URI `https://docusign1.westus.kusto.windows.net/`, database `KazMonDb`, and the matching `Stage`, `Demo`, or `Prod` environment.
- `azure-test` and bare `az`/`kubectl` use the isolated development Azure CLI profile under `~/.azure/dev/.azure`; `azure` uses the production profile under `~/.azure/prod/.azure`.
- For Azure DevOps project, build, pipeline, run, log, and artifact work, search and use the `azure-devops` MCP before invoking Azure CLI. `pipelines_write` is exposed; use it only for an explicit user-requested mutation. Use Azure DevOps CLI only when explicitly requested or when the required operation is unavailable through MCP.
- Diagnose each authentication boundary independently. `azure-devops` uses a PAT, so Azure CLI login state does not affect it.
- Query shared Kusto clusters by URI; their absence from subscription resource discovery does not establish that access is unavailable.
- Treat Kusto and Mixpanel as read-only. Do not attempt ingestion, write-capable control commands, metadata edits, dashboard changes, feature-flag changes, experiment changes, or other mutations. The MCP configuration hides Mixpanel mutation tools and starts Azure MCP with `--read-only`.
