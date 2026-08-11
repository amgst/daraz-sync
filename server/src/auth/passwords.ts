import crypto from "node:crypto";

const KEY_LENGTH = 64;

// Node's built-in scrypt - no extra dependency needed. Stored as
// "<saltHex>:<hashHex>", mirroring the app's existing node:crypto-only
// approach to secrets (daraz/crypto.ts, daraz/state.ts).
export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, hashHex] = stored.split(":");
    if (!salt || !hashHex) {
      resolve(false);
      return;
    }
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      const storedKey = Buffer.from(hashHex, "hex");
      resolve(storedKey.length === derivedKey.length && crypto.timingSafeEqual(storedKey, derivedKey));
    });
  });
}
