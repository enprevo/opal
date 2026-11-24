#!/usr/bin/env bash
# Installs Opal on this Mac or Linux computer from this folder, in one step:  ./install.sh
# When Node.js (22.12 or newer) is missing it offers to install it with nvm, in your home folder.
# Options: --no-open (do not start Opal at the end), --appimage (Linux: install the AppImage).
set -e
cd "$(dirname "$0")"

node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; fi
}

if ! node_ok; then
  load_nvm
  if ! command -v nvm >/dev/null 2>&1; then
    echo "Opal needs Node.js 22.12 or newer to be built, and this computer does not have it."
    ans=n
    read -r -p "Install it now with nvm (in your home folder, no administrator password)? [Y/n] " ans || ans=n
    case "${ans:-y}" in
      [nN]*) echo "Install Node.js from https://nodejs.org, then run ./install.sh again."; exit 1 ;;
    esac
    if ! command -v curl >/dev/null 2>&1; then
      echo "curl is needed to download nvm (on Ubuntu: sudo apt install curl)."
      exit 1
    fi
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    load_nvm
  fi
  nvm install # the version in .nvmrc
  nvm use >/dev/null
fi

if ! node_ok; then
  echo "Node.js 22.12 or newer is still missing. Install it from https://nodejs.org, then run ./install.sh again."
  exit 1
fi

exec node build/install.mjs "$@"
