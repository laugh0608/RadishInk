import { createContext } from "react";
export const MarkdownTransferContext = createContext<{
  ready: boolean;
  importing: boolean;
  chooseFile: () => void;
  exportFile: () => void;
  chooseZip?: () => void;
  exportZip?: () => void;
} | null>(null);
