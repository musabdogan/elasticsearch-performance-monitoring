import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleMinus, CirclePlus, Copy } from 'lucide-react';
import type { DiscoverFilter } from '@/types/discover';
import {
  computeCellOverlayPopoverPosition,
  isValidPopoverAnchorRect
} from '@/utils/anchoredPopoverPosition';

/** Three icon buttons + padding — used before first layout measure. */
const POPOVER_ESTIMATED_WIDTH = 76;
const POPOVER_ESTIMATED_HEIGHT = 28;

export type DiscoverCellActionTarget = {
  field: string;
  aggField: string;
  filterValue: string | number | boolean | null;
  copyText: string;
  getAnchorRect: () => DOMRect | null;
};

type DiscoverCellActionPopoverProps = {
  target: DiscoverCellActionTarget;
  activeFilters: DiscoverFilter[];
  onAddFilter: (field: string, aggField: string, value: string | number | boolean, negate: boolean) => void;
  onDismiss: () => void;
  onPopoverPointerEnter: () => void;
  onPopoverPointerLeave: () => void;
};

function ActionIconButton({
  label,
  disabled,
  onClick,
  icon: Icon,
  copied
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  icon: typeof CirclePlus;
  copied?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded p-0.5 text-white/95 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-35"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />}
    </button>
  );
}

export function DiscoverCellActionPopover({
  target,
  activeFilters,
  onAddFilter,
  onDismiss,
  onPopoverPointerEnter,
  onPopoverPointerLeave
}: DiscoverCellActionPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = target.getAnchorRect();
    const panel = panelRef.current;
    if (!isValidPopoverAnchorRect(anchor) || !panel) {
      onDismiss();
      return;
    }
    setPosition(
      computeCellOverlayPopoverPosition(
        anchor,
        panel.offsetHeight,
        panel.offsetWidth || POPOVER_ESTIMATED_WIDTH
      )
    );
  }, [target, onDismiss]);

  useLayoutEffect(() => {
    const anchor = target.getAnchorRect();
    if (!isValidPopoverAnchorRect(anchor)) {
      onDismiss();
      return;
    }
    setPosition(
      computeCellOverlayPopoverPosition(anchor, POPOVER_ESTIMATED_HEIGHT, POPOVER_ESTIMATED_WIDTH)
    );
    updatePosition();
  }, [target, updatePosition, onDismiss]);

  useEffect(() => {
    const onReposition = () => updatePosition();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [updatePosition]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDismiss]);

  const anchor = target.getAnchorRect();
  if (!isValidPopoverAnchorRect(anchor)) return null;

  const resolvedPosition =
    position ??
    computeCellOverlayPopoverPosition(anchor, POPOVER_ESTIMATED_HEIGHT, POPOVER_ESTIMATED_WIDTH);

  const canFilter = target.filterValue != null && target.filterValue !== '';
  const filterKey = canFilter ? String(target.filterValue) : '';
  const isActive = canFilter && activeFilters.some(
    (f) => !f.negate && f.field === target.field && String(f.value) === filterKey
  );
  const isExcluded = canFilter && activeFilters.some(
    (f) => f.negate && f.field === target.field && String(f.value) === filterKey
  );

  const onCopy = async () => {
    if (!target.copyText) return;
    try {
      await navigator.clipboard.writeText(target.copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const panel = (
    <div
      ref={panelRef}
      className="fixed z-[200] flex items-center gap-0 rounded border-2 border-blue-600 bg-blue-600 p-0.5 shadow-md dark:border-blue-500 dark:bg-blue-700"
      style={{ top: resolvedPosition.top, left: resolvedPosition.left }}
      onMouseEnter={onPopoverPointerEnter}
      onMouseLeave={onPopoverPointerLeave}
      onClick={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label={`Actions for ${target.field}`}
    >
      <ActionIconButton
        label="Filter for this value"
        disabled={!canFilter || isActive}
        icon={CirclePlus}
        onClick={() => {
          if (target.filterValue == null) return;
          onAddFilter(target.field, target.aggField, target.filterValue, false);
          onDismiss();
        }}
      />
      <ActionIconButton
        label="Filter out this value"
        disabled={!canFilter || isExcluded}
        icon={CircleMinus}
        onClick={() => {
          if (target.filterValue == null) return;
          onAddFilter(target.field, target.aggField, target.filterValue, true);
          onDismiss();
        }}
      />
      <ActionIconButton
        label={copied ? 'Copied' : 'Copy value'}
        disabled={!target.copyText}
        icon={Copy}
        copied={copied}
        onClick={() => void onCopy()}
      />
    </div>
  );

  return createPortal(panel, document.body);
}

export const DISCOVER_CELL_HOVER_DELAY_MS = 400;
export const DISCOVER_CELL_LEAVE_DELAY_MS = 120;
