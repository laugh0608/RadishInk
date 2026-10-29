import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { StorageDatabase } from '../storage/storage-database';
import { AUTH_MIGRATION } from '../storage/storage-auth-schema';
import { ArticleRepository } from '../storage/article-repository';
import { sha256 } from '../storage/storage-contract';
import { LocalAuth, manageAccount } from './local-auth';
import { serverConfig } from '../http/server-policy';
import { StorageExecutor } from '../http/storage-executor';

let root: string, db: StorageDatabase;
const password = 'synthetic-migration-password';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'radishink-oidc-schema-'));
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

function schemaTwo() {
  const accounts = db.connection
    .prepare(
      'SELECT a.user_id,a.username,p.password_hash,a.role FROM account_profiles a JOIN password_credentials p ON p.user_id=a.user_id',
    )
    .all() as {
    user_id: string;
    username: string;
    password_hash: string;
    role: string;
  }[];
  db.connection
    .exec(`DROP TABLE oidc_attempts; DROP TABLE oidc_identities; DROP TABLE password_credentials;
    DROP TABLE account_profiles; DROP TABLE sessions; DROP TABLE login_limits;
    DELETE FROM schema_migrations WHERE version=3; PRAGMA user_version=2;`);
  db.connection.exec(AUTH_MIGRATION);
  for (const row of accounts)
    db.connection
      .prepare('INSERT INTO local_accounts VALUES (?,?,?,?)')
      .run(row.user_id, row.username, row.password_hash, row.role);
  db.verifySchema();
}
it('显式 schema 2→3 完整备份；原用户、口令、元数据和文章字节保留，旧会话撤销', async () => {
  const user = await manageAccount(
    db.connection,
    'init-admin',
    'alice',
    password,
  );
  const articleId = randomUUID(),
    markdown = '\ufeff---\r\nunknown: keep\r\n---\r\n# preserve';
  new ArticleRepository(db).commit({
    ownerId: user.userId,
    articleId,
    expectedRevision: null,
    operationId: randomUUID(),
    markdown,
    metadata: {
      id: articleId,
      title: 'before OIDC',
      savedAt: new Date().toISOString(),
      theme: 'default',
      themeName: '',
      customCSS: '',
      unknown: { preserve: true },
    },
    assets: [],
  });
  const deployment = db.deployment;
  schemaTwo();
  db.connection
    .prepare('INSERT INTO sessions VALUES (?,?,?,?,?)')
    .run('old-digest', user.userId, Date.now(), Date.now(), Date.now() + 60000);
  const hash = db.connection
    .prepare<
      [],
      { password_hash: string }
    >('SELECT password_hash FROM local_accounts')
    .get()!.password_hash;
  db.close();
  db = new StorageDatabase({
    directory: join(root, 'data'),
    mode: 'accounts',
    oidcBackupDirectory: join(root, 'backup'),
  });
  expect(db.connection.pragma('user_version', { simple: true })).toBe(3);
  expect(db.deployment).toEqual(deployment);
  expect(new ArticleRepository(db).read(user.userId, articleId).markdown).toBe(
    markdown,
  );
  expect(
    db.connection
      .prepare<
        [],
        { password_hash: string }
      >('SELECT password_hash FROM password_credentials')
      .get()!.password_hash,
  ).toBe(hash);
  expect(db.connection.prepare('SELECT * FROM sessions').all()).toHaveLength(0);
  const auth = new LocalAuth(db.connection);
  await auth.initialize();
  expect((await auth.login('alice', password, 'test')).identity).toEqual(user);
  const manifest = JSON.parse(
    readFileSync(join(root, 'backup/backup-manifest.json'), 'utf8'),
  ) as {
    schema: number;
    files: { path: string; size: number; sha256: string }[];
  };
  expect(manifest.schema).toBe(2);
  for (const entry of manifest.files) {
    const bytes = readFileSync(join(root, 'backup', entry.path));
    expect(bytes.length).toBe(entry.size);
    expect(sha256(bytes)).toBe(entry.sha256);
  }
  const old = new Database(join(root, 'backup/metadata.sqlite'), {
    readonly: true,
  });
  try {
    expect(old.pragma('user_version', { simple: true })).toBe(2);
    expect(old.prepare('SELECT * FROM sessions').all()).toHaveLength(1);
  } finally {
    old.close();
  }
});
it('旧卷可检查但 HTTP worker 拒绝，不静默迁移；备份失败保留 schema 2', async () => {
  schemaTwo();
  db.close();
  db = new StorageDatabase({ directory: join(root, 'data'), mode: 'accounts' });
  expect(db.connection.pragma('user_version', { simple: true })).toBe(2);
  db.close();
  const executor = new StorageExecutor(join(root, 'data'));
  try {
    await expect(executor.ready).rejects.toThrow();
  } finally {
    await executor.close();
  }
  mkdirSync(join(root, 'nonempty'));
  writeFileSync(join(root, 'nonempty/keep.txt'), 'must keep');
  expect(
    () =>
      new StorageDatabase({
        directory: join(root, 'data'),
        mode: 'accounts',
        oidcBackupDirectory: join(root, 'nonempty'),
      }),
  ).toThrow();
  expect(readFileSync(join(root, 'nonempty/keep.txt'), 'utf8')).toBe(
    'must keep',
  );
  expect(
    () =>
      new StorageDatabase({
        directory: join(root, 'data'),
        mode: 'accounts',
        oidcBackupDirectory: join(root, 'data/inside'),
      }),
  ).toThrow();
  db = new StorageDatabase({ directory: join(root, 'data'), mode: 'accounts' });
  expect(db.connection.pragma('user_version', { simple: true })).toBe(2);
});
it('本机 CLI 实际升级、列出与批准待准入账号，enable 不绕过准入', async () => {
  await manageAccount(db.connection, 'init-admin', 'alice', password);
  schemaTwo();
  db.close();
  const cli = (args: string[]) =>
    spawnSync(
      process.execPath,
      [resolve(__dirname, '../../dist/auth/account-cli.js'), ...args],
      { encoding: 'utf8' },
    );
  const upgraded = cli([
    'upgrade-oidc',
    '--data-dir',
    join(root, 'data'),
    '--backup-dir',
    join(root, 'backup'),
  ]);
  expect(upgraded.status).toBe(0);
  db = new StorageDatabase({ directory: join(root, 'data'), mode: 'accounts' });
  const id = randomUUID();
  db.connection.prepare('INSERT INTO users VALUES (?,0)').run(id);
  db.connection.prepare('INSERT INTO owner_usage VALUES (?,0,0)').run(id);
  db.connection
    .prepare(
      "INSERT INTO account_profiles VALUES (?,'pending-user','user','pending')",
    )
    .run(id);
  db.connection
    .prepare('INSERT INTO oidc_identities VALUES (?,?,?,?)')
    .run('https://synthetic.invalid', 'subject', id, Date.now());
  await expect(
    manageAccount(db.connection, 'enable', 'pending-user'),
  ).rejects.toMatchObject({ code: 'approval-required' });
  db.close();
  const list = cli(['list-oidc', '--data-dir', join(root, 'data')]);
  expect(list.status).toBe(0);
  expect(JSON.parse(list.stdout)).toEqual([
    expect.objectContaining({
      username: 'pending-user',
      admission: 'pending',
      user_id: id,
    }),
  ]);
  expect(
    cli([
      'approve-oidc',
      '--data-dir',
      join(root, 'data'),
      '--username',
      'pending-user',
    ]).status,
  ).toBe(0);
  db = new StorageDatabase({ directory: join(root, 'data'), mode: 'accounts' });
  expect(
    db.connection
      .prepare<
        [string],
        { admission: string }
      >('SELECT admission FROM account_profiles WHERE user_id=?')
      .get(id)?.admission,
  ).toBe('approved');
});
it('OIDC 配置使用受控秘密文件，登录开关、issuer 与 base path 严格校验', () => {
  const file = join(root, 'secret');
  writeFileSync(file, 'synthetic-client-secret\n', { mode: 0o600 });
  const env = {
    RADISHINK_ORIGIN: 'https://ink.example.invalid',
    RADISHINK_DATA_DIR: join(root, 'data'),
    RADISHINK_OIDC_ENABLED: 'true',
    RADISHINK_OIDC_ISSUER: 'https://issuer.example.invalid',
    RADISHINK_OIDC_CLIENT_ID: 'radishink',
    RADISHINK_OIDC_CLIENT_SECRET_FILE: file,
  };
  expect(serverConfig(env).oidc?.clientSecret).toBe('synthetic-client-secret');
  expect(
    serverConfig({ ...env, RADISHINK_PASSWORD_LOGIN: 'false' }).passwordLogin,
  ).toBe(false);
  for (const patch of [
    { RADISHINK_OIDC_ENABLED: 'false' },
    { RADISHINK_OIDC_ENABLED: 'yes' },
    { RADISHINK_OIDC_ISSUER: 'http://issuer.example.invalid' },
    { RADISHINK_OIDC_ISSUER: 'https://issuer.example.invalid?query=1' },
    {
      RADISHINK_OIDC_ISSUER:
        'https://issuer.example.invalid/.well-known/openid-configuration',
    },
    { RADISHINK_OIDC_CLIENT_AUTH: 'none' },
    { RADISHINK_OIDC_ADMISSION: 'guess' },
    { RADISHINK_BASE_PATH: '//evil/' },
    { RADISHINK_BASE_PATH: '/nested/../' },
  ])
    expect(() => serverConfig({ ...env, ...patch })).toThrow();
  expect(() =>
    serverConfig({
      RADISHINK_ORIGIN: env.RADISHINK_ORIGIN,
      RADISHINK_DATA_DIR: env.RADISHINK_DATA_DIR,
      RADISHINK_PASSWORD_LOGIN: 'false',
    }),
  ).toThrow();
  chmodSync(file, 0o644);
  expect(() => serverConfig(env)).toThrow();
});
