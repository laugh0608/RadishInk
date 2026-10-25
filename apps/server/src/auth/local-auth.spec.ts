import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import * as argon2 from 'argon2';
import { StorageDatabase } from '../storage/storage-database';
import { ArticleRepository } from '../storage/article-repository';
import {
  LocalAuth,
  manageAccount,
  assertSession,
  ARGON_OPTIONS,
} from './local-auth';
import { ApiError } from '../http/api-error';
import { sha256 } from '../storage/storage-contract';
import { serverConfig } from '../http/server-policy';
import { BrowserSecurity } from '../http/browser-security';
import type { Response } from 'express';

const password = 'synthetic-auth-password';
let root: string;
let db: StorageDatabase;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'radishink-auth-'));
  db = new StorageDatabase({
    directory: join(root, 'data'),
    mode: 'accounts',
    initialize: true,
  });
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

it('Argon2id 固定最低参数、独立盐、用户名规范化与重复管理员拒绝', async () => {
  await manageAccount(db.connection, 'init-admin', 'Alice', password);
  await manageAccount(db.connection, 'create-user', 'bob', password);
  const rows = db.connection
    .prepare<
      [],
      { username: string; password_hash: string }
    >('SELECT a.username,p.password_hash FROM account_profiles a JOIN password_credentials p ON p.user_id=a.user_id ORDER BY username')
    .all();
  expect(rows[0].username).toBe('alice');
  expect(rows[0].password_hash.split('$').slice(1, 3)).toEqual([
    'argon2id',
    'v=19',
  ]);
  expect(rows[0].password_hash.split('$')[3].split(',').sort()).toEqual([
    'm=19456',
    'p=1',
    't=2',
  ]);
  expect(rows[0].password_hash).not.toBe(rows[1].password_hash);
  expect(await argon2.verify(rows[0].password_hash, password)).toBe(true);
  await expect(
    manageAccount(db.connection, 'init-admin', 'other', password),
  ).rejects.toMatchObject({ code: 'admin-exists' });
  await expect(
    manageAccount(db.connection, 'create-user', 'tiny', 'short'),
  ).rejects.toMatchObject({ code: 'invalid-password' });
});
it('Argon2 槽位只接受两个在途请求，无等待队列', async () => {
  await manageAccount(db.connection, 'init-admin', 'alice', password);
  const auth = new LocalAuth(db.connection);
  await auth.initialize();
  const attempts = [
    auth.login('alice', password, 'source'),
    auth.login('alice', password, 'source'),
  ];
  await expect(auth.login('alice', password, 'source')).rejects.toMatchObject({
    status: 429,
    code: 'password-busy',
  });
  await Promise.all(attempts);
});
it('口令校验期间重置不会建立使用旧口令的会话', async () => {
  await manageAccount(db.connection, 'init-admin', 'alice', password);
  const auth = new LocalAuth(db.connection);
  await auth.initialize();
  const replacement = await argon2.hash('replacement-password', ARGON_OPTIONS);
  const pending = auth.login('alice', password, 'source');
  db.connection
    .prepare('UPDATE password_credentials SET password_hash=?')
    .run(replacement);
  await expect(pending).rejects.toMatchObject({ status: 401 });
  expect(db.connection.prepare('SELECT * FROM sessions').all()).toHaveLength(0);
});
it('会话只存摘要，重启保留有效会话，启停与重置均撤销', async () => {
  await manageAccount(db.connection, 'init-admin', 'alice', password);
  const auth = new LocalAuth(db.connection);
  await auth.initialize();
  const login = await auth.login('alice', password, 'source');
  const session = db.connection
    .prepare<[], { digest: string }>('SELECT digest FROM sessions')
    .get()!;
  expect(session.digest).toBe(sha256(login.token));
  expect(session.digest).not.toBe(login.token);
  db.close();
  db = new StorageDatabase({ directory: join(root, 'data'), mode: 'accounts' });
  expect(assertSession(db.connection, session.digest).userId).toBe(
    login.identity.userId,
  );
  await manageAccount(db.connection, 'disable', 'alice');
  expect(() => assertSession(db.connection, session.digest)).toThrow(ApiError);
  await manageAccount(db.connection, 'enable', 'alice');
  expect(() => assertSession(db.connection, session.digest)).toThrow(ApiError);
});
it('文件已发布后会话撤销，事务拒绝提交且旧正文仍可读', async () => {
  const user = await manageAccount(
    db.connection,
    'init-admin',
    'alice',
    password,
  );
  const auth = new LocalAuth(db.connection);
  await auth.initialize();
  const login = await auth.login('alice', password, 'source');
  const id = randomUUID();
  const input = {
    ownerId: user.userId,
    articleId: id,
    operationId: randomUUID(),
    expectedRevision: null,
    markdown: 'before',
    metadata: {
      id,
      savedAt: '2026-10-25T00:00:00Z',
      theme: '',
      themeName: '',
      customCSS: '',
    },
    assets: [],
  };
  const repo = new ArticleRepository(db);
  repo.commit(input);
  const guarded = new ArticleRepository(db, {
    authorize: () => {
      assertSession(db.connection, sha256(login.token));
    },
    checkpoint: (stage) => {
      if (stage === 'snapshot-published') auth.revoke(login.token);
    },
  });
  expect(() =>
    guarded.commit({
      ...input,
      expectedRevision: 0,
      operationId: randomUUID(),
      markdown: 'after',
    }),
  ).toThrow(ApiError);
  expect(repo.read(user.userId, id).markdown).toBe('before');
  expect(repo.read(user.userId, id).revision).toBe(0);
});
it('schema 1 显式完整备份升级不改变身份和文章，备份逐文件摘要可核对', () => {
  const ownerId = randomUUID();
  db.registerOwner(ownerId);
  const id = randomUUID();
  new ArticleRepository(db).commit({
    ownerId,
    articleId: id,
    operationId: randomUUID(),
    expectedRevision: null,
    markdown: 'legacy synthetic',
    metadata: {
      id,
      savedAt: '2026-10-25T00:00:00Z',
      theme: '',
      themeName: '',
      customCSS: '',
    },
    assets: [],
  });
  // 合成首版数据库，保留原 schema 1 SQL 和迁移摘要。
  db.connection.exec(
    'DROP TABLE oidc_attempts; DROP TABLE oidc_identities; DROP TABLE sessions; DROP TABLE login_limits; DROP TABLE password_credentials; DROP TABLE account_profiles; DELETE FROM schema_migrations WHERE version>=2; PRAGMA user_version=1',
  );
  const deployment = db.deployment;
  db.close();
  db = new StorageDatabase({ directory: join(root, 'data'), mode: 'accounts' });
  expect(db.connection.pragma('user_version', { simple: true })).toBe(1);
  db.close();
  db = new StorageDatabase({
    directory: join(root, 'data'),
    mode: 'accounts',
    authBackupDirectory: join(root, 'backup'),
  });
  expect(db.deployment).toEqual(deployment);
  expect(new ArticleRepository(db).read(ownerId, id).markdown).toBe(
    'legacy synthetic',
  );
  expect(db.connection.pragma('user_version', { simple: true })).toBe(2);
  const manifest = JSON.parse(
    readFileSync(join(root, 'backup/backup-manifest.json'), 'utf8'),
  ) as { files: { path: string; sha256: string; size: number }[] };
  for (const entry of manifest.files) {
    const bytes = readFileSync(join(root, 'backup', entry.path));
    expect(bytes.length).toBe(entry.size);
    expect(sha256(bytes)).toBe(entry.sha256);
  }
  const backupDb = new Database(join(root, 'backup/metadata.sqlite'), {
    readonly: true,
  });
  try {
    expect(backupDb.pragma('user_version', { simple: true })).toBe(1);
  } finally {
    backupDb.close();
  }
});
it('卷内备份目标、未备份的 HTTP schema 升级不能静默发生', () => {
  db.connection.exec(
    'DROP TABLE oidc_attempts; DROP TABLE oidc_identities; DROP TABLE sessions; DROP TABLE login_limits; DROP TABLE password_credentials; DROP TABLE account_profiles; DELETE FROM schema_migrations WHERE version>=2; PRAGMA user_version=1',
  );
  db.close();
  expect(
    () =>
      new StorageDatabase({
        directory: join(root, 'data'),
        mode: 'accounts',
        authBackupDirectory: join(root, 'data/backup'),
      }),
  ).toThrow();
  expect(existsSync(join(root, 'data/backup'))).toBe(false);
  db = new StorageDatabase({ directory: join(root, 'data'), mode: 'accounts' });
  expect(db.connection.pragma('user_version', { simple: true })).toBe(1);
});
it('配置缺失、生产 HTTP 与宽泛 Origin 拒绝；生产 Cookie 固定 Secure / Host 前缀', () => {
  expect(() => serverConfig({})).toThrow();
  for (const origin of [
    'http://example.test',
    'http://127.0.0.1:4000/path',
    'https://example.test/',
  ])
    expect(() =>
      serverConfig({ RADISHINK_DATA_DIR: '/data', RADISHINK_ORIGIN: origin }),
    ).toThrow();
  expect(() =>
    serverConfig({
      NODE_ENV: 'production',
      RADISHINK_DATA_DIR: '/data',
      RADISHINK_ORIGIN: 'http://127.0.0.1:4000',
    }),
  ).toThrow();
  const security = new BrowserSecurity(
    serverConfig({
      NODE_ENV: 'production',
      RADISHINK_DATA_DIR: '/data',
      RADISHINK_ORIGIN: 'https://example.test',
    }),
  );
  const append = jest.fn();
  security.cookie(
    { append } as unknown as Response,
    security.sessionName,
    randomBytes(32).toString('base64url'),
    100,
  );
  const header = (append.mock.calls[0] as string[])[1];
  expect(header).toContain('__Host-radishink-session=');
  expect(header).toContain('Secure');
  expect(header).toContain('HttpOnly; SameSite=Lax');
  expect(header).not.toContain('Domain=');
});

it('删除校验文件时不持有写事务，校验后撤销阻止墓碑发布', async () => {
  const user = await manageAccount(
    db.connection,
    'init-admin',
    'alice',
    password,
  );
  const auth = new LocalAuth(db.connection);
  await auth.initialize();
  const login = await auth.login('alice', password, 'source');
  const id = randomUUID();
  const repo = new ArticleRepository(db, {
    authorize: () => {
      assertSession(db.connection, sha256(login.token));
    },
  });
  repo.commit({
    ownerId: user.userId,
    articleId: id,
    operationId: randomUUID(),
    expectedRevision: null,
    markdown: 'keep',
    metadata: {
      id,
      savedAt: '2026-10-25T00:00:00Z',
      theme: '',
      themeName: '',
      customCSS: '',
    },
    assets: [],
  });
  const reader = new ArticleRepository(db).snapshots;
  jest.spyOn(repo.snapshots, 'read').mockImplementation((row) => {
    expect(db.connection.inTransaction).toBe(false);
    const result = reader.read(row);
    auth.revoke(login.token);
    return result;
  });
  expect(() => repo.delete(user.userId, id, 0, randomUUID())).toThrow(ApiError);
  expect(new ArticleRepository(db).read(user.userId, id).markdown).toBe('keep');
});
