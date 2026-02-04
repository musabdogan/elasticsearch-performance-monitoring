import { memo } from 'react';
import { Database } from 'lucide-react';
import type { IndexInfo } from '@/types/api';

interface IndexSelectorProps {
  indices: IndexInfo[];
  selectedIndex: string | null;
  onIndexSelect: (index: string | null) => void;
}

const IndexSelector = memo<IndexSelectorProps>(({ indices, selectedIndex, onIndexSelect }) => {
  if (indices.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <Database className="h-4 w-4 text-gray-500 dark:text-gray-400" />
      <select
        value={selectedIndex || ''}
        onChange={(e) => onIndexSelect(e.target.value || null)}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 max-w-48"
      >
        <option value="">All Indices (Cluster)</option>
        {indices.map((index) => (
          <option key={index.index} value={index.index}>
            {index.index}
          </option>
        ))}
      </select>
    </div>
  );
});

IndexSelector.displayName = 'IndexSelector';

export default IndexSelector;
