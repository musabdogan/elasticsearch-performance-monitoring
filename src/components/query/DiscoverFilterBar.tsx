import { X } from 'lucide-react';
import type { DiscoverFilter } from '@/types/discover';
import { formatDiscoverFilterLabel } from '@/utils/discoverFilters';

type DiscoverFilterBarProps = {
  filters: DiscoverFilter[];
  onRemove: (id: string) => void;
  onClearAll?: () => void;
};

export function DiscoverFilterBar({ filters, onRemove, onClearAll }: DiscoverFilterBarProps) {
  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-0.5 py-1">
      {filters.map((filter) => (
        <span
          key={filter.id}
          className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-mono ${
            filter.negate
              ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100'
              : 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100'
          }`}
          title={formatDiscoverFilterLabel(filter)}
        >
          {filter.negate ? <span className="font-sans font-semibold">NOT</span> : null}
          <span className="truncate">{formatDiscoverFilterLabel(filter)}</span>
          <button
            type="button"
            onClick={() => onRemove(filter.id)}
            className="shrink-0 rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
            aria-label={`Remove filter ${formatDiscoverFilterLabel(filter)}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {filters.length > 1 && onClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs text-gray-500 hover:text-gray-800 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
