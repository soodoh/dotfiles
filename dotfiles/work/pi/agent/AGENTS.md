# Work cloud services

Use the configured MCP servers for Azure, Kusto, Mixpanel, and Azure DevOps data and operations.

1. Identify the service and target environment. Use its designated tool when already loaded; otherwise discover it with `tool_search` before considering another access path.
2. Use that tool within the account, environment, and permission boundaries below. For internal company research, follow the designated enterprise-search tools and skills.
3. Fall back only for an actual capability gap or an observed failure that makes the specialized route unsuitable, and briefly state why. Refine empty queries; use bounded retries for transient read failures. Resolve or report authentication/authorization failures rather than automatically switching to a browser, CLI, or different credentials. UI interaction and visual verification still belong in the browser, even when the service also has MCP tools.

- Integration Kusto: use native MCP tool `mcp__azure-test__kusto` with `https://docusigntestfollower.westus.kusto.windows.net/`, database `KazMonTestDb`, and environment `Test`.
- Stage, Demo, and Prod Kusto: use native MCP tool `mcp__azure__kusto` with `https://docusign1.westus.kusto.windows.net/`, database `KazMonDb`, and the matching environment.
- `azure-test` and shell `az`/`kubectl` use the isolated development profile; `azure` uses the production profile.
- Azure DevOps MCP authenticates independently through a PAT. Prefer it over the CLI.
- Discover MCP tools with `tool_search` or codemode's `searchTools()`. Use `codemode` for batching and filtering; script tool identifiers normalize hyphens to underscores. Native MCP calls return `{ content, structuredContent?, isError? }`; check `isError` and prefer `structuredContent`, otherwise parse JSON text when the tool returns it.
- For 1DS or `@1ds/qe` guidance, follow ACM's `1ds-heimdall-usage` skill. In Pi, use `mcp__heimdall__heimdall-query` with `modeType: "1ds-docs"`; its Claude/Copilot tool names do not apply here.
- Treat Kusto and Mixpanel as read-only. Shared Kusto clusters remain queryable by URI even when subscription discovery does not list them.
