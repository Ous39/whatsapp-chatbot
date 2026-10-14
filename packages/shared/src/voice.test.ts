import { describe, expect, it } from "vitest";
import { canSpeak, detectTextLanguage, normalizeLang, sttConfigFromEnv, synthesize, transcribe, ttsConfigFromEnv, voiceStatus } from "./voice";
import { downloadMedia, sendMessage, uploadMedia } from "./graph";
import { buildSystemPrompt, generateReply } from "./ai";
import { detectIntent } from "./whatsapp";

const audio = new Uint8Array([79, 103, 103, 83, 0, 1, 2, 3]);

describe("language detection", () => {
  it("normalises provider language codes", () => {
    expect(normalizeLang("wol")).toBe("wo");
    expect(normalizeLang("french")).toBe("fr");
    expect(normalizeLang("en-US")).toBe("en");
    expect(normalizeLang("de")).toBe(null);
  });
  it("recognises English, French and Wolof text", () => {
    expect(detectTextLanguage("Hello, what time do you open?")).toBe("en");
    expect(detectTextLanguage("Bonjour, combien coûte la livraison ?")).toBe("fr");
    expect(detectTextLanguage("Nanga def, ñaata la?")).toBe("wo");
    expect(detectTextLanguage("ok")).toBe(null);
  });
  it("detects handover and opt-out in all three languages", () => {
    expect(detectIntent("Je veux parler à un conseiller")).toBe("HANDOVER");
    expect(detectIntent("Dama bëgg wax ak nit")).toBe("HANDOVER");
    expect(detectIntent("quelqu'un peut me dire le prix?")).toBe(null);
    expect(detectIntent("Arrêter")).toBe("OPT_OUT");
  });
});

describe("speech-to-text", () => {
  it("uses the local raw-audio contract, language hint and token", async () => {
    let calledUrl = "";
    let request: any;
    const fetchImpl = (async (url: string, init: any) => {
      calledUrl = url;
      request = init;
      return new Response(JSON.stringify({ text: " Bonjour ", language: "fr" }));
    }) as unknown as typeof fetch;
    const cfg = sttConfigFromEnv({ STT_PROVIDER: "http", STT_HTTP_URL: "http://localhost:8001/transcribe", STT_HTTP_TOKEN: "local-token" });
    const result = await transcribe({ ...cfg, fetchImpl }, audio, "audio/ogg; codecs=opus", "fr");
    expect(calledUrl).toBe("http://localhost:8001/transcribe?language=fr");
    expect(request.headers.Authorization).toBe("Bearer local-token");
    expect(request.body).toBeInstanceOf(Blob);
    expect(new Uint8Array(await request.body.arrayBuffer())).toEqual(audio);
    expect(result.text).toBe("Bonjour");
    expect(result.language).toBe("fr");
  });
  it("sends voice notes to ElevenLabs Scribe and maps the language", async () => {
    let form: FormData | undefined;
    let headers: any;
    const fetchImpl = (async (_url: string, init: any) => {
      form = init.body;
      headers = init.headers;
      return new Response(JSON.stringify({ text: " Nanga def ", language_code: "wol", language_probability: 0.91 }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = await transcribe({ provider: "elevenlabs", apiKey: "k", fetchImpl }, audio, "audio/ogg; codecs=opus", "wo");
    expect(t.text).toBe("Nanga def");
    expect(t.language).toBe("wo");
    expect(headers["xi-api-key"]).toBe("k");
    expect(form?.get("model_id")).toBe("scribe_v2");
    expect(form?.get("language_code")).toBe("wol");
    expect((form?.get("file") as File).name).toBe("voice.ogg");
  });
  it("falls back to text detection for OpenAI transcripts", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ text: "Bonjour, combien pour la livraison ?" }), { status: 200 })) as unknown as typeof fetch;
    const t = await transcribe({ provider: "openai", apiKey: "k", fetchImpl }, audio, "audio/ogg", null);
    expect(t.language).toBe("fr");
  });
  it("reports provider errors", async () => {
    const fetchImpl = (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch;
    let msg = "";
    await transcribe({ provider: "elevenlabs", apiKey: "k", fetchImpl }, audio, "audio/ogg").catch(e => (msg = e.message));
    expect(msg).toContain("401");
  });
});

describe("text-to-speech", () => {
  it.each(["en", "fr"] as const)("uses local Piper for %s", async language => {
    let request: any;
    const fetchImpl = (async (_url: string, init: any) => {
      request = init;
      return new Response(audio, { headers: { "content-type": "audio/ogg" } });
    }) as unknown as typeof fetch;
    const key = language.toUpperCase();
    const cfg = ttsConfigFromEnv({ [`TTS_${key}`]: "http", [`TTS_${key}_URL`]: "http://localhost:8001/synthesize", [`TTS_${key}_TOKEN`]: "local-token" });
    const result = await synthesize({ ...cfg, fetchImpl }, "Hello", language);
    expect(request.headers.Authorization).toBe("Bearer local-token");
    expect(JSON.parse(request.body)).toEqual({ text: "Hello", language });
    expect(result.mime).toBe("audio/ogg");
    expect(result.audio).toEqual(audio);
  });
  const env = { TTS_EN: "openai", TTS_FR: "elevenlabs", TTS_WO: "http", OPENAI_API_KEY: "o", ELEVENLABS_API_KEY: "e", ELEVENLABS_VOICE_ID: "voice1", TTS_WO_URL: "http://tts-wolof:8000/synthesize", STT_PROVIDER: "elevenlabs" };
  it("reads per-language voices from the environment", () => {
    const cfg = ttsConfigFromEnv(env);
    expect(cfg.en.provider).toBe("openai");
    expect(cfg.fr.voice).toBe("voice1");
    expect(canSpeak(cfg, "wo")).toBe(true);
    expect(canSpeak(ttsConfigFromEnv({}), "en")).toBe(false);
    expect(sttConfigFromEnv(env).apiKey).toBe("e");
    expect(voiceStatus(env).tts.wo.ready).toBe(true);
  });
  it("asks OpenAI for Ogg/Opus so WhatsApp shows a voice note", async () => {
    let body: any;
    const fetchImpl = (async (_url: string, init: any) => {
      body = JSON.parse(init.body);
      return new Response(audio, { status: 200 });
    }) as unknown as typeof fetch;
    const s = await synthesize({ ...ttsConfigFromEnv(env), fetchImpl }, "Hello there", "en");
    expect(s.mime).toBe("audio/ogg");
    expect(body.response_format).toBe("opus");
  });
  it("calls the self-hosted Wolof voice with text and language", async () => {
    let url = "";
    let body: any;
    const fetchImpl = (async (u: string, init: any) => {
      url = u;
      body = JSON.parse(init.body);
      return new Response(audio, { status: 200, headers: { "content-type": "audio/ogg" } });
    }) as unknown as typeof fetch;
    const s = await synthesize({ ...ttsConfigFromEnv(env), fetchImpl }, "Jërëjëf", "wo");
    expect(url).toBe("http://tts-wolof:8000/synthesize");
    expect(body.language).toBe("wo");
    expect(s.audio.byteLength).toBe(audio.byteLength);
  });
});

describe("WhatsApp media", () => {
  const base = { accessToken: "t".repeat(20), phoneNumberId: "111" };
  it("uploads audio and sends it as a voice note", async () => {
    const calls: { url: string; init: any }[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(url.endsWith("/media") ? { id: "media9" } : { messages: [{ id: "wamid.V" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const id = await uploadMedia({ ...base, fetchImpl }, audio, "audio/ogg", "reply.ogg");
    expect(id).toBe("media9");
    const sent = await sendMessage({ ...base, fetchImpl }, { type: "audio", to: "+2207001111", mediaId: id, voice: true });
    expect(sent.messageId).toBe("wamid.V");
    const payload = JSON.parse(calls[1]!.init.body);
    expect(payload.audio).toEqual({ id: "media9", voice: true });
  });
  it("downloads customer media only from Meta hosts", async () => {
    const make = (host: string) =>
      (async (url: string) => (url.includes("graph.facebook.com") ? new Response(JSON.stringify({ url: `https://${host}/v/abc`, mime_type: "audio/ogg", file_size: 8 }), { status: 200 }) : new Response(audio, { status: 200 }))) as unknown as typeof fetch;
    const ok = await downloadMedia({ ...base, fetchImpl: make("lookaside.fbsbx.com") }, "m1");
    expect(ok.mime).toBe("audio/ogg");
    let blocked = false;
    await downloadMedia({ ...base, fetchImpl: make("evil.example.com") }, "m1").catch(() => (blocked = true));
    expect(blocked).toBe(true);
  });
});

describe("multilingual replies", () => {
  it("tells the model which language to answer in and to speak naturally", () => {
    const prompt = buildSystemPrompt({ businessName: "Demo", knowledge: [], history: [], message: "x", language: "wo", spoken: true }, []);
    expect(prompt).toContain("Reply in Wolof");
    expect(prompt).toContain("voice note");
  });
  it("hands over in the customer's language", async () => {
    const r = await generateReply({ provider: "simulator" }, { businessName: "Demo", knowledge: [], history: [], message: "Je veux parler à un conseiller", language: "fr" });
    expect(r.action).toBe("HANDOVER");
    expect(r.text).toContain("équipe");
  });
});
