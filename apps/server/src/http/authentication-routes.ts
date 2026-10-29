import type Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { LocalAuth, AUTH_POLICY } from '../auth/local-auth';
import type { Identity } from '../auth/auth-sessions';
import { OidcAccounts } from '../auth/oidc-accounts';
import { ApiError } from './api-error';
import { BrowserSecurity } from './browser-security';
import type { ServerConfig } from './server-policy';
import type { Deployment } from '../storage/storage-database';
import { exactKeys, readJson } from './request-body';

export class AuthenticationRoutes {
  readonly oidc: OidcAccounts | null;
  constructor(
    private readonly config: ServerConfig,
    db: Database.Database,
    private readonly auth: LocalAuth,
    private readonly security: BrowserSecurity,
    private readonly deployment: Deployment,
  ) {
    this.oidc = config.oidc ? new OidcAccounts(db, config) : null;
  }
  loginMethods(): string[] {
    return [
      ...(this.config.passwordLogin !== false ? ['password'] : []),
      ...(this.oidc ? ['radish-oidc'] : []),
    ];
  }
  private installSession(
    res: Response,
    result: { token: string; identity: Identity },
  ) {
    this.security.cookie(
      res,
      this.security.sessionName,
      result.token,
      AUTH_POLICY.absoluteMs / 1000,
    );
    this.security.cookie(res, this.security.preauthName, '', 0);
    return {
      user: result.identity,
      ...this.deployment,
      csrfToken: this.security.csrf(result.token),
    };
  }
  async handle(
    path: string,
    url: URL,
    req: Request,
    res: Response,
    signal: AbortSignal,
  ): Promise<boolean> {
    const method = req.method;
    if (!path.startsWith('/api/v1/auth/')) return false;
    const cookies = this.security.cookies(req);
    const token = cookies.get(this.security.sessionName),
      browser = cookies.get(this.security.oidcName);
    if (
      method === 'POST' &&
      ['/api/v1/auth/login', '/api/v1/auth/reauthenticate'].includes(path)
    ) {
      if (this.config.passwordLogin === false)
        throw new ApiError(403, 'password-login-disabled');
      const reauthenticate = path.endsWith('/reauthenticate');
      this.security.checkCsrf(req, !reauthenticate);
      const identity = reauthenticate ? this.auth.session(token) : null;
      const body = await readJson(req, signal);
      exactKeys(body, reauthenticate ? ['password'] : ['username', 'password']);
      const result = await this.auth.login(
        identity?.username ?? body.username,
        body.password,
        req.socket.remoteAddress ?? 'unknown',
        token,
      );
      if (signal.aborted) {
        this.auth.revoke(result.token);
        throw new ApiError(503, 'request-expired');
      }
      this.oidc?.cancelBrowser(browser);
      const response = this.installSession(res, result);
      this.security.cookie(res, this.security.oidcName, '', 0);
      res.json(response);
      return true;
    }
    if (method === 'POST' && path === '/api/v1/auth/logout') {
      this.security.checkCsrf(req, !token);
      this.auth.revoke(token);
      this.oidc?.cancelBrowser(browser);
      this.security.cookie(res, this.security.sessionName, '', 0);
      this.security.cookie(res, this.security.oidcName, '', 0);
      res.status(204).end();
      return true;
    }
    if (method === 'GET' && path === '/api/v1/auth/session') {
      res.json({
        user: this.auth.session(token),
        ...this.deployment,
        csrfToken: this.security.csrf(token!),
      });
      return true;
    }
    if (!this.oidc) throw new ApiError(404, 'not-found');
    if (method === 'GET' && path === '/api/v1/auth/oidc/radish/callback') {
      res.setHeader('Referrer-Policy', 'no-referrer');
      const callback = new URL(this.oidc.provider.callback);
      callback.search = url.search;
      let outcome = 'failed';
      try {
        const result = await this.oidc.complete(callback, browser, token);
        if (signal.aborted) {
          if ('token' in result) this.auth.revoke(result.token);
          throw new ApiError(503, 'request-expired');
        }
        outcome = result.outcome;
        if ('token' in result) this.installSession(res, result);
      } catch {
        // 不把 Token、上游原始错误、state 或身份存在性带回业务页面及日志。
        outcome = 'failed';
      }
      if (!res.headersSent && !res.destroyed) {
        this.security.cookie(res, this.security.oidcName, '', 0);
        res.redirect(
          303,
          `${this.config.basePath ?? '/'}?radishink-auth=${outcome}`,
        );
      }
      return true;
    }
    if (method === 'POST' && path === '/api/v1/auth/oidc/radish/start') {
      const body = await readJson(req, signal);
      exactKeys(body, ['purpose']);
      this.security.checkCsrf(req, body.purpose !== 'link');
      const result = await this.oidc.start(
        body.purpose,
        browser,
        token,
        req.socket.remoteAddress ?? 'unknown',
      );
      if (signal.aborted) {
        this.oidc.cancelBrowser(result.browser);
        throw new ApiError(503, 'request-expired');
      }
      this.security.cookie(res, this.security.oidcName, result.browser, 300);
      res.json({ authorizationUrl: result.authorizationUrl });
      return true;
    }
    if (method === 'GET' && path === '/api/v1/auth/oidc/radish/identity') {
      res.json(this.oidc.methods(token));
      return true;
    }
    if (method === 'POST' && path === '/api/v1/auth/oidc/radish/unlink') {
      this.security.checkCsrf(req);
      const body = await readJson(req, signal);
      exactKeys(body, ['confirm']);
      if (body.confirm !== true)
        throw new ApiError(422, 'confirmation-required');
      this.oidc.unlink(token);
      this.oidc.cancelBrowser(browser);
      this.security.cookie(res, this.security.sessionName, '', 0);
      this.security.cookie(res, this.security.oidcName, '', 0);
      res.status(204).end();
      return true;
    }
    throw new ApiError(404, 'not-found');
  }
}
