#!/usr/bin/env bash
# 3E dev startup: one command, one container.
# First run needs network (base image + npm + workerd download). After that,
# restarts are fast and work offline — deps and wrangler cache live in volumes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
IMG="3e-dev:latest"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker Desktop is not installed."
  echo "Install a Docker Desktop 4.x release that still supports macOS 12 (Monterey),"
  echo "then run ./run.sh dev again. Do not auto-upgrade past Monterey support."
  exit 1
fi

cmd="${1:-dev}"
case "$cmd" in
  dev)
    # Cached layers make repeat builds seconds.
    docker build --platform linux/amd64 -t "$IMG" -f "$ROOT/docker/Dockerfile" "$ROOT"
    docker volume create 3e-node-modules >/dev/null
    docker volume create 3e-wrangler >/dev/null

    echo "Starting 3E dev stack — frontend http://localhost:5173, API http://localhost:8787"
    exec docker run --rm -it --platform linux/amd64 \
      -p 5173:5173 -p 8787:8787 \
      -v "$ROOT:/app" \
      -v 3e-node-modules:/app/node_modules \
      -v 3e-wrangler:/root/.wrangler \
      "$IMG"
    ;;
  *)
    echo "Usage: ./run.sh dev"
    echo "  dev   build the image if needed and start the API + frontend stack"
    exit 1
    ;;
esac
