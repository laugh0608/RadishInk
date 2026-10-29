import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, Check, FolderInput, FolderOpen } from "lucide-react";
import {
  ROOT_DROP_TARGET,
  getBaseName,
  useSidebarState,
} from "./useSidebarState";
import type { SortMode } from "./sortUtils";

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "recent", label: "最近编辑" },
  { value: "name-asc", label: "名称升序" },
  { value: "name-desc", label: "名称降序" },
];

interface FileSidebarWorkspaceHeaderProps {
  state: ReturnType<typeof useSidebarState>;
}

export function FileSidebarWorkspaceHeader({
  state,
}: FileSidebarWorkspaceHeaderProps) {
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.menuOpen) setShowSortMenu(false);
  }, [state.menuOpen]);

  useEffect(() => {
    if (!showSortMenu) return;
    const handleClick = (event: MouseEvent) => {
      if (
        sortMenuRef.current?.contains(event.target as Node) ||
        sortBtnRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setShowSortMenu(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowSortMenu(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showSortMenu]);

  return (
    <div className="fs-header">
      <button
        type="button"
        className={`fs-workspace-info ${state.activeFolder === null ? "active" : ""} ${state.dragOverTarget === ROOT_DROP_TARGET ? "drop-target" : ""}`}
        onClick={() => state.setActiveFolder(null)}
        onDragOver={(event) => {
          if (!state.isDragEnabled) return;
          event.preventDefault();
          event.stopPropagation();
          state.setDragOverTarget(ROOT_DROP_TARGET);
        }}
        onDrop={(event) => state.handleDropToFolder(event, "")}
        onDragLeave={(event) => state.handleDragLeave(event, ROOT_DROP_TARGET)}
        title={state.workspacePath || "根目录"}
      >
        <FolderOpen size={14} />
        <span>
          {state.workspacePath ? getBaseName(state.workspacePath) : "根目录"}
        </span>
      </button>
      <div className="fs-header-actions">
        {state.supportsFolders !== false && (
          <button
            type="button"
            className="fs-btn-secondary fs-btn-icon-only"
            onClick={state.selectWorkspace}
            aria-label="切换工作区"
            onMouseEnter={(event) => state.showTooltip(event, "切换工作区")}
            onMouseLeave={state.hideTooltip}
            onFocus={(event) => state.showTooltip(event, "切换工作区")}
            onBlur={state.hideTooltip}
          >
            <FolderInput size={14} />
          </button>
        )}
        <div className="fs-sort-wrapper">
          <button
            ref={sortBtnRef}
            className="fs-btn-secondary fs-btn-icon-only fs-sort-btn"
            onClick={() => setShowSortMenu((visible) => !visible)}
            aria-label="排序方式"
            aria-haspopup="menu"
            aria-expanded={showSortMenu}
            onMouseEnter={(event) => state.showTooltip(event, "排序方式")}
            onMouseLeave={state.hideTooltip}
            onFocus={(event) => state.showTooltip(event, "排序方式")}
            onBlur={state.hideTooltip}
          >
            <ArrowUpDown size={14} />
          </button>
          {showSortMenu && (
            <div ref={sortMenuRef} className="fs-sort-dropdown">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className="fs-sort-option"
                  onClick={() => {
                    state.handleSetSortMode(option.value);
                    setShowSortMenu(false);
                  }}
                >
                  <span>{option.label}</span>
                  {state.sortMode === option.value && <Check size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
