"""Real English/French TTS -> Ogg/Opus -> STT test. No customer sends."""
import argparse
import json
import os
import urllib.request


def run(base, token):
    def post(path, data, mime):
        headers = {"Content-Type": mime}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(base.rstrip("/") + path, data=data, headers=headers)
        with urllib.request.urlopen(request, timeout=180) as response:
            return response.read(), response.headers.get_content_type()

    for language, text in [("en", "Hello, I would like to book an appointment tomorrow."),
                           ("fr", "Bonjour, je voudrais prendre un rendez-vous demain.")]:
        audio, mime = post("/synthesize", json.dumps({"text": text, "language": language}).encode(), "application/json")
        assert mime == "audio/ogg" and audio.startswith(b"OggS"), "Invalid Ogg audio"
        # Explicit hint tests language routing; compare actual speech manually too.
        payload, _ = post(f"/transcribe?language={language}", audio, mime)
        transcript = json.loads(payload)
        assert transcript["language"] == language and transcript["text"].strip(), "No transcript"
        print(f"PASS {language}: {len(audio)} audio bytes; transcript: {transcript['text']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:8001")
    args = parser.parse_args()
    # Root .env can be loaded for this test without ever printing credentials.
    from pathlib import Path
    parents = Path(__file__).resolve().parents
    env = (parents[2] if len(parents) > 2 else parents[0]) / ".env"
    token = os.getenv("LOCAL_VOICE_TOKEN", "")
    if not token and env.exists():
        for line in env.read_text(encoding="utf-8-sig").splitlines():
            if line.startswith("LOCAL_VOICE_TOKEN="):
                token = line.partition("=")[2].strip().strip('\"\'')
    run(args.url, token)
