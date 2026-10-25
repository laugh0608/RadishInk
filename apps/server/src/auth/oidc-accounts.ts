import type Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from '../http/api-error';
import type { ServerConfig } from '../http/server-policy';
import { sha256 } from '../storage/storage-contract';
import {
  assertRecentSession,
  assertSession,
  issueSession,
  tokenDigest,
} from './auth-sessions';
import { OidcProvider } from './oidc-provider';

const lifetime = 5 * 60_000;
const randomToken = () => randomBytes(32).toString('base64url');
const validToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
interface Attempt {
  state_digest: string;
  browser_digest: string;
  nonce: string;
  verifier: string;
  config_digest: string;
  purpose: 'login' | 'link';
  user_id: string | null;
  session_digest: string | null;
  created_at: number;
  expires_at: number;
  consumed: number;
}
interface ExternalAccount {
  user_id: string;
  enabled: number;
  admission: string;
}

export class OidcAccounts {
  readonly provider: OidcProvider;
  private readonly configDigest: string;
  constructor(
    private readonly db: Database.Database,
    private readonly config: ServerConfig,
  ) {
    const settings = config.oidc!;
    this.provider = new OidcProvider(
      settings,
      `${config.origin}${config.basePath ?? '/'}api/v1/auth/oidc/radish/callback`,
      !config.secure,
    );
    this.configDigest = sha256(
      JSON.stringify([settings, this.provider.callback]),
    );
  }
  cancelBrowser(browser: string | undefined): void {
    if (validToken(browser))
      this.db
        .prepare('DELETE FROM oidc_attempts WHERE browser_digest=?')
        .run(sha256(browser));
  }
  private reserve(source: string, browser?: string) {
    const now = Date.now();
    this.db.prepare('DELETE FROM oidc_attempts WHERE expires_at<=?').run(now);
    this.db.prepare('DELETE FROM login_limits WHERE expires_at<=?').run(now);
    const key = `oidc-source:${sha256(source)}`;
    const rate = this.db
      .prepare<
        [string],
        { failures: number }
      >('SELECT failures FROM login_limits WHERE key=?')
      .get(key);
    if (
      (rate?.failures ?? 0) >= 30 ||
      this.db
        .prepare<[], { n: number }>('SELECT count(*) n FROM oidc_attempts')
        .get()!.n >= 1000 ||
      this.db
        .prepare<[], { n: number }>('SELECT count(*) n FROM login_limits')
        .get()!.n >= 10000
    )
      throw new ApiError(429, 'oidc-attempt-limited');
    this.db
      .prepare(
        'INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET failures=failures+1',
      )
      .run(key, now + 15 * 60_000);
    this.cancelBrowser(browser);
  }
  async start(
    purpose: unknown,
    oldBrowser: string | undefined,
    session: string | undefined,
    source: string,
  ) {
    if (purpose !== 'login' && purpose !== 'link')
      throw new ApiError(422, 'invalid-oidc-purpose');
    const state = randomToken(),
      browser = randomToken(),
      nonce = randomToken(),
      verifier = randomToken();
    const now = Date.now();
    this.db
      .transaction(() => {
        const identity =
          purpose === 'link'
            ? assertRecentSession(this.db, tokenDigest(session), true)
            : null;
        if (purpose === 'link' && this.config.passwordLogin === false)
          throw new ApiError(403, 'password-login-disabled');
        this.reserve(source, oldBrowser);
        this.db
          .prepare(
            `INSERT INTO oidc_attempts
        (state_digest,browser_digest,nonce,verifier,config_digest,purpose,user_id,session_digest,created_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            sha256(state),
            sha256(browser),
            nonce,
            verifier,
            this.configDigest,
            purpose,
            identity?.userId ?? null,
            validToken(session) ? sha256(session) : null,
            now,
            now + lifetime,
          );
      })
      .immediate();
    try {
      const authorizationUrl = await this.provider.authorization({
        state,
        nonce,
        verifier,
      });
      if (
        !this.db
          .prepare(
            'SELECT 1 FROM oidc_attempts WHERE state_digest=? AND expires_at>?',
          )
          .get(sha256(state), Date.now())
      )
        throw new ApiError(403, 'oidc-attempt-cancelled');
      return { authorizationUrl, browser };
    } catch (error) {
      this.db
        .prepare('DELETE FROM oidc_attempts WHERE state_digest=?')
        .run(sha256(state));
      throw error;
    }
  }
  async complete(
    url: URL,
    browser: string | undefined,
    session: string | undefined,
  ) {
    const state = url.searchParams.get('state');
    if (!validToken(state)) throw new ApiError(403, 'oidc-attempt-invalid');
    // 先持久化消费状态，网络期间仍保留可撤销记录；任何失败都不能重放。
    const attempt = this.db
      .prepare<
        [string],
        Attempt
      >('UPDATE oidc_attempts SET consumed=1 WHERE state_digest=? AND consumed=0 RETURNING *')
      .get(sha256(state));
    if (!attempt) throw new ApiError(403, 'oidc-attempt-invalid');
    try {
      if (
        url.searchParams.getAll('state').length !== 1 ||
        !validToken(browser) ||
        attempt.browser_digest !== sha256(browser) ||
        attempt.expires_at <= Date.now() ||
        attempt.config_digest !== this.configDigest ||
        (attempt.session_digest !== null &&
          (!validToken(session) || attempt.session_digest !== sha256(session)))
      )
        throw new ApiError(403, 'oidc-attempt-invalid');
      if (url.searchParams.get('error') === 'access_denied')
        return { outcome: 'cancelled' as const };
      const { subject } = await this.provider.verify(url, {
        state,
        nonce: attempt.nonce,
        verifier: attempt.verifier,
      });
      return this.db
        .transaction(() => {
          if (
            !this.db
              .prepare(
                'SELECT 1 FROM oidc_attempts WHERE state_digest=? AND consumed=1 AND expires_at>?',
              )
              .get(attempt.state_digest, Date.now())
          )
            throw new ApiError(403, 'oidc-attempt-cancelled');
          const issuer = this.config.oidc!.issuer;
          const existing = this.db
            .prepare<[string, string], ExternalAccount>(
              `
          SELECT i.user_id,u.enabled,a.admission FROM oidc_identities i JOIN users u ON u.id=i.user_id
          JOIN account_profiles a ON a.user_id=u.id WHERE issuer=? AND subject=?
        `,
            )
            .get(issuer, subject);
          if (attempt.purpose === 'link') {
            const identity = assertRecentSession(
              this.db,
              tokenDigest(session),
              true,
            );
            if (
              identity.userId !== attempt.user_id ||
              (existing && existing.user_id !== identity.userId)
            )
              throw new ApiError(409, 'oidc-identity-conflict');
            const owned = this.db
              .prepare<
                [string, string],
                { subject: string }
              >('SELECT subject FROM oidc_identities WHERE user_id=? AND issuer=?')
              .get(identity.userId, issuer);
            if (owned && owned.subject !== subject)
              throw new ApiError(409, 'oidc-identity-conflict');
            if (!existing)
              this.db
                .prepare('INSERT INTO oidc_identities VALUES (?,?,?,?)')
                .run(issuer, subject, identity.userId, Date.now());
            // 绑定是安全状态变更；旧会话全部撤销，新的会话不能继承旧密码重新认证窗口。
            this.db
              .prepare('DELETE FROM sessions WHERE user_id=?')
              .run(identity.userId);
            this.db
              .prepare('DELETE FROM oidc_attempts WHERE user_id=?')
              .run(identity.userId);
            return {
              outcome: 'linked' as const,
              ...issueSession(this.db, identity.userId, 'oidc', session),
            };
          }
          let userId = existing?.user_id;
          if (!existing) {
            if (
              this.db
                .prepare<
                  [],
                  { n: number }
                >('SELECT count(*) n FROM account_profiles')
                .get()!.n >= 10000
            )
              throw new ApiError(429, 'account-capacity');
            userId = randomUUID();
            const approved = this.config.oidc!.admission === 'auto';
            this.db
              .prepare('INSERT INTO users VALUES (?,?)')
              .run(userId, approved ? 1 : 0);
            this.db
              .prepare('INSERT INTO owner_usage VALUES (?,0,0)')
              .run(userId);
            this.db
              .prepare("INSERT INTO account_profiles VALUES (?,?,'user',?)")
              .run(
                userId,
                `radish-${userId}`,
                approved ? 'approved' : 'pending',
              );
            this.db
              .prepare('INSERT INTO oidc_identities VALUES (?,?,?,?)')
              .run(issuer, subject, userId, Date.now());
            if (!approved) return { outcome: 'pending' as const };
          } else {
            if (existing.admission !== 'approved')
              return { outcome: 'pending' as const };
            if (!existing.enabled) throw new ApiError(403, 'account-disabled');
          }
          return {
            outcome: 'signed-in' as const,
            ...issueSession(this.db, userId!, 'oidc', session),
          };
        })
        .immediate();
    } finally {
      this.db
        .prepare('DELETE FROM oidc_attempts WHERE state_digest=?')
        .run(attempt.state_digest);
    }
  }
  methods(session: string | undefined) {
    const identity = assertSession(this.db, tokenDigest(session));
    return {
      hasPassword: !!this.db
        .prepare('SELECT 1 FROM password_credentials WHERE user_id=?')
        .get(identity.userId),
      linked: !!this.db
        .prepare('SELECT 1 FROM oidc_identities WHERE user_id=? AND issuer=?')
        .get(identity.userId, this.config.oidc!.issuer),
    };
  }
  unlink(session: string | undefined): void {
    this.db
      .transaction(() => {
        const identity = assertRecentSession(
          this.db,
          tokenDigest(session),
          true,
        );
        if (
          this.config.passwordLogin === false ||
          !this.db
            .prepare('SELECT 1 FROM password_credentials WHERE user_id=?')
            .get(identity.userId)
        )
          throw new ApiError(403, 'last-login-method');
        if (
          !this.db
            .prepare('DELETE FROM oidc_identities WHERE user_id=? AND issuer=?')
            .run(identity.userId, this.config.oidc!.issuer).changes
        )
          throw new ApiError(404, 'identity-not-found');
        this.db
          .prepare('DELETE FROM sessions WHERE user_id=?')
          .run(identity.userId);
        this.db
          .prepare('DELETE FROM oidc_attempts WHERE user_id=?')
          .run(identity.userId);
      })
      .immediate();
  }
}

/** 本机维护权限负责首次准入；不从上游角色或邮箱推导本站权限。 */
export function listOidcAccounts(db: Database.Database) {
  return db
    .prepare(
      `SELECT a.username,a.user_id,a.admission,u.enabled,i.issuer,i.subject
    FROM oidc_identities i JOIN account_profiles a ON a.user_id=i.user_id JOIN users u ON u.id=i.user_id ORDER BY a.username,i.issuer`,
    )
    .all();
}
export function approveOidcAccount(db: Database.Database, name: string): void {
  db.transaction(() => {
    const row = db
      .prepare<
        [string],
        { user_id: string }
      >("SELECT user_id FROM account_profiles WHERE username=? AND admission='pending'")
      .get(name);
    if (!row) throw new ApiError(409, 'account-not-pending');
    db.prepare(
      "UPDATE account_profiles SET admission='approved' WHERE user_id=?",
    ).run(row.user_id);
    db.prepare('UPDATE users SET enabled=1 WHERE id=?').run(row.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
    db.prepare('DELETE FROM oidc_attempts WHERE user_id=?').run(row.user_id);
  }).immediate();
}
