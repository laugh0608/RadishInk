import { useContext } from "react";
import { FileText, Download, Upload } from "lucide-react";
import { MarkdownTransferContext } from "./markdownTransferContext";
import { ActionMenu } from "../common/ActionMenu";

export function FileMenu({
  floating = false,
  mobile = false,
}: {
  floating?: boolean;
  mobile?: boolean;
}) {
  const transfer = useContext(MarkdownTransferContext);
  if (!transfer) return null;
  return (
    <ActionMenu
      label="文件"
      align="end"
      icon={<FileText size={18} />}
      showLabel={!floating}
      className={
        mobile
          ? "mobile-menu-item"
          : floating
            ? "floating-btn"
            : "btn-secondary file-menu-trigger"
      }
      description="文章 ZIP 包含正文与本地图片，最大 64 MiB；Markdown 仅含文本，最大 5 MiB。"
      actions={[
        {
          id: "export-zip",
          label: "导出当前文章包（.zip）",
          icon: <Download size={16} />,
          disabled:
            !transfer.ready || transfer.importing || !transfer.exportZip,
          onSelect: () => transfer.exportZip?.(),
        },
        {
          id: "import-zip",
          label: "导入文章包（.zip）…",
          icon: <Upload size={16} />,
          disabled:
            !transfer.ready || transfer.importing || !transfer.chooseZip,
          onSelect: () => transfer.chooseZip?.(),
        },
        {
          id: "import",
          label: transfer.importing ? "导入中…" : "导入 Markdown 为新文章…",
          icon: <Upload size={16} />,
          disabled: !transfer.ready || transfer.importing,
          onSelect: transfer.chooseFile,
        },
        {
          id: "export",
          label: "导出当前文章为 Markdown（仅文本）",
          icon: <Download size={16} />,
          disabled: transfer.importing,
          onSelect: transfer.exportFile,
        },
      ]}
    />
  );
}
