export interface FloatingPanelAnchor {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface FloatingPanelBox {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export interface FloatingPanelOptions {
  align?: "start" | "center" | "end";
  width: number;
  preferredMaxHeight: number;
  margin: number;
  gap: number;
}

export function computeFloatingPanelBox(
  anchor: FloatingPanelAnchor,
  viewport: { width: number; height: number },
  options: FloatingPanelOptions,
): FloatingPanelBox {
  const below = Math.max(
    0,
    viewport.height - anchor.bottom - options.gap - options.margin,
  );
  const above = Math.max(0, anchor.top - options.gap - options.margin);
  const openBelow = below >= options.preferredMaxHeight || below >= above;
  const selectedSpace = openBelow ? below : above;
  const width = Math.max(
    0,
    Math.min(options.width, viewport.width - 2 * options.margin),
  );
  const maxHeight = Math.min(
    options.preferredMaxHeight,
    selectedSpace,
    Math.max(0, viewport.height - 2 * options.margin),
  );
  const minLeft = options.margin;
  const maxLeft = Math.max(minLeft, viewport.width - width - options.margin);
  const desiredLeft =
    options.align === "start"
      ? anchor.left
      : options.align === "center"
        ? (anchor.left + anchor.right - width) / 2
        : anchor.right - width;
  const left = Math.min(maxLeft, Math.max(minLeft, desiredLeft));
  const desiredTop = openBelow
    ? anchor.bottom + options.gap
    : anchor.top - options.gap - maxHeight;
  const top = Math.min(
    Math.max(options.margin, desiredTop),
    Math.max(options.margin, viewport.height - maxHeight - options.margin),
  );

  return { left, top, width, maxHeight };
}
