# 3E panel art on Modal — DEVELOPMENT ONLY, parked by default.
#
# Cost shape: serverless L4 billed per second while a panel renders,
# scale-to-zero otherwise. SDXL-Turbo renders in ~1-2s, so a panel costs
# a fraction of a cent — burn Modal credits before Meta's $0.01/image.
#
# One-time setup (human steps — accounts you own): none beyond the SAM
# setup (same 3e-sam-key secret is reused for auth, same workspace).
# Then deploy + link (safe to re-run):
#   modal deploy modal/image.py
#   ./modal/link-image.sh <endpoint-url>
#
# Contract: POST { prompt, width?, height?, auth } ->
# { image_b64, content_type }. Auth: body auth checked against APP_KEY
# (same shared secret as sam.py), so stray traffic can't spend credit.

import base64
import io
import os
import secrets

import modal

IMAGE_MODEL_ID = os.environ.get("IMAGE_MODEL_ID", "stabilityai/sdxl-turbo")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("torch", "diffusers>=0.32", "transformers", "accelerate", "Pillow", "numpy", "fastapi[standard]")
    .env({"HF_HUB_CACHE": "/weights/hf", "IMAGE_MODEL_ID": IMAGE_MODEL_ID})
)
weights = modal.Volume.from_name("3e-image-weights", create_if_missing=True)
# Server-side copy of the shared key (same secret sam.py uses).
app_key = modal.Secret.from_name("3e-sam-key")

app = modal.App("3e-image-dev", image=image)

_pipe = None


def _load():
    global _pipe
    if _pipe is None:
        import torch
        from diffusers import AutoPipelineForText2Image

        pipe = AutoPipelineForText2Image.from_pretrained(
            IMAGE_MODEL_ID, torch_dtype=torch.float16, variant="fp16"
        ).to("cuda")
        _pipe = pipe
    return _pipe


@app.function(
    gpu="T4",  # L4 had no free capacity at deploy time; T4 renders
    # SDXL-Turbo in seconds and is cheaper per second. Revisit L4 only
    # if T4 proves too slow for book batches.
    volumes={"/weights": weights},  # Cache weights: no re-download billing.
    secrets=[app_key],
    min_containers=0,  # Scale to zero: $0 idle. Cold starts reload weights.
    max_containers=1,  # Dev needs one replica. Raise only under real load.
    timeout=300,
)
@modal.fastapi_endpoint(method="POST")
def draw(body: dict) -> dict:
    got = str(body.get("auth") or "")
    want = os.environ.get("APP_KEY", "")
    if not want or not secrets.compare_digest(got, want):
        return {"error": "unauthorized"}

    prompt = str(body.get("prompt", ""))[:2000]
    if not prompt:
        return {"error": "empty prompt"}
    try:
        width = max(256, min(1024, int(body.get("width", 640) or 640)))
        height = max(256, min(1280, int(body.get("height", 800) or 800)))
    except (TypeError, ValueError):
        return {"error": "bad size"}
    # SDXL needs multiples of 8.
    width -= width % 8
    height -= height % 8

    pipe = _load()
    out = pipe(
        prompt=prompt,
        height=height,
        width=width,
        num_inference_steps=4,
        guidance_scale=0.0,
    ).images[0]
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return {"image_b64": base64.b64encode(buf.getvalue()).decode(), "content_type": "image/png"}


@app.local_entrypoint()
def check() -> None:
    print("IMAGE_MODEL_ID =", IMAGE_MODEL_ID)
    print("Deploy with: modal deploy modal/image.py")
