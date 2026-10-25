import { assertPrototypeName } from "./articleContract";
import { DirectoryArticleStore } from "./directoryArticleStore";

/** 合成原型保留原控制布局，验证不能误写用户目录。 */
export class DirectoryArticlePrototype extends DirectoryArticleStore {
  constructor(
    root: FileSystemDirectoryHandle,
    directory: string,
    articleId: string,
    locks: Pick<LockManager, "request"> | undefined = navigator.locks,
  ) {
    assertPrototypeName(root.name);
    super(root, directory, articleId, locks, true);
  }
}
