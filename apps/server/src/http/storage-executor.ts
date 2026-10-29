import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { ApiError } from './api-error';
import { HTTP_POLICY } from './server-policy';
import type { AccountMode, Deployment } from '../storage/storage-database';
import type {
  StorageJob,
  StorageOperation,
  StorageResult,
  WorkerReply,
} from './storage-worker-protocol';

export class StorageExecutor {
  private readonly worker: Worker;
  private nextId = 0;
  private failed = false;
  private pending = new Map<
    number,
    {
      resolve: (value: StorageResult) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  readonly ready: Promise<Deployment>;
  constructor(directory: string, mode: AccountMode = 'accounts') {
    this.worker = new Worker(join(__dirname, 'storage-worker.js'), {
      workerData: { directory, mode },
    });
    this.ready = new Promise((resolve, reject) => {
      this.worker.once(
        'message',
        (message: { ready: boolean; deployment: Deployment }) => {
          if (message.ready) resolve(message.deployment);
          else reject(new ApiError(503, 'storage-startup'));
        },
      );
      this.worker.once('error', () =>
        reject(new ApiError(503, 'storage-startup')),
      );
      this.worker.once('exit', () =>
        reject(new ApiError(503, 'storage-stopped')),
      );
    });
    this.worker.on('message', (message: WorkerReply) => {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error)
        pending.reject(new ApiError(message.error.status, message.error.code));
      else pending.resolve(message.result!);
    });
    this.worker.on('error', () => this.fail());
    this.worker.on('exit', () => this.fail());
  }
  isHealthy(): boolean {
    return !this.failed;
  }
  private fail(): void {
    this.failed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new ApiError(503, 'storage-stopped'));
    }
    this.pending.clear();
  }
  run(
    ownerId: string,
    digest: string | null,
    operation: StorageOperation,
    deadline: number,
    cancelled: SharedArrayBuffer,
    workspaceEpoch?: string,
  ): Promise<StorageResult> {
    if (this.failed)
      return Promise.reject(new ApiError(503, 'storage-stopped'));
    if (this.pending.size >= HTTP_POLICY.storageJobs)
      return Promise.reject(new ApiError(429, 'storage-busy'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          Atomics.store(new Int32Array(cancelled), 0, 1);
          // 不释放仍在执行的 worker 槽位，避免超时后新请求扩大无界积压。
          // HTTP 层按时响应；直到 worker 实际结束才释放槽位和每用户提交锁。
        },
        Math.max(1, deadline - Date.now()),
      );
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({
        id,
        ownerId,
        digest,
        workspaceEpoch,
        operation,
        deadline,
        cancelled,
      } satisfies StorageJob);
    });
  }
  async close(): Promise<void> {
    this.fail();
    await this.worker.terminate();
  }
}
