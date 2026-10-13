"""Wolof text-to-speech service for OceanBrown.

Wraps the open-source CONCREE/Adia_TTS model (Apache-2.0, Parler-TTS fine-tuned on Wolof)
behind a tiny HTTP API that the worker calls:

    POST /synthesize  {"text": "...", "language": "wo"}  ->  audio/ogg (Opus, mono)

Set TTS_TOKEN to require "Authorization: Bearer <token>".
"""
import io
import os
import re
import subprocess
import threading

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from parler_tts import ParlerTTSForConditionalGeneration
from transformers import AutoTokenizer

MODEL_ID = os.getenv("TTS_MODEL", "CONCREE/Adia_TTS")
VOICE = os.getenv(
    "TTS_VOICE_DESCRIPTION",
    "A warm and natural voice, speaking clearly at a moderate pace, as a friendly customer service agent.",
)
TOKEN = os.getenv("TTS_TOKEN", "")
MAX_CHARS = int(os.getenv("TTS_MAX_CHARS", "600"))
CHUNK = 180  # the model is trained on short segments (< 200 characters)

device = "cuda:0" if torch.cuda.is_available() else "cpu"
model = ParlerTTSForConditionalGeneration.from_pretrained(MODEL_ID).to(device)
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
description_ids = tokenizer(VOICE, return_tensors="pt").input_ids.to(device)
rate = model.config.sampling_rate
lock = threading.Lock()  # one generation at a time per process

app = FastAPI(title="OceanBrown Wolof TTS")


class Request(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    language: str = "wo"


def chunks(text: str):
    """Split at sentence and clause boundaries so each piece stays under CHUNK characters."""
    parts, current = [], ""
    for piece in re.split(r"(?<=[.!?;:,])\s+", text.strip()):
        while len(piece) > CHUNK:  # very long clause without punctuation: split on spaces
            cut = piece.rfind(" ", 0, CHUNK)
            cut = cut if cut > 0 else CHUNK
            parts.append(piece[:cut].strip())
            piece = piece[cut:].strip()
        if current and len(current) + len(piece) + 1 > CHUNK:
            parts.append(current)
            current = piece
        else:
            current = f"{current} {piece}".strip()
    if current:
        parts.append(current)
    return [p for p in parts if p]


def to_ogg_opus(wav: np.ndarray) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, wav, rate, format="WAV", subtype="PCM_16")
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "48000",
         "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1"],
        input=buf.getvalue(), capture_output=True, timeout=60, check=True,
    )
    return result.stdout


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_ID, "device": device}


@app.post("/synthesize")
def synthesize(req: Request, authorization: str | None = Header(default=None)):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    if req.language.lower() not in ("wo", "wol", "wolof"):
        raise HTTPException(status_code=400, detail="This service only speaks Wolof")
    silence = np.zeros(int(rate * 0.25), dtype=np.float32)
    pieces = []
    with lock, torch.inference_mode():
        for part in chunks(req.text[:MAX_CHARS]):
            prompt_ids = tokenizer(part, return_tensors="pt").input_ids.to(device)
            audio = model.generate(input_ids=description_ids, prompt_input_ids=prompt_ids)
            pieces += [audio.cpu().numpy().squeeze().astype(np.float32), silence]
    if not pieces:
        raise HTTPException(status_code=400, detail="Nothing to say")
    return Response(content=to_ogg_opus(np.concatenate(pieces)), media_type="audio/ogg")
