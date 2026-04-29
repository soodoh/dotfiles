# Local pi-prompt-suggester fork

Vendored from `@guwidoe/pi-prompt-suggester@0.3.8`.

Local changes:
- Persistent runtime files are stored under `~/.local/state/pi/pi-prompt-suggester/` instead of project `.pi/suggester/`.
- State paths include a cwd-derived project key to avoid collisions across projects and sessions.
- Ghost suggestion accept keys support `enter` in addition to upstream `space` and `right`.
- Ghost editor installation continues to use `ctx.ui.setEditorComponent(...)` so existing editor wrappers, such as `shared-prompt-history`, can enhance the editor.

## Editor coexistence

This fork intentionally installs the ghost editor through `ctx.ui.setEditorComponent(...)` only. It does not manipulate TUI internals directly, so extensions that wrap `setEditorComponent`, such as `shared-prompt-history`, can compose with the ghost editor. For wrapper-style extensions to enhance the ghost editor, their `session_start` hook must run before prompt-suggester installs its editor.

To update from upstream, re-vendor the package and re-apply the local patches described above.
