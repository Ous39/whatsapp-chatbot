import { describe, expect, it } from "vitest";
import { encryptSecret } from "./secrets";
import { mayUseEnvToken, resolveWhatsAppToken, WhatsAppTokenUnavailable } from "./whatsapp-token";

const key = "0".repeat(63) + "1";

describe("resolveWhatsAppToken (C3)", () => {
  it("prefers the workspace's own encrypted token", async () => {
    const encryptedAccessToken = await encryptSecret("tenant-token", key);
    await expect(resolveWhatsAppToken({ businessId: "b1", encryptedAccessToken }, { encryptionKey: key, envAccessToken: "env", envTokenBusinessId: "b1" })).resolves.toBe("tenant-token");
  });

  it("uses the environment token only for its designated workspace", async () => {
    const env = { encryptionKey: key, envAccessToken: "env-token", envTokenBusinessId: "oceanbrown" };
    await expect(resolveWhatsAppToken({ businessId: "oceanbrown", encryptedAccessToken: null }, env)).resolves.toBe("env-token");
    await expect(resolveWhatsAppToken({ businessId: "other-tenant", encryptedAccessToken: null }, env)).rejects.toBeInstanceOf(WhatsAppTokenUnavailable);
  });

  it("never uses the environment token when no workspace is designated", async () => {
    expect(mayUseEnvToken("b1", { envAccessToken: "env-token" })).toBe(false);
    await expect(resolveWhatsAppToken({ businessId: "b1", encryptedAccessToken: null }, { envAccessToken: "env-token" })).rejects.toBeInstanceOf(WhatsAppTokenUnavailable);
  });

  it("reports a missing encryption key instead of guessing", async () => {
    const encryptedAccessToken = await encryptSecret("tenant-token", key);
    await expect(resolveWhatsAppToken({ businessId: "b1", encryptedAccessToken }, {})).rejects.toThrow("ENCRYPTION_KEY");
  });
});
