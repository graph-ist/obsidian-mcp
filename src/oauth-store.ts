import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AdapterPayload } from 'oidc-provider';

type Payload = AdapterPayload;

export function createOAuthStore(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'oauth.sqlite');
  const database = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  database.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      model TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      expires INTEGER,
      grant_id TEXT,
      user_code TEXT,
      uid TEXT,
      PRIMARY KEY (model, id)
    );
    CREATE INDEX IF NOT EXISTS artifacts_grant ON artifacts (grant_id);
    CREATE INDEX IF NOT EXISTS artifacts_uid ON artifacts (model, uid);
    CREATE INDEX IF NOT EXISTS artifacts_user_code ON artifacts (model, user_code);
  `);

  class Adapter {
    constructor(private readonly model: string) {}

    async upsert(id: string, payload: Payload, expiresIn?: number) {
      const expires = expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : null;
      database.prepare('DELETE FROM artifacts WHERE expires IS NOT NULL AND expires <= ?')
        .run(Math.floor(Date.now() / 1000));
      database.prepare(`INSERT OR REPLACE INTO artifacts
        (model, id, payload, expires, grant_id, user_code, uid) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(this.model, id, JSON.stringify(payload), expires,
          typeof payload.grantId === 'string' ? payload.grantId : null,
          typeof payload.userCode === 'string' ? payload.userCode : null,
          typeof payload.uid === 'string' ? payload.uid : null);
    }

    private lookup(column: 'id' | 'user_code' | 'uid', value: string): Payload | undefined {
      const row = database.prepare(`SELECT payload FROM artifacts WHERE model = ? AND ${column} = ?
        AND (expires IS NULL OR expires > ?)`).get(this.model, value, Math.floor(Date.now() / 1000));
      return row ? JSON.parse(row.payload as string) as Payload : undefined;
    }

    async find(id: string) { return this.lookup('id', id); }
    async findByUserCode(code: string) { return this.lookup('user_code', code); }
    async findByUid(uid: string) { return this.lookup('uid', uid); }

    async destroy(id: string) {
      database.prepare('DELETE FROM artifacts WHERE model = ? AND id = ?').run(this.model, id);
    }

    async consume(id: string) {
      database.prepare(`UPDATE artifacts SET payload = json_set(payload, '$.consumed', ?)
        WHERE model = ? AND id = ?`).run(Math.floor(Date.now() / 1000), this.model, id);
    }

    async revokeByGrantId(grantId: string) {
      database.prepare('DELETE FROM artifacts WHERE grant_id = ?').run(grantId);
    }
  }

  return { Adapter, close: () => database.close() };
}