import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';

// Ohne 0/1/I/O (Verwechslungsgefahr beim Abtippen vor Ort)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

/**
 * Einmalcode → kurzlebiges Bearer-Token. Tokens werden nur als SHA-256 gespeichert
 * (Datenbankabzug allein erlaubt keine Anmeldung); Erneuerung widerruft das alte Token.
 */
export class PairingService {
  private code: { value: string; expiresAt: number } | undefined;

  constructor(
    private readonly db: Db,
    private readonly opts: { codeTtlMs: number; tokenTtlMs: number },
    private readonly now: () => number = Date.now,
  ) {}

  /** Neuen Einmalcode erzeugen (ersetzt einen noch offenen). */
  issueCode(): { code: string; expiresAt: Date } {
    const pick = (): string =>
      Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    const value = `${pick()}-${pick()}`;
    const expiresAt = this.now() + this.opts.codeTtlMs;
    this.code = { value, expiresAt };
    return { code: value, expiresAt: new Date(expiresAt) };
  }

  /** Löst den Code ein. Erfolgreich oder abgelaufen ⇒ Code ist verbraucht. */
  redeem(candidate: string): IssuedToken | undefined {
    const current = this.code;
    if (!current) return undefined;
    if (this.now() > current.expiresAt) {
      this.code = undefined;
      return undefined;
    }
    const a = Buffer.from(candidate);
    const b = Buffer.from(current.value);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
    this.code = undefined;
    return this.issueToken();
  }

  private issueToken(): IssuedToken {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now() + this.opts.tokenTtlMs);
    this.db.prepare('DELETE FROM tokens WHERE expires_at < ?').run(this.now());
    this.db
      .prepare('INSERT INTO tokens (hash, expires_at) VALUES (?, ?)')
      .run(sha256(token), expiresAt.getTime());
    return { token, expiresAt };
  }

  /** Pseudonym der Sitzung für das Änderungsprotokoll („wer“): Kurzform des Token-Hashes. */
  actorOf(token: string): string {
    return `sitzung-${sha256(token).slice(0, 8)}`;
  }

  verify(token: string): boolean {
    const row = this.db
      .prepare('SELECT expires_at FROM tokens WHERE hash = ?')
      .get(sha256(token)) as { expires_at: number } | undefined;
    return row !== undefined && row.expires_at > this.now();
  }

  /** Token erneuern: altes wird ungültig. */
  refresh(token: string): IssuedToken | undefined {
    if (!this.verify(token)) return undefined;
    this.db.prepare('DELETE FROM tokens WHERE hash = ?').run(sha256(token));
    return this.issueToken();
  }
}
