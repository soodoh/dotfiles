# Yazi

`Ctrl+Y` copies selected files, or the hovered file when nothing is selected,
using the same Yazi action in Herdr, a shell, and Neovim.

- Paths are relative to the Git worktree root of the directory currently being
  browsed. Linked worktrees use their own root; entering another repository
  changes the base.
- Outside a Git worktree (or when Git is unavailable), paths are relative to the
  process launch directory captured by `init.lua`, not the directory subsequently
  browsed. Launching Yazi with a file/directory argument does not change this
  fallback base. Different launch directories can therefore yield different
  paths outside Git.
- Multiple paths are sorted and copied one per line, without shell quoting.
  No selection and no hovered file leaves the clipboard unchanged.
- Only local paths are supported. Clipboard delivery uses Yazi's native backend.

The local `copy-relative-path.yazi` plugin needs no package installation. Mise
already owns Git and Yazi; the whole Yazi config directory is symlinked. Neovim's
`yazi.nvim` has its relative-path mapping disabled so `Ctrl+Y` reaches Yazi.
Restart Neovim and any running Yazi sessions after configuration changes.

## Validation

```sh
python3 dotfiles/common/yazi/copy-relative-path.test.py
```

The tests run real Yazi processes in isolated PTYs with temporary config/state,
Git fixtures, and a fake clipboard executable. They do not use the workstation
clipboard. A headless Neovim check verifies that its config delegates the mapping;
this is not a full test of the Neovim UI or every terminal's clipboard transport.
The suite also runs under `mise run validate:dotfiles` on macOS/Linux.
