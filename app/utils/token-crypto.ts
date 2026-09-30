import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function getKeyMaterial(): Buffer {
  const raw =
    process.env.TOKEN_ENCRYPTION_KEY ||
    process.env.SHOPIFY_API_SECRET ||
    "dev-token-encryption-fallback";
  return createHash("sha256").update(raw).digest();
}

/** Encrypt a secret for at-rest storage. Idempotent if already encrypted. */
export function encryptSecret(
  plaintext: string | undefined | null,
): string | undefined {
  if (plaintext == null || plaintext === "") return plaintext ?? undefined;
  if (plaintext.startsWith(PREFIX)) return plaintext;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKeyMaterial(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

/**
 * Decrypt a secret from storage.
 * Plaintext legacy values (no prefix) are returned unchanged for migration.
 */
export function decryptSecret(
  value: string | undefined | null,
): string | undefined {
  if (value == null || value === "") return value ?? undefined;
  if (!value.startsWith(PREFIX)) return value;

  try {
    const raw = Buffer.from(value.slice(PREFIX.length), "base64url");
    if (raw.length < 28) return undefined;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", getKeyMaterial(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8",
    );
  } catch (error) {
    console.error("[token-crypto] decrypt failed:", error);
    return undefined;
  }
}
