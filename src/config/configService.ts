import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { db } from '../db/sqlite';

export interface ConfigEntry {
  key: string;
  value: string;
  sensitive: boolean;
}

type ConfigRow = {
  key: string;
  value: string | null;
  sensitive: number;
};

const ENCRYPTION_SECRET_KEY = '_encryption_secret';
const MASKED_VALUE = '••••••';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

class ConfigService {
  get(key: string): string | undefined {
    const dbValue = this.getRaw(key);
    if (dbValue !== undefined) return dbValue;
    return process.env[key];
  }

  set(key: string, value: string, sensitive = false): void {
    const storedValue = sensitive ? this.encrypt(value) : value;
    db.prepare(`
      INSERT INTO config (key, value, sensitive)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        sensitive = excluded.sensitive
    `).run(key, storedValue, sensitive ? 1 : 0);
  }

  getAll(): ConfigEntry[] {
    const rows = db.prepare('SELECT key, value, sensitive FROM config ORDER BY key ASC').all() as ConfigRow[];
    return rows.map((row) => ({
      key: row.key,
      value: row.sensitive ? MASKED_VALUE : (row.value ?? ''),
      sensitive: row.sensitive === 1,
    }));
  }

  getRaw(key: string): string | undefined {
    const row = db.prepare('SELECT key, value, sensitive FROM config WHERE key = ?').get(key) as ConfigRow | undefined;
    if (!row || row.value == null) return undefined;
    return row.sensitive ? this.decrypt(row.value) : row.value;
  }

  delete(key: string): void {
    db.prepare('DELETE FROM config WHERE key = ?').run(key);
  }

  has(key: string): boolean {
    const row = db.prepare('SELECT 1 FROM config WHERE key = ?').get(key) as { 1: number } | undefined;
    return !!row;
  }

  private encrypt(value: string): string {
    const secret = this.getOrCreateEncryptionSecret();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.deriveKey(secret), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
  }

  private decrypt(value: string): string {
    const [ivB64, authTagB64, encryptedB64] = value.split(':');
    if (!ivB64 || !authTagB64 || !encryptedB64) {
      throw new Error('Invalid encrypted config value');
    }

    const secret = this.getOrCreateEncryptionSecret();
    const decipher = createDecipheriv(ALGORITHM, this.deriveKey(secret), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedB64, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  private deriveKey(secret: string): Buffer {
    return createHash('sha256').update(secret).digest();
  }

  private getOrCreateEncryptionSecret(): string {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(ENCRYPTION_SECRET_KEY) as { value: string | null } | undefined;
    if (row?.value) return row.value;

    const secret = randomBytes(32).toString('hex');
    db.prepare(`
      INSERT INTO config (key, value, sensitive)
      VALUES (?, ?, 0)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(ENCRYPTION_SECRET_KEY, secret);
    return secret;
  }
}

export const configService = new ConfigService();
