# Browser routing for Pi

The local Pi package adds specialist-first routing guidance and the [terminal-browser skill](skills/terminal-browser/SKILL.md) for rendered UI work on macOS. The skill uses the existing [Herdr setup](../../../dotfiles/common/herdr/README.md#browser-panes-macos) and mise-pinned terminal-browser, which bundles its automation CLI. There is no browser MCP server. The on-demand terminal-browser daemon serves Herdr panes; panes share site data and are not account profiles.

## Retire an existing managed browser

Updated dotfiles do not prune old LaunchAgents or installed packages. Stop any foreground `browser:serve` task first. On each Mac that ran the previous service, stop the exact old job and remove its plist after verifying the label. Use `work-macos` in place of `personal-macos` on the work Mac:

```sh
label=dev.mise.playwright-mcp-personal-macos
job="gui/$(id -u)/$label"
plist="$HOME/Library/LaunchAgents/$label.plist"
if launchctl print "$job" >/dev/null 2>&1; then
  launchctl bootout "$job"
fi
# After verifying the job is unloaded, remove its plist if present.
rm -f "$plist"
mise uninstall --all npm:@playwright/mcp
```

If `~/.config/playwright-mcp/config.json` is still a symlink into this checkout, unlink it. Preserve old browser profiles and artifacts under `~/.local/share/playwright-mcp/`. Keep Chrome if it is also an everyday browser; remove it separately only if it was dedicated to the retired service. Restart Pi to pick up the new skill and MCP configuration.

## Verification

`mise run validate:agents:integration` verifies discovery of the skill in both Pi profiles. To smoke-test the browser on a Mac, start Pi in Herdr and ask `/skill:terminal-browser` to open an unauthenticated local page, click a control, verify the resulting state, and take a screenshot. Run a second task in another Pi session to verify each task stays in its own pane.

Optional first-route evaluation (real inference, no operational calls):

```sh
mise exec -- node --use-env-proxy pi-extensions/packages/browser/routing.eval.mjs \
  "$(mise which pi)" cliproxyapi/gpt-6.2-sol
```

Omit `--use-env-proxy` on a direct connection. This does not launch a browser or exercise services.
