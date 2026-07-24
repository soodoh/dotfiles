# auto-session-name

`auto-session-name` gives new unnamed Pi sessions a stable navigation title after the first submitted request has fully settled. Its single default behavior combines one low-cost initial title with, only when conservative local heuristics justify it, at most one later refinement attempt.

## Behavior

- Captures the first meaningful raw `input` before skill or prompt-template expansion and prefers it over the stored message.
- Removes a raw skill/template command prefix while keeping meaningful arguments. Command-only input falls back to the stored user message.
- Strips a leading Pi `<skill ...>...</skill>` block from the stored-message fallback.
- Generates the initial title on the first `agent_settled`, after retries, compaction retries, tool loops, and queued continuations finish. It does not run on individual `turn_end` events.
- Uses only bounded user-request text. Assistant messages, tool calls, tool results, system prompts, and project instructions are never sent to the title model.
- Limits title input to 1,600 characters using head-and-tail truncation, output to 32 tokens, provider retries to zero, and generation time to about eight seconds. Requests use deterministic temperature and disable reasoning through Pi's provider paths.
- Normalizes titles to plain text with no more than 8 words and 60 characters.
- Falls back to a deterministic prefix of the initial request if model resolution, authentication, timeout, provider generation, or output validation fails.
- Persists branch-aware ownership state in Pi custom entries, which do not enter LLM context.
- Never overwrites a startup/CLI name, `/name`, a session-picker rename, an RPC rename, or another extension's name. Changing or clearing an automatic title permanently gives ownership to that explicit choice.
- Does not scan, schedule, or backfill historical sessions. A resumed historical unnamed session remains unnamed.

## Conditional Refinement

Most sessions keep their initial automatic title permanently. After later `agent_settled` events, the extension runs cheap local checks and allows one refinement attempt only when either:

- At least three meaningful user requests exist and the original request or current title is clearly weak/generic, or the initial model call used the deterministic fallback; or
- A later request starts with a strong direction-change signal such as "Actually", "Instead", "Switch to", "New task", "Let's focus on", or "Now work on".

When eligible, the model receives only a compact envelope containing the current automatic title, the bounded original request, the latest one or two bounded user requests, and locally extracted stable anchors such as Jira keys, PR/issue references, paths, backticked symbols, or error identifiers.

The refinement prompt tells the model to keep the current title unless the dominant task materially changed or became substantially clearer. The attempt is consumed even when the provider fails, output is invalid, or the model keeps the existing title. A failed refinement never replaces the current title with a fallback and is never retried on every later turn.

## Install

This extension is part of the local `pi-extensions` package. From the dotfiles repository root, install dependencies and link the package once:

```bash
bun install
ln -sfn "$PWD/pi-extensions" "$HOME/.pi/agent/pi-extensions"
```

To load only `auto-session-name`, add a filtered package entry to `~/.pi/agent/settings.json` for a global install, or `.pi/settings.json` for a project-local install:

```json
{
  "packages": [
    {
      "source": "./pi-extensions",
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

Only two settings are configurable. Global settings are read from `~/.pi/agent/settings.json`:

```json
{
  "autoSessionName": {
    "enabled": true,
    "titleModel": ["session-default"]
  }
}
```

- `autoSessionName.enabled`: defaults to `true`. Set to `false` to disable automatic naming and refinement.
- `autoSessionName.titleModel`: non-empty string array, defaults to `["session-default"]`.

Model references support:

- `session-default` for the active session model.
- `provider/id` for an exact provider and model id.
- A bare model id when it uniquely matches one registered model.
- Ordered resolution fallbacks, for example `["openai/gpt-4.1-mini", "session-default"]`.

Invalid `titleModel` values fall back to `["session-default"]`. If configured models cannot be resolved or initial generation fails, the extension uses the deterministic initial-request fallback title.

Use a small, fast, non-reasoning task model for low latency and cost. The extension still explicitly requests reasoning-disabled generation and enforces its internal request bounds.

## Development

The workspace exposes validation scripts from `pi-extensions`. From the repository root:

```bash
bun run --cwd pi-extensions test -- packages/auto-session-name/auto-session-name.test.ts
bun run --cwd pi-extensions typecheck
bun run --cwd pi-extensions check
```
