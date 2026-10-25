import type Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { ApiError } from '../http/api-error';
import { sha256 } from '../storage/storage-contract';

import { AUTH_POLICY } from './auth-policy';
import {
  assertSession,
  issueSession,
  revokeSession,
  tokenDigest,
  type Identity,
} from './auth-sessions';
export { AUTH_POLICY } from './auth-policy';
export { assertSession, tokenDigest, type Identity } from './auth-sessions';

export const ARGON_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
});
interface Account {
  user_id: string;
  username: string;
  role: 'admin' | 'user';
  password_hash: string;
  enabled: number;
  admission: string;
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
        "SELECT 1 FROM account_profiles a JOIN users u ON u.id=a.user_id WHERE role='admin' AND enabled=1 AND admission='approved' LIMIT 1",
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
    revokeSession(this.db, token);
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
        >('SELECT a.*, p.password_hash, u.enabled FROM account_profiles a JOIN users u ON u.id=a.user_id LEFT JOIN password_credentials p ON p.user_id=a.user_id WHERE username=?')
        .get(name);
      const valid = await argon2.verify(
        row?.password_hash ?? this.dummyHash,
        password,
      );
      if (!valid || !row?.enabled || row.admission !== 'approved')
        throw new ApiError(401, 'unauthorized');
      const result = this.db
        .transaction(() => {
          const actual = this.db
            .prepare<
              [string],
              Account
            >('SELECT a.*, p.password_hash, u.enabled FROM account_profiles a JOIN users u ON u.id=a.user_id LEFT JOIN password_credentials p ON p.user_id=a.user_id WHERE a.user_id=?')
            .get(row.user_id);
          if (
            !actual?.enabled ||
            actual.admission !== 'approved' ||
            actual.password_hash !== row.password_hash
          )
            throw new ApiError(401, 'unauthorized');
          const result = issueSession(
            this.db,
            row.user_id,
            'password',
            oldToken,
          );
          for (const key of keys)
            this.db
              .prepare(
                'UPDATE login_limits SET failures=max(0,failures-1) WHERE key=?',
              )
              .run(key);
          return result;
        })
        .immediate();
      return result;
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
    | 'enable'
    | 'revoke-sessions',
  nameValue: string,
  password?: string,
): Promise<Identity> {
  const name = username(nameValue);
  const before = db
    .prepare<
      [string],
      Account
    >('SELECT a.*, p.password_hash, u.enabled FROM account_profiles a JOIN users u ON u.id=a.user_id LEFT JOIN password_credentials p ON p.user_id=a.user_id WHERE username=?')
    .get(name);
  if (
    command === 'init-admin' &&
    db.prepare("SELECT 1 FROM account_profiles WHERE role='admin'").get()
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
      db.prepare("INSERT INTO account_profiles VALUES (?,?,?,'approved')").run(
        id,
        name,
        role,
      );
      db.prepare('INSERT INTO password_credentials VALUES (?,?)').run(id, hash);
    } else {
      if (hash)
        db.prepare(
          'INSERT INTO password_credentials VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash',
        ).run(id, hash);
      if (command === 'enable' && before.admission !== 'approved')
        throw new ApiError(403, 'approval-required');
      if (command === 'disable' || command === 'enable')
        db.prepare('UPDATE users SET enabled=? WHERE id=?').run(
          command === 'enable' ? 1 : 0,
          id,
        );
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      db.prepare('DELETE FROM oidc_attempts WHERE user_id=?').run(id);
      if (command === 'reset-password')
        db.prepare('DELETE FROM login_limits WHERE key=?').run(
          'account:' + sha256(name),
        );
    }
  }).immediate();
  return { userId: id, username: name, role };
}
