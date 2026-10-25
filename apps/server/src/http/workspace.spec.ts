import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { StorageDatabase } from '../storage/storage-database';
import { manageAccount, AUTH_POLICY } from '../auth/local-auth';
import { sha256 } from '../storage/storage-contract';
import type { ServerConfig } from './server-policy';
import type { WorkspaceRuntime } from './workspace-runtime';

// 所有 HTTP 用例运行构建产物及其真实 worker，不能退回主线程内存替身。
const requireBuilt = createRequire(__filename);
const { createApplication } = requireBuilt(
  '../../dist/http/create-application',
) as typeof import('./create-application');
const { WorkspaceRuntime: Runtime } = requireBuilt(
  '../../dist/http/workspace-runtime',
) as {
  WorkspaceRuntime: typeof WorkspaceRuntime;
};
type Login = { cookie: string; csrf: string; userId: string };
type Json = { [key: string]: unknown };
const password = 'synthetic-password-2026';

function snapshot(
  id: string,
  revision: number | null = null,
  assets: {
    path: string;
    bytes?: Buffer;
    sha256?: string;
    size?: number;
  }[] = [],
  operationId = randomUUID(),
  markdown = '\ufeff---\r\nunknown: 保留\r\n---\r\n正文',
) {
  const form = new FormData();
  const descriptors = assets.map((asset, i) => ({
    path: asset.path,
    sha256: asset.sha256 ?? sha256(asset.bytes!),
    size: asset.size ?? asset.bytes!.length,
    ...(asset.bytes ? { partId: 'image' + i } : {}),
  }));
  form.append(
    'manifest',
    JSON.stringify({
      operationId,
      expectedRevision: revision,
      metadata: {
        id,
        title: '合成文章',
        savedAt: '2026-10-25T00:00:00.000Z',
        theme: 'default',
        themeName: '默认',
        customCSS: '',
        unknown: { ownerId: 'not-authority' },
      },
      assets: descriptors,
    }),
  );
  form.append('markdown', new Blob([markdown]), 'index.md');
  assets.forEach((asset, i) => {
    if (asset.bytes)
      form.append(
        'image' + i,
        new Blob([new Uint8Array(asset.bytes)]),
        'untrusted.svg',
      );
  });
  return form;
}

describe('P3-2 loopback HTTP / 实际 SQLite 与 worker', () => {
  let root: string;
  let directory: string;
  let app: Awaited<ReturnType<typeof createApplication>>;
  let config: ServerConfig;
  let runtime: WorkspaceRuntime;
  let origin: string;
  let alice: Login;
  let bob: Login;
  let png: Buffer;
  async function start() {
    config = {
      directory,
      origin: 'http://127.0.0.1:4000',
      port: 4000,
      secure: false,
    };
    app = await createApplication(config);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    config.origin = origin = `http://127.0.0.1:${address.port}`;
    config.port = address.port;
    runtime = app.get(Runtime);
  }
  async function call(path: string, options: RequestInit = {}, login?: Login) {
    const headers = new Headers(options.headers);
    headers.set('Origin', origin);
    if (login) {
      headers.set('Cookie', login.cookie);
      headers.set('X-CSRF-Token', login.csrf);
    }
    return fetch(origin + '/api/v1' + path, { ...options, headers });
  }
  async function preauth() {
    const res = await call('/auth/csrf');
    const body = (await res.json()) as Json;
    return {
      cookie: res.headers.getSetCookie()[0].split(';')[0],
      csrf: body.csrfToken as string,
      userId: '',
    };
  }
  async function login(name: string, secret = password, browser?: Login) {
    const pre = await preauth();
    if (browser) pre.cookie += '; ' + browser.cookie;
    return call(
      '/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, password: secret }),
      },
      pre,
    );
  }
  async function signIn(name: string): Promise<Login> {
    const res = await login(name);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      csrfToken: string;
      user: { userId: string };
    };
    return {
      cookie: res.headers.getSetCookie()[0].split(';')[0],
      csrf: body.csrfToken,
      userId: body.user.userId,
    };
  }
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'radishink-http-'));
    directory = join(root, 'data');
    const db = new StorageDatabase({
      directory,
      mode: 'accounts',
      initialize: true,
    });
    try {
      await manageAccount(db.connection, 'init-admin', 'alice', password);
      await manageAccount(db.connection, 'create-user', 'bob', password);
    } finally {
      db.close();
    }
    await start();
    alice = await signIn('alice');
    bob = await signIn('bob');
    png = await sharp({
      create: { width: 3, height: 2, channels: 4, background: '#123456' },
    })
      .png()
      .toBuffer();
  });
  afterEach(async () => {
    await app?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('能力、ready、私有响应头和旧匿名入口撤下', async () => {
    const cap = await call('/capabilities');
    expect(cap.status).toBe(200);
    const body = (await cap.json()) as Json;
    expect(body.protocolVersion).toBe(1);
    expect(body.ready).toBe(true);
    expect(body.loginMethods).toEqual(['password']);
    expect(cap.headers.get('cache-control')).toBe('no-store');
    expect(cap.headers.get('access-control-allow-origin')).toBeNull();
    expect((await call('/health/ready')).status).toBe(200);
    expect((await call('/articles')).status).toBe(401);
    for (const path of [
      '/api/upload',
      '/uploads/1764295973999-462963510.jpg',
    ]) {
      const res = await fetch(origin + path, { headers: { Origin: origin } });
      expect(res.status).toBe(404);
    }
  });
  it('创建、精确正文、资源真实 MIME、无字节复用、重试、冲突与墓碑', async () => {
    const id = randomUUID();
    const op = randomUUID();
    const asset = { path: 'asset/test.png', bytes: png };
    expect(
      (
        await call(
          '/articles/' + id,
          { method: 'PUT', body: snapshot(id, null, [asset], op) },
          alice,
        )
      ).status,
    ).toBe(201);
    const retry = await call(
      '/articles/' + id,
      { method: 'PUT', body: snapshot(id, null, [asset], op) },
      alice,
    );
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as Json).committedRevision).toBe(0);
    const read = await call('/articles/' + id, {}, alice);
    const saved = (await read.json()) as Json;
    expect(saved.markdown).toBe('\ufeff---\r\nunknown: 保留\r\n---\r\n正文');
    expect((saved.metadata as { unknown: unknown }).unknown).toEqual({
      ownerId: 'not-authority',
    });
    const image = await call(
      `/articles/${id}/assets/test.png?revision=0`,
      {},
      alice,
    );
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(image.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
    const reference = {
      path: asset.path,
      sha256: sha256(png),
      size: png.length,
    };
    expect(
      (
        await call(
          '/articles/' + id,
          { method: 'PUT', body: snapshot(id, 0, [reference]) },
          alice,
        )
      ).status,
    ).toBe(200);
    expect(
      (await call(`/articles/${id}/assets/test.png?revision=0`, {}, alice))
        .status,
    ).toBe(409);
    expect(
      (
        await call(
          '/articles/' + id,
          { method: 'PUT', body: snapshot(id, 0, [reference]) },
          alice,
        )
      ).status,
    ).toBe(409);
    const mismatch = await call(
      '/articles/' + id,
      { method: 'PUT', body: snapshot(id, null, [asset], op, 'changed') },
      alice,
    );
    expect(mismatch.status).toBe(409);
    expect(
      (
        await call(
          '/articles/' + id,
          { method: 'PUT', body: snapshot(id, 1, []) },
          alice,
        )
      ).status,
    ).toBe(422);
    const del = {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationId: randomUUID(), expectedRevision: 1 }),
    };
    expect((await call('/articles/' + id, del, alice)).status).toBe(200);
    expect((await call('/articles/' + id, del, alice)).status).toBe(200);
    expect((await call('/articles/' + id, {}, alice)).status).toBe(404);
    expect(
      (await call(`/articles/${id}/assets/test.png?revision=1`, {}, alice))
        .status,
    ).toBe(404);
    expect(
      (
        await call(
          '/articles/' + id,
          { method: 'PUT', body: snapshot(id, null, [asset], op) },
          alice,
        )
      ).status,
    ).toBe(404);
  });
  it('两用户隔离覆盖列表、正文、图片、更新、创建碰撞、删除、回执与摘要猜测；管理员无例外', async () => {
    const id = randomUUID();
    const op = randomUUID();
    expect(
      (
        await call(
          '/articles/' + id,
          {
            method: 'PUT',
            body: snapshot(id, null, [{ path: 'asset/a.png', bytes: png }], op),
          },
          bob,
        )
      ).status,
    ).toBe(201);
    expect(await (await call('/articles', {}, alice)).json()).toEqual([]);
    for (const path of [
      `/articles/${id}`,
      `/articles/${id}/assets/a.png?revision=0`,
      `/articles/${id}/export`,
    ])
      expect((await call(path, {}, alice)).status).toBe(404);
    for (const revision of [null, 0])
      expect(
        (
          await call(
            '/articles/' + id,
            {
              method: 'PUT',
              body: snapshot(
                id,
                revision,
                [{ path: 'asset/a.png', bytes: png }],
                op,
              ),
            },
            alice,
          )
        ).status,
      ).toBe(404);
    expect(
      (
        await call(
          '/articles/' + id,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operationId: op, expectedRevision: 0 }),
          },
          alice,
        )
      ).status,
    ).toBe(404);
    const guessed = randomUUID();
    expect(
      (
        await call(
          '/articles/' + guessed,
          {
            method: 'PUT',
            body: snapshot(guessed, null, [
              { path: 'asset/a.png', sha256: sha256(png), size: png.length },
            ]),
          },
          alice,
        )
      ).status,
    ).toBe(422);
  });
  it('所有写入拒绝缺失来源、伪造转发来源、CSRF 与重复 Cookie', async () => {
    const pre = await preauth();
    const res = await fetch(origin + '/api/v1/auth/login', {
      method: 'POST',
      headers: {
        Cookie: pre.cookie,
        'X-CSRF-Token': pre.csrf,
        'Content-Type': 'application/json',
        'X-Forwarded-Host': new URL(origin).host,
      },
      body: '{}',
    });
    expect(res.status).toBe(403);
    const evil = await fetch(origin + '/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.test',
        Cookie: alice.cookie,
        'X-CSRF-Token': alice.csrf,
      },
    });
    expect(evil.status).toBe(403);
    expect(
      (
        await call(
          '/auth/logout',
          { method: 'POST' },
          { ...alice, csrf: 'bad' },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          '/auth/session',
          {},
          { ...alice, cookie: alice.cookie + '; ' + alice.cookie },
        )
      ).status,
    ).toBe(403);
    const invalidHost = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        origin + '/api/v1/auth/csrf',
        { headers: { Host: 'evil.test' } },
        (res) => {
          res.resume();
          res.once('end', () => resolve(res.statusCode!));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(invalidHost).toBe(403);
    expect((await call('/auth/session', {}, alice)).status).toBe(200);
  });
  it('登录轮换、退出幂等、空闲与绝对过期', async () => {
    const next = await login('alice', password, alice);
    expect(next.status).toBe(200);
    expect((await call('/auth/session', {}, alice)).status).toBe(401);
    const current: Login = {
      cookie: next.headers.getSetCookie()[0].split(';')[0],
      csrf: ((await next.json()) as { csrfToken: string }).csrfToken,
      userId: alice.userId,
    };
    expect(next.headers.getSetCookie()[0]).toContain('HttpOnly');
    expect(next.headers.getSetCookie()[0]).toContain('SameSite=Lax');
    expect(
      (await call('/auth/logout', { method: 'POST' }, current)).status,
    ).toBe(204);
    expect(
      (await call('/auth/logout', { method: 'POST' }, current)).status,
    ).toBe(204);
    expect((await call('/auth/session', {}, current)).status).toBe(401);
    runtime.auth.db
      .prepare('UPDATE sessions SET last_seen=? WHERE user_id=?')
      .run(Date.now() - AUTH_POLICY.idleMs - 100, bob.userId);
    expect((await call('/auth/session', {}, bob)).status).toBe(401);
    const fresh = await signIn('bob');
    runtime.auth.db
      .prepare('UPDATE sessions SET expires_at=? WHERE user_id=?')
      .run(Date.now() - 1, bob.userId);
    expect((await call('/auth/session', {}, fresh)).status).toBe(401);
  });
  it('重置与禁用撤销会话；恢复保留 user ID 和文章', async () => {
    const id = randomUUID();
    await call('/articles/' + id, { method: 'PUT', body: snapshot(id) }, bob);
    await app.close();
    const db = new StorageDatabase({ directory, mode: 'accounts' });
    try {
      const reset = await manageAccount(
        db.connection,
        'reset-password',
        'bob',
        password + '-new',
      );
      expect(reset.userId).toBe(bob.userId);
    } finally {
      db.close();
    }
    await start();
    expect((await call('/auth/session', {}, bob)).status).toBe(401);
    expect((await login('bob')).status).toBe(401);
    const success = await login('bob', password + '-new');
    expect(success.status).toBe(200);
    const body = (await success.json()) as { csrfToken: string };
    const restored = {
      cookie: success.headers.getSetCookie()[0].split(';')[0],
      csrf: body.csrfToken,
      userId: bob.userId,
    };
    expect((await call('/articles/' + id, {}, restored)).status).toBe(200);
    await manageAccount(runtime.auth.db, 'disable', 'bob');
    expect((await call('/articles/' + id, {}, restored)).status).toBe(401);
  });
  it('失败限速跨重启保留，未知账号与错密码同响应；不信 X-Forwarded-For', async () => {
    const unknown = await login('nobody', 'wrong');
    const wrong = await login('alice', 'wrong');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    const u = (await unknown.json()) as Json;
    const w = (await wrong.json()) as Json;
    delete (u.error as { requestId?: string }).requestId;
    delete (w.error as { requestId?: string }).requestId;
    expect(u).toEqual(w);
    for (let i = 0; i < 4; i++)
      expect((await login('alice', 'wrong')).status).toBe(401);
    await app.close();
    await start();
    expect((await login('alice')).status).toBe(429);
    runtime.auth.db.prepare('DELETE FROM login_limits').run();
    for (let i = 0; i < 30; i++) {
      const pre = await preauth();
      const res = await call(
        '/auth/login',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': `192.0.2.${i}`,
          },
          body: JSON.stringify({ username: 'missing' + i, password: 'bad' }),
        },
        pre,
      );
      expect(res.status).toBe(401);
    }
    expect((await login('bob')).status).toBe(429);
  });
  it.each(['fake', 'truncated', 'extension', 'oversized'])(
    '拒绝图片 %s 且不发布文章',
    async (kind) => {
      const id = randomUUID();
      let bytes = png;
      let path = 'asset/a.png';
      if (kind === 'fake') bytes = Buffer.from('<svg onload="alert(1)"/>');
      if (kind === 'truncated') bytes = png.subarray(0, png.length - 4);
      if (kind === 'extension') path = 'asset/a.jpg';
      if (kind === 'oversized')
        bytes = await sharp({
          create: {
            width: 4001,
            height: 4000,
            channels: 3,
            background: 'white',
          },
        })
          .png()
          .toBuffer();
      expect(
        (
          await call(
            '/articles/' + id,
            { method: 'PUT', body: snapshot(id, null, [{ path, bytes }]) },
            alice,
          )
        ).status,
      ).toBe(422);
      expect((await call('/articles/' + id, {}, alice)).status).toBe(404);
    },
  );
  it.each(['jpeg', 'webp', 'gif'] as const)(
    '完整解码 %s 并保持原字节',
    async (format) => {
      const bytes = await sharp(png).toFormat(format).toBuffer();
      const id = randomUUID();
      const path = `asset/a.${format}`;
      expect(
        (
          await call(
            '/articles/' + id,
            { method: 'PUT', body: snapshot(id, null, [{ path, bytes }]) },
            alice,
          )
        ).status,
      ).toBe(201);
      expect(
        Buffer.from(
          await (
            await call(
              `/articles/${id}/assets/a.${format}?revision=0`,
              {},
              alice,
            )
          ).arrayBuffer(),
        ),
      ).toEqual(bytes);
    },
  );
  it('路径编码、分页、额外 ownerId、非法 UTF-8、缺 part 与请求尺寸失败', async () => {
    const id = randomUUID();
    for (const path of [
      '/articles?limit=101',
      '/articles?limit=0',
      '/articles?limit=1&limit=2',
      `/articles/${id}/assets/a%2fb.png?revision=0`,
      `/articles/${id}/assets/%252e.png?revision=0`,
    ])
      expect((await call(path, {}, alice)).status).toBe(422);
    const form = snapshot(id);
    const manifest = JSON.parse(form.get('manifest') as string) as Json;
    manifest.ownerId = bob.userId;
    form.set('manifest', JSON.stringify(manifest));
    expect(
      (await call('/articles/' + id, { method: 'PUT', body: form }, alice))
        .status,
    ).toBe(422);
    const utf = snapshot(id);
    utf.set('markdown', new Blob([new Uint8Array([0xff, 0xfe])]), 'index.md');
    expect(
      (await call('/articles/' + id, { method: 'PUT', body: utf }, alice))
        .status,
    ).toBe(422);
    const missing = snapshot(id, null, [{ path: 'asset/a.png', bytes: png }]);
    missing.delete('image0');
    expect(
      (await call('/articles/' + id, { method: 'PUT', body: missing }, alice))
        .status,
    ).toBe(422);
    const large = snapshot(
      id,
      null,
      [],
      randomUUID(),
      'x'.repeat(5 * 1024 * 1024 + 1),
    );
    expect(
      (await call('/articles/' + id, { method: 'PUT', body: large }, alice))
        .status,
    ).toBe(413);
  });
  it('上传中退出和每用户单提交限制；健康接口可同时响应', async () => {
    const id = randomUUID();
    const body = snapshot(id);
    const encoded = new Request(origin, { method: 'PUT', body });
    const bytes = Buffer.from(await encoded.arrayBuffer());
    let finish!: () => void;
    const response = new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        origin + '/api/v1/articles/' + id,
        {
          method: 'PUT',
          headers: {
            Origin: origin,
            Cookie: alice.cookie,
            'X-CSRF-Token': alice.csrf,
            'Content-Type': encoded.headers.get('content-type')!,
            'Content-Length': bytes.length,
          },
        },
        (res) => {
          res.resume();
          res.once('end', () => resolve(res.statusCode!));
        },
      );
      req.on('error', reject);
      req.write(bytes.subarray(0, bytes.length - 10));
      finish = () => req.end(bytes.subarray(bytes.length - 10));
    });
    // 让真实 socket 的首批数据进入服务端，再在同一用户发起第二次提交。
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(
      (
        await call(
          '/articles/' + randomUUID(),
          { method: 'PUT', body: snapshot(randomUUID()) },
          alice,
        )
      ).status,
    ).toBe(429);
    expect((await call('/health/live')).status).toBe(200);
    expect((await call('/auth/logout', { method: 'POST' }, alice)).status).toBe(
      204,
    );
    finish();
    expect(await response).toBe(401);
    const current = await signIn('alice');
    expect((await call('/articles/' + id, {}, current)).status).toBe(404);
  });
  it('损坏压缩数据和动画累计像素超限均拒绝', async () => {
    const id = randomUUID();
    const broken = Buffer.from(png);
    const idat = broken.indexOf(Buffer.from('IDAT'));
    broken[idat + 5] ^= 255;
    expect(
      (
        await call(
          '/articles/' + id,
          {
            method: 'PUT',
            body: snapshot(id, null, [{ path: 'asset/a.png', bytes: broken }]),
          },
          alice,
        )
      ).status,
    ).toBe(422);
    const frames = Buffer.alloc(2000 * 10000 * 3);
    for (let i = 0; i < 5; i++)
      frames.fill(i * 40, i * 2000 * 2000 * 3, (i + 1) * 2000 * 2000 * 3);
    const animated = await sharp(frames, {
      raw: { width: 2000, height: 10000, channels: 3, pageHeight: 2000 },
    })
      .gif()
      .toBuffer();
    expect(
      (
        await call(
          '/articles/' + id,
          {
            method: 'PUT',
            body: snapshot(id, null, [
              { path: 'asset/a.gif', bytes: animated },
            ]),
          },
          alice,
        )
      ).status,
    ).toBe(422);
  });
  it('无 Content-Length 的 chunked 请求也执行正文逐字节上限', async () => {
    const id = randomUUID();
    const encoded = new Request(origin, {
      method: 'PUT',
      body: snapshot(
        id,
        null,
        [],
        randomUUID(),
        'x'.repeat(5 * 1024 * 1024 + 1),
      ),
    });
    const bytes = Buffer.from(await encoded.arrayBuffer());
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        origin + '/api/v1/articles/' + id,
        {
          method: 'PUT',
          headers: {
            Origin: origin,
            Cookie: alice.cookie,
            'X-CSRF-Token': alice.csrf,
            'Content-Type': encoded.headers.get('content-type')!,
          },
        },
        (res) => {
          res.resume();
          res.once('end', () => resolve(res.statusCode!));
        },
      );
      req.on('error', reject);
      req.write(bytes.subarray(0, 1024));
      req.end(bytes.subarray(1024));
    });
    expect(status).toBe(413);
    expect((await call('/articles/' + id, {}, alice)).status).toBe(404);
  });
  it('第五个在途写入及第九个存储任务被拒绝，不建立无限队列', async () => {
    const users = [alice, bob];
    for (const name of ['carol', 'dave', 'ellen']) {
      await manageAccount(runtime.auth.db, 'create-user', name, password);
      users.push(await signIn(name));
    }
    const finishes: (() => void)[] = [];
    const responses: Promise<number>[] = [];
    for (const user of users.slice(0, 4)) {
      const id = randomUUID();
      const encoded = new Request(origin, {
        method: 'PUT',
        body: snapshot(id),
      });
      const bytes = Buffer.from(await encoded.arrayBuffer());
      responses.push(
        new Promise<number>((resolve, reject) => {
          const req = httpRequest(
            origin + '/api/v1/articles/' + id,
            {
              method: 'PUT',
              headers: {
                Origin: origin,
                Cookie: user.cookie,
                'X-CSRF-Token': user.csrf,
                'Content-Type': encoded.headers.get('content-type')!,
                'Content-Length': bytes.length,
              },
            },
            (res) => {
              res.resume();
              res.once('end', () => resolve(res.statusCode!));
            },
          );
          req.on('error', reject);
          req.write(bytes.subarray(0, bytes.length - 10));
          finishes.push(() => req.end(bytes.subarray(bytes.length - 10)));
        }),
      );
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const fifth = randomUUID();
      expect(
        (
          await call(
            '/articles/' + fifth,
            { method: 'PUT', body: snapshot(fifth) },
            users[4],
          )
        ).status,
      ).toBe(429);
    } finally {
      for (const finish of finishes) finish();
    }
    expect(await Promise.all(responses)).toEqual([201, 201, 201, 201]);
    const digest = sha256(alice.cookie.split('=')[1]);
    const jobs = Array.from({ length: 8 }, () =>
      runtime.executor.run(
        alice.userId,
        digest,
        { kind: 'list', limit: 50 },
        Date.now() + 60000,
        new SharedArrayBuffer(4),
      ),
    );
    await expect(
      runtime.executor.run(
        alice.userId,
        digest,
        { kind: 'list', limit: 50 },
        Date.now() + 60000,
        new SharedArrayBuffer(4),
      ),
    ).rejects.toMatchObject({ status: 429, code: 'storage-busy' });
    await Promise.all(jobs);
    await expect(
      runtime.executor.run(
        alice.userId,
        digest,
        { kind: 'list', limit: 50 },
        Date.now() - 1,
        new SharedArrayBuffer(4),
      ),
    ).rejects.toMatchObject({ status: 503, code: 'request-expired' });
  });
  it('multipart 接受恰好 125 张资源和恰好 10 MiB 图片，越界仍拒绝', async () => {
    const id = randomUUID();
    const fullAssets = Array.from({ length: 125 }, (_, i) => ({
      path: `asset/${i}.png`,
      bytes: png,
    }));
    expect(
      (
        await call(
          '/articles/' + id,
          { method: 'PUT', body: snapshot(id, null, fullAssets) },
          alice,
        )
      ).status,
    ).toBe(201);
    const tooMany = randomUUID();
    expect(
      (
        await call(
          '/articles/' + tooMany,
          {
            method: 'PUT',
            body: snapshot(tooMany, null, [
              ...fullAssets,
              { path: 'asset/extra.png', bytes: png },
            ]),
          },
          alice,
        )
      ).status,
    ).toBe(413);
    const jpeg = await sharp(png).jpeg().toBuffer();
    const segments: Buffer[] = [];
    let remaining = 10 * 1024 * 1024 - jpeg.length;
    while (remaining > 0) {
      const size =
        remaining <= 65537 ? remaining : Math.min(65537, remaining - 4);
      const segment = Buffer.alloc(size);
      segment[0] = 255;
      segment[1] = 239;
      segment.writeUInt16BE(size - 2, 2);
      segments.push(segment);
      remaining -= size;
    }
    const image = Buffer.concat([
      jpeg.subarray(0, 2),
      ...segments,
      jpeg.subarray(2),
    ]);
    expect(image.length).toBe(10 * 1024 * 1024);
    const large = randomUUID();
    expect(
      (
        await call(
          '/articles/' + large,
          {
            method: 'PUT',
            body: snapshot(large, null, [
              { path: 'asset/full.jpg', bytes: image },
            ]),
          },
          alice,
        )
      ).status,
    ).toBe(201);
    const oversized = randomUUID();
    expect(
      (
        await call(
          '/articles/' + oversized,
          {
            method: 'PUT',
            body: snapshot(oversized, null, [
              {
                path: 'asset/too-large.jpg',
                bytes: Buffer.concat([image, Buffer.from([0])]),
              },
            ]),
          },
          alice,
        )
      ).status,
    ).toBe(413);
  });
  it('无正文接口拒绝附带请求体，不能绕过请求体限制', async () => {
    expect(
      (
        await call(
          '/auth/logout',
          { method: 'POST', body: 'unexpected' },
          alice,
        )
      ).status,
    ).toBe(422);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        origin + '/api/v1/capabilities',
        {
          method: 'GET',
          headers: { Origin: origin, 'Transfer-Encoding': 'chunked' },
        },
        (res) => {
          res.resume();
          res.once('end', () => resolve(res.statusCode!));
        },
      );
      req.on('error', reject);
      req.end('unexpected');
    });
    expect(status).toBe(422);
    expect((await call('/auth/session', {}, alice)).status).toBe(200);
  });
  it('worker 失效时服务明确失败，不返回空列表', async () => {
    await runtime.executor.close();
    const res = await call('/articles', {}, alice);
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      error: {
        code: string;
        message: string;
        requestId: string;
        retryable: boolean;
      };
    };
    expect(body.error).toMatchObject({ code: 'unavailable', retryable: true });
    expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toContain(directory);
  });
  it('缺失管理员时 capabilities not-ready 且文章关闭', async () => {
    runtime.auth.db
      .prepare('UPDATE users SET enabled=0 WHERE id=?')
      .run(alice.userId);
    expect((await call('/health/ready')).status).toBe(503);
    expect(((await (await call('/capabilities')).json()) as Json).ready).toBe(
      false,
    );
    expect((await call('/articles', {}, bob)).status).toBe(503);
  });
});
