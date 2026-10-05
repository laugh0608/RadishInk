import { FolderOpen } from "lucide-react";
import { useFileSystem } from "../../hooks/useFileSystem";
import { useUITheme } from "../../hooks/useUITheme";
import { useWindowControls } from "../../hooks/useWindowControls";
import { resolveAppAssetPath } from "../../utils/assetPath";
import { WindowControls } from "../common";
import "./Welcome.css";

export function Welcome() {
  const { selectWorkspace } = useFileSystem();
  const { isWindows } = useWindowControls();
  const theme = useUITheme((state) => state.theme);
  const logoSrc = resolveAppAssetPath(
    theme === "dark" ? "favicon-light.svg" : "favicon-dark.svg",
  );

  return (
    <div className="welcome-container">
      {isWindows && (
        <div className="welcome-titlebar">
          <div className="welcome-titlebar-drag-region" aria-hidden="true" />
          <WindowControls variant="compact" />
        </div>
      )}
      <div className="welcome-content">
        <img src={logoSrc} alt="RadishInk Logo" className="welcome-logo" />
        <h1>欢迎使用 RadishInk</h1>
        <p>请选择一个文件夹作为工作区以开始写作</p>
        <button className="btn-primary" onClick={selectWorkspace}>
          <FolderOpen size={20} />
          选择工作区文件夹
        </button>
      </div>
    </div>
  );
}
