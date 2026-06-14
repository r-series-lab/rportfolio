#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

cd "$REPO_ROOT"

rustup target add x86_64-unknown-linux-gnu

export CC_x86_64_unknown_linux_gnu="npx -y -p @ziglang/cli zig cc -target x86_64-linux-gnu.2.31"
export CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER="$REPO_ROOT/scripts/zig-linux-gnu-cc.sh"

cargo build \
  --manifest-path ./src-tauri/Cargo.toml \
  --release \
  --no-default-features \
  --target x86_64-unknown-linux-gnu

du -h ./target/x86_64-unknown-linux-gnu/release/rportfolio
