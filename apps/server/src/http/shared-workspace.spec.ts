import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { SHARED_OWNER, StorageDatabase } from '../storage/storage-database';
import { backupStorage, restoreStorage } from '../storage/storage-backup';
import { serverConfig } from './server-policy';
type Payload = {
  deploymentId: string;
  workspaceEpoch: string;
  csrfToken: string;
  user: { userId: string; role: string };
  markdown: string;
  error: { code: string };
};
const json = async (response: Response): Promise<Payload> =>
  (await response.json()) as Payload;
const { createApplication } = createRequire(__filename)(
  '../../dist/http/create-application',
) as typeof import('./create-application');

it('真实 shared HTTP 共用文章，拒绝跨站、缺失 CSRF、旧 epoch；恢复后旧页面无法写入', async () => {
  const root = mkdtempSync(join(tmpdir(), 'radishink-shared-http-'));
  let directory = join(root, 'source');
  const database = new StorageDatabase({
    directory,
    mode: 'shared',
    initialize: true,
  });
  database.close();
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  let origin: string;
  const start = async () => {
    const config = serverConfig({
      RADISHINK_ACCOUNT_MODE: 'shared',
      RADISHINK_ORIGIN: 'http://127.0.0.1:4000',
      RADISHINK_DATA_DIR: directory,
    });
    app = await createApplication(config);
    await app.listen(0, '127.0.0.1');
    config.origin =
      origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  };
  const call = (path: string, init: RequestInit = {}) =>
    fetch(origin + '/api/v1' + path, init);
  const id = randomUUID();
  const form = (revision: number | null) => {
    const result = new FormData();
    result.append(
      'manifest',
      JSON.stringify({
        operationId: randomUUID(),
        expectedRevision: revision,
        metadata: {
          id,
          title: '共享合成文章',
          savedAt: '2026-10-29T00:00:00.000Z',
          theme: '',
          themeName: '',
          customCSS: '',
        },
        assets: [],
      }),
    );
    result.append('markdown', new Blob(['共享原文']), 'index.md');
    return result;
  };
  try {
    await start();
    const cap = await json(await call('/capabilities'));
    expect(cap).toMatchObject({
      accountMode: 'shared',
      loginMethods: [],
      ready: true,
    });
    for (const path of [
      '/auth/csrf',
      '/auth/login',
      '/auth/logout',
      '/auth/oidc/radish/start',
    ])
      expect((await call(path)).status).toBe(404);
    const session = await call('/auth/session');
    const browser = await json(session);
    expect(browser.user).toMatchObject({
      userId: SHARED_OWNER,
      role: 'shared',
    });
    const headers = {
      Origin: origin!,
      Cookie: session.headers.getSetCookie()[0].split(';')[0],
      'X-CSRF-Token': browser.csrfToken,
      'X-RadishInk-Workspace': `${cap.deploymentId}/${cap.workspaceEpoch}`,
    };
    const again = await call('/auth/session', { headers });
    expect((await json(again)).csrfToken).toBe(browser.csrfToken);
    expect((await call('/articles')).status).toBe(409);
    expect(
      (
        await call('/articles/' + id, {
          method: 'PUT',
          headers: { ...headers, Origin: 'https://other.invalid' },
          body: form(null),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('/articles/' + id, {
          method: 'PUT',
          headers: { ...headers, 'X-CSRF-Token': 'forged' },
          body: form(null),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('/articles/' + id, {
          method: 'PUT',
          headers,
          body: form(null),
        })
      ).status,
    ).toBe(201);
    // 第二位访问者无需第一位的 cookie；读取相同固定工作区。
    const visitor = {
      'X-RadishInk-Workspace': headers['X-RadishInk-Workspace'],
    };
    expect(
      (await json(await call('/articles/' + id, { headers: visitor })))
        .markdown,
    ).toBe('共享原文');
    expect(
      (
        await call('/articles/' + id, {
          method: 'PUT',
          headers,
          body: form(null),
        })
      ).status,
    ).toBe(409);
    await app!.close();
    app = undefined;
    backupStorage(directory, join(root, 'backup'), 'shared');
    directory = join(root, 'restored');
    restoreStorage(directory, join(root, 'backup'), 'shared');
    await start();
    const stale = await call('/articles/' + id, {
      method: 'PUT',
      headers: { ...headers, Origin: origin! },
      body: form(0),
    });
    expect(stale.status).toBe(409);
    expect((await json(stale)).error.code).toBe('workspace-changed');
    const refreshed = await call('/auth/session');
    const next = await json(refreshed);
    const renewedHeaders = {
      ...headers,
      Origin: origin!,
      'X-RadishInk-Workspace': `${next.deploymentId}/${next.workspaceEpoch}`,
    };
    expect(
      (
        await call('/articles/' + id, {
          method: 'PUT',
          headers: renewedHeaders,
          body: form(0),
        })
      ).status,
    ).toBe(401);
    renewedHeaders.Cookie = refreshed.headers.getSetCookie()[0].split(';')[0];
    renewedHeaders['X-CSRF-Token'] = next.csrfToken;
    expect(
      (
        await call('/articles/' + id, {
          method: 'PUT',
          headers: renewedHeaders,
          body: form(0),
        })
      ).status,
    ).toBe(200);
  } finally {
    await app?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
