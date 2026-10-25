#!/usr/bin/env bash
# The editor engine = upstream ranuts/document at a pinned commit + Kiroku's changes in engine.patch.
#   bash scripts/engine.sh setup   first time: clone + apply the patch; then install, build, copy into app/engine-dist
#   bash scripts/engine.sh patch   after changing files in engine/: rewrite engine.patch from them
# Needs Git (Git Bash on Windows), Node.js 24+, pnpm 11 (corepack enable).
set -euo pipefail
BASE=37ecc5c5080b66296a3cb8df5d7e51ddf2172e68
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
case "${1:-}" in
  setup)
    if [ ! -d engine/.git ]; then
      git clone https://github.com/ranuts/document.git engine
      git -C engine checkout -q -b kiroku "$BASE"
      git -C engine apply --whitespace=nowarn "$ROOT/engine.patch"
    fi
    (cd engine && CI=true pnpm install && pnpm run build)
    # the build regenerates these vendored files; keep them as they are in the engine source
    git -C engine checkout -- index.html public/ran-fonts public/ran-tokens.css public/ranui-iife
    (cd app && npm ci && npm run prepare-engine)
    ;;
  patch)
    git -C engine add -A
    git -C engine diff --cached --binary "$BASE" > engine.patch
    echo "engine.patch updated"
    ;;
  *) echo "usage: bash scripts/engine.sh setup|patch" >&2; exit 1 ;;
esac
