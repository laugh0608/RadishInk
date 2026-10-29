import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { ApiError } from '../http/api-error';
import { sha256 } from '../storage/storage-contract';
import { AUTH_POLICY } from './auth-policy';

export interface Identity {
  userId: string;
  username: string;
  role: 'admin' | 'user';
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
    JOIN account_profiles a ON a.user_id=u.id
    WHERE s.digest=? AND u.enabled=1 AND a.admission='approved' AND s.expires_at>? AND s.last_seen>?
  `,
    )
    .get(digest, now, now - AUTH_POLICY.idleMs);
  if (!row) throw new ApiError(401, 'unauthorized');
  return { userId: row.user_id, username: row.username, role: row.role };
}
export function assertRecentSession(
  db: Database.Database,
  digest: string,
  passwordOnly = false,
): Identity {
  const identity = assertSession(db, digest);
  const row = db
    .prepare<
      [string],
      { created_at: number; authentication_method: string }
    >('SELECT created_at, authentication_method FROM sessions WHERE digest=?')
    .get(digest)!;
  if (
    row.created_at <= Date.now() - AUTH_POLICY.reauthenticationMs ||
    (passwordOnly && row.authentication_method !== 'password')
  )
    throw new ApiError(403, 'reauthentication-required');
  return identity;
}
export function revokeSession(
  db: Database.Database,
  token: string | undefined,
): void {
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    const digest = sha256(token);
    db.prepare('DELETE FROM sessions WHERE digest=?').run(digest);
    db.prepare('DELETE FROM oidc_attempts WHERE session_digest=?').run(digest);
  }
}

/** 调用方在同一身份事务内执行；OIDC 与本地密码共用同一容量、轮换和撤销规则。 */
export function issueSession(
  db: Database.Database,
  userId: string,
  method: 'password' | 'oidc',
  oldToken?: string,
) {
  const account = db
    .prepare<[string], { username: string; role: 'admin' | 'user' }>(
      `
    SELECT a.username,a.role FROM account_profiles a JOIN users u ON u.id=a.user_id
    WHERE a.user_id=? AND u.enabled=1 AND a.admission='approved'
  `,
    )
    .get(userId);
  if (!account) throw new ApiError(403, 'account-unavailable');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at<=? OR last_seen<=?').run(
    now,
    now - AUTH_POLICY.idleMs,
  );
  db.prepare(
    'DELETE FROM sessions WHERE digest IN (SELECT digest FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 19)',
  ).run(userId);
  revokeSession(db, oldToken);
  if (
    db.prepare<[], { n: number }>('SELECT count(*) n FROM sessions').get()!.n >=
    10000
  )
    throw new ApiError(429, 'session-capacity');
  const token = randomBytes(32).toString('base64url');
  db.prepare(
    'INSERT INTO sessions (digest,user_id,created_at,last_seen,expires_at,authentication_method) VALUES (?,?,?,?,?,?)',
  ).run(sha256(token), userId, now, now, now + AUTH_POLICY.absoluteMs, method);
  return { token, identity: { userId, ...account } };
}
