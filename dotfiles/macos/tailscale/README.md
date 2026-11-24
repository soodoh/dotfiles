# System Tailscale daemon

Both macOS profiles use the root daemon with the normal system tunnel. Homebrew
supplies the CLI and the candidate daemon binary. The running copy lives under
`/Library/Application Support/dotfiles-tailscale`, separate from the Cellar, and
launchd manages it as `system/dev.dotfiles.tailscaled`. Work keeps its GOST agent
and `/etc/tailscale/tailscaled-env.txt`; personal does not use GOST.

## First install

Run `mise run tailscale:deploy` from a local terminal after choosing the macOS
profile and installing its Homebrew packages. The task checks exact `sudo`
permissions before changing the service. Authenticate a fresh node with
`tailscale up`, and enable inbound Tailscale SSH with `tailscale set --ssh`.

## Updates and cleanup

Run `mise run upgrade` locally. It runs native `mise bootstrap --upgrade`, then
offers to refresh the running daemon only if the source binary differs from the
protected copy. It does not start a deliberately stopped service or restart
Tailscale over SSH. Use `mise run tailscale:deploy` if you need to retry or start
the service explicitly. The CLI and daemon may briefly report different versions
between the package upgrade and daemon refresh.

The deploy task checks the running version and attempts to restore the previous
binary and service if the verification fails. Verify `tailscale version
--daemon` and an actual SSH connection from another device after an upgrade.
`tailscale debug daemon-logs` streams logs from a running daemon. The version
check cannot establish that other peers can reach the Mac.

`mise run cleanup` prunes Homebrew independently without stopping the daemon.
Plain bootstrap and `mise run update` do not deploy the protected binary.
