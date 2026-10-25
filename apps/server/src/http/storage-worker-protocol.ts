import type {
  ArticleWrite,
  ArticleSnapshot,
  CommitReceipt,
} from '../storage/storage-contract';
export type StorageOperation =
  | { kind: 'list'; limit: number; after?: string }
  | { kind: 'read'; articleId: string }
  | { kind: 'asset'; articleId: string; path: string; revision: number }
  | { kind: 'save'; input: Omit<ArticleWrite, 'ownerId'> }
  | {
      kind: 'delete';
      articleId: string;
      revision: number;
      operationId: string;
    };
export interface StorageJob {
  id: number;
  digest: string;
  ownerId: string;
  deadline: number;
  cancelled: SharedArrayBuffer;
  operation: StorageOperation;
}
export type StorageResult =
  | ArticleSnapshot
  | CommitReceipt
  | { id: string; title: string; savedAt: string; revision: number }[]
  | { bytes: Uint8Array; mime: string }
  | { receipt: CommitReceipt; created: boolean };
export interface WorkerReply {
  id: number;
  result?: StorageResult;
  error?: { status: number; code: string };
}
