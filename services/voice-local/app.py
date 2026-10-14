"""Local-only speech endpoints matching packages/shared/src/voice.ts."""
import asyncio
import hmac
import os
import threading
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

MAX_BYTES = 10 * 1024 * 1024


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    language: Literal["en", "fr"] = "en"


def create_app(backend=None, token=None):
    if backend is None:
        from engine import SpeechEngine
        backend = SpeechEngine()
    token = os.getenv("LOCAL_VOICE_TOKEN", "") if token is None else token
    busy = threading.Lock()
    ready = False

    @asynccontextmanager
    async def lifespan(_app):
        nonlocal ready
        await run_in_threadpool(backend.load)
        ready = True
        yield
        ready = False

    app = FastAPI(title="OceanBrown local voice", lifespan=lifespan)

    def authorize(value):
        if token and not hmac.compare_digest(value or "", f"Bearer {token}"):
            raise HTTPException(401, "Unauthorized")

    def execute(fn, *args):
        if not ready:
            raise HTTPException(503, "Speech models are not ready")
        if not busy.acquire(blocking=False):
            raise HTTPException(429, "Speech service is busy; retry later")
        try:
            return fn(*args)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except HTTPException:
            raise
        except Exception as exc:
            # Provider internals and customer audio/text are never returned or logged.
            raise HTTPException(503, "Local speech processing failed") from exc
        finally:
            busy.release()

    @app.get("/health")
    def health():
        return {"status": "ok" if ready else "loading", "ready": ready,
                "stt": "faster-whisper", "tts": "piper", "languages": ["en", "fr"]}

    @app.post("/transcribe")
    async def transcribe(request: Request, language: str | None = None,
                         authorization: str | None = Header(default=None)):
        authorize(authorization)
        if language not in (None, "en", "fr"):
            raise HTTPException(422, "Local transcription supports English/French only")
        mime = request.headers.get("content-type", "").split(";")[0].lower()
        if mime not in {"audio/ogg", "audio/webm", "audio/wav", "audio/x-wav",
                        "audio/mpeg", "audio/mp4", "audio/aac", "audio/amr"}:
            raise HTTPException(415, "Unsupported audio type")
        data = bytearray()
        try:
            async with asyncio.timeout(30):
                async for chunk in request.stream():
                    if len(data) + len(chunk) > MAX_BYTES:
                        raise HTTPException(413, "Recording exceeds 10 MB")
                    data.extend(chunk)
        except TimeoutError:
            raise HTTPException(408, "Upload timed out")
        if not data:
            raise HTTPException(422, "Recording is empty")
        return await run_in_threadpool(execute, backend.transcribe, bytes(data), language)

    @app.post("/synthesize")
    def synthesize(body: SpeechRequest, authorization: str | None = Header(default=None)):
        authorize(authorization)
        if not body.text.strip():
            raise HTTPException(422, "Text is empty")
        audio = execute(backend.synthesize, body.text.strip(), body.language)
        return Response(audio, media_type="audio/ogg", headers={"Cache-Control": "no-store"})

    return app


app = create_app()
