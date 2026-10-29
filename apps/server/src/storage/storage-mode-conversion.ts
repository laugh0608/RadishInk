import {
  StorageError,
  assertUuid,
  assertRevision,
  sha256,
} from './storage-contract';
import {
  AccountMode,
  ArticleRow,
  SHARED_OWNER,
  StorageDatabase,
} from './storage-database';
import { snapshotDirectory } from './storage-snapshots';

export interface ModeConversion {
  targetMode: AccountMode;
  ownerId: string;
  confirmShared: boolean;
}

/** 同一检查在源卷备份前与恢复暂存副本中重复执行。 */
export function validateConversion(
  db: StorageDatabase,
  plan: ModeConversion,
): void {
  assertUuid(plan.ownerId);
  if (
    !['accounts', 'shared'].includes(plan.targetMode) ||
    plan.targetMode === db.deployment.accountMode ||
    plan.ownerId === SHARED_OWNER
  )
    throw new StorageError('invalid', '必须选择另一模式及明确的真实账号');
  if (db.connection.pragma('user_version', { simple: true }) !== 3)
    throw new StorageError(
      'schema-incompatible',
      '模式转换要求先完成 schema 3 升级',
    );
  const validAccount = db.connection
    .prepare(
      `SELECT 1 FROM users u JOIN account_profiles a ON a.user_id=u.id
    WHERE u.id=? AND u.enabled=1 AND a.admission='approved'`,
    )
    .get(plan.ownerId);
  if (!validAccount)
    throw new StorageError('invalid', '归属账号必须存在、启用且已获准访问');
  if (plan.targetMode === 'shared') {
    if (!plan.confirmShared)
      throw new StorageError('invalid', '必须显式确认所有访问者均可读写文章');
    const owners = db.connection
      .prepare<[string], { id: string }>('SELECT id FROM users WHERE id != ?')
      .all(SHARED_OWNER);
    if (owners.length !== 1 || owners[0].id !== plan.ownerId)
      throw new StorageError(
        'invalid',
        '多用户卷禁止自动转换为共享；先导出并另建共享卷',
      );
  } else if (
    !db.connection
      .prepare(
        `SELECT 1 FROM users u JOIN account_profiles a ON a.user_id=u.id
    WHERE u.enabled=1 AND a.admission='approved' AND a.role='admin'`,
      )
      .get()
  )
    throw new StorageError('invalid', '账号模式必须保留已启用的管理员');
  const from =
    db.deployment.accountMode === 'shared' ? SHARED_OWNER : plan.ownerId;
  if (
    db.connection
      .prepare('SELECT 1 FROM articles WHERE owner_id != ? LIMIT 1')
      .get(from)
  )
    throw new StorageError('corrupt', '存在其他归属的文章或墓碑，禁止合并');
  for (const base of ['users', 'staging']) {
    if (
      db.files
        .inventory(base)
        .some((entry) => entry.path.split('/')[1] !== from)
    )
      throw new StorageError(
        'corrupt',
        '存在其他所有者的文件，先检查和显式清理',
      );
  }
}

/** 仅转换新目标的隔离暂存副本；失败由外层 maintenance-incomplete 阻止启动。 */
export function applyConversion(
  db: StorageDatabase,
  plan: ModeConversion,
): void {
  validateConversion(db, plan);
  const from =
    db.deployment.accountMode === 'shared' ? SHARED_OWNER : plan.ownerId;
  const to = plan.targetMode === 'shared' ? SHARED_OWNER : plan.ownerId;
  const hashes = new Map<string, string>();
  for (const base of ['users', 'staging']) {
    if (db.files.exists(`${base}/${to}`))
      throw new StorageError('conflict', '目标所有者目录已存在，禁止覆盖');
    for (const entry of db.files.inventory(`${base}/${from}`)) {
      if (!entry.path.endsWith('/manifest.json')) continue;
      let manifest: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(
          db.files.read(entry.path, 1024 * 1024).toString('utf8'),
        );
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('manifest');
        manifest = value as Record<string, unknown>;
        if (manifest.format !== 1 || manifest.ownerId !== from)
          throw new Error('identity');
        assertUuid(manifest.articleId as string);
        assertRevision(manifest.revision as number);
        if (base === 'users' && manifest.articleId !== entry.path.split('/')[3])
          throw new Error('article');
      } catch (cause) {
        throw new StorageError(
          'corrupt',
          '保留快照或暂存清单无效，需先检查并清理',
          { cause },
        );
      }
      // 只改协议清单中的归属；正文、用户元数据及图片字节原样保留。
      const bytes = Buffer.from(JSON.stringify({ ...manifest, ownerId: to }));
      db.files.removeFile(entry.path);
      db.files.writeNew(entry.path, bytes);
      hashes.set(entry.path, sha256(bytes));
    }
    if (db.files.exists(`${base}/${from}`))
      db.files.publishDirectory(`${base}/${from}`, `${base}/${to}`);
  }
  const rows = db.connection
    .prepare<[], ArticleRow>('SELECT * FROM articles')
    .all();
  db.connection
    .transaction(() => {
      db.connection.pragma('defer_foreign_keys = ON');
      if (to === SHARED_OWNER) {
        db.connection
          .prepare(
            'INSERT INTO users VALUES (?,1) ON CONFLICT(id) DO UPDATE SET enabled=1',
          )
          .run(to);
      }
      for (const row of rows) {
        const hash = hashes.get(`${snapshotDirectory(row)}/manifest.json`);
        // 已清理墓碑快照可以不存在；其回执、版本与删除状态仍完整保留。
        if (!hash && !row.deleted)
          throw new StorageError('corrupt', '缺少当前文章清单');
        db.connection
          .prepare('UPDATE articles SET owner_id=?, manifest_hash=? WHERE id=?')
          .run(to, hash ?? row.manifest_hash, row.id);
      }
      db.connection
        .prepare('UPDATE commit_receipts SET owner_id=? WHERE owner_id=?')
        .run(to, from);
      db.connection.prepare('DELETE FROM owner_usage').run();
      db.connection
        .prepare(
          `INSERT INTO owner_usage SELECT users.id, COUNT(articles.id), COALESCE(SUM(articles.logical_bytes),0)
      FROM users LEFT JOIN articles ON users.id=articles.owner_id AND articles.deleted=0 GROUP BY users.id`,
        )
        .run();
      db.connection
        .prepare('UPDATE deployment SET account_mode=? WHERE singleton=1')
        .run(plan.targetMode);
    })
    .immediate();
  db.deployment.accountMode = plan.targetMode;
  db.verifyOwnership();
  db.checkIntegrity();
}
