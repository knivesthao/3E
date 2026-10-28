# 3E SAM isolate on Modal — DEVELOPMENT ONLY, parked by default.
#
# Cost shape: serverless L4 billed per second while a cutout runs,
# scale-to-zero otherwise. No idle billing by construction.
#
# One-time setup (human steps — accounts you own):
#   1. Accept the license at https://huggingface.co/facebook/sam3 and
#      create a read token there (gated repo).
#   2. modal secret create huggingface-secret HF_TOKEN=hf_...
# Then deploy + link (safe to re-run):
#   modal deploy modal/sam.py
#   ./modal/link.sh <endpoint-url>   # creates the shared key for you
#
# Contract: POST { image_b64, prompt } -> { mask_b64, content_type }.
# Auth: Authorization: Bearer <APP_KEY> checked in code (public URL,
# shared secret) so stray traffic can't spend the workspace credit.

import base64
import io
import os
import secrets

import modal

SAM_MODEL_ID = os.environ.get("SAM_MODEL_ID", "facebook/sam3")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("torch", "transformers>=4.57", "Pillow", "numpy")
    .env({"HF_HUB_CACHE": "/weights/hf", "SAM_MODEL_ID": SAM_MODEL_ID})
)
weights = modal.Volume.from_name("3e-sam-weights", create_if_missing=True)
# Server-side copy of the shared key; link.sh stores the same value locally.
app_key = modal.Secret.from_name("3e-sam-key")

app = modal.App("3e-sam-dev", image=image)

_predictor = None


def _load():
    global _predictor
    if _predictor is None:
        import torch
        from transformers import Sam3Model, Sam3Processor

        model = Sam3Model.from_pretrained(
            SAM_MODEL_ID, dtype=torch.float16, device_map="auto"
        )
        processor = Sam3Processor.from_pretrained(SAM_MODEL_ID)
        _predictor = (model, processor)
    return _predictor


@app.function(
    gpu="L4",  # Cheapest tier that fits: raise only on OOM, never preemptively.
    volumes={"/weights": weights},  # Cache weights: no re-download billing.
    secrets=[app_key, modal.Secret.from_name("huggingface-secret")],
    min_containers=0,  # Scale to zero: $0 idle. Cold starts reload weights.
    max_containers=1,  # Dev needs one replica. Raise only under real load.
    timeout=600,
)
@modal.fastapi_endpoint(method="POST")
def isolate(body: dict) -> dict:
    import torch
    from PIL import Image

    got = str(body.get("auth") or "")
    want = os.environ.get("APP_KEY", "")
    if not want or not secrets.compare_digest(got, want):
        return {"error": "unauthorized"}

    raw = base64.b64decode(body["image_b64"])
    panel = Image.open(io.BytesIO(raw)).convert("RGB")
    prompt = str(body.get("prompt", ""))

    model, processor = _load()
    inputs = processor(images=panel, text=prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        outputs = model(**inputs)
    results = processor.post_process_instance_segmentation(
        outputs,
        threshold=0.5,
        mask_threshold=0.5,
        target_sizes=inputs.get("original_sizes").tolist(),
    )[0]

    masks = results.get("masks", [])
    union = None
    for m in masks:
        t = torch.as_tensor(m).bool()
        union = t if union is None else (union | t)
    if union is None:
        raise RuntimeError("sam3 found no masks")
    # Drop any leading batch dim, keep HxW.
    while union.dim() > 2:
        union = union[0]
    png = Image.fromarray((union.cpu().numpy().astype("uint8")) * 255, mode="L")
    buf = io.BytesIO()
    png.save(buf, format="PNG")
    return {"mask_b64": base64.b64encode(buf.getvalue()).decode(), "content_type": "image/png"}


@app.local_entrypoint()
def check() -> None:
    print("SAM_MODEL_ID =", SAM_MODEL_ID)
    print("Deploy with: modal deploy modal/sam.py")
