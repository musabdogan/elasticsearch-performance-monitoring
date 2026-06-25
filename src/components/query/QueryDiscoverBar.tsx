import { RefreshCw, Search } from 'lucide-react';
import { QueryHelpPopup } from '@/components/query/QuerySimpleSearchBar';
import {
  QueryIndexPatternPicker,
  type QueryPatternOption
} from '@/components/query/QueryIndexPatternPicker';
import { normalizeQueryIndexPattern, type QueryMode } from '@/utils/querySearch';

export type QueryDiscoverBarProps = {
  indexPattern: string;
  searchIndexPattern: string;
  indexPickerDisplayLabel?: string;
  onIndexPatternCommit: (value: string) => void;
  patternOptions: QueryPatternOption[];
  onIndexPickerOpen?: () => void;
  mode: QueryMode;
  onModeChange: (mode: QueryMode) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  loading: boolean;
};

export function QueryDiscoverIndexColumn({
  indexPattern,
  indexPickerDisplayLabel,
  onIndexPatternCommit,
  patternOptions,
  onIndexPickerOpen
}: Pick<
  QueryDiscoverBarProps,
  | 'indexPattern'
  | 'indexPickerDisplayLabel'
  | 'onIndexPatternCommit'
  | 'patternOptions'
  | 'onIndexPickerOpen'
>) {
  return (
    <div className="flex min-h-[2.25rem] w-full min-w-0 items-center">
      <QueryIndexPatternPicker
        value={indexPattern}
        displayLabel={indexPickerDisplayLabel}
        onCommit={onIndexPatternCommit}
        options={patternOptions}
        onOpenChange={(open) => {
          if (open) onIndexPickerOpen?.();
        }}
      />
    </div>
  );
}

export function QueryDiscoverSearchRow({
  searchIndexPattern,
  mode,
  onModeChange,
  query,
  onQueryChange,
  onSearch,
  loading
}: Pick<
  QueryDiscoverBarProps,
  'searchIndexPattern' | 'mode' | 'onModeChange' | 'query' | 'onQueryChange' | 'onSearch' | 'loading'
>) {
  return (
    <>
      {mode === 'simple' && (
        <>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearch();
              }}
              placeholder="Filter your data"
              className="w-full rounded-md border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm font-mono text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:bg-gray-800"
              aria-label="Document search query"
            />
          </div>
          <button
            type="button"
            onClick={onSearch}
            disabled={loading || !normalizeQueryIndexPattern(searchIndexPattern)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
            Search
          </button>
          <QueryHelpPopup />
        </>
      )}

      <div className="ml-auto flex shrink-0 rounded-md border border-gray-200 dark:border-gray-600">
        {(['simple', 'advanced'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={`px-3 py-1.5 text-sm capitalize ${
              mode === m
                ? 'bg-blue-600 text-white dark:bg-blue-500'
                : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
    </>
  );
}

/** Standalone card layout (legacy); Query tab uses split columns inside DocumentSearchWorkspace. */
export function QueryDiscoverBar(props: QueryDiscoverBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-900/40">
      <div className="min-w-[180px] max-w-[300px] shrink-0">
        <QueryDiscoverIndexColumn {...props} />
      </div>
      <QueryDiscoverSearchRow {...props} />
    </div>
  );
}
