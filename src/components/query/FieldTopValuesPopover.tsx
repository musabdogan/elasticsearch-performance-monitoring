import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleMinus, CirclePlus, RefreshCw, X } from 'lucide-react';
import type { DiscoverFilter } from '@/types/discover';
import type { FieldTopValuesResult } from '@/types/discover';
import {
  computeSidebarFieldPopoverPosition,
  FIELD_TOP_VALUES_POPOVER_ESTIMATED_HEIGHT,
  FIELD_TOP_VALUES_POPOVER_WIDTH,
  type PopoverPlacement
} from '@/utils/anchoredPopoverPosition';

type FieldTopValuesPopoverProps = {
  field: string;
  aggField: string;
  getAnchorRect: () => DOMRect | null;
  getSidebarRect: () => DOMRect | null;
  getSidebarElement?: () => HTMLElement | null;
  result: FieldTopValuesResult | null;
  loading: boolean;
  error: string | null;
  activeFilters: DiscoverFilter[];
  onClose: () => void;
  onAddFilter: (field: string, aggField: string, value: string | number | boolean, negate: boolean) => void;
};

function FilterActionButton({
  label,
  disabled,
  onClick,
  icon: Icon
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  icon: typeof CirclePlus;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-full p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
    </button>
  );
}

export function FieldTopValuesPopover({
  field,
  aggField,
  getAnchorRect,
  getSidebarRect,
  getSidebarElement,
  result,
  loading,
  error,
  activeFilters,
  onClose,
  onAddFilter
}: FieldTopValuesPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; placement: PopoverPlacement } | null>(
    null
  );

  const updatePosition = useCallback(() => {
    const fieldAnchor = getAnchorRect();
    const sidebarAnchor = getSidebarRect();
    const panel = panelRef.current;
    if (!fieldAnchor || !sidebarAnchor || !panel) return;

    const { top, left, placement } = computeSidebarFieldPopoverPosition(
      fieldAnchor,
      sidebarAnchor,
      panel.offsetHeight,
      panel.offsetWidth || FIELD_TOP_VALUES_POPOVER_WIDTH
    );
    setPosition({ top, left, placement });
  }, [getAnchorRect, getSidebarRect]);

  useLayoutEffect(() => {
    const fieldAnchor = getAnchorRect();
    const sidebarAnchor = getSidebarRect();
    if (!fieldAnchor || !sidebarAnchor) {
      setPosition(null);
      return;
    }
    const estimate = computeSidebarFieldPopoverPosition(
      fieldAnchor,
      sidebarAnchor,
      FIELD_TOP_VALUES_POPOVER_ESTIMATED_HEIGHT,
      FIELD_TOP_VALUES_POPOVER_WIDTH
    );
    setPosition({ top: estimate.top, left: estimate.left, placement: estimate.placement });
    updatePosition();
  }, [getAnchorRect, getSidebarRect, updatePosition, field, loading, error, result]);

  useEffect(() => {
    const fieldAnchor = getAnchorRect();
    const sidebarAnchor = getSidebarRect();
    if (!fieldAnchor || !sidebarAnchor) return;

    const onReposition = () => updatePosition();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [getAnchorRect, getSidebarRect, updatePosition]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (getSidebarElement?.()?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose, getSidebarElement]);

  const fieldAnchor = getAnchorRect();
  const sidebarAnchor = getSidebarRect();
  if (!fieldAnchor || !sidebarAnchor) return null;

  const resolvedPosition =
    position ??
    computeSidebarFieldPopoverPosition(
      fieldAnchor,
      sidebarAnchor,
      FIELD_TOP_VALUES_POPOVER_ESTIMATED_HEIGHT,
      FIELD_TOP_VALUES_POPOVER_WIDTH
    );

  const title = result?.kind === 'date_histogram' ? 'Time distribution' : 'Top values';

  const panel = (
    <div
      ref={panelRef}
      className="fixed z-[200] w-[min(288px,calc(100vw-1rem))] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-900"
      style={{ top: resolvedPosition.top, left: resolvedPosition.left }}
      data-popover-placement={resolvedPosition.placement}
      role="dialog"
      aria-label={`${field} ${title}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <span className="truncate font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
          {field}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto px-3 py-2">
        {loading && (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-500 dark:text-gray-400">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}

        {error && !loading && (
          <p className="py-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>
        )}

        {!loading && !error && result && result.buckets.length === 0 && (
          <p className="py-3 text-xs text-gray-500 dark:text-gray-400">No values in the current result set.</p>
        )}

        {!loading && !error && result && result.buckets.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {title}
            </p>
            <ul className="space-y-1">
              {result.buckets.map((bucket) => {
                const isActive = activeFilters.some(
                  (f) => !f.negate && f.field === field && String(f.value) === bucket.key
                );
                const isExcluded = activeFilters.some(
                  (f) => f.negate && f.field === field && String(f.value) === bucket.key
                );
                return (
                  <li
                    key={`${bucket.key}-${bucket.docCount}`}
                    className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="truncate font-mono text-xs text-gray-800 dark:text-gray-200"
                          title={bucket.key}
                        >
                          {bucket.key || '—'}
                        </span>
                        <span className="shrink-0 text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
                          {bucket.percent.toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                        <div
                          className="h-full rounded-full bg-blue-500 dark:bg-blue-400"
                          style={{ width: `${Math.min(100, bucket.percent)}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <FilterActionButton
                        label="Filter for this value"
                        disabled={isActive}
                        onClick={() => onAddFilter(field, aggField, bucket.key, false)}
                        icon={CirclePlus}
                      />
                      <FilterActionButton
                        label="Filter out this value"
                        disabled={isExcluded}
                        onClick={() => onAddFilter(field, aggField, bucket.key, true)}
                        icon={CircleMinus}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {result && !loading && (
        <div className="border-t border-gray-200 px-3 py-2 text-[10px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
          Calculated from {result.sampleSize.toLocaleString()} sample records.
          {result.distinctCount != null ? ` · ${result.distinctCount.toLocaleString()} unique values` : ''}
        </div>
      )}
    </div>
  );

  return createPortal(panel, document.body);
}
