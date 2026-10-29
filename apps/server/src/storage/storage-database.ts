import Database from 'better-sqlite3';
import { chmodSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, basename, join, isAbsolute } from 'node:path';
import { StorageFiles } from './storage-files';
import { StorageError, assertUuid, sha256 } from './storage-contract';
import { AUTH_MIGRATION } from './storage-auth-schema';
import { OIDC_MIGRATION } from './storage-oidc-schema';
import { StorageVolumeLock } from './storage-volume-lock';

export type AccountMode = 'accounts' | 'shared';
export const SHARED_OWNER = '00000000-0000-4000-8000-000000000001';

export interface Deployment {
  deploymentId: string;
  workspaceEpoch: string;
  accountMode: AccountMode;
}

export interface ArticleRow {
  id: string;
  owner_id: string;
  revision: number;
  generation: string;
  manifest_hash: string;
  logical_bytes: number;
  title: string;
  saved_at: string;
  deleted: number;
}

const migration = `
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY, digest TEXT NOT NULL, applied_at TEXT NOT NULL
) STRICT;
CREATE TABLE deployment (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1), deployment_id TEXT NOT NULL,
  workspace_epoch TEXT NOT NULL, account_mode TEXT NOT NULL CHECK(account_mode IN ('accounts','shared'))
) STRICT;
CREATE TABLE users (
  id TEXT PRIMARY KEY, enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
) STRICT;
CREATE TABLE owner_usage (
  owner_id TEXT PRIMARY KEY REFERENCES users(id), articles INTEGER NOT NULL CHECK(articles >= 0),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes >= 0)
) STRICT;
CREATE TABLE articles (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
  revision INTEGER NOT NULL CHECK(revision >= 0), generation TEXT NOT NULL,
  manifest_hash TEXT NOT NULL, logical_bytes INTEGER NOT NULL CHECK(logical_bytes >= 0),
  title TEXT NOT NULL, saved_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)), UNIQUE(owner_id, id)
) STRICT;
CREATE INDEX article_owner_list ON articles(owner_id, deleted, id);
CREATE TABLE commit_receipts (
  owner_id TEXT NOT NULL, operation_id TEXT NOT NULL, request_digest TEXT NOT NULL,
  article_id TEXT NOT NULL, revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('save','delete')), PRIMARY KEY(owner_id, operation_id),
  FOREIGN KEY(owner_id, article_id) REFERENCES articles(owner_id, id)
) STRICT;
`;
const migrationDigest = sha256(migration);
const schemaQuery =
  "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name";
const schemaReference = new Database(':memory:');
schemaReference.exec(migration);
const expectedSchemaV1 = JSON.stringify(
  schemaReference.prepare(schemaQuery).all(),
);
schemaReference.exec(AUTH_MIGRATION);
const expectedSchemaV2 = JSON.stringify(
  schemaReference.prepare(schemaQuery).all(),
);
schemaReference.exec(OIDC_MIGRATION);
const expectedSchemaV3 = JSON.stringify(
  schemaReference.prepare(schemaQuery).all(),
);
schemaReference.close();

/** 独占连接只锁 process-lock.sqlite；metadata 的短事务仍可独立提交。 */
export class StorageDatabase {
  readonly files: StorageFiles;
  readonly connection: Database.Database;
  readonly deployment: Deployment;
  private lock: StorageVolumeLock;
  private closed = false;

  constructor(options: {
    directory: string;
    mode: AccountMode;
    initialize?: boolean;
    busyTimeoutMs?: number;
    authBackupDirectory?: string;
    oidcBackupDirectory?: string;
  }) {
    if (options.authBackupDirectory && options.oidcBackupDirectory)
      throw new StorageError('invalid', '每次只允许一个显式 schema 升级');
    if (!['accounts', 'shared'].includes(options.mode))
      throw new StorageError('invalid', '账号模式无效');
    this.files = new StorageFiles(
      options.directory,
      options.initialize === true,
    );
    const knownRoot = new Set([
      'metadata.sqlite',
      'metadata.sqlite-wal',
      'metadata.sqlite-shm',
      'metadata.sqlite-journal',
      'process-lock.sqlite',
      'process-lock.sqlite-journal',
      'users',
      'staging',
    ]);
    if (this.files.list().some((name) => !knownRoot.has(name)))
      throw new StorageError('corrupt', '数据目录包含未知顶层内容');
    for (const name of this.files.list()) this.files.path(name);
    const timeout = options.busyTimeoutMs ?? 1000;
    if (!Number.isInteger(timeout) || timeout < 0 || timeout > 5000)
      throw new StorageError('invalid', '数据库等待时间无效');
    this.lock = new StorageVolumeLock(this.files);
    let db: Database.Database | undefined;
    try {
      const exists = this.files.exists('metadata.sqlite');
      if (!exists && !options.initialize)
        throw new StorageError('not-found', '存储尚未初始化');
      if (
        !exists &&
        (this.files.inventory('users').length ||
          this.files.inventory('staging').length)
      ) {
        throw new StorageError(
          'corrupt',
          '数据库缺失但文件仍存在，必须恢复一致备份',
        );
      }
      db = new Database(this.files.path('metadata.sqlite'), {
        timeout,
        fileMustExist: !options.initialize,
      });
      chmodSync(this.files.path('metadata.sqlite'), 0o600);
      this.connection = db;
      this.checkIntegrity();
      const tables = db
        .prepare<
          [],
          { name: string }
        >("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all();
      if (!tables.length) {
        if (
          !options.initialize ||
          this.files.inventory('users').length ||
          this.files.inventory('staging').length
        ) {
          throw new StorageError(
            'schema-incompatible',
            '数据库未初始化或缺少提交状态，禁止自动认领文件',
          );
        }
        db.pragma('foreign_keys = ON');
        db.transaction(() => {
          db!.exec(migration);
          db!
            .prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)')
            .run(migrationDigest, new Date().toISOString());
          db!
            .prepare('INSERT INTO deployment VALUES (1, ?, ?, ?)')
            .run(randomUUID(), randomUUID(), options.mode);
          db!.exec(AUTH_MIGRATION);
          db!
            .prepare('INSERT INTO schema_migrations VALUES (2, ?, ?)')
            .run(sha256(AUTH_MIGRATION), new Date().toISOString());
          db!.exec(OIDC_MIGRATION);
          db!
            .prepare('INSERT INTO schema_migrations VALUES (3, ?, ?)')
            .run(sha256(OIDC_MIGRATION), new Date().toISOString());
          db!.pragma('user_version = 3');
          if (options.mode === 'shared') {
            db!.prepare('INSERT INTO users VALUES (?, 1)').run(SHARED_OWNER);
            db!
              .prepare('INSERT INTO owner_usage VALUES (?, 0, 0)')
              .run(SHARED_OWNER);
          }
        }).immediate();
      }
      this.verifySchema();
      const deployment = db
        .prepare<
          [],
          {
            deployment_id: string;
            workspace_epoch: string;
            account_mode: AccountMode;
          }
        >('SELECT * FROM deployment WHERE singleton = 1')
        .get();
      if (!deployment || deployment.account_mode !== options.mode)
        throw new StorageError(
          'mode-mismatch',
          '账号模式与已有数据不符，需备份及显式归属迁移',
        );
      assertUuid(deployment.deployment_id);
      assertUuid(deployment.workspace_epoch);
      this.deployment = {
        deploymentId: deployment.deployment_id,
        workspaceEpoch: deployment.workspace_epoch,
        accountMode: deployment.account_mode,
      };
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = FULL');
      db.pragma('foreign_keys = ON');
      this.checkIntegrity();
      if (options.authBackupDirectory)
        this.upgradeAccountSchema(options.authBackupDirectory, 2);
      if (options.oidcBackupDirectory)
        this.upgradeAccountSchema(options.oidcBackupDirectory, 3);
      this.files.mkdir('users');
      this.files.mkdir('staging');
    } catch (error) {
      db?.close();
      this.lock.close();
      throw error;
    }
  }

  verifySchema(): void {
    const version = this.connection.pragma('user_version', { simple: true });
    if (version !== 1 && version !== 2 && version !== 3)
      throw new StorageError(
        'schema-incompatible',
        '不支持的存储 schema，禁止降级或清库',
      );
    const rows = this.connection
      .prepare<
        [],
        { version: number; digest: string }
      >('SELECT version, digest FROM schema_migrations ORDER BY version')
      .all();
    if (
      rows.length !== version ||
      rows[0].version !== 1 ||
      rows[0].digest !== migrationDigest ||
      (version >= 2 &&
        (rows[1].version !== 2 || rows[1].digest !== sha256(AUTH_MIGRATION))) ||
      (version === 3 &&
        (rows[2].version !== 3 || rows[2].digest !== sha256(OIDC_MIGRATION)))
    )
      throw new StorageError(
        'schema-incompatible',
        '迁移历史或摘要与当前代码不符',
      );
    if (
      JSON.stringify(this.connection.prepare(schemaQuery).all()) !==
      (version === 1
        ? expectedSchemaV1
        : version === 2
          ? expectedSchemaV2
          : expectedSchemaV3)
    ) {
      throw new StorageError(
        'schema-incompatible',
        '实际表或索引结构与迁移定义不符',
      );
    }
  }

  /** 离线逐版本升级：完整备份与校验成功后才改变账号结构。 */
  private upgradeAccountSchema(directory: string, target: 2 | 3): void {
    const source = target - 1;
    if (this.connection.pragma('user_version', { simple: true }) !== source)
      throw new StorageError(
        'invalid',
        `此命令仅升级 schema ${source} 到 ${target}`,
      );
    const requested = join(
      realpathSync(dirname(directory)),
      basename(directory),
    );
    if (
      !isAbsolute(directory) ||
      requested === this.files.root ||
      requested.startsWith(this.files.root + '/')
    )
      throw new StorageError('invalid', '备份必须为数据卷之外的新空目录');
    const backup = new StorageFiles(directory, true);
    if (
      backup.root === this.files.root ||
      backup.root.startsWith(this.files.root + '/') ||
      backup.list().length
    )
      throw new StorageError('invalid', '备份必须为数据卷之外的新空目录');
    this.connection.pragma('wal_checkpoint(TRUNCATE)');
    const names = [
      'metadata.sqlite',
      ...this.files.inventory('users').map((x) => x.path),
      ...this.files.inventory('staging').map((x) => x.path),
    ];
    const entries: { path: string; sha256: string; size: number }[] = [];
    for (const name of names) {
      const bytes = this.files.read(name, Number.MAX_SAFE_INTEGER);
      const parent = name.slice(0, name.lastIndexOf('/'));
      if (name.includes('/')) backup.mkdir(parent);
      backup.writeNew(name, bytes);
      backup.verify(name, sha256(bytes), bytes.length);
      entries.push({ path: name, sha256: sha256(bytes), size: bytes.length });
    }
    const check = new Database(backup.path('metadata.sqlite'), {
      readonly: true,
    });
    try {
      if (
        check.pragma('integrity_check', { simple: true }) !== 'ok' ||
        check.prepare('PRAGMA foreign_key_check').all().length
      )
        throw new StorageError('corrupt', '升级备份校验失败');
    } finally {
      check.close();
    }
    backup.writeNew(
      'backup-manifest.json',
      Buffer.from(JSON.stringify({ schema: source, files: entries })),
    );
    this.connection.pragma('foreign_keys = ON');
    this.connection
      .transaction(() => {
        const sql = target === 2 ? AUTH_MIGRATION : OIDC_MIGRATION;
        this.connection.exec(sql);
        this.connection
          .prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)')
          .run(target, sha256(sql), new Date().toISOString());
        this.connection.pragma(`user_version = ${target}`);
      })
      .immediate();
    this.verifySchema();
  }

  checkIntegrity(): void {
    const results = this.connection
      .prepare<[], { integrity_check: string }>('PRAGMA integrity_check')
      .all();
    if (
      results.length !== 1 ||
      results[0].integrity_check !== 'ok' ||
      this.connection.prepare('PRAGMA foreign_key_check').all().length
    ) {
      throw new StorageError('corrupt', '数据库完整性或外键检查失败');
    }
  }

  /** 仅供后续可信账号模块调用；此方法不创建密码、登录或管理员权限。 */
  registerOwner(id: string): void {
    assertUuid(id);
    if (this.deployment.accountMode !== 'accounts' || id === SHARED_OWNER)
      throw new StorageError('invalid', '共享模式不新增独立用户');
    this.connection
      .transaction(() => {
        this.connection.prepare('INSERT INTO users VALUES (?, 1)').run(id);
        this.connection
          .prepare('INSERT INTO owner_usage VALUES (?, 0, 0)')
          .run(id);
      })
      .immediate();
  }

  assertOwner(id: string): void {
    assertUuid(id);
    if (this.deployment.accountMode === 'shared' && id !== SHARED_OWNER)
      throw new StorageError('not-found', '工作区不可访问');
    const row = this.connection
      .prepare<
        [string],
        { enabled: number }
      >('SELECT enabled FROM users WHERE id = ?')
      .get(id);
    if (!row?.enabled) throw new StorageError('not-found', '工作区不可访问');
  }

  /** 离线复制前关闭内容数据库，但继续持有卷锁直到 close。 */
  closeForBackup(): void {
    const result = this.connection.pragma('wal_checkpoint(TRUNCATE)') as {
      busy: number;
    }[];
    if (result.length !== 1 || result[0].busy !== 0)
      throw new StorageError('locked', '数据库 checkpoint 未完成，不能备份');
    this.connection.close();
  }

  close(): void {
    if (this.closed) return;
    if (this.connection.open) this.connection.close();
    this.lock.close();
    this.closed = true;
  }
}
