import { useEffect, useRef, type ReactNode } from "react";
import { useMarkdownFileTransfer } from "../../hooks/useMarkdownFileTransfer";
import { MarkdownTransferContext } from "./markdownTransferContext";
import { platform } from "../../lib/platformAdapter";

export function MarkdownTransferProvider({
  children,
}: {
  children: ReactNode;
}) {
  if (platform.isElectron) return <>{children}</>;
  return <WebMarkdownTransferProvider>{children}</WebMarkdownTransferProvider>;
}
function WebMarkdownTransferProvider({ children }: { children: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const transfer = useMarkdownFileTransfer();
  const importFile = transfer.importFile;
  useEffect(() => {
    const element = input.current;
    const cancel = () => {
      void importFile();
    };
    const zip = zipInput.current;
    element?.addEventListener("cancel", cancel);
    zip?.addEventListener("cancel", cancel);
    return () => {
      element?.removeEventListener("cancel", cancel);
      zip?.removeEventListener("cancel", cancel);
    };
  }, [importFile]);
  return (
    <MarkdownTransferContext.Provider
      value={{
        ready: transfer.ready,
        importing: transfer.importing,
        exportFile: transfer.exportFile,
        exportZip: () => {
          void transfer.exportZip();
        },
        chooseZip: () => {
          if (!transfer.ready || transfer.importing) return;
          transfer.beginImport();
          zipInput.current?.click();
        },
        chooseFile: () => {
          if (!transfer.ready || transfer.importing) return;
          transfer.beginImport();
          input.current?.click();
        },
      }}
    >
      {children}
      {transfer.progress && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            padding: "12px 18px",
            background: "var(--bg-primary)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-color)",
            borderRadius: 8,
          }}
        >
          {transfer.progress}{" "}
          <button
            type="button"
            disabled={transfer.committing}
            onClick={transfer.cancel}
          >
            取消文章包处理
          </button>
        </div>
      )}
      <input
        ref={zipInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        aria-label="选择文章 ZIP"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void transfer.importFile(file, "zip");
        }}
      />
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
    </MarkdownTransferContext.Provider>
  );
}
