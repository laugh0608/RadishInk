import Database from 'better-sqlite3';
import { chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { StorageFiles } from './storage-files';
import { StorageError, assertUuid, sha256 } from './storage-contract';

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
const expectedSchema = JSON.stringify(
  schemaReference.prepare(schemaQuery).all(),
);
schemaReference.close();

/** 独占连接只锁 process-lock.sqlite；metadata 的短事务仍可独立提交。 */
export class StorageDatabase {
  readonly files: StorageFiles;
  readonly connection: Database.Database;
  readonly deployment: Deployment;
  private lock: Database.Database;
  private closed = false;

  constructor(options: {
    directory: string;
    mode: AccountMode;
    initialize?: boolean;
    busyTimeoutMs?: number;
  }) {
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
    this.lock = new Database(this.files.path('process-lock.sqlite'), {
      timeout: 0,
    });
    chmodSync(this.files.path('process-lock.sqlite'), 0o600);
    try {
      this.lock.exec('BEGIN EXCLUSIVE');
    } catch (error) {
      this.lock.close();
      throw new StorageError('locked', '数据卷正被另一个服务或维护进程使用', {
        cause: error,
      });
    }
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
          db!.pragma('user_version = 1');
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
      this.files.mkdir('users');
      this.files.mkdir('staging');
    } catch (error) {
      db?.close();
      this.lock.exec('ROLLBACK');
      this.lock.close();
      throw error;
    }
  }

  verifySchema(): void {
    if (this.connection.pragma('user_version', { simple: true }) !== 1)
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
      rows.length !== 1 ||
      rows[0].version !== 1 ||
      rows[0].digest !== migrationDigest
    )
      throw new StorageError(
        'schema-incompatible',
        '迁移历史或摘要与当前代码不符',
      );
    if (
      JSON.stringify(this.connection.prepare(schemaQuery).all()) !==
      expectedSchema
    ) {
      throw new StorageError(
        'schema-incompatible',
        '实际表或索引结构与迁移定义不符',
      );
    }
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

  close(): void {
    if (this.closed) return;
    this.connection.close();
    this.lock.exec('ROLLBACK');
    this.lock.close();
    this.closed = true;
  }
}
