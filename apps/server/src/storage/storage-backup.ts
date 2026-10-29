import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  copyFileSync,
  fstatSync,
  fsyncSync,
  openSync,
  readSync,
  realpathSync,
  chmodSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { ArticleRepository } from './article-repository';
import { assertUuid, StorageError } from './storage-contract';
import {
  AccountMode,
  Deployment,
  SHARED_OWNER,
  StorageDatabase,
} from './storage-database';
import { StorageFiles } from './storage-files';
import { StorageMaintenance } from './storage-maintenance';
import { StorageVolumeLock } from './storage-volume-lock';

interface BackupEntry {
  path: string;
  size: number;
  sha256: string;
}
interface BackupManifest {
  schema: number;
  files: BackupEntry[];
  formatVersion?: 1;
  deployment?: Deployment;
}
const manifestName = 'backup-manifest.json';
const marker = 'maintenance-incomplete';
const maxManifestBytes = 16 * 1024 * 1024;

function separateDirectory(source: StorageFiles, directory: string): void {
  if (!isAbsolute(directory))
    throw new StorageError('invalid', '目标必须为绝对路径');
  const normalized = resolve(directory);
  const target = resolve(
    realpathSync(dirname(normalized)),
    basename(normalized),
  );
  if (
    target === source.root ||
    target.startsWith(source.root + '/') ||
    source.root.startsWith(target + '/')
  )
    throw new StorageError('invalid', '源与目标目录不能相同或互相包含');
}
function emptyDestination(
  source: StorageFiles,
  directory: string,
): StorageFiles {
  separateDirectory(source, directory);
  const target = new StorageFiles(directory, true);
  separateDirectory(source, target.root);
  if (target.list().length)
    throw new StorageError(
      'invalid',
      '目标必须是新建或空目录，不能覆盖已有数据',
    );
  chmodSync(target.root, 0o700);
  return target;
}

/** 分块读取，数据库大小不转化为等量内存占用。 */
function digestFile(files: StorageFiles, name: string): BackupEntry {
  const fd = openSync(
    files.path(name),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1)
      throw new StorageError('corrupt', '备份包含链接或非普通文件');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let size = 0,
      count: number;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
      size += count;
    }
    const after = fstatSync(fd);
    if (
      size !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      throw new StorageError('corrupt', '备份读取期间文件发生变化');
    return { path: name, size, sha256: hash.digest('hex') };
  } finally {
    closeSync(fd);
  }
}
function copyEntry(
  source: StorageFiles,
  target: StorageFiles,
  entry: BackupEntry,
): void {
  if (entry.path.includes('/'))
    target.mkdir(entry.path.slice(0, entry.path.lastIndexOf('/')));
  copyFileSync(
    source.path(entry.path),
    target.path(entry.path),
    constants.COPYFILE_EXCL,
  );
  chmodSync(target.path(entry.path), 0o600);
  const fd = openSync(
    target.path(entry.path),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const actual = digestFile(target, entry.path);
  if (actual.size !== entry.size || actual.sha256 !== entry.sha256)
    throw new StorageError('corrupt', '备份文件摘要或大小不符');
  const directory = openSync(
    dirname(target.path(entry.path)),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
function inspectDatabase(db: StorageDatabase): number {
  const owners = db.connection
    .prepare<[], { id: string }>('SELECT id FROM users')
    .all();
  for (const owner of owners) {
    assertUuid(owner.id);
    if (db.deployment.accountMode === 'shared' && owner.id !== SHARED_OWNER)
      throw new StorageError('corrupt', '共享卷包含其他所有者');
  }
  const report = new StorageMaintenance(new ArticleRepository(db)).inspect();
  if (report.unknownPaths.length)
    throw new StorageError('corrupt', '数据卷包含未知或损坏的文件，需先检查');
  return report.articles;
}

/** 离线完整备份；不复制进程锁、WAL / SHM 或外部秘密。清单最后发布。 */
export function backupStorage(
  directory: string,
  backupDirectory: string,
  mode: AccountMode,
) {
  const db = new StorageDatabase({ directory, mode });
  try {
    const articles = inspectDatabase(db);
    const schema = db.connection.pragma('user_version', {
      simple: true,
    }) as number;
    const target = emptyDestination(db.files, backupDirectory);
    target.writeNew(
      marker,
      Buffer.from('Incomplete backup; do not restore.\n'),
    );
    db.closeForBackup();
    const names = [
      'metadata.sqlite',
      ...db.files.inventory('users').map((x) => x.path),
      ...db.files.inventory('staging').map((x) => x.path),
    ];
    const entries: BackupEntry[] = [];
    for (const name of names) {
      const entry = digestFile(db.files, name);
      copyEntry(db.files, target, entry);
      entries.push(entry);
    }
    const manifest: BackupManifest = {
      formatVersion: 1,
      schema,
      deployment: db.deployment,
      files: entries,
    };
    const bytes = Buffer.from(JSON.stringify(manifest));
    if (bytes.length > maxManifestBytes)
      throw new StorageError('capacity', '备份清单超过 16 MiB 上限');
    target.writeNew(manifestName, bytes);
    target.removeFile(marker);
    return {
      ...db.deployment,
      schema,
      articles,
      files: entries.length,
      bytes: entries.reduce((n, e) => n + e.size, 0),
    };
  } finally {
    db.close();
  }
}

function readManifest(source: StorageFiles): BackupManifest {
  let value: unknown;
  try {
    value = JSON.parse(
      source.read(manifestName, maxManifestBytes).toString('utf8'),
    );
  } catch (error) {
    throw new StorageError('corrupt', '备份清单缺失或无效', { cause: error });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new StorageError('corrupt', '备份清单不是对象');
  const row = value as Record<string, unknown>;
  // 接受 schema 升级专用旧清单；不能将未知新格式猜测为兼容格式。
  const modern = row.formatVersion === 1;
  if (
    (!modern && row.formatVersion !== undefined) ||
    Object.keys(row).some(
      (k) =>
        !(
          modern
            ? ['formatVersion', 'schema', 'deployment', 'files']
            : ['schema', 'files']
        ).includes(k),
    ) ||
    ![1, 2, 3].includes(row.schema as number) ||
    !Array.isArray(row.files) ||
    row.files.length === 0
  )
    throw new StorageError('schema-incompatible', '备份格式或 schema 不兼容');
  if (modern) {
    const d = row.deployment as Deployment | undefined;
    if (
      !d ||
      !['accounts', 'shared'].includes(d.accountMode) ||
      Object.keys(d).length !== 3
    )
      throw new StorageError('corrupt', '备份部署身份无效');
    assertUuid(d.deploymentId);
    assertUuid(d.workspaceEpoch);
  }
  const seen = new Set<string>();
  for (const item of row.files as unknown[]) {
    if (!item || typeof item !== 'object')
      throw new StorageError('corrupt', '备份文件清单无效');
    const e = item as BackupEntry;
    if (
      Object.keys(e).sort().join(',') !== 'path,sha256,size' ||
      typeof e.path !== 'string' ||
      !(e.path === 'metadata.sqlite' || /^(users|staging)\//.test(e.path)) ||
      !Number.isSafeInteger(e.size) ||
      e.size < 0 ||
      typeof e.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(e.sha256) ||
      seen.has(e.path)
    )
      throw new StorageError('corrupt', '备份文件路径、大小或摘要无效');
    source.path(e.path);
    seen.add(e.path);
  }
  if (!seen.has('metadata.sqlite'))
    throw new StorageError('corrupt', '备份缺少数据库');
  const allowedRoot = ['users', 'staging', 'metadata.sqlite', manifestName];
  // 旧升级备份的只读 SQLite 校验可能留下空 WAL 和派生 SHM；不复制它们。
  // 非空 WAL 表示主文件并非完整 checkpoint，绝不能猜测或忽略其中的数据。
  if (!modern) {
    if (source.exists('metadata.sqlite-wal'))
      source.read('metadata.sqlite-wal', 0);
    if (source.exists('metadata.sqlite-shm'))
      source.read('metadata.sqlite-shm', 1024 * 1024);
    allowedRoot.push('metadata.sqlite-wal', 'metadata.sqlite-shm');
  }
  if (source.list().some((n) => !allowedRoot.includes(n)))
    throw new StorageError('corrupt', '备份包含未知顶层文件或未完成标记');
  const actual = [
    'metadata.sqlite',
    ...source.inventory('users').map((x) => x.path),
    ...source.inventory('staging').map((x) => x.path),
  ];
  if (actual.length !== seen.size || actual.some((n) => !seen.has(n)))
    throw new StorageError('corrupt', '备份文件与清单不一致');
  return value as BackupManifest;
}

/** 恢复先在目标内隔离校验，轮换 epoch 后才发布；任何失败留下标记阻止启动。 */
export function restoreStorage(
  directory: string,
  backupDirectory: string,
  mode: AccountMode,
) {
  const source = new StorageFiles(backupDirectory, false);
  const manifest = readManifest(source);
  if (manifest.deployment && manifest.deployment.accountMode !== mode)
    throw new StorageError('mode-mismatch', '恢复模式必须与备份一致');
  const target = emptyDestination(source, directory);
  const lock = new StorageVolumeLock(target);
  try {
    // 重新检查，避免另一个受支持维护进程在创建锁之前占用空目录。
    if (
      target
        .list()
        .some(
          (n) =>
            !['process-lock.sqlite', 'process-lock.sqlite-journal'].includes(n),
        )
    )
      throw new StorageError('invalid', '恢复目标已被占用');
    target.writeNew(
      marker,
      Buffer.from(
        'Incomplete restore; inspect and use a new empty destination.\n',
      ),
    );
    target.mkdir('restore-staging');
    const staged = new StorageFiles(target.path('restore-staging'), false);
    for (const entry of manifest.files) copyEntry(source, staged, entry);
    const db = new StorageDatabase({ directory: staged.root, mode });
    let articles: number;
    let deployment: Deployment;
    try {
      if (
        db.connection.pragma('user_version', { simple: true }) !==
          manifest.schema ||
        (manifest.deployment &&
          (db.deployment.deploymentId !== manifest.deployment.deploymentId ||
            db.deployment.workspaceEpoch !==
              manifest.deployment.workspaceEpoch ||
            db.deployment.accountMode !== manifest.deployment.accountMode))
      )
        throw new StorageError('corrupt', '清单与数据库身份或 schema 不一致');
      articles = inspectDatabase(db);
      const workspaceEpoch = randomUUID();
      db.connection
        .transaction(() => {
          if (manifest.schema >= 2)
            db.connection.prepare('DELETE FROM sessions').run();
          if (manifest.schema >= 3)
            db.connection.prepare('DELETE FROM oidc_attempts').run();
          db.connection
            .prepare(
              'UPDATE deployment SET workspace_epoch = ? WHERE singleton = 1',
            )
            .run(workspaceEpoch);
        })
        .immediate();
      deployment = { ...db.deployment, workspaceEpoch };
      db.checkIntegrity();
      db.closeForBackup();
    } finally {
      db.close();
    }
    // 所有内容校验完成后发布，marker 和外层锁阻止半成品启动。
    target.publishDirectory('restore-staging/users', 'users');
    target.publishDirectory('restore-staging/staging', 'staging');
    const database = digestFile(staged, 'metadata.sqlite');
    copyEntry(staged, target, database);
    for (const name of staged.list()) staged.removeFile(name);
    target.removeEmptyDirectory('restore-staging');
    target.removeFile(marker);
    return {
      ...deployment,
      schema: manifest.schema,
      articles,
      sessionsRevoked: true,
      oidcAttemptsRevoked: true,
    };
  } finally {
    lock.close();
  }
}
