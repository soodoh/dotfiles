# llm-hub

Pi extension that dynamically registers an Anthropic-compatible LLM Hub as a model provider.

## Required environment

```bash
export ANTHROPIC_BASE_URL="https://llm-hub.example.com"
export ANTHROPIC_AUTH_TOKEN="..."
```

`ANTHROPIC_BASE_URL` should be the LLM Hub origin/base endpoint. The extension trims trailing slashes and discovers models from `/v1/models` using Anthropic API-key style authentication.

## Optional settings

Configure the provider name in `~/.pi/agent/settings.json` or `<project>/.pi/settings.json`:

```json
{
  "llm-hub": {
    "providerName": "llm-hub"
  }
}
```

Project settings override global settings. If `providerName` is unset or invalid, it defaults to `llm-hub`.

## Behavior

- Silently does nothing when required environment variables are missing or empty.
- Silently does nothing when model discovery fails or returns no usable model IDs.
- Starts discovery in the background on `session_start`, so pi startup is not delayed.
- Registers the provider after discovery succeeds; it may not appear immediately at startup or in instant `--list-models` output.
- Does not change the selected/default model. Opt in with `/model`, `--model`, `defaultProvider`, `defaultModel`, or `enabledModels`.
- Reports provider-name collisions as errors and skips registration instead of overriding an existing provider.
