/** Mints a client-side id (`crypto.randomUUID()` when available). */
export function makeId(): string {
  // `crypto.randomUUID` only exists in a secure context (HTTPS or localhost).
  // Over plain HTTP on a non-localhost host (e.g. the preview env) it is
  // undefined, so fall back to `crypto.getRandomValues`, which has no secure-
  // context restriction, and assemble a v4 UUID by hand.
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // eslint-disable-next-line no-bitwise -- UUID v4 bit-twiddling per RFC 4122
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  // eslint-disable-next-line no-bitwise -- UUID v4 bit-twiddling per RFC 4122
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx

  let uuid = "";
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) {
      uuid += "-";
    }
    uuid += bytes[i]!.toString(16).padStart(2, "0");
  }
  return uuid;
}
