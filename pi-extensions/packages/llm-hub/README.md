# llm-hub

Pi extension that registers an independent Anthropic-compatible LLM Hub provider and emits Claude Code-compatible OTEL metrics only while an LLM Hub model is active.

It can run alongside the community `pi-provider-litellm` package: this extension always registers the fixed `llm-hub` provider with `/login` credentials or `LLMHUB_*` fallbacks, while the community package keeps its separate `litellm` provider and `LITELLM_*` credentials. The providers, models, endpoints, and authentication do not override one another.

## Authentication

### Interactive login

Inside Pi, run `/login`, choose **Use a subscription**, then select **LLM Hub**. The extension prompts for the LLM Hub base URL and API key, verifies them by discovering models from `/v1/models`, and stores the credentials in Pi's `auth.json`.

Saved login credentials take precedence over environment variables. The base URL stored by `/login` is applied to every discovered `llm-hub` model.

### Environment fallback

For non-interactive setup, provide both variables:

```bash
export LLMHUB_BASE_URL="https://llm-hub.example.com"
export LLMHUB_AUTH_TOKEN="..."
```

`LLMHUB_BASE_URL` should be the LLM Hub origin/base endpoint. The extension trims trailing slashes and discovers models from `/v1/models` using Anthropic API-key style authentication.

If neither saved credentials nor both environment variables are available, the provider still registers with no models so **LLM Hub** remains available in the `/login` subscription list.

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

The extension starts telemetry when the `llm-hub` provider becomes active, keeps one logical telemetry session across provider switches, and flushes/stops when switching to `litellm` or any other provider. All telemetry-producing handlers also check the active provider. Teardown is failure-safe: an OTLP flush failure cannot leave the old exporter active or poison later model transitions.

With the metrics-only settings in `~/.claude/settings.json`, the extension emits all metrics Claude Code normally includes:

- `claude_code.session.count`
- `claude_code.token.usage`
- `claude_code.cost.usage`
- `claude_code.active_time.total`
- `claude_code.lines_of_code.count`
- `claude_code.commit.count`
- `claude_code.pull_request.count`
- `claude_code.code_edit_tool.decision`

## Behavior

- Registers the provider and `/login` subscription flow even when no credentials are configured.
- Discovers models during async extension initialization when saved or environment credentials are available.
- Keeps login available with an empty model list when startup discovery fails, allowing credentials to be replaced interactively.
- Does not change the selected/default model. Opt in with `/model`, `--model`, `defaultProvider`, `defaultModel`, or `enabledModels`.
- Uses a two-second discovery timeout to keep startup bounded.
- Starts no long-lived OTEL resources until a session is active with an LLM Hub model.

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
bun install
bun run --filter llm-hub test
bun run --filter llm-hub typecheck
```
