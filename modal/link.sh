#!/usr/bin/env bash
# Link the Modal SAM development endpoint into the Worker's local env.
# Dev-only, parked by default: enable only when per-cutout Modal spend
# beats the Meta Model API. Token is never echoed or stored in the repo.
# Usage: MODAL_PROXY_TOKEN='<id>.ws-<secret>' ./modal/link.sh <endpoint-url>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV_JSON="$ROOT/modal/dev.json"
TARGET="$ROOT/api/.dev.vars"

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "Usage: MODAL_PROXY_TOKEN='<id>.ws-<secret>' ./modal/link.sh <endpoint-url>" >&2
  exit 1
fi
if [ -z "${MODAL_PROXY_TOKEN:-}" ]; then
  echo "MODAL_PROXY_TOKEN is not set. Create one: modal workspace proxy-tokens create" >&2
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

# Upsert URL + token into api/.dev.vars (wrangler reads this file, not the
# repo-root .dev.vars). Existing keys are preserved. Nothing is echoed.
touch "$TARGET"
python3 - "$TARGET" "$URL" "$MODAL_PROXY_TOKEN" <<'EOF'
import sys
path, url, token = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path).read().splitlines()
out = []
for line in lines:
    key = line.split('=', 1)[0]
    if key in ('MODAL_API_URL', 'MODAL_PROXY_TOKEN'):
        continue
    out.append(line)
out.append(f'MODAL_API_URL={url}')
out.append(f'MODAL_PROXY_TOKEN={token}')
open(path, 'w').write('\n'.join(l for l in out if l) + '\n')
EOF

echo "Linked Modal SAM endpoint. Target: api/.dev.vars (MODAL_API_URL + MODAL_PROXY_TOKEN)."
echo "Unlink (fall back to Meta): delete those two lines from api/.dev.vars."
