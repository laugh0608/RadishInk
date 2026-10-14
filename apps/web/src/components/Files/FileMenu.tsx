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
      description="仅交换文本，UTF-8，最大 5 MiB；图片及附件需另存。"
      actions={[
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
