# claude-otel

Pi extension that emits OTEL metrics using the same metric names and attributes as Claude Code telemetry. This lets Faros and other OTEL dashboards aggregate Claude Code and pi sessions that use the same LLM hub.

## Behavior

The extension hardcodes Claude Code-compatible telemetry defaults:

- OTLP metrics export over HTTP/JSON
- Delta aggregation temporality
- `session.id` included on all datapoints
- `service.name = "claude-code"`
- Meter/scope name `com.anthropic.claude_code`
- 60 second metric export interval

`service.version` is parsed from `claude --version`; if that command is unavailable, it falls back to `2.1.118`.

## Environment

Telemetry is a no-op unless `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` is set.

Optional runtime environment variables:

| Variable | Purpose |
| --- | --- |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | OTLP HTTP metrics endpoint, such as a Faros webhook URL. Required. |
| `OTEL_RESOURCE_ATTRIBUTES` | Comma-separated resource attributes, for example `faros.user.id=you@example.com`. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Comma-separated export headers, for example `x-webhook-secret=...`. |

## Provider gating

The extension only emits telemetry when the active model provider is listed in pi settings:

```json
{
	"otel": {
		"enabledProviders": ["llm-hub"]
	}
}
```

Switching from a disabled provider to an enabled provider starts a fresh telemetry session. Switching away from an enabled provider flushes and stops telemetry. Switching between enabled providers flushes and restarts with a new `session.id`.

## Metrics

| Metric | Value | Attributes | When |
| --- | --- | --- | --- |
| `claude_code.session.count` | `1` | `session.id`, `start_type` | Telemetry activation. |
| `claude_code.token.usage` | Token count integer | `session.id`, `type`, `model` | Assistant message usage. `cacheWrite` is emitted as `cacheCreation`. |
| `claude_code.cost.usage` | USD float | `session.id`, `model` | Assistant message cost usage. |
| `claude_code.active_time.total` | Seconds float | `session.id`, `type` | Agent CLI time and user think time before next input. |
| `claude_code.lines_of_code.count` | Line count integer | `session.id`, `type` | Successful edit/write tool results. |
| `claude_code.commit.count` | `1` | `session.id` | Successful bash result matching `git commit`. |
| `claude_code.pull_request.count` | `1` | `session.id` | Successful bash result matching `gh pr create`. |
| `claude_code.code_edit_tool.decision` | `1` | `session.id`, `decision`, `tool_name`, `source` | Successful edit/write tool results. |

## Not implemented by design

These are intentionally omitted to match Claude Code defaults when the corresponding environment variables are unset, or because pi does not expose the data:

- No log/event export (`OTEL_LOGS_EXPORTER` equivalent)
- No trace export (`CLAUDE_CODE_ENHANCED_TELEMETRY_BETA` equivalent)
- No user prompt logging
- No organization ID or `user.account_uuid` attributes

## Install

Install this repository as a pi package, or load the extension directly from the workspace:

```bash
pi install /path/to/pi-extensions
# or
pi -e /path/to/pi-extensions/packages/claude-otel/index.ts
```

## Development

```bash
bun install
bun run --filter claude-otel test
bun run --filter claude-otel typecheck
```
