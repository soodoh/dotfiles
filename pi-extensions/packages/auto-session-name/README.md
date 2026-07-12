# auto-session-name

`auto-session-name` names new unnamed Pi sessions after the first assistant turn. It asks a configured model for a short title based only on the cleaned first user message.

## Behavior

- Runs once on the first `turn_end` (`turnIndex === 0`).
- Applies to any session whose current name is empty.
- Preserves existing non-empty names before scheduling and again before setting the generated title.
- Uses only the first user message; assistant output and later user messages are ignored.
- If the first message starts with a Pi `<skill ...>...</skill>` block, that leading block is stripped before title generation.
- Normalizes model output to plain text, up to 8 words and 60 characters.
- Catches model/config/provider failures and falls back to a deterministic prefix of the cleaned first message.
- Does not scan or backfill historical session files.

## Install

These packages are not published to npm. Use Pi's Git package source.

To install the whole repo package:

```bash
pi install git:github.com/soodoh/pi-extensions
```

To load only `auto-session-name`, add a filtered package entry to `~/.pi/agent/settings.json` for a global install, or `.pi/settings.json` for a project-local install:

```json
{
  "packages": [
    {
      "source": "git:github.com/soodoh/pi-extensions",
      "extensions": ["packages/auto-session-name/index.ts"],
      "skills": [],
      "prompts": [],
      "themes": []
    }
  ]
}
```

Restart Pi or run `/reload` after installing.

## Configuration

Global settings are read from `~/.pi/agent/settings.json`:

```json
{
  "autoSessionName": {
    "enabled": true,
    "titleModel": ["session-default"]
  }
}
```

Options:

- `autoSessionName.enabled`: defaults to `true`. Set to `false` to disable automatic naming.
- `autoSessionName.titleModel`: non-empty string array, defaults to `["session-default"]`.

Model references support:

- `session-default` for the active session model.
- `provider/id` for an exact provider and model id.
- A bare model id when it uniquely matches one registered model.
- Ordered fallbacks, for example `["openai/gpt-4.1-mini", "session-default"]`.

Invalid `titleModel` values fall back to `["session-default"]`. If configured models cannot be resolved or generation fails, the extension uses the deterministic first-message fallback title.

## Examples

Plain first message:

```text
Help me design a reliable backup strategy for my laptop and home server.
```

Possible title:

```text
Reliable Backup Strategy
```

Skill-prefixed first message:

```xml
<skill name="planner">...</skill>
Add README.md for each package
```

The model receives only:

```text
Add README.md for each package
```

## Development

From the repository root:

```bash
bun run --filter auto-session-name test
bun run --filter auto-session-name typecheck
```
