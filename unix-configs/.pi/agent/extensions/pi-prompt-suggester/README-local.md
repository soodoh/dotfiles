# Local pi-prompt-suggester fork

Vendored from `@guwidoe/pi-prompt-suggester@0.3.8`.

Local changes:

- `~/.pi/agent/settings.json` is the only runtime customization source; this dotfiles repo provides it via `unix-configs/.pi/agent/settings.json`.
- The only supported custom setting is `promptSuggester.suggesterModel`.
- Persistent runtime state remains under `~/.local/state/pi/pi-prompt-suggester/` with cwd-derived project keys to avoid collisions.
- Ghost display is the only suggestion UI. Widget display mode, F2 acceptance, runtime settings UI, runtime config commands, model/thinking commands, and A/B variant controls have been removed.
- Ghost suggestion accept keys support `space`, `right`, and `enter`; accept-only defaults to `right`, and accept-and-send defaults to `enter` from package defaults.
- Ghost editor installation continues to use `ctx.ui.setEditorComponent(...)` so existing editor wrappers, such as `shared-prompt-history`, can enhance the editor.

Example Pi settings:

```json
{
  "promptSuggester": {
    "suggesterModel": "session-default"
  }
}
```

## Editor coexistence

This fork intentionally installs the ghost editor through `ctx.ui.setEditorComponent(...)` only. It does not manipulate TUI internals directly, so extensions that wrap `setEditorComponent`, such as `shared-prompt-history`, can compose with the ghost editor. For wrapper-style extensions to enhance the ghost editor, their `session_start` hook must run before prompt-suggester installs its editor.

To update from upstream, re-vendor the package and re-apply the local patches described above.
