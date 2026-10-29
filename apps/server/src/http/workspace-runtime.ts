import type { OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { LocalAuth, tokenDigest } from '../auth/local-auth';
import { assertUuid, assertRevision } from '../storage/storage-contract';
import type { Deployment } from '../storage/storage-database';
import { ApiError, ERROR_MESSAGES, publicError } from './api-error';
import { BrowserSecurity } from './browser-security';
import { AuthenticationRoutes } from './authentication-routes';
import { HTTP_POLICY, PUBLIC_LIMITS, ServerConfig } from './server-policy';
import { readArticle, readJson, exactKeys } from './request-body';
import { StorageExecutor } from './storage-executor';
import type { StorageOperation } from './storage-worker-protocol';

export class WorkspaceRuntime implements OnModuleDestroy {
  readonly security: BrowserSecurity;
  readonly auth: LocalAuth;
  readonly authentication: AuthenticationRoutes;
  private active = 0;
  private readonly writers = new Set<string>();
  private closing = false;
  private constructor(
    readonly config: ServerConfig,
    readonly executor: StorageExecutor,
    readonly deployment: Deployment,
    private readonly db: Database.Database,
  ) {
    this.security = new BrowserSecurity(config);
    this.auth = new LocalAuth(db);
    this.authentication = new AuthenticationRoutes(
      config,
      db,
      this.auth,
      this.security,
      deployment,
    );
  }
  static async open(config: ServerConfig): Promise<WorkspaceRuntime> {
    const executor = new StorageExecutor(config.directory);
    let db: Database.Database | undefined;
    try {
      const deployment = await executor.ready;
      // worker 保持卷独占锁；此连接只处理短小身份事务，退出时先关此连接。
      db = new Database(join(config.directory, 'metadata.sqlite'), {
        fileMustExist: true,
        timeout: 100,
      });
      db.pragma('foreign_keys = ON');
      db.pragma('synchronous = FULL');
      const runtime = new WorkspaceRuntime(config, executor, deployment, db);
      await runtime.auth.initialize();
      return runtime;
    } catch (error) {
      db?.close();
      await executor.close();
      throw error;
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    // 先拒绝新请求，给已进入的保存请求一个完整的请求期限，再释放身份连接和卷锁。
    // 仍未完成的 IO 由原有提交日志恢复，不能无限阻止容器停机。
    const deadline = Date.now() + HTTP_POLICY.requestMs;
    while (this.active > 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    this.db.close();
    await this.executor.close();
  }
  private error(res: Response, error: unknown, requestId: string): void {
    if (res.headersSent || res.destroyed) return;
    const safe = publicError(error);
    if (safe.status === 429 || safe.status === 503)
      res.setHeader('Retry-After', '5');
    res.status(safe.status).json({
      error: {
        code: safe.code,
        message: ERROR_MESSAGES[safe.status],
        requestId,
        retryable: [429, 503, 507].includes(safe.status),
      },
    });
  }
  async handle(req: Request, res: Response): Promise<void> {
    const requestId = randomUUID();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const cancelled = new SharedArrayBuffer(4);
    const abort = new AbortController();
    const deadline = Date.now() + HTTP_POLICY.requestMs;
    let admitted = false;
    let writer: string | undefined;
    const cancel = () => {
      Atomics.store(new Int32Array(cancelled), 0, 1);
      abort.abort();
    };
    const timer = setTimeout(() => {
      cancel();
      if (!res.headersSent) res.setHeader('Connection', 'close');
      this.error(res, new ApiError(503, 'request-expired'), requestId);
    }, HTTP_POLICY.requestMs);
    const release = () => {
      clearTimeout(timer);
      cancel();
      if (admitted) {
        this.active--;
        admitted = false;
      }
    };
    res.once('close', release);
    res.once('finish', release);
    try {
      if (this.closing || !this.executor.isHealthy())
        throw new ApiError(503, 'unavailable');
      if (this.active >= 32) throw new ApiError(429, 'request-busy');
      this.active++;
      admitted = true;
      if (req.originalUrl.length > 8192)
        throw new ApiError(422, 'url-too-long');
      const raw = req.originalUrl.split('?')[0];
      // 路由仅解码一次；编码分隔符、双编码及非规范 UUID 永不进入文件路径。
      if (/%(?:2f|5c|25|00|2e)/i.test(raw))
        throw new ApiError(422, 'encoded-path');
      let path: string;
      try {
        path = decodeURIComponent(raw);
      } catch {
        throw new ApiError(422, 'invalid-path');
      }
      const url = new URL(req.originalUrl, this.config.origin);
      const method = req.method;
      this.security.checkOrigin(
        req,
        !['GET', 'HEAD'].includes(method),
        method === 'GET' && path === '/api/v1/auth/oidc/radish/callback',
      );
      if (
        (['GET', 'HEAD'].includes(method) || path === '/api/v1/auth/logout') &&
        (req.headers['transfer-encoding'] !== undefined ||
          Number(req.headers['content-length'] ?? 0) !== 0)
      )
        throw new ApiError(422, 'unexpected-body');
      const ready = this.auth.hasAdmin();
      if (method === 'GET' && path === '/api/v1/health/live') {
        res.json({ status: 'live' });
        return;
      }
      if (method === 'GET' && path === '/api/v1/health/ready') {
        if (!ready) throw new ApiError(503, 'not-ready');
        res.json({ status: 'ready' });
        return;
      }
      if (method === 'GET' && path === '/api/v1/capabilities') {
        res.json({
          protocolVersion: 1,
          ...this.deployment,
          loginMethods: this.authentication.loginMethods(),
          limits: PUBLIC_LIMITS,
          ready,
        });
        return;
      }
      if (method === 'GET' && path === '/api/v1/auth/csrf') {
        res.json({ csrfToken: this.security.issuePreauth(res) });
        return;
      }
      if (!ready) throw new ApiError(503, 'not-ready');
      const token = this.security.cookies(req).get(this.security.sessionName);
      if (await this.authentication.handle(path, url, req, res, abort.signal))
        return;
      if (!path.startsWith('/api/v1/articles'))
        throw new ApiError(404, 'not-found');
      const identity = this.auth.session(token);
      const parts = path.split('/');
      if (parts.slice(0, 4).join('/') !== '/api/v1/articles')
        throw new ApiError(404, 'not-found');
      if (!['GET', 'PUT', 'DELETE'].includes(method))
        throw new ApiError(404, 'not-found');
      if (method !== 'GET') {
        this.security.checkCsrf(req);
        if (
          this.writers.has(identity.userId) ||
          this.writers.size >= HTTP_POLICY.writes
        )
          throw new ApiError(429, 'commit-busy');
        this.writers.add(identity.userId);
        writer = identity.userId;
      }
      let operation: StorageOperation;
      if (method === 'GET' && parts.length === 4) {
        if (
          [...url.searchParams.keys()].some(
            (k) => !['limit', 'after'].includes(k),
          ) ||
          url.searchParams.getAll('limit').length > 1 ||
          url.searchParams.getAll('after').length > 1
        )
          throw new ApiError(422, 'invalid-pagination');
        const limitText = url.searchParams.get('limit');
        if (limitText !== null && !/^[1-9]\d{0,2}$/.test(limitText))
          throw new ApiError(422, 'invalid-pagination');
        operation = {
          kind: 'list',
          limit: limitText === null ? 50 : Number(limitText),
          after: url.searchParams.get('after') ?? undefined,
        };
      } else {
        const articleId = parts[4];
        assertUuid(articleId);
        if (method === 'GET' && parts.length === 5 && !url.search)
          operation = { kind: 'read', articleId };
        else if (
          method === 'GET' &&
          parts.length === 7 &&
          parts[5] === 'assets'
        ) {
          const revision = url.searchParams.get('revision');
          if (
            url.searchParams.size !== 1 ||
            revision === null ||
            !/^(0|[1-9]\d*)$/.test(revision)
          )
            throw new ApiError(422, 'revision-required');
          assertRevision(Number(revision));
          operation = {
            kind: 'asset',
            articleId,
            path: 'asset/' + parts[6],
            revision: Number(revision),
          };
        } else if (method === 'PUT' && parts.length === 5 && !url.search)
          operation = {
            kind: 'save',
            input: await readArticle(req, articleId, abort.signal),
          };
        else if (method === 'DELETE' && parts.length === 5 && !url.search) {
          const body = await readJson(req, abort.signal);
          exactKeys(body, ['operationId', 'expectedRevision']);
          if (
            typeof body.operationId !== 'string' ||
            typeof body.expectedRevision !== 'number'
          )
            throw new ApiError(422, 'invalid-delete');
          assertUuid(body.operationId);
          assertRevision(body.expectedRevision);
          operation = {
            kind: 'delete',
            articleId,
            operationId: body.operationId,
            revision: body.expectedRevision,
          };
        } else throw new ApiError(404, 'not-found');
      }
      const result = await this.executor.run(
        identity.userId,
        tokenDigest(token),
        operation,
        deadline,
        cancelled,
      );
      this.auth.session(token); // 排队、解码或文件读取期间撤销，响应不泄露私有内容。
      if (abort.signal.aborted || res.headersSent) return;
      if ('bytes' in result) {
        res.type(result.mime).send(Buffer.from(result.bytes));
      } else if ('receipt' in result)
        res.status(result.created ? 201 : 200).json(result.receipt);
      else res.json(result);
    } catch (error) {
      if (!req.complete && !res.headersSent) {
        res.setHeader('Connection', 'close');
        res.once('finish', () => req.destroy());
      }
      this.error(res, error, requestId);
    } finally {
      if (writer) this.writers.delete(writer);
    }
  }
}
