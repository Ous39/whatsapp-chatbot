# Local English/French voice notes

This optional CPU service uses faster-whisper (base, INT8) for speech recognition,
Piper for speech synthesis, and FFmpeg for mono Ogg/Opus. It implements the existing
raw-audio STT and JSON-to-audio TTS HTTP contracts. No OpenAI/ElevenLabs key is needed
for these speech endpoints. Answer generation still uses the configured agent provider;
`AI_PROVIDER=simulator` keeps answers in local simulation mode.

## Windows: quickest setup with the app running through pnpm

In PowerShell at the repository root:

```powershell
git pull
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-voice.ps1
docker compose logs -f voice-local
```

The script preserves database credentials, Wolof settings, AI provider and WhatsApp
delivery switches. It configures local STT/TTS URLs and a shared random token.
First startup downloads the Whisper model and two Piper voices into a named volume;
allow several minutes and internet access. Later starts reuse the downloads.
Press Ctrl+C to stop following logs (the service keeps running), then check:

```powershell
Invoke-RestMethod http://localhost:8001/health
```

Once `ready` is true, stop the old `pnpm dev` terminal with Ctrl+C and restart it:

```powershell
pnpm dev
```

Open http://localhost:3000, sign in, and use **Agent & playground** to record a short
English or French question. You should see a transcript and receive a playable answer.
The playground does not send to WhatsApp. Test recordings with background noise and
local accents before enabling customer delivery.

## Real speech smoke test

Run the standard-library-only Python test from the host:

```powershell
python services/voice-local/smoke.py
```

Or run inside the container (inherits the token without printing it):

```powershell
docker compose exec -T voice-local python /app/smoke.py
```

It generates English and French Ogg/Opus speech, transcribes each recording, and prints
the recognized text. It never invokes a paid AI API or sends customer messages.
Listen to additional playground samples; round-trip success is not an accuracy benchmark.

## App also running in Docker

Container apps must use `http://voice-local:8001`, whereas apps started by `pnpm dev`
on Windows use `http://localhost:8001`. Use the supplied override:

```powershell
docker compose -f docker-compose.yml -f docker-compose.voice-local.yml --profile voice-local up -d --build voice-local api worker web
```

## Limits and operation

- English/French only. Wolof still uses the separate `services/tts-wolof`; this change
  does not add reliable Wolof transcription.
- Recordings: 10 MB and 120 seconds maximum. Spoken replies: 600 characters.
- One inference at a time to bound memory; concurrent requests receive 429. This is
  a pilot configuration, not a high-volume deployment.
- Base model uses two CPU threads. Set `LOCAL_STT_MODEL=small` for an accuracy experiment,
  allowing more memory and processing time. No latency guarantee on your hardware.
- Bind the service to localhost; `LOCAL_VOICE_TOKEN` protects processing endpoints.
- It keeps customer audio in memory, not persistent files. Speech models are cached.
- Stop with `docker compose stop voice-local`; do not delete the model volume unnecessarily.
- If model downloads fail, inspect `docker compose logs --tail=100 voice-local` and
  check internet access to Hugging Face. Don't share tokens in diagnostic output.

## Tests and licenses

```sh
python -m pip install -r services/voice-local/requirements-test.txt
python -m pytest services/voice-local/test_app.py
pnpm --filter @oceanbrown/shared test
```

Python endpoint tests use a fake engine; `smoke.py` uses real models. Piper's engine is
GPL-3.0. Voice weights have their own model cards/licenses: review the selected
`en_US-lessac-medium` and `fr_FR-siwis-medium` voices before distributing them. Downloads
come from the Piper voice project, not this repository. faster-whisper is MIT.
