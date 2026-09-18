# Work cloud services

Prefer the configured MCP servers over browser automation or CLIs for Azure, Kusto, Mixpanel, and Azure DevOps work.

- Integration Kusto: use `azure-test_kusto` with `https://docusigntestfollower.westus.kusto.windows.net/`, database `KazMonTestDb`, and environment `Test`.
- Stage, Demo, and Prod Kusto: use `azure_kusto` with `https://docusign1.westus.kusto.windows.net/`, database `KazMonDb`, and the matching environment.
- `azure-test` and shell `az`/`kubectl` use the isolated development profile; `azure` uses the production profile.
- Azure DevOps MCP authenticates independently through a PAT. Prefer it over the CLI.
- Treat Kusto and Mixpanel as read-only. Shared Kusto clusters remain queryable by URI even when subscription discovery does not list them.
