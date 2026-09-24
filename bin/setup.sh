#!/usr/bin/env bash
# One-shot setup for a fresh clone: node check, deps, headless Chromium, .env.
set -euo pipefail

cd "$(dirname "$0")/.."

required_major=24
node_major=$(node -p 'process.versions.node.split(".")[0]')
if (( node_major < required_major )); then
  echo "setup: Node >= ${required_major} required, found $(node -v)" >&2
  exit 1
fi

echo "==> installing npm dependencies"
if [[ -f package-lock.json ]]; then npm ci; else npm install; fi

echo "==> installing headless Chromium for the renderer"
npx playwright install chromium

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "==> created .env from .env.example; fill in OPENROUTER_API_KEY and VERCEL_TOKEN"
else
  echo "==> .env already exists, leaving it alone"
fi

echo "==> done. Try: npx silver --help"
