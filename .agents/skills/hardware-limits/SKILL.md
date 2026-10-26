---
name: hardware-limits
description: Hardware-limit guardrails for building 3E on a Mid-2015 Intel MacBook Pro (macOS Monterey 12.7.6, 16 GB RAM). Keeps the local toolchain light and pushes heavy work to the cloud. Check before adding tools, dependencies, or local workloads.
---

# Hardware limits — 3E guardrails

Build machine: MacBook Pro Retina 15" Mid 2015, 2.8 GHz Intel i7, 16 GB DDR3,
macOS Monterey 12.7.6 (last supported OS for this machine — no upgrade path).
Local dev runs **inside one Docker container** on this machine; deployed code runs on
**Cloudflare's edge, not in our container** (see rule 2).

## Rules

1. **Cloud over local:** Workers, D1, R2, and all AI run hosted. Never add a local
   model, local GPU job, Dockerized GPU stack, or CUDA dependency — this machine has
   no usable local ML acceleration.
2. **Cloudflare does not run our container:** `wrangler deploy` uploads code to
   Cloudflare's edge (V8 isolates) — the Docker container is only the local dev
   environment (`npm run dev`, `wrangler dev`, builds). Keep deployable code free of
   anything container-specific (no localhost URLs, no mounted paths, no container env
   assumptions). Prefer `wrangler dev --remote` so emulation load stays in the cloud.
3. **One lean container:** a single dev image (slim Node LTS, `linux/amd64` — this is
   an Intel machine, never `arm64`), pinned Docker Desktop version that supports
   Monterey (do not auto-upgrade past it). No Compose stacks, no sidecar containers,
   no GPU flags. Multi-stage builds + `.dockerignore` so rebuilds stay fast and small.
4. **Version support:** every new tool/dependency must support macOS 12 + Intel x64.
   Pin versions that do; do not chase latest-major releases that drop Monterey or x64.
   Verify with the package's engines/OS support notes before adding.
5. **Memory budget (16 GB minus the Docker VM):** Docker Desktop reserves gigabytes for
   its Linux VM, so the budget is one dev container + one browser + editor. No parallel
   `tsc` + `vite build` + test runners; run checks sequentially. Cap the VM's memory in
   Docker Desktop settings; close heavy apps during builds.
6. **Thermal throttling:** sustained full-core loads throttle this chassis, and container
   builds add overhead. Chunk long work (builds, migrations, bulk scripts); prefer
   `wrangler --remote` and CI-style small steps over long local runs. If a command hangs
   or the fans scream, stop it and split the job.
7. **Offline-first PWA still testable:** verify on the locally installed Chrome/Safari, not
   on emulators or device farms that need newer macOS. Target baseline web features; avoid
   APIs that need Safari 18+ or macOS 13+.
8. **Disk awareness:** one container image (prune old tags), one `node_modules` tree, prune
   caches (`npm`, wrangler, Vite, Docker builder) when space bites, and keep large assets
   (art, R2 mirrors) out of the repo checkout.

## Quick self-check before finishing a change

- [ ] Nothing added needs a GPU, a second container, a VM, or macOS 13+.
- [ ] New dependency supports macOS 12 x64 (pinned); image stays `linux/amd64` slim.
- [ ] No container-specific assumptions in deployable code (no localhost, no mounts).
- [ ] No new always-on local service or heavy parallel build step.
