# Wolof voice (text-to-speech) service

No major cloud provider offers a Wolof voice yet, so OceanBrown ships this small service around the open-source [CONCREE/Adia_TTS](https://huggingface.co/CONCREE/Adia_TTS) model (Apache-2.0, Parler-TTS fine-tuned on ~40 hours of Wolof).

```
docker build -t oceanbrown-tts-wolof services/tts-wolof
docker run -p 8000:8000 -e TTS_TOKEN=change-me oceanbrown-tts-wolof
```

Then set on the worker and API:

```
TTS_WO=http
TTS_WO_URL=http://tts-wolof:8000/synthesize
TTS_WO_TOKEN=change-me
```

Notes
- Speed: a few seconds per sentence on a GPU; much slower on CPU. Voice notes are generated in the background worker, so customers simply receive them a little later. Use a GPU host (or a Hugging Face Inference Endpoint running this container) for production.
- The model handles numbers and dates poorly; the agent is instructed to write numbers in words when replying by voice.
- Text is split into segments under 200 characters, as the model card recommends.
- `TTS_VOICE_DESCRIPTION` changes the voice style (Parler-TTS describes voices in plain language).
- Have a native Wolof speaker review sample replies before launch.
