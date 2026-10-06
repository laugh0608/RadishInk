import { useEffect, useRef, useState } from "react";
import {
  Image,
  ListEnd,
  Loader2,
  MoreHorizontal,
  WrapText,
} from "lucide-react";

import {
  blockTools,
  headingOptions,
  listOptions,
  mermaidMoreTemplates,
  mermaidPrimaryTemplates,
  textFormatTools,
} from "./toolbarConfigs";
import { SyntaxHelpPopover } from "./SyntaxHelpPopover";
import { AiOptimizeButtons } from "./AiOptimize/AiOptimizeButtons";
import "./Toolbar.css";

interface ToolbarCompactMenuProps {
  onInsert: (prefix: string, suffix: string, placeholder: string) => void;
  uploading: boolean;
  onUpload: () => void;
  onMermaidInsert: (code: string) => void;
  linkToFootnote: boolean;
  tableWrap: boolean;
  onToggleLinkToFootnote: () => void;
  onToggleTableWrap: () => void;
}

export function ToolbarCompactMenu({
  onInsert,
  uploading,
  onUpload,
  onMermaidInsert,
  linkToFootnote,
  tableWrap,
  onToggleLinkToFootnote,
  onToggleTableWrap,
}: ToolbarCompactMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest("[data-toolbar-floating-panel]") ||
        containerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const close = () => setOpen(false);
  const insert = (prefix: string, suffix: string, placeholder: string) => {
    onInsert(prefix, suffix, placeholder);
    close();
  };

  return (
    <div
      ref={containerRef}
      className="md-toolbar-dropdown-container toolbar-compact-menu"
    >
      <button
        ref={buttonRef}
        type="button"
        className={`md-toolbar-btn ${open ? "active" : ""}`}
        aria-label="更多编辑工具"
        data-tooltip="更多编辑工具"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="md-toolbar-dropdown-menu toolbar-compact-dropdown">
          {textFormatTools.map((tool) => (
            <button
              key={tool.label}
              type="button"
              className="md-toolbar-dropdown-item"
              onClick={() => insert(tool.prefix, tool.suffix, tool.placeholder)}
            >
              <tool.icon size={14} />
              <span>{tool.label}</span>
            </button>
          ))}
          <div className="toolbar-compact-divider" />
          {[...headingOptions, ...listOptions, ...blockTools].map((tool) => (
            <button
              key={tool.label}
              type="button"
              className="md-toolbar-dropdown-item"
              onClick={() => insert(tool.prefix, tool.suffix, tool.placeholder)}
            >
              <tool.icon size={14} />
              <span>{tool.label}</span>
            </button>
          ))}
          <div className="toolbar-compact-divider" />
          {[...mermaidPrimaryTemplates, ...mermaidMoreTemplates].map(
            (template) => (
              <button
                key={template.label}
                type="button"
                className="md-toolbar-dropdown-item"
                onClick={() => {
                  onMermaidInsert(template.code);
                  close();
                }}
              >
                <template.icon size={14} />
                <span>{template.label}</span>
              </button>
            ),
          )}
          <button
            type="button"
            className="md-toolbar-dropdown-item"
            disabled={uploading}
            onClick={() => {
              onUpload();
              close();
            }}
          >
            {uploading ? <Loader2 size={14} /> : <Image size={14} />}
            <span>上传图片</span>
          </button>
          <div className="toolbar-compact-divider" />
          <button
            type="button"
            className={`md-toolbar-dropdown-item ${linkToFootnote ? "active" : ""}`}
            onClick={onToggleLinkToFootnote}
          >
            <ListEnd size={14} />
            <span>{linkToFootnote ? "关闭外链转脚注" : "开启外链转脚注"}</span>
          </button>
          <button
            type="button"
            className={`md-toolbar-dropdown-item ${tableWrap ? "active" : ""}`}
            onClick={onToggleTableWrap}
          >
            <WrapText size={14} />
            <span>{tableWrap ? "关闭表格自动换行" : "开启表格自动换行"}</span>
          </button>
          <div className="toolbar-compact-divider" />
          <div className="toolbar-compact-ai">
            <AiOptimizeButtons />
          </div>
          <div className="toolbar-compact-help">
            <SyntaxHelpPopover
              onOpenFullHelp={() => {
                buttonRef.current?.focus();
                close();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
