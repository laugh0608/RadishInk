import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFloatingPosition } from "./useFloatingPosition";
import "./TooltipLayer.css";

export function TooltipLayer() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  // RefObject 的 current 随当前目标同步，定位 effect 只在显示时运行。
  anchor.current = target;
  const panel = useRef<HTMLDivElement>(null);
  const box = useFloatingPosition(anchor, !!target, {
    width: 220,
    height: 100,
    align: "center",
    panel,
    fitWidth: true,
  });
  useEffect(() => {
    const find = (event: Event) =>
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(
            ".md-toolbar [data-tooltip], .app-header [data-tooltip], .floating-toolbar [data-tooltip]",
          )
        : null;
    const show = (event: Event) => {
      if (
        typeof PointerEvent !== "undefined" &&
        event instanceof PointerEvent &&
        event.pointerType === "touch"
      )
        return;
      const element = find(event);
      if (
        element?.getAttribute("aria-expanded") === "true" ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      )
        return;
      setTarget(element);
    };
    const hide = () => setTarget(null);
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("pointerout", hide);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("keydown", hide);
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("pointerout", hide);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("keydown", hide);
    };
  }, []);
  return target?.isConnected && box
    ? createPortal(
        <div
          ref={panel}
          role="tooltip"
          className="app-tooltip"
          style={{
            left: box.left,
            top: box.top,
            maxWidth: "min(220px, calc(100vw - 16px))",
          }}
        >
          {target.dataset.tooltip}
        </div>,
        document.body,
      )
    : null;
}
