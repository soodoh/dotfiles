# statusline

`statusline` is a lean, compact, powerline-style statusline for Pi.

This package was created to provide similar statusline-focused functionality to [`pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer), while removing features unrelated to the statusline itself. It keeps the pieces I needed—model, thinking mode, git, provider, and context visibility—and intentionally leaves out broader UI features such as welcome overlays, vibes, stash flows, bash mode, presets, and slash-command controls.

## Highlights

- Replaces Pi's footer with a compact statusline below the editor, preserving status text published by other extensions.
- Shows the active model name, with shorter display for Claude names, and a Fast bolt when CLIProxyAPI Fast is effective for that model.
- Shows the current thinking level as a separately configurable, level-colored section.
- Shows the current git branch plus staged and unstaged change counts.
- Shows provider usage badges when the `provider_usage` section is configured and Pi exposes the relevant provider/auth data. All supported authenticated providers are shown (e.g. GitHub Copilot, OpenAI Codex subscription, Anthropic, and OpenRouter), with the selected model's provider highlighted in the model accent.
- Shows context usage as percentage plus context window, with warning colors above 70% and 90%.
- Indicates auto-compaction when Pi reports it as enabled.
- Adapts to terminal width by hiding less important provider detail first, then wrapping overflow onto additional lines.
- Uses Nerd Font icons throughout; a Nerd Font is required in the terminal client.

## Install

This extension is part of the local `pi-extensions` package. From the dotfiles repository root, install dependencies and link the package once:

```bash
bun install --cwd pi-extensions
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

The extension activates automatically in terminal UI sessions, including regular and fullscreen modes. It renders directly through `ctx.ui.setFooter()` and keeps it refreshed as Pi emits session, agent, provider, model, thinking-level, input, tool, and compaction events. RPC, JSON, and print modes do not install the footer or start usage/git refreshes.

The custom footer replaces Pi's default cwd, token/cost totals, and model-routing display. Status text published through `ctx.ui.setStatus()` is preserved on a separate, width-bounded row. Native Pi's MCP connection status is available through `/mcp`, not the footer.

There are no slash commands. The statusline is intentionally always-on once the extension is loaded.

## Statusline segments

The rendered line is width-aware: narrow terminals use active-only provider detail when needed, then wrap remaining overflow onto additional lines without truncating sections.

| Segment        | Description                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Model          | Current Pi model name, shortened for Claude, with a bolt when the selected CLIProxyAPI model has Fast enabled and supports priority service tier. |
| Thinking       | Current Pi thinking level (`off` through `max`), using Pi's matching level color.                                   |
| Git            | Branch name, staged `+n`, and unstaged `*n` markers. Untracked files still make the branch appear dirty.           |
| Provider usage | Usage or balance information for all authenticated configured providers, with OpenAI window reset dates and reset-credit counts and the selected model's provider highlighted. |
| Context        | Pi's current context percentage and effective context window, colored normally below 70%, warning above 70%, and error above 90%. Unknown usage (including immediately after compaction) renders as `?` until Pi reports a new estimate. |

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

## OpenAI subscription usage

OpenAI subscriptions reuse the corresponding CLIProxyAPI account's quota when available, for example `5% (7d ↻3)`. Inference authentication and routing are unchanged. No Codex CLI, browser cookies, or manual mapping is required; the corresponding Codex account must already be enrolled in CLIProxyAPI, with its management URL/key available to the reader. Native `/login openai` does not require another local legacy login.

For native `openai` OAuth, the collector verifies that Pi's resolved provider credential matches the stored grant, then matches its client ID against complete app-registration lists fetched through the proxy's read-only `/wham/usage/chatpass/apps` route. Exactly one matching proxy credential is required. Registration matching is not independent identity proof; the backend endpoint is undocumented. Missing, duplicate, incomplete, or failed registration lookups show a standalone OpenAI `?`, without affecting the proxy-account overview.

For legacy `openai-codex` OAuth, the resolved token's ChatGPT account ID is matched against account metadata already returned by the proxy's credential listing. Only unique matches from complete account metadata are accepted; email/plan/name guessing is never used. The shared proxy refresh completes before deciding whether a direct read is necessary. Usable proxy quota wins, including for accounts disabled for proxy routing. Without a usable match, the existing credential-scoped direct usage/reset reader and cache are the fallback. Legacy matching adds no app-registration requests. If a matched disabled proxy entry has no usable quota, direct fallback quota fills that same entry rather than producing a duplicate; quota observation times remain distinct from the proxy metadata snapshot time, and direct reset counts do not claim proxy reset-expiration details.

Matching reuses the existing account quota and observation timestamps; a matched usable proxy observation does not cause an additional direct plan-usage request or a second quota cache. Only hashed registration/account-ID associations enter the proxy cache, scoped to its normalized management base URL and key. Local OAuth tokens and raw app/profile data are never sent to the proxy or cached. App-registration reads add one GET per Codex account at the existing refresh cadence, only when a verified native grant is present. A fresh older snapshot missing requested association metadata is upgraded once; associations must be fresh (five minutes) even when ordinary proxy quotas can still display stale data.

Plan percentages are **used**, not remaining. They do not establish native app-specific availability. The `↻N` count reports available account reset credits, not app-specific allowance. App usage percentages and reset-credit redemption are outside this feature. OpenAI API keys do not use subscription associations.

**SketchyBar:** a linked account appears only as its existing proxy item and popup, with no duplicate direct OpenAI badge. **Pi:** that same entry has adjacent OpenAI and terminal icons, followed by one quota summary. A direct OpenAI model accents the linked OpenAI icon and quota text, leaving the terminal icon dim. A CLIProxyAPI model accents terminal icons and quota text for all enabled proxy accounts, leaving OpenAI icons dim: the statusline does not claim to know which pooled credential handled a request. Other entries stay dim. A disabled proxy route's terminal icon remains dim, but does not prevent an active direct OpenAI route from accenting its icon/text. Narrow active-only layouts retain the linked active account.

## Notes

- CLIProxyAPI is loaded from the local `pi-extensions` package in both macOS profiles. Supply `CLIPROXYAPI_BASE_URL` in the environment before launching Pi; mise provides the encrypted `CLIPROXYAPI_API_KEY`. Existing default models remain unchanged. Use `/model` to select a CLIProxyAPI model and `/fast` to toggle the provider's Fast preference (off initially).
- The local `packages/cliproxyapi/index.ts` adapter loads the installed provider unchanged and publishes a read-only Fast reader to this statusline; only the adapter knows the provider's controller type. The bolt reflects the current Pi process's effective priority tier for the selected model, not the shared `cliproxyapi.json` preference. It stays hidden until the provider has populated its model capabilities. `/fast` in another running Pi process does not change this bolt or this process's requests; each invocation still writes the last-used preference for future sessions. Keep the statusline extension before the adapter in the package extension list.
- Rendering reads cached git/provider state; it does not spawn git processes, discover providers, resolve credentials, or start network requests.
- Git branch and status are fetched asynchronously, with five-second caches and a five-second idle refresh. Branch notifications and the `bash`, `write`, and `edit` tools invalidate git state immediately.
- Provider targets are discovered at footer installation and model selection, then rediscovered once per minute to pick up model/auth changes and refresh countdown/staleness displays while idle. Agent/provider events also check cached targets for due usage refreshes. Existing usage TTLs and cross-process leases still govern actual network requests. Footer disposal and session shutdown stop polling and ignore late callbacks.
- Provider usage is best-effort, only runs when the `provider_usage` section is configured, and reflects every supported provider Pi reports as authenticated—not just the active model's provider. Supported providers include LLM Hub, Anthropic (OAuth), OpenAI Codex (subscription), native OpenAI OAuth (proxy-sourced plan usage), GitHub Copilot, and OpenRouter (API key). LLM Hub is treated as a normal authenticated Pi provider: its endpoint comes from Pi's configured model/provider data and its API key is resolved through Pi's provider-auth APIs.
- When LiteLLM is active, model IDs whose first route segment is exactly `chatgpt` or `openai` highlight the existing OpenAI usage badge. Other LiteLLM routes do not map to a usage provider, and this mapping does not create targets or change provider requests.
- Direct-provider requests make at most three attempts, retrying only network failures, throttling, and transient HTTP responses with capped exponential backoff and full jitter. `Retry-After` is honored up to the backoff cap; authentication and other non-transient failures fail immediately. All usage sources share a five-minute successful refresh, one-minute failed-refresh retry, and 15-minute maximum last-known-value display lifetime. Age-based `!` stale warnings allow a one-minute grace period after refresh becomes due (appearing once a snapshot is older than six minutes), so routine background refreshes do not flash warnings. Failed or empty refreshes warn immediately; neither the grace period nor an in-flight refresh extends the 15-minute display lifetime. A missing value for an active direct provider still renders as `?`.
- Provider results are shared across processes in `${XDG_CACHE_HOME:-~/.cache}/pi/provider-usage.json` (override with `PI_PROVIDER_USAGE_CACHE_PATH`). Both usage caches are disposable, unversioned snapshots: readers validate their current structure, malformed data is a cache miss, and missing optional fields are filled on the next normal TTL refresh (except requested OpenAI association metadata, which upgrades a fresh older proxy snapshot once). Cache entries are scoped by a one-way credential fingerprint, contain usage results only, never credentials or endpoints, and use provider-specific refresh leases so concurrent Pi and Sketchybar processes join the first refresh instead of making duplicate requests. LLM Hub fingerprints include both the normalized Pi base URL and resolved Pi API key.
- CLIProxyAPI accounts use a separate cache (`${XDG_CACHE_HOME:-~/.cache}/pi/cliproxy-usage.json`, override with `PI_CLIPROXY_USAGE_CACHE_PATH`). If `CLIPROXYAPI_MANAGEMENT_KEY` and `CLIPROXYAPI_BASE_URL` are present, the reader lists accounts with `GET /v8/management/credentials`. The configured server is expected to support the current v8 management interface. All management calls use curl (which honors the work profile's GOST proxy settings). The management key is privileged and distinct from the inference key. The raw response contains identity and token fields: neither it nor credential labels are logged or cached. Only Codex accounts are currently supported; other enrolled provider types are hidden. For every Codex account, including disabled accounts, the reader also forwards a read-only `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` through `POST /v8/management/requests/api-call`. The proxy substitutes the account's token for literal `Bearer $TOKEN$`; the statusline never downloads upstream credentials. Requests include the account's `id_token.chatgpt_account_id` when available, and run at most four at a time within the shared refresh lease. The normalized available count is displayed as `↻N`, matching direct Codex usage; zero or unknown counts are omitted. Disabled accounts remain in the same stable order with dimmed proxy-route styling; a separately active direct OpenAI route can still accent its own icon and the shared quota text. They are included even without usable quota, showing `?` rather than disappearing. Every account also fetches `/wham/usage` through the same read-only management forwarding for its quota and credit balance (credits, not USD or manual resets). The normalized `creditBalance` is a nonnegative number or `"unlimited"`, separate from the compact scope so Pi's badges are unchanged. Missing/failed balance reads show unavailable rather than zero or a newly timestamped old balance. Successful `/usage` quota responses supersede management headers for active and disabled accounts alike; Free accounts may have no quota headers at all. Header windows are normalized through the same parser as direct Codex usage. When `/usage` has no usable quota, valid management headers are the fallback; otherwise a valid last-known quota can survive for up to 15 minutes from its original observation. Retained quota is marked stale, and refreshing metadata never extends its lifetime. Disabled-account quota lookup failures remain explicit even when headers provide a fallback. These reads never enable inference routing or consume credits. Re-enabling restores normal styling, not a different quota source. Safe account details (plan, health, and available reset-credit grant/expiry timestamps) are also cached for external renderers; raw credit IDs, profile data, and identity labels are discarded. Failed reset-credit lookups do not hide quota percentages or other accounts' credits, and positive reset counts can appear even without a current quota observation. No credits are consumed and no routing cooldowns are reset. Account ordering is deterministic by hashed credential identity, not usage. Each proxy Codex account has its own `nf-fa-terminal` glyph, with no account numbers or aliases. Proxy accounts and direct providers share the same middot (` · `) separator; unlinked direct OpenAI Codex keeps its existing OpenAI glyph, while linked accounts use the merged display described above. Pi shows every supported account's value. The CLI's compatibility `text` field still limits proxy accounts to two plus `+N`, while structured `proxyAccounts` includes every visible account. The proxy stores a batch account snapshot separately because the management endpoint returns all accounts at once. A snapshot with no supported accounts is retried after one minute rather than the five-minute successful refresh interval; non-empty snapshots use the normal freshness policy. An older server quota observation does not itself make a successful management read stale; its percentages are shown only while the reported reset window remains valid (or for up to 15 minutes without a reset timestamp).
- GitHub Copilot reuses its existing read-only `GET https://api.github.com/copilot_internal/user` call and credential-scoped provider cache for popup details; no extra requests or credentials are needed. The compact Pi badge remains a monthly percentage without added counts or a reset countdown. Sketchybar gives Copilot a separate hoverable item in regular and notch layouts, showing the reported plan, billing units (AI credits, legacy premium requests, or unknown), used/allowance and remaining values, local reset time/countdown, paid-overage policy and reported consumption, and freshness/lookup status. Counts come from the reported entitlement and `quota_remaining` (falling back to `remaining`), never rounded percentages or hard-coded plan limits. Aggregate `credits_used` has no entitlement denominator and is shown separately only for unlimited quotas, not divided by a budget. Business/Enterprise popups explicitly distinguish the reported account quota from the organization's shared pool. Missing values remain unavailable/not reported, explicit zeroes remain zero, unlimited quotas do not get a percentage, and expired quota periods are not shown as current popup counts. Failed reads retain details only within the existing 15-minute maximum, preserve the original observation time, and mark them stale; successful partial responses do not relabel old fields as fresh. Only allowlisted plan names and normalized quota fields enter the cache/output; raw identity, organizations, SKU and tokens are discarded. Chat/completion quotas and model pricing are not included in this first popup.
- External renderers such as Sketchybar consume the exact same discovery, fetching, formatting, and cache implementation with `bun packages/statusline/src/provider-usage-cli.ts`. The CLI constructs Pi's `ModelRuntime`, loads `models.json`, and resolves credentials from Pi's normal `auth.json`; it does not depend on Claude settings or inherited Anthropic/LLM Hub environment variables. Sketchybar records standalone refresh diagnostics in `${XDG_CACHE_HOME:-~/.cache}/sketchybar/ai-usage.log` (override with `AI_USAGE_LOG_PATH`). The command preserves its `text` field and additionally returns `directText` (provider badges not already represented by a linked proxy account or the dedicated Copilot item), optional `copilot` (compact summary, sanitized plan/premium quota details, state, observation/attempt times, and staleness), and `proxyAccounts` (stable hashed keys, compact summaries, quota scopes, plan/health, disabled state, reset expirations, quota/reset-credit observation times, credit balance, snapshot fetch time, lookup-failure flags, and staleness). Sketchybar uses these structured fields rather than splitting rendered text. Shared TypeScript owns all provider fetching, validation, caching, and compact account formatting; Sketchybar alone owns item and popup presentation.
- Percentage badges stay unprefixed when a provider reports one value. When multiple values need disambiguation, compact scope prefixes identify `S` session, `W` weekly, and `M` monthly usage. Unclassified Codex windows retain their reported duration and render it explicitly (for example, `14d 23%`), rather than being guessed as weekly. Five-hour, seven-day, and 28–31-day Codex windows map to session, weekly, and monthly scopes regardless of plan; legacy responses without a duration retain their primary/session and secondary/weekly defaults. Monthly and unclassified windows carry reset timestamps through both caches and displays. Zero usage is valid; expired windows are omitted, not relabeled zero. Percentages without a reported duration and dollar balances stay unprefixed for compactness. Reset timestamps use rounded-up relative time; available banked reset credits share the detail without a dot separator (for example, `93% (2d ↻3)`).
- Sketchybar renders every proxy account as a separate native item in both regular and notch layouts, using a terminal glyph for each account and the same middot separators as direct providers. Hover opens a tooltip for only that account: a `Codex · Plan` heading with the snapshot's local `Updated at` time, account status, reported quota windows and local reset times, credit balance, and available manual resets with their individual expiration dates. A quota/reset observation timestamp appears only when it predates the snapshot by over a minute or a failed lookup retained data; a successful metadata refresh never implies a new quota observation. Disabled account tooltips keep an explicit `Disabled` status while showing fresh data normally and remain hoverable when usage is unavailable. Failed quota/reset lookups are identified separately; only retained fallback reset counts are labelled last observed. Unreported windows are omitted; an unknown manual-reset count is shown as unavailable, not zero. The compiled Swift helper opens/closes cached popup rows without compilation, Bun, credentials, network access, or reset redemption on hover. Background refresh updates surviving native items in place and removes obsolete accounts/rows. Notch overflow measures the combined group and divides the scrolling character budget across its individual items; account popups remain independently hoverable.
- The package intentionally does not persist presets or expose UI controls.

## Development

From the repository root:

```bash
bun run --cwd pi-extensions typecheck
bun run --cwd pi-extensions test -- packages/statusline
node pi-extensions/packages/statusline/integration-host.test.mjs "$(mise which pi)"
bash dotfiles/macos/sketchybar/helper/build.sh test
```

For an opt-in native hover/geometry check against a running, refreshed bar:

```bash
SKETCHYBAR_LIVE_TESTS=1 bash dotfiles/macos/sketchybar/helper/build.sh test
```

The native checks require existing input-monitoring permission for hover, move/restore the pointer, and pause/restore the usage and layout timers. Notch-specific live checks skip unless a notched display is connected. The Swift implementation and development commands are documented in `dotfiles/macos/sketchybar/helper/README.md`. It never prompts for permission or starts services. After changing shared account data, reload all open Pi sessions so older loaded readers do not overwrite the cache without the new optional details.
