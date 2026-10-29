import Database from 'better-sqlite3';
import { chmodSync } from 'node:fs';
import { StorageFiles } from './storage-files';
import { StorageError } from './storage-contract';

/** 服务、离线备份与恢复共用同一卷锁；进程退出后由 SQLite 释放。 */
export class StorageVolumeLock {
  private readonly connection: Database.Database;
  constructor(files: StorageFiles) {
    this.connection = new Database(files.path('process-lock.sqlite'), {
      timeout: 0,
    });
    try {
      chmodSync(files.path('process-lock.sqlite'), 0o600);
      this.connection.exec('BEGIN EXCLUSIVE');
    } catch (error) {
      this.connection.close();
      throw new StorageError('locked', '数据卷正被另一个服务或维护进程使用', {
        cause: error,
      });
    }
  }
  close(): void {
    if (!this.connection.open) return;
    this.connection.exec('ROLLBACK');
    this.connection.close();
  }
}
