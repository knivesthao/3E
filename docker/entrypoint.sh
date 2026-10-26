#!/usr/bin/env bash
# Container entrypoint: install once, migrate local D1, run API + frontend.
# Restarts are fast and offline — network is only needed on first run
# (npm packages + the workerd binary wrangler downloads on first dev boot).
set -euo pipefail
cd /app

# Check binaries, not the directory: an interrupted first install can leave
# node_modules present but empty, which skips the install forever and then
# fails with "vite: not found" (and npx fetching the wrong wrangler major).
if [ ! -x node_modules/.bin/vite ] || [ ! -x node_modules/.bin/wrangler ]; then
  npm install --no-audit --no-fund
fi

npx wrangler --config api/wrangler.toml d1 migrations apply DB --local >/dev/null 2>&1 || true

echo "3E dev stack:"
echo "  Frontend: http://localhost:5173"
echo "  API:      http://localhost:8787"

trap 'kill 0' EXIT
npx wrangler dev --config api/wrangler.toml --port 8787 --ip 0.0.0.0 &
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort &
wait
