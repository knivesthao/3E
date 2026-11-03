#!/usr/bin/env bash
# Link the Modal image development endpoint into the Worker's local env.
# Reuses the shared APP_KEY (3e-sam-key secret) — no new secrets.
# Usage: ./modal/link-image.sh <endpoint-url>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV_JSON="$ROOT/modal/image-dev.json"
# Wrangler dev loads .dev.vars from the repo root; qa scripts and
# flash-batch.sh read api/.dev.vars. Write both so the worker and the
# tooling always agree.
TARGETS="$ROOT/.dev.vars $ROOT/api/.dev.vars"

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "Usage: ./modal/link-image.sh <endpoint-url>" >&2
  exit 1
fi

# Record the endpoint in image-dev.json (no secrets in IaC).
URL="$URL" python3 -c "
import json, os
p = '$DEV_JSON'
d = json.load(open(p))
d['apiUrl'] = os.environ['URL']
json.dump(d, open(p, 'w'), indent=2)
open(p, 'a').write('\n')
"

# Upsert URL into both .dev.vars files. Existing keys (incl. MODAL_PROXY_TOKEN,
# reused as the body auth) are preserved. Nothing is echoed.
for TARGET in $TARGETS; do
touch "$TARGET"
python3 - "$TARGET" "$URL" <<'EOF'
import sys
path, url = sys.argv[1], sys.argv[2]
lines = open(path).read().splitlines()
out = []
for line in lines:
    k = line.split('=', 1)[0]
    if k == 'MODAL_IMAGE_API_URL':
        continue
    out.append(line)
out.append(f'MODAL_IMAGE_API_URL={url}')
open(path, 'w').write('\n'.join(l for l in out if l) + '\n')
EOF
done

echo "Linked Modal image endpoint. Targets: .dev.vars + api/.dev.vars (MODAL_IMAGE_API_URL)."
echo "Unlink (fall back to Meta): delete that line from both files."
