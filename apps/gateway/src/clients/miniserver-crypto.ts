import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  type KeyObject,
} from 'node:crypto';

/**
 * Anwendungsverschlüsselung für Verbindungen ohne TLS (Doku „Communicating with the Miniserver“
 * V17.0, S. 7f. und 24f.): RSA (ECB, PKCS1, Base64) für den Sitzungsschlüssel, danach
 * AES-256-CBC mit Zero-Byte-Padding und Salt je Befehl.
 *
 * TODO(verify) am Test-Miniserver:
 * - Format der Antwort auf `jdev/sys/getcertificate` (wir akzeptieren PEM-Zertifikat oder -Public-Key).
 * - PKCS1 = v1.5-Padding (Doku nennt nur „PKCS1“).
 * - Salt-Länge (Doku: „length may vary, e.g. 2 bytes“, hex).
 */

export const AES_KEY_BYTES = 32;
export const AES_IV_BYTES = 16;
const AES_BLOCK = 16;

/** Öffentlichen Schlüssel aus der Antwort von `getcertificate` lesen (letztes Zertifikat der Kette). */
export function publicKeyFromCertificate(text: string): KeyObject {
  const blocks = text.match(/-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g);
  const last = blocks?.at(-1);
  if (!last) throw new Error('getcertificate: kein PEM-Block in der Antwort');
  // „BEGIN CERTIFICATE“ mit nacktem Public Key kommt in der Praxis vor (TODO(verify)): dann umetikettieren.
  try {
    return createPublicKey(last);
  } catch {
    return createPublicKey(
      last
        .replace(/BEGIN [A-Z ]+-----/, 'BEGIN PUBLIC KEY-----')
        .replace(/END [A-Z ]+-----/, 'END PUBLIC KEY-----'),
    );
  }
}

function zeroPad(data: Buffer): Buffer {
  const rest = data.length % AES_BLOCK;
  return rest === 0 ? data : Buffer.concat([data, Buffer.alloc(AES_BLOCK - rest)]);
}

function stripZeroPad(data: Buffer): Buffer {
  let end = data.length;
  while (end > 0 && data[end - 1] === 0) end--;
  return data.subarray(0, end);
}

export function aesEncrypt(plain: string, key: Buffer, iv: Buffer): string {
  const c = createCipheriv('aes-256-cbc', key, iv);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(zeroPad(Buffer.from(plain, 'utf8'))), c.final()]).toString(
    'base64',
  );
}

export function aesDecrypt(base64: string, key: Buffer, iv: Buffer): string {
  const d = createDecipheriv('aes-256-cbc', key, iv);
  d.setAutoPadding(false);
  return stripZeroPad(Buffer.concat([d.update(Buffer.from(base64, 'base64')), d.final()])).toString(
    'utf8',
  );
}

export function rsaEncrypt(plain: string, key: KeyObject): string {
  return publicEncrypt(
    { key, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(plain, 'utf8'),
  ).toString('base64');
}

/** Nur für den Simulator: Gegenstück mit dem privaten Schlüssel des simulierten Miniservers. */
export function rsaDecrypt(base64: string, privateKey: KeyObject): string {
  return privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(base64, 'base64'),
  ).toString('utf8');
}

const newSalt = (): string => randomBytes(2).toString('hex');

/**
 * Sitzung nach dem Schlüsseltausch. Jeder Befehl wird als „salt/{salt}/{cmd}“ verschlüsselt;
 * der Salt wird nach jedem Befehl per „nextSalt/{prev}/{next}/{cmd}“ gewechselt (S. 7f., 25).
 */
export class EncryptedSession {
  readonly key = randomBytes(AES_KEY_BYTES);
  readonly iv = randomBytes(AES_IV_BYTES);
  private salt: string;
  private used = false;

  constructor(private readonly saltFactory: () => string = newSalt) {
    this.salt = saltFactory();
  }

  /** Wert für `jdev/sys/keyexchange/{…}`: RSA("{key}:{iv}") als Base64 (S. 7). */
  keyExchangePayload(publicKey: KeyObject): string {
    return rsaEncrypt(`${this.key.toString('hex')}:${this.iv.toString('hex')}`, publicKey);
  }

  /** Verschlüsselten Befehl bauen: `jdev/sys/enc/{uri(base64(aes(...)))}`. */
  encryptCommand(cmd: string): string {
    let plain: string;
    if (!this.used) {
      plain = `salt/${this.salt}/${cmd}`;
      this.used = true;
    } else {
      const next = this.saltFactory();
      plain = `nextSalt/${this.salt}/${next}/${cmd}`;
      this.salt = next;
    }
    return `jdev/sys/enc/${encodeURIComponent(aesEncrypt(plain, this.key, this.iv))}`;
  }
}
