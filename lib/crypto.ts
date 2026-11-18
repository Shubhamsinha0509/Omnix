import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption for the OAuth tokens in `connections` (decision D13).
 *
 * A token in that table is a live key to someone's inbox, so it is never stored in the
 * clear: the database alone is not enough to read it. AES-256-GCM is authenticated, so a
 * row that has been tampered with fails to decrypt rather than returning wrong bytes.
 *
 * Only server code calls this, and only at the moment a tool runs ([security](../docs/07-security.md)).
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const TAG_BYTES = 16;

/** Prefix on every ciphertext, so a future algorithm change can be told apart. */
const VERSION = "v1";

/** True when a usable encryption key is configured. */
export function hasEncryptionKey() {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypts a token.
 *
 * `aad` is additional authenticated data: it isn't stored in the ciphertext but must
 * match on decryption. Passing something that identifies the row (the owner and provider)
 * binds the ciphertext to it, so a token blob copied into another user's row won't
 * decrypt. See `tokenAad`.
 */
export function encrypt(plaintext: string, aad?: string) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, loadKey(), iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  // iv | tag | ciphertext — all three are needed to decrypt, so they travel together.
  const packed = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  return `${VERSION}:${packed.toString("base64")}`;
}

/** Decrypts a token. Throws if the key is wrong, the `aad` differs, or the row was altered. */
export function decrypt(payload: string, aad?: string) {
  const [version, encoded] = splitOnce(payload, ":");
  if (version !== VERSION || !encoded) {
    throw new Error("Encrypted value isn't in a format this version understands.");
  }

  const packed = Buffer.from(encoded, "base64");
  // An empty plaintext is legitimately iv + tag and nothing more, hence `<`, not `<=`.
  if (packed.length < IV_BYTES + TAG_BYTES) throw new Error("Encrypted value is too short to be valid.");

  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = packed.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, loadKey(), iv);
  decipher.setAuthTag(tag);
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));

  // `final()` is what verifies the tag, so a forged or swapped value fails here.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * The binding for a connection's tokens. Both parts are fixed for the life of the row,
 * so the tokens stay readable while remaining tied to this owner and provider.
 */
export function tokenAad(userId: number, provider: string) {
  return `connection:${userId}:${provider}`;
}

// Read once and kept: the key doesn't change while the process is alive.
let cachedKey: Buffer | null = null;

/**
 * The key from `TOKEN_ENCRYPTION_KEY`, as 32 raw bytes from base64 or hex.
 *
 * Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Deliberately strict: a key of the wrong length, or a missing one, must stop a token
 * being written rather than be quietly padded into something weaker. The error is thrown
 * on use, not at import, so the app still starts before anyone has configured it.
 */
function loadKey() {
  if (cachedKey) return cachedKey;

  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY isn't set. Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(${KEY_BYTES}).toString('base64'))"`,
    );
  }

  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        "It should be 32 random bytes, base64 or hex encoded.",
    );
  }

  cachedKey = key;
  return key;
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const at = value.indexOf(separator);
  return at === -1 ? [value, undefined] : [value.slice(0, at), value.slice(at + separator.length)];
}
