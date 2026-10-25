import { Transaction } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { ArticleImageTarget } from "./ArticleWorkspaceContext";
import { checkImageBatch, prepareImage } from "./imagePolicy";

interface PendingInsertion {
  from: number;
  to: number;
  target: ArticleImageTarget;
}

/** 锚点随 CodeMirror 更改移动；取消只丢弃插入意图，不删除已提交字节。 */
export class ImageInsertion {
  private pending: PendingInsertion | null = null;
  constructor(
    private view: EditorView,
    private status: (busy: boolean) => void,
    private report: (message: string) => void,
  ) {}
  begin(target: ArticleImageTarget) {
    if (this.pending) throw new Error("图片正在处理中，请等待或取消本次插入");
    const { from, to } = this.view.state.selection.main;
    this.pending = { from, to, target };
    this.status(true);
  }
  cancel() {
    this.pending = null;
    this.status(false);
  }
  update(update: ViewUpdate) {
    const pending = this.pending;
    if (!pending || !update.docChanged) return;
    if (
      update.transactions.some(
        (tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"),
      )
    ) {
      this.cancel();
      return;
    }
    let changedSelection = false;
    update.changes.iterChangedRanges((from, to) => {
      if (
        pending.from === pending.to
          ? from < pending.from && to > pending.from
          : from < pending.to && to > pending.from
      )
        changedSelection = true;
    });
    if (changedSelection) {
      this.cancel();
      this.report("原选区已修改，图片插入已取消");
      return;
    }
    const empty = pending.from === pending.to;
    pending.from = update.changes.mapPos(pending.from, 1);
    pending.to = update.changes.mapPos(pending.to, empty ? 1 : -1);
  }
  async insert(files: File[]) {
    const pending = this.pending;
    if (!pending) return;
    try {
      checkImageBatch(files);
      const assets = [];
      for (const file of files) {
        if (this.pending !== pending || !pending.target.isCurrent()) return;
        try {
          assets.push(await prepareImage(file));
        } catch (error) {
          this.report(
            `${file.name || "剪贴板图片"}：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (
        !assets.length ||
        this.pending !== pending ||
        !pending.target.isCurrent()
      )
        return;
      await pending.target.append(assets);
      if (this.pending !== pending || !pending.target.isCurrent()) return;
      this.pending = null;
      this.view.dispatch({
        changes: {
          from: pending.from,
          to: pending.to,
          insert: assets.map((asset) => `![图片](${asset.path})`).join("\n"),
        },
        annotations: Transaction.userEvent.of("input.paste"),
      });
    } catch (error) {
      this.report(
        `图片未插入：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (this.pending === pending) this.pending = null;
      if (!this.pending) this.status(false);
    }
  }
}
