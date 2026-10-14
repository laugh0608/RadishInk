import { describe, expect, it } from "vitest";

import {
  computeFloatingPanelBox,
  type FloatingPanelBox,
} from "../../components/Editor/floatingPanelBox";

const margin = 8;

function expectWithinViewport(
  box: FloatingPanelBox,
  viewport: { width: number; height: number },
) {
  expect(box.left).toBeGreaterThanOrEqual(margin);
  expect(box.top).toBeGreaterThanOrEqual(margin);
  expect(box.left + box.width).toBeLessThanOrEqual(viewport.width - margin);
  expect(box.top + box.maxHeight).toBeLessThanOrEqual(viewport.height - margin);
}

describe("工具栏浮层定位", () => {
  it("将右下角锚点的浮层夹回视口", () => {
    const viewport = { width: 1440, height: 900 };
    const box = computeFloatingPanelBox(
      { left: 1360, right: 1420, top: 780, bottom: 820 },
      viewport,
      { width: 380, preferredMaxHeight: 540, margin, gap: 4 },
    );

    expectWithinViewport(box, viewport);
  });

  it("在视口窄于目标浮层时收窄", () => {
    const viewport = { width: 340, height: 900 };
    const box = computeFloatingPanelBox(
      { left: 260, right: 300, top: 120, bottom: 150 },
      viewport,
      { width: 380, preferredMaxHeight: 540, margin, gap: 4 },
    );

    expect(box.width).toBe(324);
    expectWithinViewport(box, viewport);
  });

  it("在下方空间不足时向上展开", () => {
    const viewport = { width: 800, height: 600 };
    const box = computeFloatingPanelBox(
      { left: 680, right: 720, top: 500, bottom: 540 },
      viewport,
      { width: 220, preferredMaxHeight: 360, margin, gap: 4 },
    );

    expect(box.top + box.maxHeight).toBeLessThanOrEqual(496);

    expectWithinViewport(box, viewport);
  });
  it.each(["start", "center", "end"] as const)(
    "支持 %s 对齐并保持边界",
    (align) => {
      const box = computeFloatingPanelBox(
        { left: 300, right: 340, top: 20, bottom: 54 },
        { width: 800, height: 600 },
        { width: 100, preferredMaxHeight: 100, margin, gap: 6, align },
      );
      expect(box.left).toBe(
        align === "start" ? 300 : align === "center" ? 270 : 240,
      );
    },
  );
  it.each([-300, 900])("滚动导致锚点位于视口外 %s 时浮层仍在视口内", (top) => {
    const viewport = { width: 340, height: 400 };
    const box = computeFloatingPanelBox(
      { left: -100, right: -60, top, bottom: top + 34 },
      viewport,
      { width: 300, preferredMaxHeight: 460, margin, gap: 6 },
    );
    expectWithinViewport(box, viewport);
  });
});
