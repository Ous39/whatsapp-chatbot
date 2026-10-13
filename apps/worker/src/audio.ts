import { spawn } from "node:child_process";

let ffmpegAvailable: Promise<boolean> | undefined;

/** True when an ffmpeg binary is on PATH (installed in the worker Docker image). */
export function hasFfmpeg(): Promise<boolean> {
  ffmpegAvailable ??= new Promise(resolve => {
    const p = spawn(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", code => resolve(code === 0));
  });
  return ffmpegAvailable;
}

/** Re-encodes any audio to mono Ogg/Opus, the only format WhatsApp shows as a voice note. */
export function toOggOpus(input: Uint8Array, timeoutMs = 30000): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1"]);
    const chunks: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    p.on("error", err => {
      clearTimeout(timer);
      reject(err);
    });
    p.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(0, 300)}`));
      const out = Buffer.concat(chunks);
      resolve(new Uint8Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer));
    });
    p.stdin.on("error", () => undefined);
    p.stdin.end(Buffer.from(input));
  });
}

/**
 * Prepares synthesized speech for WhatsApp. Ogg/Opus is sent as a voice note;
 * other formats are converted when ffmpeg exists, otherwise sent as a regular audio file.
 */
export async function prepareVoiceNote(audio: Uint8Array<ArrayBuffer>, mime: string): Promise<{ data: Uint8Array<ArrayBuffer>; mime: string; voice: boolean; filename: string }> {
  const base = mime.split(";")[0]!.trim();
  if (base === "audio/ogg") return { data: audio, mime: "audio/ogg", voice: true, filename: "reply.ogg" };
  if (await hasFfmpeg()) {
    try {
      return { data: await toOggOpus(audio), mime: "audio/ogg", voice: true, filename: "reply.ogg" };
    } catch {
      /* fall back to the original file */
    }
  }
  const supported: Record<string, string> = { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr" };
  if (supported[base]) return { data: audio, mime: base, voice: false, filename: `reply.${supported[base]}` };
  throw new Error(`Cannot send ${base} audio to WhatsApp without ffmpeg`);
}
