# llm-hub

Telemetry-only Pi extension for Anthropic-compatible models on the `llm-hub` provider.

The extension does not register a provider, discover models, or manage credentials. Pi owns provider configuration and authentication. In this repository, the static provider catalog is defined in `work/.pi/agent/models.json`, and its API key is stored through Pi's generic `/login` flow in Pi's normal credential store.

## Telemetry

Telemetry follows Claude Code's metrics exporter controls and is a no-op unless OTLP over HTTP/JSON is selected and a metrics endpoint is configured.

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY="1"
export OTEL_METRICS_EXPORTER="otlp"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/json"
export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT="https://otel.example.com/v1/metrics"
```

Supported variables:

| Variable | Purpose |
| --- | --- |
| `CLAUDE_CODE_ENABLE_TELEMETRY` | Must be `1`, matching Claude Code's master telemetry switch. |
| `OTEL_RESOURCE_ATTRIBUTES` | Strict comma-separated, percent-decoded resource attributes. Copied to datapoints by default. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Comma-separated general export headers. |
| `OTEL_EXPORTER_OTLP_METRICS_HEADERS` | Metrics-specific headers; takes precedence over general headers. |
| `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` | `delta` by default; `cumulative` is also supported. |
| `OTEL_METRIC_EXPORT_INTERVAL` | Export interval in milliseconds; defaults to 60 seconds. |
| `OTEL_METRICS_INCLUDE_SESSION_ID` | Includes `session.id` by default; set `false` to omit it. |
| `OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES` | Copies custom resource attributes to datapoints by default. |
| `OTEL_METRICS_INCLUDE_VERSION` | Adds `app.version` to datapoints when true. |

Telemetry starts only while a model whose Pi provider is `llm-hub` is active. Switching to another provider flushes and stops the exporter. Switching back starts a fresh exporter while preserving the logical telemetry session. Teardown is failure-safe, and telemetry-producing handlers gate every metric on the active provider.

The extension emits the Claude Code-compatible metrics already covered by its OTEL tests:

- `claude_code.session.count`
- `claude_code.token.usage`
- `claude_code.cost.usage`
- `claude_code.active_time.total`
- `claude_code.lines_of_code.count`
- `claude_code.commit.count`
- `claude_code.pull_request.count`
- `claude_code.code_edit_tool.decision`

## Metric fidelity

Token, cost, and session metrics come directly from Pi lifecycle and usage data. Token and cost datapoints include `model` and `query_source=main`; lines-of-code datapoints include the active `model`.

The remaining metrics use the closest signals Pi currently exposes:

- Edit LOC prefers Pi's successful unified diff. Write LOC counts the submitted replacement content as added lines because Pi does not expose overwritten content.
- Commit and PR counters use successful Bash results plus command/output signatures. Successful PR/MR creation tools are also counted by tool name. Compound shell commands and custom wrappers can still create false positives or negatives.
- Edit decisions are counted at Pi's `tool_call` gate. With the current Claude `bypassPermissions` mode, accepted Edit/Write calls use `source=config`.
- User active time uses a five-second rolling activity window after each Pi input event, while CLI active time covers agent processing. This approximates typing/reading without counting unbounded idle time.
- Pi's current main extension API does not expose Claude's subagent/skill/plugin/MCP request attribution, effort, fast mode, anonymous installation identity, or OAuth account identity, so those optional attributes are omitted.

## Development

```bash
bun run --cwd pi-extensions test packages/llm-hub
bun run --cwd pi-extensions typecheck
```
