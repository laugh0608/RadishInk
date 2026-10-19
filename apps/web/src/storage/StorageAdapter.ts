import type {
  FileItem,
  StorageAdapterContext,
  StorageInitResult,
  StorageType,
} from "./types";

export interface WorkspaceSelectionResult {
  success: boolean;
  canceled?: boolean;
  workspaceName?: string;
  error?: string;
}

export interface WorkspaceSelectionOptions {
  // 先在用户手势中打开目录选择器，再在提交候选目录前保存旧工作区。
  beforeCommit?: () => Promise<boolean>;
}

export interface StorageAdapter {
  readonly type: StorageType;
  readonly name: string;
  readonly ready: boolean;
  readonly supportsWatch?: boolean;
  readonly supportsFolders?: boolean; // 是否支持文件夹操作
  // 同一适配器切换目录时也会变化，供异步文章操作检查归属。
  getWorkspaceIdentity?(): unknown;
  requestWorkspacePermission?(): Promise<StorageInitResult>;
  getArticleAssets?(
    path: string,
  ): import("./articles/articleContract").ArticleAsset[];
  readArticleAssetsForExport?(
    path: string,
  ): Promise<import("./articles/articleContract").ArticleAsset[]>;
  appendArticleAssets?(
    path: string,
    assets: import("./articles/articleContract").ArticleAsset[],
  ): Promise<void>;

  init(context?: StorageAdapterContext): Promise<StorageInitResult>;
  listFiles(): Promise<FileItem[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  renameFile(oldPath: string, newPath: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  teardown?(): Promise<void>;
  selectWorkspace?(
    options?: WorkspaceSelectionOptions,
  ): Promise<WorkspaceSelectionResult>;

  // 文章目录能力独立于字符串文件接口；返回固定 index.md 路径。
  saveArticleConflictCopy?(
    path: string,
    content: string,
  ): Promise<{ path: string; content: string; title: string }>;
  forgetArticleRead?(path: string): void;
  createArticle?(
    content: string,
    title: string,
    folderPath?: string,
    assets?: import("./articles/articleContract").ArticleAsset[],
  ): Promise<string>;
  copyLegacyArticle?(path: string): Promise<string>;
  recoverArticle?(path: string): Promise<void>;
  cleanupArticleHistory?(path: string): Promise<number>;
  listArticleOperations?(): Promise<
    import("./articles/directoryPackageOperations").DirectoryOperationSummary[]
  >;
  recoverArticleOperation?(id: string): Promise<void>;
  cleanupArticleOperation?(id: string): Promise<void>;

  // 可选的目录操作方法
  createFolder?(
    folderName: string,
  ): Promise<{ success: boolean; path?: string; error?: string }>;
  moveFile?(
    filePath: string,
    targetFolder: string,
  ): Promise<{ success: boolean; newPath?: string; error?: string }>;
  inspectFolder?(
    folderPath: string,
  ): Promise<{ success: boolean; entries?: string[]; error?: string }>;
  deleteFolder?(
    folderPath: string,
    options?: { recursive?: boolean },
  ): Promise<{ success: boolean; error?: string }>;
  renameFolder?(
    oldPath: string,
    newPath: string,
  ): Promise<{ success: boolean; newPath?: string; error?: string }>;
  moveFolder?(
    folderPath: string,
    targetFolder: string,
  ): Promise<{ success: boolean; newPath?: string; error?: string }>;
}
