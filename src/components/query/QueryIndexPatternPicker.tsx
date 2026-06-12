import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Database, Layers, Search } from 'lucide-react';
import { normalizeQueryIndexPattern } from '@/utils/querySearch';

export type QueryPatternOptionKind = 'pattern' | 'index' | 'data_stream';

export type QueryPatternOption = {
  value: string;
  label: string;
  kind: QueryPatternOptionKind;
};

type QueryIndexPatternPickerProps = {
  value: string;
  onChange: (value: string) => void;
  options: QueryPatternOption[];
};

const SECTION_ORDER: QueryPatternOptionKind[] = ['pattern', 'index', 'data_stream'];

const SECTION_LABELS: Record<QueryPatternOptionKind, string> = {
  pattern: 'Patterns',
  index: 'Indices',
  data_stream: 'Data streams'
};

export function QueryIndexPatternPicker({ value, onChange, options }: QueryIndexPatternPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);

  draftRef.current = draft;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commitDraft = () => {
    const next = normalizeQueryIndexPattern(draftRef.current);
    onChange(next);
    setDraft(next);
    setFilter('');
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        commitDraft();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? options.filter(
          (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
        )
      : options;

    return SECTION_ORDER.map((kind) => ({
      kind,
      label: SECTION_LABELS[kind],
      items: filtered.filter((o) => o.kind === kind)
    })).filter((g) => g.items.length > 0);
  }, [filter, options]);

  const pick = (next: string) => {
    onChange(next);
    setDraft(next);
    setFilter('');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex min-w-[160px] max-w-[260px] shrink-0 items-center gap-1 border-r border-gray-200 pr-2 dark:border-gray-700">
      <label htmlFor="query-index-pattern" className="sr-only">
        Index or data stream pattern
      </label>
      <Database className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
      <input
        ref={inputRef}
        id="query-index-pattern"
        type="text"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitDraft();
            setOpen(false);
          }
          if (e.key === 'Escape') {
            setDraft(value);
            setOpen(false);
          }
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) {
              commitDraft();
            }
          }, 0);
        }}
        placeholder="All indices (*)"
        className="min-w-0 flex-1 rounded border-0 bg-transparent px-1 py-1.5 text-sm font-medium text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-0 dark:text-gray-100 dark:placeholder:text-gray-400"
        aria-expanded={open}
        aria-haspopup="listbox"
        autoComplete="off"
      />
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) inputRef.current?.focus();
        }}
        className="rounded p-0.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
        aria-label="Open index pattern list"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          <div className="border-b border-gray-200 p-2 dark:border-gray-700">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter indices or data streams…"
                className="w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-7 pr-2 text-xs text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
            {filteredGroups.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">No matches</li>
            ) : (
              filteredGroups.map((group) => (
                <li key={group.kind}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {group.label}
                  </div>
                  <ul>
                    {group.items.map((item) => (
                      <li key={`${item.kind}-${item.value}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={normalizeQueryIndexPattern(value) === item.value}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pick(item.value)}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/80 ${
                            normalizeQueryIndexPattern(value) === item.value
                              ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                              : 'text-gray-800 dark:text-gray-200'
                          }`}
                        >
                          {item.kind === 'data_stream' ? (
                            <Layers className="h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
                          ) : (
                            <Database className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                          )}
                          <span className="min-w-0 truncate font-mono">{item.label}</span>
                        </button>
                      </li>
                    ))}
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
