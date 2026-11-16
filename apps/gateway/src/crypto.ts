import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface Sealed {
  iv: Uint8Array;
  tag: Uint8Array;
  ciphertext: Uint8Array;
}

/** AES-256-GCM. `aad` bindet den Geheimtext an seine ID, damit Zeilen nicht vertauscht werden können. */
export function seal(key: Buffer, plaintext: string, aad: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

export function open(key: Buffer, sealed: Sealed, aad: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
}
