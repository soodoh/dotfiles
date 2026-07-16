# shared-prompt-history

`shared-prompt-history` is a Pi extension that shares prompt history across Pi sessions.

## Highlights

- Loads previous prompts into the interactive editor history when a session starts.
- Persists submitted prompts to one global JSONL history file.
- Wraps Pi editor components so later custom editors can still receive shared history.
- Adds `/history` to search all saved prompts and restore one into the editor.
- Avoids writing empty prompts or immediate duplicate submissions.
- Fails quietly if history persistence has an issue, so prompt submission is never blocked.

## Install

This extension is part of the local `pi-extensions` package. From the dotfiles repository root, install dependencies and link the package once:

```bash
bun install
ln -sfn "$PWD/pi-extensions" "$HOME/.pi/agent/pi-extensions"
```

To load only `shared-prompt-history`, add a filtered package entry to `~/.pi/agent/settings.json` for a global install, or `.pi/settings.json` for a project-local install:

```json
{
  "packages": [
    {
      "source": "./pi-extensions",
      "extensions": ["packages/shared-prompt-history/index.ts"],
      "skills": [],
      "prompts": [],
      "themes": []
    }
  ]
}
```

Restart Pi or run `/reload` after installing.

## Usage

The extension runs automatically in interactive sessions.

Use the normal editor history controls in Pi. Prompts submitted in one session become available in future sessions after restart/reload.

Run `/history` to open a searchable prompt-history picker. Selecting a prompt restores it into the editor without submitting it, so you can edit before sending.

## Configuration

There is no user configuration.

## Storage

Prompt history is stored as newline-delimited JSON at:

```text
~/.local/state/pi/prompt-history.jsonl
```

Each entry is shaped like:

```json
{ "ts": "2026-01-01T00:00:00.000Z", "prompt": "Example prompt" }
```

Malformed lines are ignored on read, which keeps a partially written record from breaking startup.

## Notes

- Only non-empty trimmed prompts are persisted.
- Consecutive duplicate prompts are skipped.
- Startup editor history loads a bounded tail, but `/history` reads all valid records in the history file.
- The extension installs a default `CustomEditor` and wraps later calls to `ctx.ui.setEditorComponent(...)` so other editor extensions can still participate.

## Development

From the repository root:

```bash
bun run --filter shared-prompt-history typecheck
bun run --filter shared-prompt-history test
```
