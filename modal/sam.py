# 3E SAM isolate on Modal — DEVELOPMENT ONLY, parked by default.
#
# Cost shape: serverless GPU billed per second while a cutout runs,
# scale-to-zero otherwise. No idle billing by construction.
#
# Before first deploy, fill SAM_MODEL_ID (see TODO below) with the
# text-promptable SAM 3.1 weights repo, then:
#   pip install modal && modal setup
#   modal deploy modal/sam.py
# Copy the printed web endpoint URL, create a proxy token, and link it:
#   modal workspace proxy-tokens create
#   MODAL_PROXY_TOKEN='<id>.ws-<secret>' ./modal/link.sh <endpoint-url>
import base64
import io
import os

import modal

# TODO: point at the text-promptable SAM 3.1 weights repo before deploying.
# Must accept a free-text prompt (our app sends character descriptions like
# "a young child"), not just points/boxes.
SAM_MODEL_ID = os.environ.get("SAM_MODEL_ID", "TODO-fill-sam-3-1-hf-repo")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("torch", "transformers", "Pillow", "numpy")
    .env({"HF_HUB_CACHE": "/weights/hf", "SAM_MODEL_ID": SAM_MODEL_ID})
)
weights = modal.Volume.from_name("3e-sam-weights", create_if_missing=True)

app = modal.App("3e-sam-dev", image=image)


@app.function(
    gpu="L4",  # Cheapest tier that fits: raise only on OOM, never preemptively.
    volumes={"/weights": weights},  # Cache weights: no re-download billing.
    min_containers=0,  # Scale to zero: $0 idle. Cold starts are slow.
    max_containers=1,  # Dev needs one replica. Raise only under real load.
    timeout=300,
)
@modal.web_endpoint(method="POST")
def isolate(body: dict) -> dict:
    """POST { image_b64, prompt } -> { mask_b64, content_type }."""
    from PIL import Image

    raw = base64.b64decode(body["image_b64"])
    _panel = Image.open(io.BytesIO(raw)).convert("RGB")
    prompt = str(body.get("prompt", ""))

    # TODO: run SAM_MODEL_ID text-prompted segmentation on (_panel, prompt)
    # and return the transparent PNG mask bytes. Raise on failure so the
    # Worker retries once, then falls back to reporting ai failure.
    raise NotImplementedError("fill SAM predictor (see SAM_MODEL_ID TODO above)")


@app.local_entrypoint()
def check() -> None:
    print("SAM_MODEL_ID =", SAM_MODEL_ID)
    print("Deploy with: modal deploy modal/sam.py")
