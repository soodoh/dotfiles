# prompt-suggester

`prompt-suggester` is a Pi extension that suggests likely next prompts from the current session and project context.

This package is derived from the idea behind [`pi-prompt-suggester`](https://github.com/guwidoe/pi-prompt-suggester): generate useful next-prompt suggestions after assistant turns. This version is intentionally simplified for this repo's needs. It keeps ghost text suggestions and project-aware seeding, while removing configuration UIs, slash-command surfaces, alternate display modes, and other features I did not need.

## Highlights

- Generates likely next user prompts after assistant completions.
- Displays suggestions as ghost text in the editor.
- Accepts ghost text with the configured accept key, defaulting to Right Arrow.
- Supports accept-and-send with a separate configured key, defaulting to Enter when the editor is empty and a suggestion is visible.
- Builds suggestions from recent conversation signals, touched files, unresolved questions, tool activity, abort context, and project seed data.
- Maintains per-project seed/state under the user's local state directory.
- Uses the session's model and thinking level by default unless configured otherwise.

## Install

These packages are not published to npm. Use Pi's Git package source.

To install the whole repo package:

```bash
pi install git:github.com/soodoh/pi-extensions
```

To load only `prompt-suggester`, add a filtered package entry to `~/.pi/agent/settings.json` for a global install, or `.pi/settings.json` for a project-local install:

```json
{
  "packages": [
    {
      "source": "git:github.com/soodoh/pi-extensions",
      "extensions": ["packages/prompt-suggester/src/index.ts"],
      "skills": [],
      "prompts": [],
      "themes": []
    }
  ]
}
```

If you prefer SSH, use this source instead:

```text
git:git@github.com:soodoh/pi-extensions
```

Restart Pi or run `/reload` after installing.

## Usage

The extension runs automatically.

1. Work normally in Pi.
2. After an assistant turn ends, the extension builds context and may generate a suggested next prompt.
3. When the editor is empty, the suggestion appears as inline ghost text.
4. Press Right Arrow to accept the suggestion into the editor.
5. Press Enter to accept and immediately send the suggestion when the editor is empty and a ghost suggestion is visible.

There are no `/suggester` or `/suggesterSettings` commands in this simplified package.

## Configuration

Defaults live in [`prompt-suggester.config.json`](./prompt-suggester.config.json). The current user-facing Pi settings override is intentionally narrow:

```json
{
  "promptSuggester": {
    "suggesterModel": ["session-default"]
  }
}
```

Place that in:

```text
~/.pi/agent/settings.json
```

Key defaults include:

| Setting                                 | Default               | Description                                                                                      |
| --------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| `suggestion.ghostAcceptKeys`            | `["right"]`           | Keys that accept ghost text into the editor. Supported values are `space`, `right`, and `enter`. |
| `suggestion.ghostAcceptAndSendKeys`     | `["enter"]`           | Keys that accept the full ghost suggestion and submit it when the editor is empty.               |
| `suggestion.maxSuggestionChars`         | `200`                 | Maximum suggested prompt length.                                                                 |
| `suggestion.prefillOnlyWhenEditorEmpty` | `true`                | Keeps suggestions from overwriting active typing.                                                |
| `suggestion.strategy`                   | `compact`             | Suggestion strategy; `transcript-steering` is also supported by the code.                        |
| `reseed.enabled`                        | `true`                | Enables project seed refreshes.                                                                  |
| `reseed.checkOnSessionStart`            | `true`                | Checks whether project seed data is stale on startup.                                            |
| `reseed.checkAfterEveryTurn`            | `true`                | Checks whether project seed data is stale after turns.                                           |
| `inference.seederModel`                 | `session-default`     | Model used for project seeding.                                                                  |
| `inference.suggesterModel`              | `["session-default"]` | Ordered model list used for prompt suggestions; the first available entry wins.                  |

## State and logs

Per-project state is stored below:

```text
~/.local/state/pi/pi-prompt-suggester/projects/<project-name>-<hash>/
```

Notable files include:

- `seed.json` — project seed metadata and findings.
- session state files managed by the extension's state store.
- `logs/events.ndjson` — event log for suggester activity.

## What changed from pi-prompt-suggester

Compared with [`pi-prompt-suggester`](https://github.com/guwidoe/pi-prompt-suggester), this package is intentionally narrower:

- Configuration path changed: this package uses package defaults plus `~/.pi/agent/settings.json` `promptSuggester.suggesterModel`; it does not use user/project `.pi/suggester/config.json` override files.
- Added/defaulted accept-and-send behavior through `suggestion.ghostAcceptAndSendKeys` (`Enter` by default).
- Ghost-only display: there is no selectable widget `displayMode`; suggestions are presented as ghost text.
- No `/suggester` command surface.
- No `/suggesterSettings` TUI.
- No slash-command editing for instruction/model/thinking/config/reseed/seed trace.
- The below-editor panel is only used for transient status/log lines, not as the main suggestion display.
- Model and thinking defaults are `session-default` for both seeding and suggestion generation.
- State handling is simplified around this repo's per-project local state layout.

## Notes

- Suggestions are best-effort; the extension may clear the suggestion when there is no useful next prompt.
- Ghost text is only shown when it can be safely rendered at the current editor cursor position.
- Multiline suggestions are only shown when the editor is empty.
- If the suggester model is unavailable or misconfigured, suggestion generation can fail without blocking normal Pi usage.

## Development

From the repository root:

```bash
bun run --filter prompt-suggester typecheck
bun run --filter prompt-suggester test
```
