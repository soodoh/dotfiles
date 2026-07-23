# statusline

`statusline` is a lean, compact, powerline-style statusline for Pi.

This package was created to provide similar statusline-focused functionality to [`pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer), while removing features unrelated to the statusline itself. It keeps the pieces I needed—model, thinking mode, git, provider, and context visibility—and intentionally leaves out broader UI features such as welcome overlays, vibes, stash flows, bash mode, presets, and slash-command controls.

## Highlights

- Renders a compact statusline below the editor.
- Shows the active model name.
- Shows the current thinking level as a separately configurable, level-colored section.
- Shows the current git branch plus staged and unstaged change counts.
- Shows provider usage badges when the `provider_usage` section is configured and Pi exposes the relevant provider/auth data. All supported authenticated providers are shown (e.g. GitHub Copilot, OpenAI Codex subscription, Anthropic, and OpenRouter), regardless of which model is currently active.
- Shows context usage as percentage plus context window, with warning colors above 70% and 90%.
- Indicates auto-compaction when Pi reports it as enabled.
- Adapts to terminal width by hiding less important provider detail first.
- Auto-detects Nerd Font-capable terminals and falls back to ASCII-safe symbols.

## Install

This extension is part of the local `pi-extensions` package. From the dotfiles repository root, install dependencies and link the package once:

```bash
bun install
ln -sfn "$PWD/pi-extensions" "$HOME/.pi/agent/pi-extensions"
```

To load only `statusline`, add a filtered package entry to `~/.pi/agent/settings.json` for a global install, or `.pi/settings.json` for a project-local install:

```json
{
  "packages": [
    {
      "source": "./pi-extensions",
      "extensions": ["packages/statusline/index.ts"],
      "skills": [],
      "prompts": [],
      "themes": []
    }
  ]
}
```

Restart Pi or run `/reload` after installing.

## Usage

The extension activates automatically for sessions with a UI. It installs a below-editor widget named `pi-statusline` and keeps it refreshed as Pi emits session, agent, provider, model, thinking-level, input, tool, and compaction events.

There are no slash commands. The statusline is intentionally always-on once the extension is loaded.

## Statusline segments

The rendered line is width-aware and may omit provider detail in narrow terminals.

| Segment        | Description                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Model          | Current Pi model name, with a shorter display for Claude model names.                                              |
| Thinking       | Current Pi thinking level (`off` through `max`), using Pi's matching level color.                                   |
| Git            | Branch name, staged `+n`, and unstaged `*n` markers. Untracked files still make the branch appear dirty.           |
| Provider usage | Usage or balance information for all authenticated configured providers when configured and available. |
| Context        | Current context percentage and context window, colored normally below 70%, warning above 70%, and error above 90%. |

## Configuration

The statusline layout is configured with a `statusline.sections` array in Pi settings. It supports two formats:

### Multi-line layout (default)

Use a nested array where each inner array defines one line:

```json
{
  "statusline": {
    "sections": [["model", "thinking", "git", "context"], ["provider_usage"]]
  }
}
```

The default layout renders two lines: model, thinking level, git, and context on the first line, and provider usage on the second.

### Single-line layout

Use a flat array to render everything on one line:

```json
{
  "statusline": {
    "sections": ["model", "thinking", "git", "provider_usage", "context"]
  }
}
```

Supported sections are `model`, `thinking`, `git`, `provider_usage`, and `context`. The statusline renders only the configured sections and preserves their order. Provider usage token/quota lookups only run when `provider_usage` is present.

For example, to show only context then model on a single line:

```json
{
  "statusline": {
    "sections": ["context", "model"]
  }
}
```

Or to put git on a separate line from the model:

```json
{
  "statusline": {
    "sections": [["model", "context"], ["git"]]
  }
}
```

Nerd Font detection can be overridden with an environment variable:

```bash
POWERLINE_NERD_FONTS=1 pi   # force Nerd Font icons
POWERLINE_NERD_FONTS=0 pi   # force ASCII-safe symbols
```

Without an override, the extension enables Nerd Font icons for common terminals such as Ghostty, iTerm, WezTerm, Kitty, and Alacritty.

## Notes

- Git status is fetched asynchronously with short-lived caches so rendering stays responsive.
- Running the `bash` tool invalidates git status so the line updates after filesystem changes.
- Provider usage is best-effort, only runs when the `provider_usage` section is configured, and reflects every supported provider Pi reports as authenticated — not just the active model's provider. Supported providers include Anthropic (OAuth), OpenAI Codex (subscription), GitHub Copilot, Google Gemini CLI / Antigravity (OAuth), and OpenRouter (API key).
- Provider results are shared across processes in `${XDG_CACHE_HOME:-~/.cache}/pi/provider-usage.json` (override with `PI_PROVIDER_USAGE_CACHE_PATH`). The cache contains usage results only, never credentials, and uses the same five-minute TTL as the statusline.
- External renderers such as Sketchybar can consume the exact same discovery, fetching, formatting, and cache implementation with `bun packages/statusline/src/provider-usage-cli.ts`. The command emits `{ "text": "..." }` JSON using the exact same joined text rendered by the Pi statusline, so it only reports usage fetched directly from supported providers. Independently of Pi authentication, the `env` object in `${CLAUDE_CONFIG_DIR:-~/.claude}/settings.json` enables an `LLMHub` spend section when it contains `ANTHROPIC_BASE_URL` and either `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`; usage is fetched from `<ANTHROPIC_BASE_URL>/key/info`.
- Percentage badges use compact scope prefixes when the period is known: `S` session, `W` weekly, and `M` monthly. Ambiguous percentages and dollar balances stay unprefixed for compactness.
- The package intentionally does not persist presets or expose UI controls.

## Development

From the repository root:

```bash
bun run --filter statusline typecheck
bun run --filter statusline test
```
