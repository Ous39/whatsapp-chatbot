// Voice support: speech-to-text, text-to-speech and language detection for
// English, French and Wolof. Providers are called with plain fetch.

export const LANGUAGES = ["en", "fr", "wo"] as const;
export type Lang = (typeof LANGUAGES)[number];
export const LANGUAGE_NAMES: Record<Lang, string> = { en: "English", fr: "French", wo: "Wolof" };

/** Maps ISO 639-1/639-3 codes and names returned by providers to our three languages. */
export function normalizeLang(code: string | null | undefined): Lang | null {
  const c = String(code ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  if (["en", "eng", "english"].includes(c)) return "en";
  if (["fr", "fra", "fre", "french", "français", "francais"].includes(c)) return "fr";
  if (["wo", "wol", "wolof"].includes(c)) return "wo";
  return null;
}

const MARKERS: Record<Lang, string[]> = {
  // Common Gambian/Senegalese Wolof words and greetings, with and without diacritics.
  wo: ["nanga", "def", "nangadef", "naka", "jërëjëf", "jerejef", "jarama", "waaw", "déedéet", "deedeet", "dama", "damay", "bëgg", "begg", "bugg", "ndax", "lan", "lu", "kan", "ana", "mangi", "maangi", "fii", "rekk", "dafa", "amul", "xam", "xaalis", "jënd", "jend", "ñaata", "naata", "nit", "suba", "tey", "yow", "moo", "dégg", "degg", "bàyyi", "jaaxle", "salaamaalekum", "malekum", "asalaam"],
  fr: ["bonjour", "bonsoir", "merci", "je", "vous", "est", "pour", "avec", "oui", "non", "comment", "combien", "prix", "voudrais", "veux", "pouvez", "quand", "où", "s'il", "plaît", "svp", "livraison", "rendez-vous", "aujourd'hui", "demain", "c'est", "pas", "les", "des", "une", "mon", "ma"],
  en: ["hello", "hi", "thanks", "thank", "you", "the", "is", "are", "what", "how", "much", "price", "want", "would", "like", "please", "when", "where", "can", "delivery", "today", "tomorrow", "my", "need", "open", "do", "have"],
};

/**
 * Lightweight text language guess for EN/FR/WO. Returns null when the
 * evidence is too thin (e.g. "ok") so callers can keep the previous language.
 */
export function detectTextLanguage(text: string): Lang | null {
  const words = text.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}' ]/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const score: Record<Lang, number> = { en: 0, fr: 0, wo: 0 };
  for (const w of words) for (const l of LANGUAGES) if (MARKERS[l].includes(w)) score[l] += l === "wo" ? 1.5 : 1;
  if (/[àâçéèêëîïôûùüÿœ]/i.test(text) && score.wo === 0) score.fr += 0.5;
  if (/[ëñŋ]/i.test(text)) score.wo += 1;
  const ranked = LANGUAGES.map(l => [l, score[l]] as const).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!best || best[1] < 1) return null;
  if (second && best[1] - second[1] < 0.5) return null;
  return best[0];
}

// ---------------- Speech-to-text ----------------

export type SttProvider = "elevenlabs" | "openai" | "http" | "none";
export type SttConfig = { provider: SttProvider; apiKey?: string; url?: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number };
export type Transcript = { text: string; language: Lang | null; rawLanguage?: string; confidence?: number; provider: SttProvider };

async function request(f: typeof fetch, url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await f(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Voice provider error ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function extFor(mime: string) {
  const m = mime.split(";")[0]!.trim();
  return ({ "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr", "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm" } as Record<string, string>)[m] ?? "ogg";
}

export async function transcribe(cfg: SttConfig, audio: Uint8Array<ArrayBuffer>, mime: string, hint?: Lang | null): Promise<Transcript> {
  const f = cfg.fetchImpl ?? fetch;
  const timeout = cfg.timeoutMs ?? 60000;
  const blob = new Blob([audio], { type: mime.split(";")[0] });
  const filename = `voice.${extFor(mime)}`;

  if (cfg.provider === "elevenlabs") {
    if (!cfg.apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");
    const form = new FormData();
    form.append("model_id", cfg.model || "scribe_v2");
    form.append("file", blob, filename);
    // Wolof is often mixed with French; letting Scribe auto-detect handles code-switching best.
    if (hint === "wo") form.append("language_code", "wol");
    form.append("tag_audio_events", "false");
    const json: any = await (await request(f, "https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": cfg.apiKey }, body: form }, timeout)).json();
    return { text: String(json.text ?? "").trim(), language: normalizeLang(json.language_code), rawLanguage: json.language_code, confidence: json.language_probability, provider: "elevenlabs" };
  }

  if (cfg.provider === "openai") {
    if (!cfg.apiKey) throw new Error("OPENAI_API_KEY is not configured");
    const form = new FormData();
    form.append("model", cfg.model || "whisper-1");
    form.append("file", blob, filename);
    form.append("response_format", "verbose_json");
    if (hint && hint !== "wo") form.append("language", hint);
    const json: any = await (await request(f, "https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${cfg.apiKey}` }, body: form }, timeout)).json();
    const text = String(json.text ?? "").trim();
    return { text, language: normalizeLang(json.language) ?? detectTextLanguage(text), rawLanguage: json.language, provider: "openai" };
  }

  if (cfg.provider === "http") {
    // Self-hosted ASR: POST raw audio, expect {"text": "...", "language": "wo"}.
    if (!cfg.url) throw new Error("STT_HTTP_URL is not configured");
    const json: any = await (await request(f, `${cfg.url}${hint ? `${cfg.url.includes("?") ? "&" : "?"}language=${hint}` : ""}`, { method: "POST", headers: { "Content-Type": mime, ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) }, body: blob }, timeout)).json();
    const text = String(json.text ?? "").trim();
    return { text, language: normalizeLang(json.language) ?? detectTextLanguage(text), rawLanguage: json.language, provider: "http" };
  }

  throw new Error("Speech-to-text is not configured");
}

// ---------------- Text-to-speech ----------------

export type TtsProvider = "openai" | "elevenlabs" | "http" | "none";
export type TtsTarget = { provider: TtsProvider; apiKey?: string; url?: string; voice?: string; model?: string };
export type TtsConfig = Record<Lang, TtsTarget> & { fetchImpl?: typeof fetch; timeoutMs?: number };
export type Speech = { audio: Uint8Array<ArrayBuffer>; mime: string; provider: TtsProvider };

/** WhatsApp voice notes should stay short; long answers are sent as text only. */
export const MAX_TTS_CHARS = 600;

export function canSpeak(cfg: TtsConfig, lang: Lang) {
  const t = cfg[lang];
  return !!t && t.provider !== "none" && (t.provider === "http" ? !!t.url : !!t.apiKey);
}

export async function synthesize(cfg: TtsConfig, text: string, lang: Lang): Promise<Speech> {
  const target = cfg[lang];
  const f = cfg.fetchImpl ?? fetch;
  const timeout = cfg.timeoutMs ?? 90000;
  const input = text.slice(0, MAX_TTS_CHARS);
  if (!target || !canSpeak(cfg, lang)) throw new Error(`No text-to-speech voice configured for ${LANGUAGE_NAMES[lang]}`);

  if (target.provider === "openai") {
    const res = await request(f, "https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${target.apiKey}`, "Content-Type": "application/json" },
      // "opus" returns Ogg/Opus, which WhatsApp plays as a native voice note.
      body: JSON.stringify({ model: target.model || "gpt-4o-mini-tts", voice: target.voice || "alloy", input, response_format: "opus", instructions: `Speak naturally in ${LANGUAGE_NAMES[lang]} with a warm, friendly customer-service tone.` }),
    }, timeout);
    return { audio: new Uint8Array(await res.arrayBuffer()), mime: "audio/ogg", provider: "openai" };
  }

  if (target.provider === "elevenlabs") {
    if (!target.voice) throw new Error("ELEVENLABS_VOICE_ID is not configured");
    const res = await request(f, `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(target.voice)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": target.apiKey!, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: input, model_id: target.model || "eleven_multilingual_v2" }),
    }, timeout);
    return { audio: new Uint8Array(await res.arrayBuffer()), mime: "audio/mpeg", provider: "elevenlabs" };
  }

  // Self-hosted voice (e.g. services/tts-wolof): POST {"text","language"} → audio bytes.
  const res = await request(f, target.url!, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}) },
    body: JSON.stringify({ text: input, language: lang }),
  }, timeout);
  const mime = (res.headers.get("content-type") ?? "audio/ogg").split(";")[0]!;
  return { audio: new Uint8Array(await res.arrayBuffer()), mime, provider: "http" };
}

// ---------------- Configuration from environment ----------------

type Env = Record<string, string | undefined>;

export function sttConfigFromEnv(env: Env): SttConfig {
  const provider = (["elevenlabs", "openai", "http"].includes(env.STT_PROVIDER ?? "") ? env.STT_PROVIDER : "none") as SttProvider;
  const apiKey = provider === "elevenlabs" ? env.ELEVENLABS_API_KEY : provider === "openai" ? env.OPENAI_API_KEY : env.STT_HTTP_TOKEN;
  return { provider, apiKey: apiKey || undefined, url: env.STT_HTTP_URL || undefined, model: env.STT_MODEL || undefined };
}

export function ttsConfigFromEnv(env: Env): TtsConfig {
  const target = (lang: Lang): TtsTarget => {
    const key = lang.toUpperCase();
    const provider = (["openai", "elevenlabs", "http"].includes(env[`TTS_${key}`] ?? "") ? env[`TTS_${key}`] : "none") as TtsProvider;
    if (provider === "openai") return { provider, apiKey: env.OPENAI_API_KEY || undefined, voice: env.OPENAI_TTS_VOICE || undefined, model: env.OPENAI_TTS_MODEL || undefined };
    if (provider === "elevenlabs") return { provider, apiKey: env.ELEVENLABS_API_KEY || undefined, voice: env[`ELEVENLABS_VOICE_ID_${key}`] || env.ELEVENLABS_VOICE_ID || undefined, model: env.ELEVENLABS_TTS_MODEL || undefined };
    if (provider === "http") return { provider, url: env[`TTS_${key}_URL`] || undefined, apiKey: env[`TTS_${key}_TOKEN`] || undefined };
    return { provider: "none" };
  };
  return { en: target("en"), fr: target("fr"), wo: target("wo") };
}

export function voiceStatus(env: Env) {
  const stt = sttConfigFromEnv(env);
  const tts = ttsConfigFromEnv(env);
  return {
    enabled: env.VOICE_ENABLED !== "false",
    stt: { provider: stt.provider, ready: stt.provider !== "none" && (stt.provider === "http" ? !!stt.url : !!stt.apiKey) },
    tts: Object.fromEntries(LANGUAGES.map(l => [l, { provider: tts[l].provider, ready: canSpeak(tts, l) }])) as Record<Lang, { provider: TtsProvider; ready: boolean }>,
  };
}
