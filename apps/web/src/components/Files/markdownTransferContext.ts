import { createContext } from "react";
export const MarkdownTransferContext = createContext<{
  ready: boolean;
  importing: boolean;
  chooseFile: () => void;
  exportFile: () => void;
} | null>(null);
