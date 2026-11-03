#!/usr/bin/env bash
# Link the Baseten DEVELOPMENT endpoint into the Worker's local env.
# Dev-only: there is no production wiring in this repo.
# Usage: ./baseten/link-dev.sh <model-id> [deployment-id]
#   or:  MODEL_ID=<id> npm run baseten:link
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV_JSON="$ROOT/baseten/dev.json"
TARGET="$ROOT/api/.dev.vars"

MODEL_ID="${1:-${MODEL_ID:-}}"
DEPLOY_ID="${2:-${DEPLOYMENT_ID:-}}"
if [ -z "$MODEL_ID" ]; then
  echo "Usage: ./baseten/link-dev.sh <model-id> [deployment-id]" >&2
  echo "   or: MODEL_ID=<id> npm run baseten:link" >&2
  exit 1
fi

# Build the endpoint from the IaC record (no secrets here).
read -r SYNC_PATH CHAT_PATH MODEL < <(python3 -c "
import json
d = json.load(open('$DEV_JSON'))
print(d['syncBasePath'], d['chatPath'], d['model'])
")
URL="https://model-${MODEL_ID}.api.baseten.co${SYNC_PATH}${CHAT_PATH}"

# Record the IDs back into dev.json so the IaC record stays current.
MODEL_ID="$MODEL_ID" DEPLOY_ID="$DEPLOY_ID" python3 -c "
import json, os
p = '$DEV_JSON'
d = json.load(open(p))
d['modelId'] = os.environ['MODEL_ID']
if os.environ.get('DEPLOY_ID'): d['deploymentId'] = os.environ['DEPLOY_ID']
json.dump(d, open(p, 'w'), indent=2)
open(p, 'a').write('\n')
"

# Upsert URL + model into api/.dev.vars (wrangler reads this file, not the
# repo-root .dev.vars). Existing keys (e.g. MODEL_API_KEY) are preserved.
# Values are never echoed.
touch "$TARGET"
python3 - "$TARGET" "$URL" "$MODEL" <<'EOF'
import sys
path, url, model = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path).read().splitlines()
seen = set()
out = []
for line in lines:
    key = line.split('=', 1)[0]
    if key in ('BASETEN_API_URL', 'BASETEN_MODEL'):
        continue
    out.append(line)
    if key: seen.add(key)
out.append(f'BASETEN_API_URL={url}')
out.append(f'BASETEN_MODEL={model}')
open(path, 'w').write('\n'.join(l for l in out if l) + '\n')
EOF

echo "Linked development endpoint for model ${MODEL_ID}."
echo "Target: api/.dev.vars (BASETEN_API_URL + BASETEN_MODEL)."
