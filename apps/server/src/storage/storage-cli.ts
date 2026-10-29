import { parseArgs } from 'node:util';
import { ArticleRepository } from './article-repository';
import { AccountMode, StorageDatabase } from './storage-database';
import { StorageMaintenance } from './storage-maintenance';
import { StorageError } from './storage-contract';
import {
  backupStorage,
  restoreStorage,
  convertStorage,
} from './storage-backup';

export function runStorageCommand(args: string[]): unknown {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      'data-dir': { type: 'string' },
      mode: { type: 'string' },
      apply: { type: 'boolean', default: false },
      plan: { type: 'string' },
      'backup-dir': { type: 'string' },
      'target-dir': { type: 'string' },
      'target-mode': { type: 'string' },
      'owner-id': { type: 'string' },
      'confirm-shared': { type: 'boolean', default: false },
    },
  });
  const command = positionals[0];
  if (
    positionals.length !== 1 ||
    ![
      'init',
      'check',
      'cleanup',
      'reindex',
      'backup',
      'restore',
      'convert-mode',
    ].includes(command) ||
    !values['data-dir'] ||
    !values.mode ||
    !['accounts', 'shared'].includes(values.mode)
  ) {
    throw new StorageError(
      'invalid',
      '用法：storage <init|check|cleanup|reindex|backup|restore> --data-dir <绝对路径> --mode <accounts|shared> [--backup-dir <绝对路径>] [--apply --plan <摘要>]',
    );
  }
  if (
    (values.apply || values.plan) &&
    !['cleanup', 'reindex'].includes(command)
  )
    throw new StorageError('invalid', '该命令不接受清理或修改参数');
  if (command === 'cleanup' && values.apply && !values.plan)
    throw new StorageError('invalid', '清理须提供检查报告的 --plan 摘要');
  if (command === 'reindex' && (!values.apply || values.plan))
    throw new StorageError(
      'invalid',
      '重建派生索引须显式 --apply，且不接受清理摘要',
    );
  if (command === 'convert-mode') {
    if (
      !values['backup-dir'] ||
      !values['target-dir'] ||
      !values['owner-id'] ||
      !['accounts', 'shared'].includes(values['target-mode'] ?? '')
    )
      throw new StorageError(
        'invalid',
        '转换须指定 --backup-dir、--target-dir、--target-mode 与 --owner-id',
      );
    return convertStorage(
      values['data-dir'],
      values['backup-dir'],
      values['target-dir'],
      values.mode as AccountMode,
      {
        targetMode: values['target-mode'] as AccountMode,
        ownerId: values['owner-id'],
        confirmShared: values['confirm-shared'],
      },
    );
  }
  if (
    values['target-dir'] ||
    values['target-mode'] ||
    values['owner-id'] ||
    values['confirm-shared']
  )
    throw new StorageError('invalid', '仅 convert-mode 接受归属转换参数');
  const backupCommand = command === 'backup' || command === 'restore';
  if (backupCommand !== !!values['backup-dir'])
    throw new StorageError(
      'invalid',
      '仅 backup / restore 命令必须提供 --backup-dir',
    );
  if (backupCommand) {
    const execute = command === 'backup' ? backupStorage : restoreStorage;
    return execute(
      values['data-dir'],
      values['backup-dir']!,
      values.mode as AccountMode,
    );
  }
  const database = new StorageDatabase({
    directory: values['data-dir'],
    mode: values.mode as AccountMode,
    initialize: command === 'init',
  });
  try {
    const maintenance = new StorageMaintenance(new ArticleRepository(database));
    if (command === 'reindex') maintenance.rebuildDerivedIndexes();
    if (command === 'cleanup' && values.apply)
      return maintenance.cleanup(values.plan!);
    return maintenance.inspect();
  } finally {
    database.close();
  }
}

if (require.main === module) {
  try {
    process.stdout.write(
      `${JSON.stringify(runStorageCommand(process.argv.slice(2)), null, 2)}\n`,
    );
  } catch (error) {
    const code =
      error instanceof StorageError ? error.code : 'io-or-database-error';
    const message =
      error instanceof StorageError
        ? error.message
        : '存储操作失败，检查目录权限、磁盘和数据库状态';
    let cause: unknown = error;
    let systemCode: string | undefined;
    for (
      let depth = 0;
      depth < 6 && cause && typeof cause === 'object';
      depth++
    ) {
      const detail = cause as { code?: unknown; cause?: unknown };
      if (
        typeof detail.code === 'string' &&
        /^(E[A-Z0-9_]+|SQLITE_[A-Z0-9_]+)$/.test(detail.code)
      ) {
        systemCode = detail.code;
        break;
      }
      cause = detail.cause;
    }
    // 保留可定位的系统错误码，不输出原始文件内容、SQL、路径或调用参数。
    process.stderr.write(
      `${JSON.stringify({ error: { code, message, systemCode } })}\n`,
    );
    process.exitCode = 1;
  }
}
