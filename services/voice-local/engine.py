import io
import os
import subprocess
import sys
import wave
from pathlib import Path


class SpeechEngine:
    """Keep models loaded; serialize inference in app.py to bound CPU/RAM use."""
    def load(self):
        from faster_whisper import WhisperModel
        from piper import PiperVoice
        directory = Path(os.getenv("VOICE_MODEL_DIR", "/models"))
        directory.mkdir(parents=True, exist_ok=True)
        self.max_seconds = int(os.getenv("STT_MAX_SECONDS", "120"))
        self.asr = WhisperModel(os.getenv("LOCAL_STT_MODEL", "base"), device="cpu",
                               compute_type="int8", cpu_threads=2, num_workers=1,
                               download_root=str(directory / "whisper"))
        self.voices = {}
        for language, default in [("en", "en_US-lessac-medium"), ("fr", "fr_FR-siwis-medium")]:
            name = os.getenv(f"PIPER_VOICE_{language.upper()}", default)
            if not name or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in name):
                raise ValueError("Invalid Piper voice name")
            path = directory / f"{name}.onnx"
            if not path.exists() or not path.with_suffix(".onnx.json").exists():
                subprocess.run([sys.executable, "-m", "piper.download_voices", "--data-dir", str(directory), name],
                               check=True, timeout=600)
            self.voices[language] = PiperVoice.load(str(path))

    def transcribe(self, audio, language):
        # Decode with a duration cap before inference, so compressed uploads cannot
        # allocate unbounded memory or keep the CPU occupied for hours.
        try:
            result = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error",
                "-i", "pipe:0", "-t", str(self.max_seconds + 1), "-ac", "1", "-ar", "16000",
                "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"], input=audio,
                capture_output=True, check=True, timeout=30)
            with wave.open(io.BytesIO(result.stdout)) as wav:
                frames = wav.readframes(self.max_seconds * 16000 + 1)
                if len(frames) > self.max_seconds * 16000 * 2:
                    raise ValueError(f"Recording exceeds {self.max_seconds} seconds")
        except (subprocess.SubprocessError, wave.Error, EOFError) as exc:
            raise ValueError("Recording could not be decoded") from exc
        import numpy as np
        samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        segments, info = self.asr.transcribe(samples, language=language, beam_size=1,
                                            vad_filter=True, condition_on_previous_text=False)
        text = " ".join(s.text.strip() for s in segments).strip()
        if info.language not in ("en", "fr"):
            raise ValueError("Detected language is not supported by this local service")
        if not text:
            raise ValueError("No speech was recognized")
        return {"text": text, "language": info.language}

    def synthesize(self, text, language):
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            self.voices[language].synthesize_wav(text, wav)
        result = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
            "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1"],
            input=buffer.getvalue(), capture_output=True, check=True, timeout=30)
        return result.stdout
