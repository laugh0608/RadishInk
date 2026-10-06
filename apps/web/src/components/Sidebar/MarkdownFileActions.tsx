import { useRef } from "react";
import { Download, Upload } from "lucide-react";
import { platform } from "../../lib/platformAdapter";
import { useMarkdownFileTransfer } from "../../hooks/useMarkdownFileTransfer";
import "./MarkdownFileActions.css";

export function MarkdownFileActions() {
  if (platform.isElectron) return null;
  return <WebMarkdownFileActions />;
}

function WebMarkdownFileActions() {
  const input = useRef<HTMLInputElement>(null);
  const transfer = useMarkdownFileTransfer();
  return (
    <div className="markdown-file-actions">
      <div className="markdown-file-buttons">
        <button
          className="markdown-file-button"
          disabled={!transfer.ready || transfer.importing}
          onClick={() => {
            transfer.beginImport();
            input.current?.click();
          }}
        >
          <Upload size={14} aria-hidden="true" />
          {transfer.importing ? "导入中…" : "导入 Markdown"}
        </button>
        <button
          className="markdown-file-button"
          onClick={transfer.exportFile}
          aria-label="导出 Markdown"
        >
          <Download size={14} aria-hidden="true" />
          导出
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".md,.markdown"
        hidden
        aria-label="选择 Markdown 文件"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void transfer.importFile(file);
        }}
      />
      <p>
        单文件 UTF-8，最大 5
        MiB。仅交换文本；图片及附件需另存，相对路径可能无法显示。
      </p>
    </div>
  );
}
