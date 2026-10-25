import type { StorageContextValue } from "../storage/StorageContext";
import { useEditorStore } from "../store/editorStore";
import { useThemeStore } from "../store/themeStore";
import { useHistoryStore } from "../store/historyStore";
import { useFileStore } from "../store/fileStore";
import { useArticleTransferState } from "../store/articleTransferState";
import { useDirectoryStorageState } from "../store/directoryStorageState";
import { captureWorkspace } from "../hooks/captureWorkspace";

export function assertUpdateIdle(context: StorageContextValue) {
  const transfer = useArticleTransferState.getState();
  if (transfer.imageBusy || transfer.fileBusy)
    throw new Error("图片或文件操作尚未结束，请完成或取消后再更新。");
  const file = useFileStore.getState();
  const history = useHistoryStore.getState();
  if (!context.ready || !context.adapter || context.adapter.ready === false)
    throw new Error("存储尚未就绪，请先完成初始化或重新授权文件夹。");
  if (
    file.isLoading ||
    file.isRestoring ||
    file.isSaving ||
    history.pendingWrites > 0 ||
    useDirectoryStorageState.getState().pendingOperations > 0
  )
    throw new Error("文章正在读取或写入，请等待完成后再更新。");
  if (context.type === "indexeddb" && (history.loading || history.error))
    throw new Error("浏览器文章尚未就绪，请先处理存储提示。");
}

function snapshot() {
  const theme = useThemeStore.getState();
  const file = useFileStore.getState();
  return {
    markdown: useEditorStore.getState().markdown,
    theme: theme.themeId,
    themeName: theme.themeName,
    customCSS: theme.customCSS,
    activeId: useHistoryStore.getState().activeId,
    filePath: file.currentFile?.path,
    fileTitle: file.currentFile?.title,
    fileName: file.currentFile?.name,
  };
}

/** Return a guard to recheck immediately before activation and before reload. */
export async function saveBeforeUpdate(
  getContext: () => StorageContextValue,
  persistFile: (showToast: boolean, ensureCurrent: boolean) => Promise<boolean>,
) {
  const context = getContext();
  assertUpdateIdle(context);
  const before = snapshot();
  const workspaceCurrent = captureWorkspace(context.adapter);
  const assertCurrent = () => {
    const current = getContext();
    assertUpdateIdle(current);
    if (
      !workspaceCurrent() ||
      current.adapter !== context.adapter ||
      current.type !== context.type ||
      JSON.stringify(before) !== JSON.stringify(snapshot())
    )
      throw new Error(
        "保存期间文章或工作区发生变化，尚未刷新，请检查当前内容后重试。",
      );
  };
  if (context.type === "filesystem") {
    if (!before.filePath && before.markdown)
      throw new Error(
        "当前正文尚未关联文件，请先导出正文并保存到文章后再更新。",
      );
    if (!(await persistFile(false, true)))
      throw new Error(
        "当前文章保存失败，尚未更新；请恢复目录权限或处理冲突后重试，也可先导出正文。",
      );
  } else {
    if (!before.activeId)
      throw new Error("当前草稿尚未关联文章，请先完成存储初始化或导出正文。");
    const saved = await useHistoryStore.getState().persistActiveSnapshot({
      markdown: before.markdown,
      theme: before.theme,
      themeName: before.themeName,
      customCSS: before.customCSS,
    });
    if (!saved)
      throw new Error("当前文章未保存，尚未更新；请先导出正文后重试。");
  }
  assertCurrent();
  return assertCurrent;
}
