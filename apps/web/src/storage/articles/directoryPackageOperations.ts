import { ArticleStorageError, assertSegment, digest } from "./articleContract";
import {
  optionalDirectory,
  optionalFile,
  readJson,
  writeFile,
} from "./directoryArticleIO";
import {
  resolveDirectoryHandle,
  resolveParentAndName,
} from "../adapters/fileSystemAdapterHelpers";

export const DIRECTORY_LOCK = "radishink:directory-articles";
export const OPERATIONS_DIRECTORY = ".radishink-operations";
type Inventory = Record<string, string>;
interface Operation {
  format: 1;
  id: string;
  source: string;
  target: string | null;
  files: Inventory;
}
export interface DirectoryOperationSummary {
  id: string;
  source: string;
  target: string | null;
  complete: boolean;
}

export function checkedPath(path: string) {
  if (!path) throw new ArticleStorageError("invalid", "路径不能为空");
  path.split("/").forEach(assertSegment);
  return path;
}

// 清单包含隐藏控制记录和空目录，移动/删除不能漏掉包内字节。
async function inventory(
  root: FileSystemDirectoryHandle,
  base = "",
  result: Inventory = {},
) {
  for await (const entry of root.values()) {
    const path = `${base}${entry.name}`;
    if (path === ".radishink/lifecycle.json") continue;
    if (entry.kind === "directory") {
      result[`${path}/`] = "directory";
      await inventory(
        await root.getDirectoryHandle(entry.name),
        `${path}/`,
        result,
      );
    } else
      result[path] = await digest(
        await (await root.getFileHandle(entry.name)).getFile(),
      );
  }
  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  );
}
function same(a: Inventory, b: Inventory) {
  return JSON.stringify(a) === JSON.stringify(b);
}
async function copy(
  source: FileSystemDirectoryHandle,
  target: FileSystemDirectoryHandle,
) {
  for await (const entry of source.values()) {
    if (entry.kind === "directory")
      await copy(
        await source.getDirectoryHandle(entry.name),
        await target.getDirectoryHandle(entry.name, { create: true }),
      );
    else
      await writeFile(
        target,
        entry.name,
        await (await source.getFileHandle(entry.name)).getFile(),
      );
  }
}
async function directoryAt(root: FileSystemDirectoryHandle, path: string) {
  const { parent, name } = await resolveParentAndName(root, checkedPath(path));
  return { parent, name, handle: await optionalDirectory(parent, name) };
}
function validate(value: unknown, id: string): asserts value is Operation {
  const op = value as Operation;
  if (
    !op ||
    op.format !== 1 ||
    op.id !== id ||
    !/^[a-f0-9-]{36}$/.test(id) ||
    !op.files ||
    typeof op.files !== "object"
  )
    throw new ArticleStorageError("invalid", "整包操作日志无效");
  checkedPath(op.source);
  if (op.target !== null) checkedPath(op.target);
  for (const [path, hash] of Object.entries(op.files)) {
    // 内部清单允许隐藏控制文件，但拒绝路径逃逸。
    if (
      path
        .split("/")
        .filter(Boolean)
        .some(
          (p) =>
            !p ||
            p === "." ||
            p === ".." ||
            p.includes("\\") ||
            Array.from(p).some((c) => c.charCodeAt(0) < 32),
        ) ||
      path.startsWith("/") ||
      (hash !== "directory" && !/^[a-f0-9]{64}$/.test(hash))
    )
      throw new ArticleStorageError("invalid", "整包操作清单无效");
  }
}

/** 调用方持有 DIRECTORY_LOCK；先保留完整副本，再显式推进移动/删除。 */
export async function beginPackageOperation(
  root: FileSystemDirectoryHandle,
  source: string,
  target: string | null,
) {
  checkedPath(source);
  if (target !== null) {
    checkedPath(target);
    if (target === source) return;
    if (target.startsWith(`${source}/`))
      throw new ArticleStorageError("invalid", "不能移动到文章包内部");
    const destination = await directoryAt(root, target);
    if (
      destination.handle ||
      (await optionalFile(destination.parent, destination.name))
    )
      throw new ArticleStorageError("conflict", "目标已存在，未移动文章");
  }
  const original = await resolveDirectoryHandle(root, source);
  const owner = (await readJson(original, ".radishink-owner.json")) as {
    format?: number;
    articleId?: string;
  } | null;
  if (owner?.format !== 1 || !owner.articleId)
    throw new ArticleStorageError("invalid", "只允许操作具有有效身份的文章包");
  const files = await inventory(original);
  const id = crypto.randomUUID();
  const operations = await root.getDirectoryHandle(OPERATIONS_DIRECTORY, {
    create: true,
  });
  const journal = await operations.getDirectoryHandle(id, { create: true });
  const backup = await journal.getDirectoryHandle("package", { create: true });
  await copy(original, backup);
  if (
    !same(files, await inventory(backup)) ||
    !same(files, await inventory(original))
  )
    throw new ArticleStorageError("conflict", "复制校验期间文章变化，原包保留");
  const operation: Operation = { format: 1, id, source, target, files };
  await writeFile(journal, "operation.json", JSON.stringify(operation));
  await writeFile(
    await original.getDirectoryHandle(".radishink"),
    "lifecycle.json",
    JSON.stringify({ id }),
  );
  await resumePackageOperation(root, id);
}

export async function resumePackageOperation(
  root: FileSystemDirectoryHandle,
  id: string,
) {
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw new ArticleStorageError("invalid", "操作 ID 无效");
  const journal = await (
    await root.getDirectoryHandle(OPERATIONS_DIRECTORY)
  ).getDirectoryHandle(id);
  const op = await readJson(journal, "operation.json");
  validate(op, id);
  const complete = (await readJson(journal, "complete.json")) as {
    id?: string;
  } | null;
  if (complete?.id === id) return;
  if (complete) throw new ArticleStorageError("invalid", "完成记录归属不匹配");
  const backup = await journal.getDirectoryHandle("package");
  const owner = (await readJson(backup, ".radishink-owner.json")) as {
    format?: number;
    articleId?: string;
  } | null;
  if (owner?.format !== 1 || !owner.articleId)
    throw new ArticleStorageError("invalid", "恢复副本不是文章包");
  if (!same(op.files, await inventory(backup)))
    throw new ArticleStorageError("conflict", "整包恢复副本已变化，停止操作");
  const original = await directoryAt(root, op.source);
  if (original.handle && !same(op.files, await inventory(original.handle)))
    throw new ArticleStorageError(
      "conflict",
      "原文章包已变化，保留原件与恢复副本，不能继续删除",
    );
  if (original.handle) {
    const control = await original.handle.getDirectoryHandle(".radishink");
    const marker = (await readJson(control, "lifecycle.json")) as {
      id?: string;
    } | null;
    if (marker && marker.id !== id)
      throw new ArticleStorageError("conflict", "原包已有另一整包操作");
    if (!marker)
      await writeFile(control, "lifecycle.json", JSON.stringify({ id }));
  }
  if (op.target) {
    const destination = await directoryAt(root, op.target);
    const claim = await optionalFile(journal, "target-claimed.json");
    if (!claim && destination.handle)
      throw new ArticleStorageError("conflict", "移动目标被占用");
    // claim 落盘后若外部程序创建目标，仍仅允许清单内且字节相同的部分副本。
    if (!claim)
      await writeFile(
        journal,
        "target-claimed.json",
        JSON.stringify({ target: op.target }),
      );
    const target =
      destination.handle ??
      (await destination.parent.getDirectoryHandle(destination.name, {
        create: true,
      }));
    const actual = await inventory(target);
    const emptyHash = await digest(new Blob([]));
    if (
      Object.entries(actual).some(
        ([p, h]) => op.files[p] !== h && !(op.files[p] && h === emptyHash),
      )
    )
      throw new ArticleStorageError(
        "conflict",
        "移动目标含有其他内容，保留两份等待处理",
      );
    await copy(backup, target);
    if (!same(op.files, await inventory(target)))
      throw new ArticleStorageError("conflict", "整包移动目标校验失败");
  }
  // 最后一次验证缩小外部编辑窗口；文件系统不提供跨文件 CAS。
  if (original.handle) {
    if (!same(op.files, await inventory(original.handle)))
      throw new ArticleStorageError("conflict", "删除前原包再次变化");
    await original.parent.removeEntry(original.name, { recursive: true });
  }
  await writeFile(journal, "complete.json", JSON.stringify({ id: op.id }));
}

export async function listPackageOperations(
  root: FileSystemDirectoryHandle,
): Promise<DirectoryOperationSummary[]> {
  const folder = await optionalDirectory(root, OPERATIONS_DIRECTORY);
  if (!folder) return [];
  const list: DirectoryOperationSummary[] = [];
  for await (const entry of folder.values()) {
    if (entry.kind !== "directory")
      throw new ArticleStorageError(
        "invalid",
        "操作目录含未知文件，请检查磁盘记录",
      );
    const journal = await folder.getDirectoryHandle(entry.name);
    const op = await readJson(journal, "operation.json");
    // 发布日志前失败的副本不影响原包，不自动删除；界面提示手工检查。
    if (!op) {
      list.push({
        id: entry.name,
        source: "未完成暂存（请在磁盘检查）",
        target: null,
        complete: false,
      });
      continue;
    }
    validate(op, entry.name);
    list.push({
      id: entry.name,
      source: op.source,
      target: op.target,
      complete:
        ((await readJson(journal, "complete.json")) as { id?: string } | null)
          ?.id === entry.name,
    });
  }
  return list;
}

export async function cleanupPackageOperation(
  root: FileSystemDirectoryHandle,
  id: string,
) {
  const operations = await root.getDirectoryHandle(OPERATIONS_DIRECTORY);
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw new ArticleStorageError("invalid", "操作 ID 无效");
  const folder = await operations.getDirectoryHandle(id);
  const op = await readJson(folder, "operation.json");
  validate(op, id);
  if (
    ((await readJson(folder, "complete.json")) as { id?: string } | null)
      ?.id !== id
  )
    throw new ArticleStorageError("recovery-required", "未完成操作不可清理");
  if (
    !same(op.files, await inventory(await folder.getDirectoryHandle("package")))
  )
    throw new ArticleStorageError("conflict", "恢复副本已改变，不自动清理");
  for await (const entry of folder.values())
    if (
      ![
        "package",
        "operation.json",
        "complete.json",
        "target-claimed.json",
      ].includes(entry.name)
    )
      throw new ArticleStorageError(
        "conflict",
        "操作目录含未知文件，不自动清理",
      );
  await operations.removeEntry(id, { recursive: true });
}
