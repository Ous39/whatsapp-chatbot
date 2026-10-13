# Voice notes in English, French and Wolof

Customers in The Gambia often prefer WhatsApp voice notes, so the agent can listen and answer by voice.

## How it works

1. **Customer sends a voice note.** The worker downloads it from Meta (only from Meta's media hosts, with the business's token) and transcribes it.
2. **Language.** The transcript language (or, for text, a lightweight English/French/Wolof detector) is remembered on the customer. Until a language is known, the business's default language is used.
3. **Answer.** The AI answers from published knowledge in the customer's language. When the answer will be spoken, it is told to use short spoken sentences and write numbers in words.
4. **Voice reply.** With *Voice replies = Reply by voice when the customer sends a voice note* (default), the worker synthesizes the answer, converts it to mono Ogg/Opus (so WhatsApp shows a real voice note with a play button), uploads it and sends it, followed by the same answer as text (`VOICE_ALSO_TEXT=true`).
5. **Fallbacks.** If transcription fails, the customer is asked (in their language) to resend or type. If no voice exists for the language or synthesis fails, the answer goes out as text. Handover, STOP/START and the 24-hour window work the same for voice.

Staff see voice notes in the inbox with the transcript, the language and a player. The **Agent & playground** page lets you record a question with the microphone and hear the spoken answer — nothing is sent to customers.

## Providers

| Need | English | French | Wolof |
| --- | --- | --- | --- |
| Understand voice notes (STT) | ElevenLabs Scribe or OpenAI | ElevenLabs Scribe or OpenAI | **ElevenLabs Scribe** (or a self-hosted model via `STT_PROVIDER=http`) |
| Speak replies (TTS) | OpenAI or ElevenLabs | OpenAI or ElevenLabs | **`services/tts-wolof`** (open-source Adia TTS model) |

At the time of writing, ElevenLabs lists Wolof among Scribe's speech-to-text languages; mainstream TTS providers do not offer a Wolof voice, hence the bundled service. Wolof transcription is less accurate than English or French, especially with code-switching and noisy audio — review transcripts in the inbox during the pilot.

## Configuration (API and worker)

```
VOICE_ENABLED=true
STT_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...

TTS_EN=openai          # uses OPENAI_API_KEY, voice OPENAI_TTS_VOICE (default alloy)
TTS_FR=openai
TTS_WO=http
TTS_WO_URL=http://tts-wolof:8000/synthesize
TTS_WO_TOKEN=...       # same value as TTS_TOKEN on the service
VOICE_ALSO_TEXT=true
```

ElevenLabs voices instead of OpenAI: `TTS_EN=elevenlabs`, `ELEVENLABS_VOICE_ID=<voice id>` (or `ELEVENLABS_VOICE_ID_EN` / `_FR`). ElevenLabs returns MP3, which the worker converts with ffmpeg (installed in the worker image).

In the dashboard: **Settings → Voice & languages** sets the default language and the voice-reply policy (mirror / always / never) and shows which voices are ready.

## Before launch

- Have native speakers review: the Wolof system messages (opt-out, handover, "couldn't understand") in `apps/worker/src/processor.ts` and `packages/shared/src/ai.ts`, and a sample of AI answers in Wolof. Businesses can override the handover text in Settings.
- Run the Wolof TTS service on a GPU for acceptable latency.
- Costs: transcription and synthesis are billed per minute/character by the providers; voice replies are only generated for voice notes by default.
