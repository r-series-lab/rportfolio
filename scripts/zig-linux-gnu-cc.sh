#!/bin/sh

set -eu

exec npx -y -p @ziglang/cli zig cc -target x86_64-linux-gnu.2.31 "$@"
