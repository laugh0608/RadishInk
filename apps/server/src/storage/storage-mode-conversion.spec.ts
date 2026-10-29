import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ArticleRepository } from './article-repository';
import { SHARED_OWNER, StorageDatabase } from './storage-database';
import {
  convertStorage,
  backupStorage,
  restoreStorage,
} from './storage-backup';
import { manageAccount } from '../auth/local-auth';
import { issueSession } from '../auth/auth-sessions';
import { sha256 } from './storage-contract';
import { StorageFiles } from './storage-files';
import { runStorageCommand } from './storage-cli';
let root: string, db: StorageDatabase, owner: string;
const password = 'synthetic-conversion-password';
const source = () => join(root, 'source');
const target = () => join(root, 'shared');
const backup = () => join(root, 'backup');
const plan = () => ({
  targetMode: 'shared' as const,
  ownerId: owner,
  confirmShared: true,
});
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'radishink-conversion-'));
  db = new StorageDatabase({
    directory: source(),
    mode: 'accounts',
    initialize: true,
  });
  owner = (await manageAccount(db.connection, 'init-admin', 'alice', password))
    .userId;
});
afterEach(() => {
  jest.restoreAllMocks();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

it('双向转换保留内容、原图、版本、墓碑、幂等回执和身份凭据；原卷与备份可独立恢复', () => {
  const articleId = randomUUID(),
    deleted = randomUUID();
  const image = Buffer.from([0, 255, 13, 10, 25]);
  const make = (id: string) => ({
    ownerId: owner,
    articleId: id,
    operationId: randomUUID(),
    expectedRevision: null,
    markdown: '\ufeff---\r\nunknown: 保留\r\n---\r\n# 转换原文',
    metadata: {
      id,
      title: '转换',
      savedAt: '2026-10-29T00:00:00.000Z',
      theme: '',
      themeName: '',
      customCSS: '',
      ownerId: 'opaque-user-metadata',
    },
    assets: [
      {
        path: 'asset/原图.png',
        bytes: image,
        size: image.length,
        sha256: sha256(image),
      },
    ],
  });
  const write = make(articleId),
    repo = new ArticleRepository(db);
  const receipt = repo.commit(write);
  repo.commit(make(deleted));
  repo.delete(owner, deleted, 0, randomUUID());
  issueSession(db.connection, owner, 'password');
  db.connection
    .prepare('INSERT INTO oidc_identities VALUES (?,?,?,?)')
    .run('https://synthetic.invalid', 'sub', owner, 0);
  const tombstone = db.connection
    .prepare('SELECT deleted,revision FROM articles WHERE id=?')
    .get(deleted);
  const epoch = db.deployment.workspaceEpoch;
  const before = repo.read(owner, articleId);
  db.close();
  const report = convertStorage(
    source(),
    backup(),
    target(),
    'accounts',
    plan(),
  );
  expect(report.accountMode).toBe('shared');
  expect(report.workspaceEpoch).not.toBe(epoch);
  const backupBytes = readFileSync(join(backup(), 'metadata.sqlite'));
  db = new StorageDatabase({ directory: target(), mode: 'shared' });
  const shared = new ArticleRepository(db);
  expect(shared.read(SHARED_OWNER, articleId)).toEqual(before);
  expect(
    shared.readAsset(SHARED_OWNER, articleId, 'asset/原图.png', 0),
  ).toEqual(image);
  expect(shared.commit({ ...write, ownerId: SHARED_OWNER })).toEqual(receipt);
  expect(
    db.connection
      .prepare('SELECT deleted,revision FROM articles WHERE id=?')
      .get(deleted),
  ).toEqual(tombstone);
  expect(db.connection.prepare('SELECT * FROM sessions').all()).toEqual([]);
  expect(
    db.connection.prepare('SELECT * FROM oidc_identities').all(),
  ).toHaveLength(1);
  db.close();
  const restored = join(root, 'accounts');
  convertStorage(target(), join(root, 'backup2'), restored, 'shared', {
    targetMode: 'accounts',
    ownerId: owner,
    confirmShared: false,
  });
  db = new StorageDatabase({ directory: restored, mode: 'accounts' });
  expect(new ArticleRepository(db).read(owner, articleId)).toEqual(before);
  expect(new ArticleRepository(db).commit(write)).toEqual(receipt);
  db.close();
  db = new StorageDatabase({ directory: source(), mode: 'accounts' });
  expect(db.deployment.workspaceEpoch).toBe(epoch);
  expect(new ArticleRepository(db).read(owner, articleId)).toEqual(before);
  db.close();
  restoreStorage(join(root, 'backup-restore'), backup(), 'accounts');
  expect(readFileSync(join(backup(), 'metadata.sqlite'))).toEqual(backupBytes);
});
it('拒绝多用户卷，包括无文章与被禁用的第二用户', async () => {
  await manageAccount(db.connection, 'create-user', 'bob', password);
  await manageAccount(db.connection, 'disable', 'bob');
  db.close();
  expect(() =>
    convertStorage(source(), backup(), target(), 'accounts', plan()),
  ).toThrow('多用户');
});
it('拒绝隐式公开、未知接收者、直接改配置与源卷被占用', () => {
  expect(() =>
    convertStorage(source(), backup(), target(), 'accounts', plan()),
  ).toThrow();
  db.close();
  expect(
    () => new StorageDatabase({ directory: source(), mode: 'shared' }),
  ).toThrow('账号模式');
  expect(() =>
    convertStorage(source(), backup(), target(), 'accounts', {
      ...plan(),
      confirmShared: false,
    }),
  ).toThrow('显式确认');
  expect(() =>
    convertStorage(source(), backup(), target(), 'accounts', {
      ...plan(),
      ownerId: randomUUID(),
    }),
  ).toThrow('归属账号');
  expect(() =>
    runStorageCommand([
      'check',
      '--data-dir',
      source(),
      '--mode',
      'accounts',
      '--owner-id',
      owner,
    ]),
  ).toThrow();
});
it('转换中断只留下不可启动目标，原卷和校验备份保留', () => {
  db.close();
  // 保存原方法后始终以 call(this) 调用，保持文件系统接收者。
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = StorageFiles.prototype.publishDirectory;
  jest
    .spyOn(StorageFiles.prototype, 'publishDirectory')
    .mockImplementation(function (this: StorageFiles, a, b) {
      if (a === 'restore-staging/users')
        throw new Error('synthetic-publish-failure');
      original.call(this, a, b);
    });
  expect(() =>
    convertStorage(source(), backup(), target(), 'accounts', plan()),
  ).toThrow('synthetic-publish-failure');
  expect(
    () => new StorageDatabase({ directory: target(), mode: 'shared' }),
  ).toThrow();
  jest.restoreAllMocks();
  db = new StorageDatabase({ directory: source(), mode: 'accounts' });
  db.close();
  expect(() =>
    restoreStorage(join(root, 'recovery'), backup(), 'accounts'),
  ).not.toThrow();
});
it('全新共享卷可离线准备接收管理员，先备份再转换，不把其他账号当作文章归属', async () => {
  db.close();
  db = new StorageDatabase({
    directory: target(),
    mode: 'shared',
    initialize: true,
  });
  const recipient = await manageAccount(
    db.connection,
    'init-admin',
    'recipient',
    password,
  );
  db.close();
  backupStorage(target(), backup(), 'shared');
  const result = convertStorage(
    target(),
    join(root, 'conversion-backup'),
    join(root, 'accounts'),
    'shared',
    { targetMode: 'accounts', ownerId: recipient.userId, confirmShared: false },
  );
  expect(result.accountMode).toBe('accounts');
});

it.each(['disabled', 'pending'])(
  '拒绝 %s 接收者，不创建可用的转换目标',
  (state) => {
    if (state === 'disabled')
      db.connection.prepare('UPDATE users SET enabled=0 WHERE id=?').run(owner);
    else
      db.connection
        .prepare(
          "UPDATE account_profiles SET admission='pending' WHERE user_id=?",
        )
        .run(owner);
    db.close();
    expect(() =>
      convertStorage(source(), backup(), target(), 'accounts', plan()),
    ).toThrow('归属账号');
  },
);
it('拒绝损坏暂存清单，保留原件和可恢复备份', () => {
  const path = `staging/${owner}/${randomUUID()}`;
  db.files.mkdir(path);
  db.files.writeNew(path + '/manifest.json', Buffer.from('{broken'));
  db.close();
  expect(() =>
    convertStorage(source(), backup(), target(), 'accounts', plan()),
  ).toThrow('暂存清单');
  expect(readFileSync(join(source(), path, 'manifest.json'), 'utf8')).toBe(
    '{broken',
  );
  expect(
    () => new StorageDatabase({ directory: target(), mode: 'shared' }),
  ).toThrow();
  expect(() =>
    restoreStorage(join(root, 'safe-restored'), backup(), 'accounts'),
  ).not.toThrow();
});
it('拒绝相互包含路径和占用目标，不能覆盖源卷或归档', () => {
  db.close();
  expect(() =>
    convertStorage(
      source(),
      backup(),
      join(source(), 'nested'),
      'accounts',
      plan(),
    ),
  ).toThrow();
  const occupied = new StorageFiles(target(), true);
  occupied.writeNew('retained', Buffer.from('keep'));
  expect(() =>
    convertStorage(source(), backup(), target(), 'accounts', plan()),
  ).toThrow('空目录');
  expect(occupied.read('retained', 4).toString()).toBe('keep');
});
