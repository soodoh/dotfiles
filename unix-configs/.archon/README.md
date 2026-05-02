# User-scoped Archon setup

This directory is stowed to `~/.archon` and keeps Archon configuration global instead of per-project.

## Defaults

- Global default assistant: `pi` (`config.yaml`)
- Default Pi model: `openai-codex/gpt-5.5`
- Claude Code remains configured as an explicit fallback via `claude-assist` and `claude-plan`.

Archon's Homebrew binary embeds its own Pi SDK, but it reads user-scoped Pi state from `~/.pi/agent`. The custom `openai-codex/gpt-5.5` model is supplied by `unix-configs/.pi/agent/models.json`.

## Global workflows

These workflows are available from any git repo:

```bash
archon workflow run pi-assist --cwd /path/to/repo --no-worktree "Explain this repo"
archon workflow run pi-plan --cwd /path/to/repo --no-worktree "Plan the change"
archon workflow run pi-review --cwd /path/to/repo --no-worktree "Review my diff"
archon workflow run pi-implement --cwd /path/to/repo "Implement the change"

archon workflow run claude-assist --cwd /path/to/repo --no-worktree "Explain this repo"
archon workflow run claude-plan --cwd /path/to/repo --no-worktree "Plan the change"
```

`pi-implement` intentionally leaves worktree behavior to Archon's default isolation. Add `--no-worktree` only when you want edits directly in the live checkout.

## Adding custom workflows

- Add reusable prompts to `commands/*.md`.
- Add DAG workflows to `workflows/*.yaml`.
- Keep repo-specific `.archon` directories out of projects unless a workflow truly belongs only to that repository.
