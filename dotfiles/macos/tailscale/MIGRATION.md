# One-time Homebrew Tailscale cutover

Do this from a **local terminal**, not over SSH. Use the profile already selected
on this Mac:

```sh
mise --env personal-macos run migrate:tailscale
# or
mise --env work-macos run migrate:tailscale
```

The temporary task installs the root-owned daemon outside Homebrew if needed,
then retires the old Homebrew system LaunchDaemon and user LaunchAgent. It keeps
the existing node state and proxy settings. If the separate daemon is already
running, it leaves it running and only retires leftovers. It returns recognized
Homebrew-hardened Tailscale paths to the Homebrew owner, so ordinary cleanup can
prune obsolete kegs. It does not prune packages or change other formulas.

The task checks the necessary privileged operations before interrupting a
service. If the new daemon cannot start, it attempts to restore the original
service and keeps its plist and keg. If only removal of leftovers fails, the
new daemon is left running and the migration can be rerun. Unrecognized custom
plists or ownership patterns are reported rather than overwritten.

Verify `tailscale version --daemon` and SSH in from another device. Afterward,
use `mise run upgrade` and `mise run cleanup` for routine maintenance. The
migration task, its tests, and this page can be removed after both Macs finish.
