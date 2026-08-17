#!/usr/bin/env bash
set -euo pipefail

command -v rustup >/dev/null || exit 0
rustup component add clippy rustfmt rust-src rust-analyzer
