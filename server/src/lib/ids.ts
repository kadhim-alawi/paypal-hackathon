import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford-ish base32, no i/l/o/u

function encode(bytes: Buffer, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i % bytes.length]! % ALPHABET.length];
  }
  return out;
}

/** Prefixed, URL-safe, sortable-enough identifier, e.g. `app_k3j9...`. */
export function newId(prefix: string): string {
  const time = Date.now().toString(36).padStart(9, "0");
  return `${prefix}_${time}${encode(randomBytes(12), 12)}`;
}

/** Short human-readable case reference shown to applicants, e.g. `TDO-7KQ4M`. */
export function newPublicRef(): string {
  return `TDO-${encode(randomBytes(5), 5).toUpperCase()}`;
}

/** High-entropy secret for applicant magic links. */
export function newSecretToken(): string {
  return randomBytes(24).toString("base64url");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}
