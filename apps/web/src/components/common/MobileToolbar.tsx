import {
  Pencil,
  Eye,
  Copy,
  MoreHorizontal,
  Palette,
  Code,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MobileViewType } from "../../hooks/useMobileView";
import "./MobileToolbar.css";
import { FileMenu } from "../Files/FileMenu";

interface MobileToolbarProps {
  activeView: MobileViewType;
  onViewChange: (view: MobileViewType) => void;
  onCopyToWechat: () => void;
  onCopyAsHtml: () => void;
  onOpenTheme: () => void;
}

/**
 * 移动端底部工具栏
 */
export function MobileToolbar({
  activeView,
  onViewChange,
  onCopyToWechat,
  onCopyAsHtml,
  onOpenTheme,
}: MobileToolbarProps) {
  const [showMenu, setShowMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showMenu) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      // 文件子菜单处理自身导航与 Esc；它通过 Portal 显示在当前面板外。
      if (event.defaultPrevented || document.querySelector('[role="menu"]'))
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        setShowMenu(false);
      }
      if (event.key === "Tab") {
        const buttons = Array.from(
          panel.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) ?? [],
        );
        const first = buttons[0];
        const last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", keydown);
    const trigger = more.current;
    return () => {
      window.removeEventListener("keydown", keydown);
      trigger?.focus();
    };
  }, [showMenu]);

  return (
    <>
      {/* 更多菜单弹窗 */}
      {showMenu && (
        <div className="mobile-menu-overlay" onClick={() => setShowMenu(false)}>
          <div
            ref={panel}
            role="dialog"
            aria-label="更多功能"
            aria-modal="true"
            className="mobile-menu-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mobile-menu-header">
              <span>更多功能</span>
              <button
                className="mobile-menu-close"
                aria-label="关闭更多功能"
                onClick={() => setShowMenu(false)}
              >
                <X size={20} />
              </button>
            </div>
            <FileMenu mobile />
            <div className="mobile-menu-list">
              <button
                className="mobile-menu-item"
                onClick={() => {
                  onCopyAsHtml();
                  setShowMenu(false);
                }}
              >
                <Code size={20} />
                <span>复制 HTML</span>
              </button>
              <button
                className="mobile-menu-item"
                onClick={() => {
                  more.current?.focus();
                  onOpenTheme();
                  setShowMenu(false);
                }}
              >
                <Palette size={20} />
                <span>主题管理</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 底部工具栏 */}
      <div className="mobile-toolbar">
        <div className="mobile-toolbar-tabs">
          <button
            className={`mobile-tab ${activeView === "editor" ? "active" : ""}`}
            onClick={() => onViewChange("editor")}
          >
            <Pencil size={18} />
            <span>编辑</span>
          </button>
          <button
            className={`mobile-tab ${activeView === "preview" ? "active" : ""}`}
            onClick={() => onViewChange("preview")}
          >
            <Eye size={18} />
            <span>预览</span>
          </button>
        </div>

        <div className="mobile-toolbar-actions">
          <button
            className="mobile-action-btn primary"
            aria-label="复制到公众号"
            onClick={onCopyToWechat}
          >
            <Copy size={18} />
          </button>
          <button
            className="mobile-action-btn"
            ref={more}
            aria-label="更多功能"
            onClick={() => setShowMenu(true)}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>
    </>
  );
}
