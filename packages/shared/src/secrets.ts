// AES-256-GCM encryption for provider credentials stored in the database.
// Uses the Web Crypto API (globalThis.crypto) available in Node 18+.
// Format: "v1:<base64 iv>:<base64 ciphertext+tag>"

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function isValidEncryptionKey(hex: string | undefined): hex is string {
  return typeof hex === "string" && /^[0-9a-fA-F]{64}$/.test(hex);
}

async function importKey(hex: string) {
  if (!isValidEncryptionKey(hex)) throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  const raw = new Uint8Array(32);
  for (let i = 0; i < 32; i++) raw[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string, keyHex: string): Promise<string> {
  const key = await importKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext)));
  return `v1:${toB64(iv)}:${toB64(ct)}`;
}

export async function decryptSecret(payload: string, keyHex: string): Promise<string> {
  const [version, ivB64, ctB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !ctB64) throw new Error("Unsupported encrypted secret format");
  const key = await importKey(keyHex);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(ctB64));
  return dec.decode(pt);
}

/** Shows only the last 4 characters of a secret, for UI display. */
export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}
