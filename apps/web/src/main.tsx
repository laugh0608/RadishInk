import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { MarkdownTransferProvider } from "./components/Files/MarkdownTransferProvider";
import { TooltipLayer } from "./components/common/TooltipLayer";
import App from "./App.tsx";
import { StorageProvider } from "./storage/StorageContext";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import {
  getSafeSessionStorage,
  installPreloadErrorHandler,
} from "./bootstrap/installPreloadErrorHandler";

installPreloadErrorHandler({
  target: window,
  storage: getSafeSessionStorage(),
  now: () => Date.now(),
  reload: () => window.location.reload(),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <StorageProvider>
        <MarkdownTransferProvider>
          <App />
          <TooltipLayer />
        </MarkdownTransferProvider>
      </StorageProvider>
    </ErrorBoundary>
  </StrictMode>,
);
