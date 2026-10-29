import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { backupStorage, restoreStorage } from './storage-backup';
import { StorageDatabase } from './storage-database';
import { StorageFiles } from './storage-files';
import { StorageVolumeLock } from './storage-volume-lock';
import { ArticleRepository } from './article-repository';
import { sha256 } from './storage-contract';
import { manageAccount, LocalAuth } from '../auth/local-auth';
import { issueSession } from '../auth/auth-sessions';
import { runStorageCommand } from './storage-cli';

let root: string, db: StorageDatabase;
const password = 'synthetic-backup-password';
const markdown = '\ufeff---\r\nunknown: keep\r\n---\r\n# 完整恢复';
const image = Buffer.from([0, 13, 10, 255, 42]);
let owner: string, article: string, oldToken: string;
const source = () => join(root, 'data');
const backup = () => join(root, 'backup');
const target = () => join(root, 'restored');
const manifest = () =>
  JSON.parse(
    fs.readFileSync(join(backup(), 'backup-manifest.json'), 'utf8'),
  ) as {
    schema: number;
    files: { path: string; size: number; sha256: string }[];
  };
const writeManifest = (value: unknown) =>
  fs.writeFileSync(
    join(backup(), 'backup-manifest.json'),
    JSON.stringify(value),
  );
function makeBackup() {
  db.close();
  return backupStorage(source(), backup(), 'accounts');
}
function openTarget() {
  return new StorageDatabase({ directory: target(), mode: 'accounts' });
}
beforeEach(async () => {
  root = fs.mkdtempSync(join(tmpdir(), 'radishink-backup-'));
  db = new StorageDatabase({
    directory: source(),
    mode: 'accounts',
    initialize: true,
  });
  owner = (await manageAccount(db.connection, 'init-admin', 'alice', password))
    .userId;
  article = randomUUID();
  new ArticleRepository(db).commit({
    ownerId: owner,
    articleId: article,
    operationId: randomUUID(),
    expectedRevision: null,
    markdown,
    metadata: {
      id: article,
      savedAt: '2026-10-29T00:00:00.000Z',
      title: '恢复验证',
      theme: 'default',
      themeName: '',
      customCSS: '',
      unknown: { preserved: true },
    },
    assets: [
      {
        path: 'asset/图片.png',
        bytes: image,
        size: image.length,
        sha256: sha256(image),
      },
    ],
  });
  oldToken = issueSession(db.connection, owner, 'password').token;
  db.connection
    .prepare('INSERT INTO oidc_identities VALUES (?,?,?,?)')
    .run('https://synthetic.invalid', 'stable-subject', owner, Date.now());
  db.connection
    .prepare('INSERT INTO oidc_attempts VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      'state',
      'browser',
      'nonce',
      'verifier',
      'config',
      'link',
      owner,
      sha256(oldToken),
      Date.now(),
      Date.now() + 60000,
      0,
    );
});
afterEach(() => {
  jest.restoreAllMocks();
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

it('独立恢复保留正文/原图/身份/墓碑/回执，撤销会话与 OIDC 尝试并逐次轮换 epoch', async () => {
  const deleted = randomUUID();
  const repo = new ArticleRepository(db);
  repo.commit({
    ownerId: owner,
    articleId: deleted,
    operationId: randomUUID(),
    expectedRevision: null,
    markdown: 'deleted',
    metadata: {
      id: deleted,
      title: '',
      savedAt: '2026-10-29T00:00:00.000Z',
      theme: '',
      themeName: '',
      customCSS: '',
    },
    assets: [],
  });
  repo.delete(owner, deleted, 0, randomUUID());
  const identity = db.deployment;
  const report = makeBackup();
  expect(report.articles).toBe(1);
  const before = fs.readFileSync(join(backup(), 'metadata.sqlite'));
  const restored = restoreStorage(target(), backup(), 'accounts');
  expect(restored.deploymentId).toBe(identity.deploymentId);
  expect(restored.workspaceEpoch).not.toBe(identity.workspaceEpoch);
  db = openTarget();
  const read = new ArticleRepository(db).read(owner, article);
  expect(read.markdown).toBe(markdown);
  expect(read.metadata.unknown).toEqual({ preserved: true });
  expect(
    new ArticleRepository(db).readAsset(owner, article, 'asset/图片.png', 0),
  ).toEqual(image);
  expect(db.connection.prepare('SELECT * FROM sessions').all()).toHaveLength(0);
  expect(
    db.connection.prepare('SELECT * FROM oidc_attempts').all(),
  ).toHaveLength(0);
  expect(
    db.connection.prepare('SELECT * FROM oidc_identities').all(),
  ).toHaveLength(1);
  expect(
    db.connection.prepare('SELECT * FROM articles WHERE deleted=1').all(),
  ).toHaveLength(1);
  expect(
    db.connection.prepare('SELECT * FROM commit_receipts').all(),
  ).toHaveLength(3);
  const auth = new LocalAuth(db.connection);
  await auth.initialize();
  expect(() => auth.session(oldToken)).toThrow();
  expect(
    (await auth.login('alice', password, 'synthetic')).identity.userId,
  ).toBe(owner);
  expect(fs.readFileSync(join(backup(), 'metadata.sqlite'))).toEqual(before);
  const second = restoreStorage(join(root, 'second'), backup(), 'accounts');
  expect(second.workspaceEpoch).not.toBe(restored.workspaceEpoch);
});

it('运行中的卷拒绝备份，关闭数据库但持锁阶段仍拒绝并发维护', () => {
  expect(() => backupStorage(source(), backup(), 'accounts')).toThrow(
    expect.objectContaining({ code: 'locked' }) as Error,
  );
  db.closeForBackup();
  expect(
    () => new StorageDatabase({ directory: source(), mode: 'accounts' }),
  ).toThrow(expect.objectContaining({ code: 'locked' }) as Error);
  db.close();
  expect(backupStorage(source(), backup(), 'accounts').articles).toBe(1);
});

it('现有目标、卷内备份、祖先目标和路径别名不能覆盖源数据', () => {
  db.close();
  expect(() =>
    backupStorage(source(), join(source(), 'backup'), 'accounts'),
  ).toThrow();
  expect(fs.existsSync(join(source(), 'backup'))).toBe(false);
  fs.symlinkSync(source(), join(root, 'alias'));
  expect(() =>
    backupStorage(source(), join(root, 'alias/backup'), 'accounts'),
  ).toThrow();
  backupStorage(source(), backup(), 'accounts');
  expect(() => restoreStorage(source(), backup(), 'accounts')).toThrow();
  expect(() => restoreStorage(root, backup(), 'accounts')).toThrow();
  expect(() =>
    restoreStorage(join(backup(), 'child'), backup(), 'accounts'),
  ).toThrow();
  expect(() => restoreStorage(target(), backup(), 'shared')).toThrow(
    expect.objectContaining({ code: 'mode-mismatch' }) as Error,
  );
});

it.each([
  'bytes',
  'missing',
  'extra',
  'symlink',
  'hardlink',
  'traversal',
  'duplicate',
  'future',
])('拒绝损坏或恶意备份：%s', (kind) => {
  makeBackup();
  const value = manifest();
  const entry = value.files.find((e) => e.path !== 'metadata.sqlite')!;
  const path = join(backup(), entry.path);
  if (kind === 'bytes') fs.writeFileSync(path, 'corrupt');
  if (kind === 'missing') fs.unlinkSync(path);
  if (kind === 'extra')
    fs.writeFileSync(join(backup(), 'unexpected'), 'unknown');
  if (kind === 'symlink') {
    fs.unlinkSync(path);
    fs.symlinkSync(join(source(), entry.path), path);
  }
  if (kind === 'hardlink') {
    fs.unlinkSync(path);
    fs.linkSync(join(source(), entry.path), path);
  }
  if (kind === 'traversal') {
    entry.path = 'users/../../outside';
    writeManifest(value);
  }
  if (kind === 'duplicate') {
    value.files.push(entry);
    writeManifest(value);
  }
  if (kind === 'future') {
    value.schema = 99;
    writeManifest(value);
  }
  expect(() => restoreStorage(target(), backup(), 'accounts')).toThrow();
  expect(() => openTarget()).toThrow();
});

it('清单摘要正确但数据库归属/当前资源损坏仍拒绝恢复', () => {
  makeBackup();
  const bad = new Database(join(backup(), 'metadata.sqlite'));
  bad.pragma('foreign_keys=OFF');
  bad.prepare('UPDATE articles SET owner_id=?').run(randomUUID());
  bad.close();
  const value = manifest();
  const entry = value.files.find((e) => e.path === 'metadata.sqlite')!;
  const bytes = fs.readFileSync(join(backup(), entry.path));
  entry.size = bytes.length;
  entry.sha256 = sha256(bytes);
  writeManifest(value);
  expect(() => restoreStorage(target(), backup(), 'accounts')).toThrow();
  expect(() => openTarget()).toThrow();
});

it('复制 ENOSPC 与进程 SIGKILL 留下失败标记，不能启动或复用半成品目标', () => {
  makeBackup();
  jest.spyOn(fs, 'copyFileSync').mockImplementationOnce(() => {
    throw Object.assign(new Error('synthetic full disk'), { code: 'ENOSPC' });
  });
  expect(() => restoreStorage(target(), backup(), 'accounts')).toThrow();
  expect(fs.existsSync(join(target(), 'maintenance-incomplete'))).toBe(true);
  expect(() => openTarget()).toThrow();
  expect(() => restoreStorage(target(), backup(), 'accounts')).toThrow();
  jest.restoreAllMocks();
  for (const stage of ['copy', 'publish']) {
    const killed = join(root, 'killed-' + stage);
    const child = spawnSync(process.execPath, [
      '-e',
      `
      const fs=require('node:fs'); const copy=fs.copyFileSync;
      fs.copyFileSync=(...args)=>{copy(...args);if(process.argv[3]==='copy'||String(args[0]).includes('/restore-staging/'))process.kill(process.pid,'SIGKILL')};
      require(${JSON.stringify(resolve(__dirname, '../../dist/storage/storage-backup.js'))}).restoreStorage(process.argv[1], process.argv[2], 'accounts');
    `,
      killed,
      backup(),
      stage,
    ]);
    expect(child.signal).toBe('SIGKILL');
    expect(
      () => new StorageDatabase({ directory: killed, mode: 'accounts' }),
    ).toThrow();
  }
  expect(
    restoreStorage(join(root, 'retry'), backup(), 'accounts').articles,
  ).toBe(1);
});

it('空目标的维护锁互斥；CLI 严格检查参数和错误退出', () => {
  makeBackup();
  const files = new StorageFiles(target(), true);
  const lock = new StorageVolumeLock(files);
  try {
    expect(() => restoreStorage(target(), backup(), 'accounts')).toThrow();
  } finally {
    lock.close();
  }
  expect(() =>
    runStorageCommand([
      'restore',
      '--data-dir',
      target(),
      '--mode',
      'accounts',
    ]),
  ).toThrow();
  expect(() =>
    runStorageCommand([
      'check',
      '--data-dir',
      source(),
      '--mode',
      'accounts',
      '--backup-dir',
      backup(),
    ]),
  ).toThrow();
  const child = spawnSync(
    process.execPath,
    [
      resolve(__dirname, '../../dist/storage/storage-cli.js'),
      'restore',
      '--data-dir',
      source(),
      '--backup-dir',
      backup(),
      '--mode',
      'accounts',
    ],
    { encoding: 'utf8' },
  );
  expect(child.status).toBe(1);
  expect(child.stderr).not.toContain(password);
  expect(child.stderr).not.toContain(markdown);
});

it('schema 1 / 2 升级专用备份可恢复，再显式逐级升级，身份和文章保留', () => {
  const identity = db.deployment;
  db.connection.exec(
    'DROP TABLE oidc_attempts; DROP TABLE oidc_identities; DROP TABLE sessions; DROP TABLE login_limits; DROP TABLE password_credentials; DROP TABLE account_profiles; DELETE FROM schema_migrations WHERE version>=2; PRAGMA user_version=1',
  );
  db.close();
  db = new StorageDatabase({
    directory: source(),
    mode: 'accounts',
    authBackupDirectory: backup(),
  });
  db.close();
  const first = restoreStorage(target(), backup(), 'accounts');
  expect(first.schema).toBe(1);
  expect(first.deploymentId).toBe(identity.deploymentId);
  expect(first.workspaceEpoch).not.toBe(identity.workspaceEpoch);
  db = new StorageDatabase({
    directory: target(),
    mode: 'accounts',
    authBackupDirectory: join(root, 'before-v2'),
  });
  db.close();
  db = new StorageDatabase({
    directory: target(),
    mode: 'accounts',
    oidcBackupDirectory: join(root, 'before-v3'),
  });
  expect(db.deployment.workspaceEpoch).toBe(first.workspaceEpoch);
  expect(db.connection.pragma('user_version', { simple: true })).toBe(3);
  expect(new ArticleRepository(db).read(owner, article).markdown).toBe(
    markdown,
  );
  db.close();
  const second = restoreStorage(
    join(root, 'from-v2'),
    join(root, 'before-v3'),
    'accounts',
  );
  expect(second.schema).toBe(2);
  expect(second.workspaceEpoch).not.toBe(first.workspaceEpoch);
  const legacy = new StorageDatabase({
    directory: join(root, 'from-v2'),
    mode: 'accounts',
  });
  try {
    expect(
      legacy.connection.prepare('SELECT * FROM sessions').all(),
    ).toHaveLength(0);
  } finally {
    legacy.close();
  }
});

it('当前快照资源损坏时不能备份；清单重算也不能绕过恢复的资源校验', () => {
  makeBackup();
  const value = manifest();
  const entry = value.files.find((e) => e.path.includes('/objects/'))!;
  const damaged = Buffer.alloc(entry.size, 99);
  fs.writeFileSync(join(backup(), entry.path), damaged);
  entry.sha256 = sha256(damaged);
  writeManifest(value);
  expect(() => restoreStorage(target(), backup(), 'accounts')).toThrow();
  fs.writeFileSync(join(source(), entry.path), damaged);
  expect(() =>
    backupStorage(source(), join(root, 'bad-backup'), 'accounts'),
  ).toThrow();
  expect(fs.existsSync(join(root, 'bad-backup'))).toBe(false);
});

it('备份写入失败不会发布可用备份，并释放源卷锁供原实例重新打开', () => {
  db.close();
  jest.spyOn(fs, 'copyFileSync').mockImplementationOnce(() => {
    throw Object.assign(new Error('synthetic copy failure'), {
      code: 'ENOSPC',
    });
  });
  expect(() => backupStorage(source(), backup(), 'accounts')).toThrow();
  expect(fs.existsSync(join(backup(), 'maintenance-incomplete'))).toBe(true);
  expect(() => restoreStorage(target(), backup(), 'accounts')).toThrow();
  jest.restoreAllMocks();
  db = new StorageDatabase({ directory: source(), mode: 'accounts' });
  expect(new ArticleRepository(db).read(owner, article).markdown).toBe(
    markdown,
  );
});

it('共享仓储备份恢复保持固定所有者和模式，不转换为账号卷', () => {
  const shared = join(root, 'shared');
  const first = new StorageDatabase({
    directory: shared,
    mode: 'shared',
    initialize: true,
  });
  const identity = first.deployment;
  first.close();
  backupStorage(shared, join(root, 'shared-backup'), 'shared');
  expect(() =>
    restoreStorage(
      join(root, 'wrong'),
      join(root, 'shared-backup'),
      'accounts',
    ),
  ).toThrow();
  const restored = restoreStorage(
    join(root, 'shared-restored'),
    join(root, 'shared-backup'),
    'shared',
  );
  expect(restored.accountMode).toBe('shared');
  expect(restored.deploymentId).toBe(identity.deploymentId);
  expect(restored.workspaceEpoch).not.toBe(identity.workspaceEpoch);
});
