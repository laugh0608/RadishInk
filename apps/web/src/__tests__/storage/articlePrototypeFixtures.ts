import type { HistorySnapshot } from "../../store/historyTypes";

export function syntheticArticle(id = "synthetic-a"): HistorySnapshot {
  return {
    id,
    title: "合成文章",
    markdown: "\uFEFF---\r\ncustomFlag: keep\r\n---\r\n\r\n# 合成正文\r\n",
    theme: "default",
    themeName: "默认主题",
    customCSS: "p { color: green; }",
    createdAt: "2026-10-14T00:00:00.000Z",
    savedAt: "2026-10-14T01:00:00.000Z",
  };
}

type FileNode = { kind: "file"; bytes: Blob };
type DirectoryNode = { kind: "directory"; children: Map<string, Node> };
type Node = FileNode | DirectoryNode;

/** 模拟 File System Access 的暂存后 close 提交，而不是把每次 write 当作成功。 */
export function syntheticFileSystem(name = "radishink-p2a-prototype-test") {
  const tree: DirectoryNode = { kind: "directory", children: new Map() };
  const faults: { step?: (event: string, path: string) => void } = {};
  const fail = (event: string, path: string) => faults.step?.(event, path);
  function directory(
    node: DirectoryNode,
    name: string,
    path: string,
  ): FileSystemDirectoryHandle {
    const handle = {
      kind: "directory",
      name,
      async getDirectoryHandle(child: string, options?: { create?: boolean }) {
        fail("directory", `${path}/${child}`);
        let next = node.children.get(child);
        if (!next && options?.create) {
          next = { kind: "directory", children: new Map() };
          node.children.set(child, next);
        }
        if (!next) throw new DOMException("missing", "NotFoundError");
        if (next.kind !== "directory")
          throw new DOMException("file", "TypeMismatchError");
        return directory(next, child, `${path}/${child}`);
      },
      async getFileHandle(child: string, options?: { create?: boolean }) {
        fail("file", `${path}/${child}`);
        let next = node.children.get(child);
        if (!next && options?.create) {
          next = { kind: "file", bytes: new Blob([]) };
          node.children.set(child, next);
        }
        if (!next) throw new DOMException("missing", "NotFoundError");
        if (next.kind !== "file")
          throw new DOMException("directory", "TypeMismatchError");
        const fileNode = next;
        return {
          kind: "file",
          name: child,
          async getFile() {
            fail("read", `${path}/${child}`);
            return new File([fileNode.bytes], child);
          },
          async createWritable() {
            fail("writable", `${path}/${child}`);
            let pending: Blob;
            return {
              async write(value: string | Blob) {
                fail("write", `${path}/${child}`);
                pending = new Blob([value]);
              },
              async close() {
                fail("close", `${path}/${child}`);
                fileNode.bytes = pending;
              },
              async abort() {},
            };
          },
        } as unknown as FileSystemFileHandle;
      },
      async *values() {
        for (const [name, entry] of node.children)
          yield { kind: entry.kind, name };
      },
      async removeEntry(child: string) {
        fail("remove", `${path}/${child}`);
        if (!node.children.delete(child))
          throw new DOMException("missing", "NotFoundError");
      },
    };
    return handle as unknown as FileSystemDirectoryHandle;
  }
  let tail = Promise.resolve();
  const locks = {
    request(_name: string, action: () => Promise<unknown>) {
      const pending = tail.then(action);
      tail = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
  } as Pick<LockManager, "request">;
  return { root: directory(tree, name, ""), locks, faults };
}
