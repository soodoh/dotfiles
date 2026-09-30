# shared-prompt-history

`shared-prompt-history` is a Pi extension that shares prompt history across Pi sessions.

## Highlights

- Loads previous prompts into the interactive editor history when a session starts.
- Persists native interactive input, including queued steering/follow-up prompts,
  to one global JSONL history file. RPC and extension-generated input are excluded.
- Composes existing and later Pi editor components so custom editors retain shared
  history; command/shell submissions bypassing native input are intercepted once.
- Adds `/history` to search all saved prompts and restore one into the editor.
- Avoids empty prompts and global consecutive duplicates with a cross-process
  check-and-append lock; another session's intervening prompt is never ignored.
- Fails quietly if history persistence has an issue, so prompt submission is never blocked.

## Install

This extension is part of the local `pi-extensions` package. From the dotfiles repository root, install dependencies and link the package once:

```bash
bun install --cwd pi-extensions
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
- The extension preserves `getEditorComponent()` when already configured and
  wraps later factories. Resetting uses a history-enabled `CustomEditor` with
  Pi's embedded working indicator. Submit wrappers are identity-checked.
- Only TUI mode installs an editor or opens `/history`; `hasUI` alone is not
  sufficient because RPC does not support custom terminal components.
- Orderly shutdown drains pending writes and restores the owned UI setter.
- Tail reads decode complete UTF-8 records once, preserving multibyte characters.
- Search text is indexed once per picker; extending a query filters the previous
  matches instead of repeatedly lowercasing/rescanning every prompt. History is
  append-only: there is no automatic destructive retention/pruning policy.
- Locks retry for at most five short waits; storage/lock failures remain best-effort.

## Development

From the repository root:

```bash
bun run --cwd pi-extensions typecheck
bun run --cwd pi-extensions test -- packages/shared-prompt-history
node pi-extensions/packages/shared-prompt-history/integration-host.test.mjs "$(mise which pi)"
```
