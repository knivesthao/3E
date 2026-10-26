# 3E dev container: slim Node LTS on linux/amd64 (Intel Mac — never arm64).
# One lean image: local workerd (needs glibc 2.35+, bookworm has 2.36) runs
# INSIDE here, so macOS 12 never has to execute it. No GPU, no sidecars.
# Node 22: minimum required by wrangler 4 (still slim LTS on linux/amd64).
FROM --platform=linux/amd64 node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ sqlite3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
EXPOSE 5173 8787
ENTRYPOINT ["bash", "/app/docker/entrypoint.sh"]
