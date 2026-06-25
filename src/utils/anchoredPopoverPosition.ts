export type PopoverPlacement = 'below' | 'above' | 'right' | 'left';

export type AnchoredPopoverPosition = {
  top: number;
  left: number;
  placement: PopoverPlacement;
};

const GAP_PX = 4;
const VIEWPORT_PADDING_PX = 8;

/** Default width matches FieldTopValuesPopover `w-72` (288px). */
export const FIELD_TOP_VALUES_POPOVER_WIDTH = 288;

/** Header + max body (`max-h-72`) + footer — used before first layout measure. */
export const FIELD_TOP_VALUES_POPOVER_ESTIMATED_HEIGHT = 360;

type Viewport = { width: number; height: number };

/** Reject detached or zero-size anchors (getBoundingClientRect on removed nodes → 0,0). */
export function isValidPopoverAnchorRect(
  rect: DOMRect | null | undefined,
  viewport: Viewport = { width: window.innerWidth, height: window.innerHeight }
): rect is DOMRect {
  if (!rect) return false;
  if (rect.width <= 0 && rect.height <= 0) return false;
  if (rect.bottom <= 0 || rect.right <= 0) return false;
  if (rect.top >= viewport.height || rect.left >= viewport.width) return false;
  return true;
}

export function getConnectedElementRect(element: HTMLElement | null | undefined): DOMRect | null {
  if (!element?.isConnected) return null;
  const rect = element.getBoundingClientRect();
  return isValidPopoverAnchorRect(rect) ? rect : null;
}

/**
 * Prefer opening below the anchor; flip above when there is not enough room below
 * (Floating UI / Popper-style collision handling).
 */
export function computeAnchoredPopoverPosition(
  anchor: DOMRect,
  panelHeight: number,
  panelWidth: number,
  viewport: Viewport = { width: window.innerWidth, height: window.innerHeight }
): AnchoredPopoverPosition {
  const safeHeight = Math.max(1, panelHeight);
  const safeWidth = Math.max(1, panelWidth);

  const spaceBelow = viewport.height - VIEWPORT_PADDING_PX - (anchor.bottom + GAP_PX);
  const spaceAbove = anchor.top - GAP_PX - VIEWPORT_PADDING_PX;

  const fitsBelow = safeHeight <= spaceBelow;
  const fitsAbove = safeHeight <= spaceAbove;

  let placement: PopoverPlacement = 'below';
  if (!fitsBelow && (fitsAbove || spaceAbove > spaceBelow)) {
    placement = 'above';
  }

  let top: number;
  if (placement === 'below') {
    top = anchor.bottom + GAP_PX;
    top = Math.min(top, viewport.height - VIEWPORT_PADDING_PX - safeHeight);
  } else {
    top = anchor.top - GAP_PX - safeHeight;
    top = Math.max(top, VIEWPORT_PADDING_PX);
  }

  let left = anchor.left;
  left = Math.min(left, viewport.width - VIEWPORT_PADDING_PX - safeWidth);
  left = Math.max(left, VIEWPORT_PADDING_PX);

  return { top, left, placement };
}

/**
 * Discover field details: open to the right of the fields sidebar, vertically aligned
 * with the clicked field row (Kibana Discover style).
 */
export function computeSidebarFieldPopoverPosition(
  fieldAnchor: DOMRect,
  sidebarAnchor: DOMRect,
  panelHeight: number,
  panelWidth: number,
  viewport: Viewport = { width: window.innerWidth, height: window.innerHeight }
): AnchoredPopoverPosition {
  const safeHeight = Math.max(1, panelHeight);
  const safeWidth = Math.max(1, panelWidth);

  const spaceRight = viewport.width - VIEWPORT_PADDING_PX - (sidebarAnchor.right + GAP_PX);
  const spaceLeft = sidebarAnchor.left - GAP_PX - VIEWPORT_PADDING_PX;

  let placement: PopoverPlacement = 'right';
  let left: number;

  if (safeWidth <= spaceRight) {
    left = sidebarAnchor.right + GAP_PX;
  } else if (safeWidth <= spaceLeft) {
    placement = 'left';
    left = sidebarAnchor.left - GAP_PX - safeWidth;
  } else {
    left = sidebarAnchor.right + GAP_PX;
    left = Math.min(left, viewport.width - VIEWPORT_PADDING_PX - safeWidth);
    left = Math.max(left, VIEWPORT_PADDING_PX);
  }

  let top = fieldAnchor.top;
  top = Math.min(top, viewport.height - VIEWPORT_PADDING_PX - safeHeight);
  top = Math.max(top, VIEWPORT_PADDING_PX);

  return { top, left, placement };
}

/** Compact toolbar centered over a table cell (Kibana cell action style). */
export function computeCellOverlayPopoverPosition(
  anchor: DOMRect,
  panelHeight: number,
  panelWidth: number,
  viewport: Viewport = { width: window.innerWidth, height: window.innerHeight }
): { top: number; left: number } {
  const safeHeight = Math.max(1, panelHeight);
  const safeWidth = Math.max(1, panelWidth);

  let top = anchor.top + (anchor.height - safeHeight) / 2;
  let left = anchor.left + (anchor.width - safeWidth) / 2;

  top = Math.max(
    VIEWPORT_PADDING_PX,
    Math.min(top, viewport.height - VIEWPORT_PADDING_PX - safeHeight)
  );
  left = Math.max(
    VIEWPORT_PADDING_PX,
    Math.min(left, viewport.width - VIEWPORT_PADDING_PX - safeWidth)
  );

  return { top, left };
}
