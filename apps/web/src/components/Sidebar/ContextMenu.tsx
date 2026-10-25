import { createPortal } from "react-dom";
import {
  Trash2,
  Edit2,
  Copy,
  ChevronRight,
  MoveRight,
  FolderPlus,
  FolderOpen,
} from "lucide-react";
import type { FileItem, FolderItem } from "../../store/fileTypes";

interface FolderOption {
  name: string;
  path: string;
}

interface ContextMenuProps {
  supportsFolders?: boolean;
  position: { x: number; y: number };
  menuTarget: FileItem | null;
  menuTargetFolder: FolderItem | null;
  showMoveMenu: boolean;
  allFolders: FolderOption[];
  folderMoveTargets: FolderOption[];
  onClose: () => void;
  onCopyTitle: () => void;
  onStartRename: () => void;
  onToggleMoveMenu: () => void;
  onMoveToFolder: (path: string) => void;
  onMoveFolder: (path: string) => void;
  onDeleteFile: () => void;
  onDeleteFolder: () => void;
  onStartRenameFolder: () => void;
  onNewFolder: () => void;
}

export function ContextMenu({
  supportsFolders = true,
  position,
  menuTarget,
  menuTargetFolder,
  showMoveMenu,
  allFolders,
  folderMoveTargets,
  onClose,
  onCopyTitle,
  onStartRename,
  onToggleMoveMenu,
  onMoveToFolder,
  onMoveFolder,
  onDeleteFile,
  onDeleteFolder,
  onStartRenameFolder,
  onNewFolder,
}: ContextMenuProps) {
  return createPortal(
    <div className="fs-context-menu-overlay" onClick={onClose}>
      <div
        className="fs-context-menu"
        style={{ top: position.y, left: position.x }}
        onClick={(e) => e.stopPropagation()}
      >
        {menuTarget && (
          <>
            <button onClick={onCopyTitle}>
              <Copy size={14} /> 复制标题
            </button>
            <button onClick={onStartRename}>
              <Edit2 size={14} /> 重命名
            </button>
            {supportsFolders && (
              <button onClick={onToggleMoveMenu} className="has-submenu">
                <MoveRight size={14} /> 移动到...
                <ChevronRight size={12} className="submenu-arrow" />
              </button>
            )}
            {showMoveMenu && (
              <div className="fs-submenu">
                <button onClick={() => onMoveToFolder("")}>
                  <FolderOpen size={14} /> 根目录
                </button>
                {allFolders.map((f) => (
                  <button key={f.path} onClick={() => onMoveToFolder(f.path)}>
                    <FolderOpen size={14} /> {f.name}
                  </button>
                ))}
              </div>
            )}
            <button className="danger" onClick={onDeleteFile}>
              <Trash2 size={14} /> 删除
            </button>
          </>
        )}
        {menuTargetFolder && (
          <>
            <button onClick={onStartRenameFolder}>
              <Edit2 size={14} /> 重命名
            </button>
            <button onClick={onToggleMoveMenu} className="has-submenu">
              <MoveRight size={14} /> 移动到...
              <ChevronRight size={12} className="submenu-arrow" />
            </button>
            {showMoveMenu && (
              <div className="fs-submenu">
                <button onClick={() => onMoveFolder("")}>
                  <FolderOpen size={14} /> 根目录
                </button>
                {folderMoveTargets.map((f) => (
                  <button key={f.path} onClick={() => onMoveFolder(f.path)}>
                    <FolderOpen size={14} /> {f.name}
                  </button>
                ))}
              </div>
            )}
            <button className="danger" onClick={onDeleteFolder}>
              <Trash2 size={14} /> 删除文件夹
            </button>
          </>
        )}
        {supportsFolders && !menuTarget && !menuTargetFolder && (
          <button onClick={onNewFolder}>
            <FolderPlus size={14} /> 新建文件夹
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
