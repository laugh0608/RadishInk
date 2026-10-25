import type Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { ApiError } from '../http/api-error';
import { sha256 } from '../storage/storage-contract';

export const AUTH_POLICY = Object.freeze({
  idleMs: 30 * 60_000,
  absoluteMs: 12 * 60 * 60_000,
  windowMs: 15 * 60_000,
  accountFailures: 5,
  sourceFailures: 30,
  argonConcurrency: 2,
});
export const ARGON_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
});
export interface Identity {
  userId: string;
  username: string;
  role: 'admin' | 'user';
}
interface Account {
  user_id: string;
  username: string;
  role: 'admin' | 'user';
  password_hash: string;
  enabled: number;
}

export function username(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(value)
  )
    throw new ApiError(422, 'invalid-username');
  return value.toLowerCase();
}
export function validatePassword(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length < 12 ||
    Buffer.byteLength(value) > 1024
  )
    throw new ApiError(422, 'invalid-password');
}
export function tokenDigest(token: string | undefined): string {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new ApiError(401, 'unauthorized');
  return sha256(token);
}
export function assertSession(
  db: Database.Database,
  digest: string,
  now = Date.now(),
): Identity {
  const row = db
    .prepare<
      [string, number, number],
      { user_id: string; username: string; role: 'admin' | 'user' }
    >(
      `
    SELECT s.user_id, a.username, a.role FROM sessions s JOIN users u ON u.id=s.user_id
    JOIN local_accounts a ON a.user_id=u.id
    WHERE s.digest=? AND u.enabled=1 AND s.expires_at>? AND s.last_seen>?`,
    )
    .get(digest, now, now - AUTH_POLICY.idleMs);
  if (!row) throw new ApiError(401, 'unauthorized');
  return { userId: row.user_id, username: row.username, role: row.role };
}

/** 仅短 SQL 在 HTTP 线程执行；口令原生库有独立并发上限。 */
export class LocalAuth {
  private hashing = 0;
  private dummyHash = '';
  constructor(readonly db: Database.Database) {}
  async initialize(): Promise<void> {
    this.dummyHash = await argon2.hash(randomBytes(32), ARGON_OPTIONS);
  }
  hasAdmin(): boolean {
    return !!this.db
      .prepare(
        "SELECT 1 FROM local_accounts a JOIN users u ON u.id=a.user_id WHERE role='admin' AND enabled=1 LIMIT 1",
      )
      .get();
  }
  session(token: string | undefined): Identity {
    const digest = tokenDigest(token);
    const identity = assertSession(this.db, digest);
    this.db
      .prepare('UPDATE sessions SET last_seen=? WHERE digest=?')
      .run(Date.now(), digest);
    return identity;
  }
  revoke(token: string | undefined): void {
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token))
      this.db.prepare('DELETE FROM sessions WHERE digest=?').run(sha256(token));
  }
  private reserve(name: string, source: string): string[] {
    const now = Date.now();
    const keys = ['account:' + sha256(name), 'source:' + sha256(source)];
    this.db
      .transaction(() => {
        this.db
          .prepare('DELETE FROM login_limits WHERE expires_at<=?')
          .run(now);
        for (const [index, key] of keys.entries()) {
          const row = this.db
            .prepare<
              [string],
              { failures: number }
            >('SELECT failures FROM login_limits WHERE key=?')
            .get(key);
          if (
            row &&
            row.failures >=
              (index === 0
                ? AUTH_POLICY.accountFailures
                : AUTH_POLICY.sourceFailures)
          )
            throw new ApiError(429, 'login-limited');
        }
        const count = this.db
          .prepare<[], { n: number }>('SELECT count(*) n FROM login_limits')
          .get()!.n;
        if (count > 9998) throw new ApiError(429, 'login-limited');
        for (const key of keys)
          this.db
            .prepare(
              'INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET failures=failures+1',
            )
            .run(key, now + AUTH_POLICY.windowMs);
      })
      .immediate();
    return keys;
  }
  async login(
    nameValue: unknown,
    password: unknown,
    source: string,
    oldToken?: string,
  ): Promise<{ identity: Identity; token: string }> {
    // 非规范用户名也消耗同一来源额度，且与不存在账号走同一校验路径。
    const name =
      typeof nameValue === 'string' && nameValue.length <= 64
        ? nameValue.toLowerCase()
        : '';
    if (typeof password !== 'string' || Buffer.byteLength(password) > 1024)
      throw new ApiError(401, 'unauthorized');
    if (this.hashing >= AUTH_POLICY.argonConcurrency)
      throw new ApiError(429, 'password-busy');
    this.hashing++;
    try {
      const keys = this.reserve(name, source);
      const row = this.db
        .prepare<
          [string],
          Account
        >('SELECT a.*, u.enabled FROM local_accounts a JOIN users u ON u.id=a.user_id WHERE username=?')
        .get(name);
      const valid = await argon2.verify(
        row?.password_hash ?? this.dummyHash,
        password,
      );
      if (!valid || !row?.enabled) throw new ApiError(401, 'unauthorized');
      const token = randomBytes(32).toString('base64url');
      const now = Date.now();
      this.db
        .transaction(() => {
          const actual = this.db
            .prepare<
              [string],
              Account
            >('SELECT a.*, u.enabled FROM local_accounts a JOIN users u ON u.id=a.user_id WHERE user_id=?')
            .get(row.user_id);
          if (!actual?.enabled || actual.password_hash !== row.password_hash)
            throw new ApiError(401, 'unauthorized');
          this.db
            .prepare('DELETE FROM sessions WHERE expires_at<=? OR last_seen<=?')
            .run(now, now - AUTH_POLICY.idleMs);
          this.db
            .prepare(
              'DELETE FROM sessions WHERE digest IN (SELECT digest FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 19)',
            )
            .run(row.user_id);
          if (
            this.db
              .prepare<[], { n: number }>('SELECT count(*) n FROM sessions')
              .get()!.n >= 10000
          )
            throw new ApiError(429, 'session-capacity');
          this.revoke(oldToken);
          this.db
            .prepare('INSERT INTO sessions VALUES (?,?,?,?,?)')
            .run(
              sha256(token),
              row.user_id,
              now,
              now,
              now + AUTH_POLICY.absoluteMs,
            );
          for (const key of keys)
            this.db
              .prepare(
                'UPDATE login_limits SET failures=max(0,failures-1) WHERE key=?',
              )
              .run(key);
        })
        .immediate();
      return {
        token,
        identity: {
          userId: row.user_id,
          username: row.username,
          role: row.role,
        },
      };
    } finally {
      this.hashing--;
    }
  }
}

/** 本机离线维护入口；身份恢复保留原 user ID 和文章归属。 */
export async function manageAccount(
  db: Database.Database,
  command:
    | 'init-admin'
    | 'create-user'
    | 'reset-password'
    | 'disable'
    | 'enable',
  nameValue: string,
  password?: string,
): Promise<Identity> {
  const name = username(nameValue);
  const before = db
    .prepare<
      [string],
      Account
    >('SELECT a.*, u.enabled FROM local_accounts a JOIN users u ON u.id=a.user_id WHERE username=?')
    .get(name);
  if (
    command === 'init-admin' &&
    db.prepare("SELECT 1 FROM local_accounts WHERE role='admin'").get()
  )
    throw new ApiError(409, 'admin-exists');
  if (
    command === 'init-admin' || command === 'create-user' ? !!before : !before
  )
    throw new ApiError(409, 'account-state');
  let hash: string | undefined;
  if (['init-admin', 'create-user', 'reset-password'].includes(command)) {
    validatePassword(password);
    hash = await argon2.hash(password, ARGON_OPTIONS);
  }
  const id = before?.user_id ?? randomUUID();
  const role = before?.role ?? (command === 'init-admin' ? 'admin' : 'user');
  db.transaction(() => {
    if (!before) {
      db.prepare('INSERT INTO users VALUES (?,1)').run(id);
      db.prepare('INSERT INTO owner_usage VALUES (?,0,0)').run(id);
      db.prepare('INSERT INTO local_accounts VALUES (?,?,?,?)').run(
        id,
        name,
        hash,
        role,
      );
    } else {
      if (hash)
        db.prepare(
          'UPDATE local_accounts SET password_hash=? WHERE user_id=?',
        ).run(hash, id);
      if (command === 'disable' || command === 'enable')
        db.prepare('UPDATE users SET enabled=? WHERE id=?').run(
          command === 'enable' ? 1 : 0,
          id,
        );
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      if (command === 'reset-password')
        db.prepare('DELETE FROM login_limits WHERE key=?').run(
          'account:' + sha256(name),
        );
    }
  }).immediate();
  return { userId: id, username: name, role };
}
