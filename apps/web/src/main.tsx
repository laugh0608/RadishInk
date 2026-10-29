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
import { initializeRuntimeConfig } from "./storage/server/runtimeConfig";
import { ServerWorkspaceBoundary } from "./components/Server/ServerWorkspaceBoundary";
import { consumeOidcResult } from "./storage/server/oidcNavigation";

installPreloadErrorHandler({
  target: window,
  requestReload: requestSafeReload,
});

try {
  initializeRuntimeConfig(document);
  consumeOidcResult();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <StorageProvider>
          <ServerWorkspaceBoundary>
            <MarkdownTransferProvider>
              <PwaUpdateBoundary>
                <ErrorBoundary onReload={requestSafeReload}>
                  <App />
                  <TooltipLayer />
                </ErrorBoundary>
              </PwaUpdateBoundary>
            </MarkdownTransferProvider>
          </ServerWorkspaceBoundary>
        </StorageProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
} catch (error) {
  const root = document.getElementById("root")!;
  root.setAttribute("role", "alert");
  root.textContent = `无法启动工作区：${error instanceof Error ? error.message : String(error)}`;
}
