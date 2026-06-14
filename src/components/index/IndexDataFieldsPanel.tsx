import { useMemo } from 'react';
import { GripVertical, RotateCcw, Search } from 'lucide-react';
import { setFieldDragPayload } from '@/hooks/useIndexDataColumns';

type IndexDataFieldsPanelProps = {
  availableFields: string[];
  selectedColumns: string[];
  filter: string;
  defaultsFromFieldUsage?: boolean;
  autoColumns?: boolean;
  onAutoColumnsChange?: (enabled: boolean) => void;
  onFilterChange: (value: string) => void;
  onToggleField: (field: string) => void;
  onReset: () => void;
};

export function IndexDataFieldsPanel({
  availableFields,
  selectedColumns,
  filter,
  defaultsFromFieldUsage = false,
  autoColumns = true,
  onAutoColumnsChange,
  onFilterChange,
  onToggleField,
  onReset
}: IndexDataFieldsPanelProps) {
  const selectedSet = useMemo(() => new Set(selectedColumns), [selectedColumns]);
  const filteredFields = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return availableFields;
    return availableFields.filter((field) => field.toLowerCase().includes(q));
  }, [availableFields, filter]);

  return (
    <aside className="flex w-48 shrink-0 flex-col border-r border-gray-200 bg-gray-50/90 dark:border-gray-700 dark:bg-gray-900/50 sm:w-52">
      <div className="border-b border-gray-200 px-2 py-2 dark:border-gray-700">
        <div className="mb-1.5 flex items-center justify-between gap-1">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Available fields</span>
          <button
            type="button"
            onClick={onReset}
            title={
              defaultsFromFieldUsage
                ? 'Reset columns to most-used fields (field usage stats)'
                : 'Reset columns to default'
            }
            className="rounded p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="Filter…"
            className="w-full rounded border border-gray-300 bg-white py-1.5 pl-7 pr-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            aria-label="Filter available fields"
          />
        </div>
        <p className="mt-1.5 text-xs leading-snug text-gray-500 dark:text-gray-400">
          Drag onto the table or click to toggle. {selectedColumns.length} selected.
          {defaultsFromFieldUsage ? ' Defaults from field usage.' : ''}
        </p>
        {onAutoColumnsChange && (
          <div className="mt-2 flex items-start justify-between gap-2 rounded border border-gray-200/80 bg-white/70 px-2 py-1.5 dark:border-gray-600/80 dark:bg-gray-800/40">
            <div className="min-w-0">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Auto columns</span>
              <p className="text-[10px] leading-snug text-gray-500 dark:text-gray-400">
                {autoColumns
                  ? 'Updates visible fields when you change index.'
                  : 'Keeps your column pick when you change index.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoColumns}
              aria-label="Auto columns"
              title={autoColumns ? 'Disable auto columns' : 'Enable auto columns'}
              onClick={() => onAutoColumnsChange(!autoColumns)}
              className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
                autoColumns ? 'bg-blue-600 dark:bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  autoColumns ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        )}
      </div>
      <ul className="max-h-[38vh] flex-1 overflow-y-auto py-1">
        {filteredFields.length === 0 && (
          <li className="px-2 py-3 text-center text-sm text-gray-500">No fields match</li>
        )}
        {filteredFields.map((field) => {
          const active = selectedSet.has(field);
          return (
            <li key={field}>
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  setFieldDragPayload(e.dataTransfer, { field, source: 'sidebar' });
                  e.dataTransfer.setData('text/plain', field);
                }}
                onClick={() => onToggleField(field)}
                className={`group flex w-full items-center gap-1 px-1.5 py-1.5 text-left text-sm font-mono transition-colors ${
                  active
                    ? 'bg-gray-200/80 text-gray-900 dark:bg-gray-700/80 dark:text-gray-100'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/80'
                }`}
                title={active ? 'Click or drag to remove from table' : 'Click or drag to add to table'}
              >
                <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-gray-400 group-active:cursor-grabbing" />
                <span className="min-w-0 flex-1 truncate">{field}</span>
                {active && (
                  <span className="shrink-0 text-[9px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    on
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
