#!/usr/bin/env bash
# Link the Modal SAM development endpoint into the Worker's local env.
# Dev-only, parked by default. Creates the shared APP_KEY, stores it as
# the Modal secret 3e-sam-key, and writes endpoint + key into the
# gitignored api/.dev.vars. The key is never printed.
# Usage: ./modal/link.sh <endpoint-url>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV_JSON="$ROOT/modal/dev.json"
TARGET="$ROOT/api/.dev.vars"

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "Usage: ./modal/link.sh <endpoint-url>" >&2
  exit 1
fi

KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
# Rotate (dev-only): a fresh key per link. Old containers pick up the new
# value on next cold start; scale-to-zero means that is immediate here.
modal secret delete -y --allow-missing 3e-sam-key >/dev/null 2>&1
if ! modal secret create 3e-sam-key "APP_KEY=$KEY" >/dev/null 2>&1; then
  echo "Could not create Modal secret 3e-sam-key." >&2
  exit 1
fi

# Record the endpoint in dev.json (no secrets in IaC).
URL="$URL" python3 -c "
import json, os
p = '$DEV_JSON'
d = json.load(open(p))
d['apiUrl'] = os.environ['URL']
json.dump(d, open(p, 'w'), indent=2)
open(p, 'a').write('\n')
"

# Upsert URL + key into api/.dev.vars (wrangler reads this file, not the
# repo-root .dev.vars). Existing keys are preserved. Nothing is echoed.
touch "$TARGET"
python3 - "$TARGET" "$URL" "$KEY" <<'EOF'
import sys
path, url, key = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path).read().splitlines()
out = []
for line in lines:
    k = line.split('=', 1)[0]
    if k in ('MODAL_API_URL', 'MODAL_PROXY_TOKEN'):
        continue
    out.append(line)
out.append(f'MODAL_API_URL={url}')
out.append(f'MODAL_PROXY_TOKEN={key}')
open(path, 'w').write('\n'.join(l for l in out if l) + '\n')
EOF

echo "Linked Modal SAM endpoint. Target: api/.dev.vars (MODAL_API_URL + MODAL_PROXY_TOKEN)."
echo "Unlink (fall back to Meta): delete those two lines from api/.dev.vars."
