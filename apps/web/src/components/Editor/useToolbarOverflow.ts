import { useLayoutEffect, useRef, useState } from "react";

// 主栏与测量行共享样式；测量节点始终参与布局，不因收纳读到零宽。
export function useToolbarOverflow(priorities: number[]) {
  const toolbar = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() =>
    priorities.map((_, index) => index),
  );
  const signature = priorities.join(",");
  useLayoutEffect(() => {
    const root = toolbar.current;
    const ruler = measure.current;
    if (!root || !ruler) return;
    let active = true;
    let frame = 0;
    const update = () => {
      if (!active || !root.clientWidth) return;
      const style = getComputedStyle(root);
      const available =
        root.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0);
      const gap = parseFloat(style.columnGap) || 0;
      const widths = Array.from(ruler.children).map(
        (node) => node.getBoundingClientRect().width,
      );
      // 未完成浏览器布局时保留原布局，不能根据 0 宽制造可用空间。
      if (widths.some((width) => !width)) return;
      const moreWidth = widths.pop()!;
      let next = priorities.map((_, index) => index);
      if (
        widths.reduce((sum, width) => sum + width, 0) +
          gap * (widths.length - 1) >
        available
      ) {
        let used = moreWidth;
        next = [];
        for (const index of priorities
          .map((_, index) => index)
          .sort((a, b) => priorities[a] - priorities[b])) {
          if (used + gap + widths[index] <= available) {
            used += gap + widths[index];
            next.push(index);
          }
        }
        next.sort((a, b) => a - b);
      }
      const focused = document.activeElement as HTMLElement | null;
      const menu = focused?.closest<HTMLElement>('[role="menu"]');
      const trigger = menu
        ? root.querySelector<HTMLElement>(`[aria-controls="${menu.id}"]`)
        : focused;
      const item = trigger?.closest<HTMLElement>("[data-toolbar-index]");
      if (
        (item &&
          root.contains(item) &&
          !next.includes(Number(item.dataset.toolbarIndex))) ||
        (trigger?.getAttribute("aria-label") === "更多编辑工具" &&
          root.contains(trigger) &&
          next.length === priorities.length)
      ) {
        // more 在这次 render 后才出现；layout effect 负责恢复焦点。
        root.dataset.restoreToolbarFocus = "true";
      }
      setVisible((current) =>
        current.join(",") === next.join(",") ? current : next,
      );
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(root);
    Array.from(ruler.children).forEach((node) => observer?.observe(node));
    // 无 ResizeObserver 时仍跟踪分栏与侧栏变化，不局限于 window.resize。
    if (!observer) {
      const poll = () => {
        update();
        frame = requestAnimationFrame(poll);
      };
      frame = requestAnimationFrame(poll);
    }
    window.addEventListener("resize", update);
    document.fonts?.ready.then(update);
    return () => {
      active = false;
      observer?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
    };
    // 命令顺序和优先级变化才重建测量，不依赖每次渲染的新数组。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  useLayoutEffect(() => {
    if (toolbar.current?.dataset.restoreToolbarFocus) {
      (
        toolbar.current.querySelector<HTMLButtonElement>(
          '[aria-label="更多编辑工具"]',
        ) ?? toolbar.current.querySelector<HTMLButtonElement>("button")
      )?.focus();
      delete toolbar.current.dataset.restoreToolbarFocus;
    }
  }, [visible]);
  return { toolbar, measure, visible };
}
