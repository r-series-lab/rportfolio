#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

if [ -f "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"
fi

if command -v nvm >/dev/null 2>&1 && [ -f "$REPO_ROOT/.nvmrc" ]; then
  nvm use --silent >/dev/null
fi

unset OUT_DIR
unset CARGO_MANIFEST_DIR
unset CARGO_MANIFEST_PATH

for env_name in $(env | awk -F= '/^(TAURI_|CARGO_PKG_)/ { print $1 }'); do
  unset "$env_name"
done

cd "$REPO_ROOT"
exec npm run build
