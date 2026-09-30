# Work cloud services

Prefer the configured MCP servers over browser automation or CLIs for Azure, Kusto, Mixpanel, and Azure DevOps work.

- Integration Kusto: use native MCP tool `mcp__azure-test__kusto` with `https://docusigntestfollower.westus.kusto.windows.net/`, database `KazMonTestDb`, and environment `Test`.
- Stage, Demo, and Prod Kusto: use native MCP tool `mcp__azure__kusto` with `https://docusign1.westus.kusto.windows.net/`, database `KazMonDb`, and the matching environment.
- `azure-test` and shell `az`/`kubectl` use the isolated development profile; `azure` uses the production profile.
- Azure DevOps MCP authenticates independently through a PAT. Prefer it over the CLI.
- Discover MCP tools with `tool_search` or codemode's `searchTools()`. Use `codemode` for batching and filtering; script tool identifiers normalize hyphens to underscores. Native MCP calls return `{ content, structuredContent?, isError? }`; check `isError` and prefer `structuredContent`, otherwise parse JSON text when the tool returns it.
- For 1DS or `@1ds/qe` guidance, follow ACM's `1ds-heimdall-usage` skill. In Pi, use `mcp__heimdall__heimdall-query` with `modeType: "1ds-docs"`; its Claude/Copilot tool names do not apply here.
- Treat Kusto and Mixpanel as read-only. Shared Kusto clusters remain queryable by URI even when subscription discovery does not list them.
