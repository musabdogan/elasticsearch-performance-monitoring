import { useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { InfoPopup } from '@/components/ui/InfoPopup';
import { INDEX_DATA_QUERY_EXAMPLES } from '@/utils/indexSearchQuery';

type QuerySimpleSearchBarProps = {
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: () => void;
  loading: boolean;
};

export function QuerySimpleSearchBar({
  query,
  onQueryChange,
  onSearch,
  loading
}: QuerySimpleSearchBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-900/40">
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
        disabled={loading}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
      >
        {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
        Search
      </button>
      <QueryHelpPopup />
    </div>
  );
}

export function QueryHelpPopup() {
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <InfoPopup
      title="Query examples"
      modalTitle="Document search (query_string)"
      open={helpOpen}
      onOpen={() => setHelpOpen(true)}
      onClose={() => setHelpOpen(false)}
    >
      <div className="space-y-2 text-xs">
        <p className="text-gray-600 dark:text-gray-400">
          Uses Elasticsearch <code className="font-mono">query_string</code>. Empty or{' '}
          <code className="font-mono">*</code> runs <code className="font-mono">match_all</code>.
        </p>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-600">
              <th className="py-1 pr-2 font-medium">Query</th>
              <th className="py-1 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {INDEX_DATA_QUERY_EXAMPLES.map(({ query: q, description }) => (
              <tr key={q} className="border-b border-gray-100 dark:border-gray-700/60">
                <td className="py-1.5 pr-2 font-mono text-blue-700 dark:text-blue-300">{q}</td>
                <td className="py-1.5 text-gray-600 dark:text-gray-400">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </InfoPopup>
  );
}
