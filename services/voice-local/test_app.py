from fastapi.testclient import TestClient
from app import create_app, MAX_BYTES
from concurrent.futures import ThreadPoolExecutor
from threading import Event


class FakeSpeech:
    def load(self):
        pass

    def transcribe(self, data, language):
        if data == b"invalid":
            raise ValueError("Recording could not be decoded")
        return {"text": "Bonjour", "language": language or "fr"}

    def synthesize(self, text, language):
        return b"OggS-test"


def test_raw_audio_contract_and_authorization():
    with TestClient(create_app(FakeSpeech(), token="test-token")) as client:
        assert client.get("/health").json()["ready"] is True
        assert client.post("/transcribe", content=b"audio", headers={"content-type": "audio/ogg"}).status_code == 401
        headers = {"content-type": "audio/ogg; codecs=opus", "authorization": "Bearer test-token"}
        assert client.post("/transcribe?language=fr", content=b"audio", headers=headers).json() == {"text": "Bonjour", "language": "fr"}
        assert client.post("/transcribe?language=wo", content=b"audio", headers=headers).status_code == 422
        assert client.post("/transcribe", content=b"", headers=headers).status_code == 422
        assert client.post("/transcribe", content=b"invalid", headers=headers).status_code == 422
        assert client.post("/transcribe", content=b"x" * (MAX_BYTES + 1), headers=headers).status_code == 413
        assert client.post("/transcribe", content=b"audio", headers={**headers, "content-type": "text/plain"}).status_code == 415


def test_speech_contract_and_limits():
    with TestClient(create_app(FakeSpeech(), token="test-token")) as client:
        headers = {"authorization": "Bearer test-token"}
        assert client.post("/synthesize", json={"text": "Hello"}).status_code == 401
        for language in ["en", "fr"]:
            result = client.post("/synthesize", json={"text": "Hello", "language": language}, headers=headers)
            assert result.status_code == 200
            assert result.headers["content-type"] == "audio/ogg"
            assert result.content.startswith(b"OggS")
        for body in [{"text": " "}, {"text": "x" * 601}, {"text": "Hello", "language": "wo"}]:
            assert client.post("/synthesize", json=body, headers=headers).status_code == 422


def test_busy_service_rejects_concurrent_inference():
    entered, release = Event(), Event()
    class SlowSpeech(FakeSpeech):
        def synthesize(self, text, language):
            entered.set()
            assert release.wait(5)
            return b"OggS-test"
    with TestClient(create_app(SlowSpeech(), token="")) as client, ThreadPoolExecutor() as pool:
        first = pool.submit(client.post, "/synthesize", json={"text": "Hello"})
        try:
            assert entered.wait(5)
            assert client.post("/synthesize", json={"text": "Hello"}).status_code == 429
        finally:
            release.set()
        assert first.result().status_code == 200


def test_provider_failure_is_redacted_and_lock_released():
    class BrokenSpeech(FakeSpeech):
        def synthesize(self, text, language):
            raise RuntimeError("private credentials and customer content")
    with TestClient(create_app(BrokenSpeech(), token="")) as client:
        for _ in range(2):
            result = client.post("/synthesize", json={"text": "Hello"})
            assert result.status_code == 503
            assert "private" not in result.text
