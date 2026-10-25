import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { MarkdownTransferProvider } from "./components/Files/MarkdownTransferProvider";
import { TooltipLayer } from "./components/common/TooltipLayer";
import App from "./App.tsx";
import { StorageProvider } from "./storage/StorageContext";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import { installPreloadErrorHandler } from "./bootstrap/installPreloadErrorHandler";
import { PwaUpdateBoundary } from "./pwa/PwaUpdateBoundary";
import { requestSafeReload } from "./pwa/safeReloadRequest";

installPreloadErrorHandler({
  target: window,
  requestReload: requestSafeReload,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <StorageProvider>
        <MarkdownTransferProvider>
          <PwaUpdateBoundary>
            <ErrorBoundary onReload={requestSafeReload}>
              <App />
              <TooltipLayer />
            </ErrorBoundary>
          </PwaUpdateBoundary>
        </MarkdownTransferProvider>
      </StorageProvider>
    </ErrorBoundary>
  </StrictMode>,
);
