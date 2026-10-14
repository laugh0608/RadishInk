import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useId,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useFloatingPosition } from "./useFloatingPosition";
import "./ActionMenu.css";

export interface MenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  checked?: boolean;
  onSelect?: () => void;
  children?: MenuAction[];
}
interface ActionMenuProps {
  label: string;
  icon: ReactNode;
  actions: MenuAction[];
  className?: string;
  showLabel?: boolean;
  description?: string;
  align?: "start" | "end";
}

export function ActionMenu({
  label,
  icon,
  actions,
  className = "md-toolbar-btn",
  showLabel,
  description,
  align = "start",
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<string[]>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const last = useRef(false);
  const id = useId();
  const box = useFloatingPosition(trigger, open, { width: 300, align, panel });
  const level = path.reduce(
    (items, key) => items.find((item) => item.id === key)?.children ?? [],
    actions,
  );
  const items = () =>
    Array.from(
      panel.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
  const close = (restore = true) => {
    setOpen(false);
    setPath([]);
    if (restore) trigger.current?.focus();
  };
  useEffect(() => {
    // 收纳集合变化后，子页可能已移回横栏；回到当前有效的菜单。
    let current = actions;
    for (const key of path) {
      const children = current.find((action) => action.id === key)?.children;
      if (!children) {
        setPath([]);
        return;
      }
      current = children;
    }
  }, [actions, path]);
  useLayoutEffect(() => {
    if (open && box) {
      const buttons = items();
      ((last.current ? buttons.at(-1) : buttons[0]) ?? panel.current)?.focus();
    }
    // 只在打开或切换层级时移动焦点，定位帧不能抢焦点。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, path, !!box]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (
        !trigger.current?.contains(target) &&
        !panel.current?.contains(target)
      ) {
        setOpen(false);
        setPath([]);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={label}
        data-tooltip={showLabel ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-owns={open ? id : undefined}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            last.current = event.key === "ArrowUp";
            setOpen(true);
          }
        }}
        onClick={() => {
          last.current = false;
          setPath([]);
          setOpen(!open);
        }}
      >
        {icon}
        {showLabel && <span>{label}</span>}
      </button>
      {open &&
        box &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="menu"
            aria-label={label}
            tabIndex={-1}
            className="action-menu"
            data-toolbar-floating-panel
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              maxHeight: box.maxHeight,
            }}
            onKeyDown={(event) => {
              const buttons = items();
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              } else if (event.key === "ArrowLeft" && path.length) {
                event.preventDefault();
                setPath(path.slice(0, -1));
              } else if (event.key === "Tab") {
                close();
              }
            }}
          >
            {path.length > 0 && (
              <button
                role="menuitem"
                onClick={() => setPath(path.slice(0, -1))}
              >
                <ChevronLeft size={16} />
                返回
              </button>
            )}
            {level.map((action) => (
              <button
                key={action.id}
                role={
                  action.checked === undefined ? "menuitem" : "menuitemcheckbox"
                }
                aria-checked={action.checked}
                disabled={action.disabled}
                aria-haspopup={action.children ? "menu" : undefined}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" && action.children) {
                    event.preventDefault();
                    setPath([...path, action.id]);
                  }
                }}
                onClick={() => {
                  if (action.children) {
                    last.current = false;
                    setPath([...path, action.id]);
                  } else {
                    close();
                    action.onSelect?.();
                  }
                }}
              >
                {action.icon}
                <span>{action.label}</span>
                {action.children && <ChevronRight size={14} />}
              </button>
            ))}
            {description && !path.length && <p>{description}</p>}
          </div>,
          document.body,
        )}
    </>
  );
}
