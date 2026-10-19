export type StorageType = "indexeddb" | "filesystem";

export interface FileItem {
  path: string;
  name: string;
  size?: number;
  updatedAt?: string;
  meta?: Record<string, unknown>;
}

export interface StorageInitResult {
  ready: boolean;
  message?: string;
  permissionRequired?: boolean;
}

export interface StorageAdapterContext {
  /**
   * Optional metadata for adapters that require handles or tokens.
   */
  identifier?: string;
  /** 页面恢复不得自动打开选择器或请求权限。 */
  restore?: boolean;
}
