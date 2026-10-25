import { parentPort, workerData } from 'node:worker_threads';
import { StorageDatabase } from '../storage/storage-database';
import { ArticleRepository } from '../storage/article-repository';
import { StorageMaintenance } from '../storage/storage-maintenance';
import { assertSession } from '../auth/local-auth';
import { ApiError, publicError } from './api-error';
import { StorageJob, StorageResult } from './storage-worker-protocol';
import { imageMime, validateImage } from './image-validation';

const port = parentPort!;
const { directory } = workerData as { directory: string };
const database = new StorageDatabase({
  directory,
  mode: 'accounts',
  busyTimeoutMs: 100,
});
if (database.connection.pragma('user_version', { simple: true }) !== 3)
  throw new ApiError(503, 'upgrade-required');
new StorageMaintenance(new ArticleRepository(database)).inspect();
port.postMessage({ ready: true, deployment: database.deployment });

// 串行执行文件协议；父线程已限制已接收任务数，无无限等待队列。
let chain = Promise.resolve();
port.on('message', (job: StorageJob) => {
  chain = chain.then(async () => {
    try {
      const authorize = () => {
        if (
          Atomics.load(new Int32Array(job.cancelled), 0) ||
          Date.now() >= job.deadline
        )
          throw new ApiError(503, 'request-expired');
        if (
          assertSession(database.connection, job.digest).userId !== job.ownerId
        )
          throw new ApiError(401, 'unauthorized');
      };
      authorize();
      const repo = new ArticleRepository(database, { authorize });
      const op = job.operation;
      let result: StorageResult;
      switch (op.kind) {
        case 'list':
          result = repo.list(job.ownerId, op.limit, op.after);
          break;
        case 'read':
          result = repo.read(job.ownerId, op.articleId);
          break;
        case 'asset': {
          const bytes = repo.readAsset(
            job.ownerId,
            op.articleId,
            op.path,
            op.revision,
          );
          result = { bytes, mime: imageMime(bytes) };
          break;
        }
        case 'delete':
          result = repo.delete(
            job.ownerId,
            op.articleId,
            op.revision,
            op.operationId,
          );
          break;
        case 'save': {
          for (const asset of op.input.assets) {
            authorize();
            if (asset.bytes) await validateImage(asset.bytes, asset.path);
          }
          authorize();
          const replay = database.connection
            .prepare(
              'SELECT 1 FROM commit_receipts WHERE owner_id=? AND operation_id=?',
            )
            .get(job.ownerId, op.input.operationId);
          result = {
            receipt: repo.commit({ ...op.input, ownerId: job.ownerId }),
            created: !replay && op.input.expectedRevision === null,
          };
          break;
        }
      }
      authorize();
      port.postMessage({ id: job.id, result });
    } catch (error) {
      const safe = publicError(error);
      port.postMessage({
        id: job.id,
        error: { status: safe.status, code: safe.code },
      });
    }
  });
});
