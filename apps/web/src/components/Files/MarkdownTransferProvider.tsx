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
  const transfer = useMarkdownFileTransfer();
  const importFile = transfer.importFile;
  useEffect(() => {
    const element = input.current;
    const cancel = () => {
      void importFile();
    };
    element?.addEventListener("cancel", cancel);
    return () => element?.removeEventListener("cancel", cancel);
  }, [importFile]);
  return (
    <MarkdownTransferContext.Provider
      value={{
        ready: transfer.ready,
        importing: transfer.importing,
        exportFile: transfer.exportFile,
        chooseFile: () => {
          if (!transfer.ready || transfer.importing) return;
          transfer.beginImport();
          input.current?.click();
        },
      }}
    >
      {children}
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
