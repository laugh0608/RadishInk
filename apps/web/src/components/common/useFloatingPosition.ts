import { useLayoutEffect, useState, type RefObject } from "react";
import {
  computeFloatingPanelBox,
  type FloatingPanelBox,
} from "../Editor/floatingPanelBox";

// 仅在浮层打开时跟踪位置，也覆盖分栏拖动、CSS 动画与无 ResizeObserver 的环境。
export function useFloatingPosition(
  anchor: RefObject<HTMLElement>,
  open: boolean,
  {
    width,
    height = 460,
    align = "end",
    panel,
    fitWidth = false,
  }: {
    width: number;
    height?: number;
    align?: "start" | "center" | "end";
    panel?: RefObject<HTMLElement>;
    fitWidth?: boolean;
  },
) {
  const [box, setBox] = useState<FloatingPanelBox | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const measure = () => {
      if (anchor.current) {
        const surface = panel?.current;
        const contentHeight = surface
          ? surface.scrollHeight + surface.offsetHeight - surface.clientHeight
          : 0;
        const actualWidth = fitWidth
          ? surface?.getBoundingClientRect().width
          : 0;
        const next = computeFloatingPanelBox(
          anchor.current.getBoundingClientRect(),
          { width: window.innerWidth, height: window.innerHeight },
          {
            width: actualWidth || width,
            align,
            preferredMaxHeight: Math.min(
              height,
              contentHeight || height,
              window.innerHeight * 0.7,
            ),
            margin: 8,
            gap: 6,
          },
        );
        setBox((previous) =>
          previous &&
          Object.keys(next).every(
            (key) =>
              previous[key as keyof FloatingPanelBox] ===
              next[key as keyof FloatingPanelBox],
          )
            ? previous
            : next,
        );
      }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [anchor, open, width, height, align, panel, fitWidth]);
  return open ? box : null;
}
