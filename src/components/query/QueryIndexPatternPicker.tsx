import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Check, ChevronDown, Database, Layers, Search, X } from 'lucide-react';
import {
  ALL_INDICES_PATTERN,
  matchesQueryIndexFilter,
  normalizeQueryIndexPattern
} from '@/utils/querySearch';

export type QueryPatternOptionKind = 'pattern' | 'index' | 'data_stream';

export type QueryPatternOption = {
  value: string;
  label: string;
  kind: QueryPatternOptionKind;
};

type QueryIndexPatternPickerProps = {
  value: string;
  displayLabel?: string;
  onCommit: (value: string) => void;
  options: QueryPatternOption[];
  onOpenChange?: (open: boolean) => void;
};

const SECTION_ORDER: QueryPatternOptionKind[] = ['pattern', 'index', 'data_stream'];

const SECTION_LABELS: Record<QueryPatternOptionKind, string> = {
  pattern: 'Patterns',
  index: 'Indices',
  data_stream: 'Data streams'
};

function displayPatternLabel(pattern: string): string {
  const p = pattern.trim();
  if (!p || p === ALL_INDICES_PATTERN) return 'All indices (*)';
  return p;
}

function isSelectedPattern(current: string, optionValue: string): boolean {
  const normalizedCurrent = current.trim() === '' ? '' : normalizeQueryIndexPattern(current);
  return normalizedCurrent === optionValue;
}

export function QueryIndexPatternPicker({
  value,
  displayLabel,
  onCommit,
  options,
  onOpenChange
}: QueryIndexPatternPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');

  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return;
    onOpenChangeRef.current?.(true);
    setFilterQuery('');
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const filteredGroups = useMemo(() => {
    const q = filterQuery.trim();
    const filtered = q
      ? options.filter(
          (o) => matchesQueryIndexFilter(o.label, q) || matchesQueryIndexFilter(o.value, q)
        )
      : options;

    return SECTION_ORDER.map((kind) => ({
      kind,
      label: SECTION_LABELS[kind],
      items: filtered.filter((o) => o.kind === kind)
    })).filter((g) => g.items.length > 0);
  }, [filterQuery, options]);

  const trimmedFilter = filterQuery.trim();

  const commitPattern = (raw: string) => {
    const trimmed = raw.trim();
    setOpen(false);
    onCommit(trimmed);
  };

  const pick = (next: string) => {
    commitPattern(next);
  };

  const clearSelection = (e: ReactMouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (value.trim() !== '') onCommit('');
    setFilterQuery('');
    setOpen(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const showClear = value.trim() !== '' && value !== ALL_INDICES_PATTERN;
  const triggerLabel =
    value.trim() === '' && displayLabel
      ? displayPatternLabel(displayLabel)
      : displayPatternLabel(value);
  const triggerMuted = value.trim() === '' && Boolean(displayLabel);
  const listId = 'query-index-pattern-list';

  return (
    <div
      ref={rootRef}
      className="relative flex min-w-[180px] max-w-[300px] shrink-0 border-r border-gray-200 pr-2 dark:border-gray-700"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
      >
        <Database className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <span
          className={`min-w-0 flex-1 truncate text-sm font-medium font-mono ${
            triggerMuted
              ? 'text-gray-500 dark:text-gray-400'
              : !value.trim() || value === ALL_INDICES_PATTERN
                ? 'text-gray-500 dark:text-gray-400'
                : 'text-gray-900 dark:text-gray-100'
          }`}
        >
          {triggerLabel}
        </span>
        {showClear && (
          <span
            role="button"
            tabIndex={0}
            onClick={clearSelection}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                clearSelection(e as unknown as ReactMouseEvent);
              }
            }}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            aria-label="Clear index pattern"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          <div className="border-b border-gray-200 p-2 dark:border-gray-700">
            <label htmlFor="query-index-pattern-search" className="sr-only">
              Find an index or pattern
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchInputRef}
                id="query-index-pattern-search"
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitPattern(trimmedFilter || value);
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setOpen(false);
                  }
                }}
                placeholder="Find an index or pattern"
                className="w-full rounded-md border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900/50 dark:text-gray-100 dark:focus:bg-gray-900"
                autoComplete="off"
              />
            </div>
          </div>

          <ul id={listId} className="max-h-72 overflow-y-auto py-1" role="listbox">
            {filteredGroups.length === 0 && !trimmedFilter ? (
              <li className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                Type to filter indices or enter a custom pattern
              </li>
            ) : filteredGroups.length === 0 && trimmedFilter ? (
              <li className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
                No listed indices match — press Enter to search this pattern
              </li>
            ) : (
              filteredGroups.map((group) => (
                <li key={group.kind}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {group.label}
                  </div>
                  <ul>
                    {group.items.map((item) => {
                      const selected = isSelectedPattern(value, item.value);
                      return (
                        <li key={`${item.kind}-${item.value}`}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pick(item.value)}
                            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/80 ${
                              selected
                                ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                : 'text-gray-800 dark:text-gray-200'
                            }`}
                          >
                            {selected ? (
                              <Check className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                            ) : item.kind === 'data_stream' ? (
                              <Layers className="h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
                            ) : (
                              <Database className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            )}
                            <span className="min-w-0 truncate font-mono">{item.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
