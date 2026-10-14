import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, BookOpen, X } from "lucide-react";
import { useInformationDialogStore } from "../../store/informationDialogStore";
import { useFloatingPosition } from "../common/useFloatingPosition";
import "./SyntaxHelpPopover.css";

const syntaxItems = [
  { syntax: "**文字**", desc: "粗体" },
  { syntax: "*文字*", desc: "斜体" },
  { syntax: "++文字++", desc: "下划线" },
  { syntax: "~~文字~~", desc: "删除线" },
  { syntax: "==文字==", desc: "高亮" },
  { syntax: "$公式$", desc: "行内公式" },
  { syntax: "`代码`", desc: "行内代码" },
  { syntax: "H~2~O", desc: "下标" },
  { syntax: "X^2^", desc: "上标" },
  { syntax: "> [!NOTE]", desc: "提示块" },
  { syntax: "- [ ] 任务", desc: "任务列表" },
  { syntax: "{.class #id}", desc: "块级属性" },
  { syntax: "**文字**{.class}", desc: "行内/图片属性" },
];

export function SyntaxHelpPanel({
  anchor,
  onClose,
}: {
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const panel = useRef<HTMLDivElement>(null);
  const box = useFloatingPosition(anchorRef, true, {
    width: 260,
    align: "start",
    panel,
  });
  const openInformation = useInformationDialogStore((state) => state.open);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !anchor.contains(event.target as Node)
      )
        onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        anchor.focus();
        onClose();
      }
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [anchor, onClose]);
  const positioned = box !== null;
  useEffect(() => {
    panel.current?.focus();
  }, [positioned]);
  return (
    box &&
    createPortal(
      <div
        ref={panel}
        role="dialog"
        aria-label="Markdown 语法速查"
        tabIndex={-1}
        className="syntax-help-floating-panel"
        data-toolbar-floating-panel
        style={{
          position: "fixed",
          zIndex: 1100,
          left: box.left,
          top: box.top,
          width: box.width,
          maxHeight: box.maxHeight,
        }}
      >
        <div className="syntax-help-popover">
          <div className="syntax-help-header">
            Markdown 语法速查
            <button
              className="md-toolbar-btn"
              aria-label="关闭语法速查"
              onClick={() => {
                anchor.focus();
                onClose();
              }}
            >
              <X size={16} />
            </button>
          </div>
          <div className="syntax-help-list">
            {syntaxItems.map((item) => (
              <div key={item.syntax} className="syntax-help-row">
                <code>{item.syntax}</code>
                <span>{item.desc}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="syntax-help-docs-link"
            aria-haspopup="dialog"
            onClick={() => {
              anchor.focus();
              onClose();
              openInformation("help", "syntax");
            }}
          >
            <span>查看完整文档</span>
            <BookOpen size={12} />
          </button>
        </div>
      </div>,
      document.body,
    )
  );
}
export function SyntaxHelpPopover() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        className="md-toolbar-btn"
        aria-label="语法帮助"
        data-tooltip="语法帮助"
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <HelpCircle size={16} />
      </button>
      {anchor && (
        <SyntaxHelpPanel anchor={anchor} onClose={() => setAnchor(null)} />
      )}
    </>
  );
}
