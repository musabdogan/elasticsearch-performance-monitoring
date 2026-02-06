import { memo, useMemo, useState, useEffect, useCallback } from 'react';
import { DataTable } from './DataTable';
import Pagination from './Pagination';
import { InfoPopup } from '@/components/ui/InfoPopup';
import { Search, X } from 'lucide-react';
import type { IndexInfo, IndexStats } from '@/types/api';

const PAGE_SIZE = 10;
const TABLE_ID = 'index-statistics';

type SortDirection = 'asc' | 'desc' | null;

interface IndexTableProps {
  data: IndexInfo[];
  indexStats?: IndexStats;
  prevIndexStats?: IndexStats;
  fetchedAt?: string;
  prevFetchedAt?: string;
  pollIntervalMs?: number;
  loading?: boolean;
}

const IndexTable = memo<IndexTableProps>(({
  data,
  indexStats,
  prevIndexStats,
  fetchedAt,
  prevFetchedAt,
  pollIntervalMs = 5000,
  loading = false
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const formatBytes = (bytes: number | string): string => {
    const n = typeof bytes === 'number' ? bytes : parseInt(String(bytes), 10) || 0;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = n;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}`;
  };

  const formatLatency = (ms: number): string => {
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(2)} s`;
    }
    return `${ms.toFixed(2)} ms`;
  };

  // Use actual elapsed time between snapshots (fetchedAt) when available; else fallback to poll interval
  const timeIntervalSec = useMemo(() => {
    if (fetchedAt && prevFetchedAt) {
      const ms = new Date(fetchedAt).getTime() - new Date(prevFetchedAt).getTime();
      const sec = ms / 1000;
      return sec > 0 ? sec : pollIntervalMs / 1000;
    }
    return pollIntervalMs / 1000;
  }, [fetchedAt, prevFetchedAt, pollIntervalMs]);

  const hasPreviousSnapshot = !!prevFetchedAt && !!prevIndexStats;

  const processedData = useMemo(() => {
    return data.map((index) => {
      const name = index.index;
      const curr = indexStats?.indices?.[name];
      const prev = prevIndexStats?.indices?.[name];

      // Indexing: primaries; Search: total
      const currIdx = curr?.primaries?.indexing || curr?.total?.indexing;
      const prevIdx = prev?.primaries?.indexing || prev?.total?.indexing;
      const currSearch = curr?.total?.search || curr?.primaries?.search;
      const prevSearch = prev?.total?.search || prev?.primaries?.search;

      const currIdxOps = currIdx?.index_total ?? 0;
      const prevIdxOps = prevIdx?.index_total ?? 0;
      const currIdxTime = currIdx?.index_time_in_millis ?? 0;
      const prevIdxTime = prevIdx?.index_time_in_millis ?? 0;
      const currSearchOps = currSearch?.query_total ?? 0;
      const prevSearchOps = prevSearch?.query_total ?? 0;
      const currSearchTime = currSearch?.query_time_in_millis ?? 0;
      const prevSearchTime = prevSearch?.query_time_in_millis ?? 0;

      // Show 0 for rate and latency when no previous snapshot exists
      const indexingRate =
        hasPreviousSnapshot && timeIntervalSec > 0
          ? Math.max(0, (currIdxOps - prevIdxOps) / timeIntervalSec)
          : 0;
      const searchRate =
        hasPreviousSnapshot && timeIntervalSec > 0
          ? Math.max(0, (currSearchOps - prevSearchOps) / timeIntervalSec)
          : 0;
      // Calculate latency from delta values (recent interval), not cumulative
      const indexOpsDelta = Math.max(0, currIdxOps - prevIdxOps);
      const indexTimeDelta = Math.max(0, currIdxTime - prevIdxTime);
      const searchOpsDelta = Math.max(0, currSearchOps - prevSearchOps);
      const searchTimeDelta = Math.max(0, currSearchTime - prevSearchTime);
      
      const indexLatency = hasPreviousSnapshot && indexOpsDelta > 0 ? indexTimeDelta / indexOpsDelta : 0;
      const searchLatency = hasPreviousSnapshot && searchOpsDelta > 0 ? searchTimeDelta / searchOpsDelta : 0;

      // Total size = primary + replica shards (from _stats total.store.size_in_bytes)
      const totalSizeBytes = curr?.total?.store?.size_in_bytes ?? 0;
      // Primary shard size (from _stats primaries.store.size_in_bytes)
      const primarySizeBytes = curr?.primaries?.store?.size_in_bytes ?? 0;
      // Average shard size = primary size / number of primary shards
      const priNum = parseInt(index.pri, 10) || 0;
      const avgShardSizeBytes = priNum > 0 ? primarySizeBytes / priNum : 0;

      // Primary / Total shards: pri and total = pri * (1 + rep)
      const repNum = parseInt(index.rep, 10) || 0;
      const totalShards = priNum * (1 + repNum) || 1;

      return {
        ...index,
        primaryShards: priNum,
        totalShards,
        indexingRate,
        searchRate,
        indexLatency,
        searchLatency,
        totalSizeBytes,
        avgShardSizeBytes,
        docCount: index['docs.count'],
        docCountNum: parseInt(index['docs.count'], 10) || 0
      };
    });
  }, [data, indexStats, prevIndexStats, timeIntervalSec, hasPreviousSnapshot]);

  const getInitialSortState = useCallback((): { column: string; direction: SortDirection } => {
    try {
      const stored = localStorage.getItem(`datatable-sort-${TABLE_ID}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.column && (parsed.direction === 'asc' || parsed.direction === 'desc')) {
          return { column: parsed.column, direction: parsed.direction };
        }
      }
    } catch {
      // ignore
    }
    return { column: 'indexingRate', direction: 'desc' as SortDirection };
  }, []);

  const [sortState, setSortState] = useState<{ column: string; direction: SortDirection }>(() => getInitialSortState());
  const [currentPage, setCurrentPage] = useState(1);

  const sortColumn = sortState.column;
  const sortDirection = sortState.direction;

  // Filter data based on search term
  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) {
      return processedData;
    }
    
    const term = searchTerm.toLowerCase();
    return processedData.filter(index => 
      index.index.toLowerCase().includes(term)
    );
  }, [processedData, searchTerm]);

  const sortedData = useMemo(() => {
    if (!sortColumn || !sortDirection) {
      return [...filteredData].sort((a, b) => b.indexingRate - a.indexingRate);
    }
    const sorted = [...filteredData].sort((a, b) => {
      const aVal = a[sortColumn as keyof typeof a];
      const bVal = b[sortColumn as keyof typeof b];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        const primarySort = sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        // Secondary sort: sort by doc count for equal values
        if (primarySort === 0) {
          return b.docCountNum - a.docCountNum; // Descending order
        }
        return primarySort;
      }
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      const primarySort = sortDirection === 'asc'
        ? (aStr < bStr ? -1 : aStr > bStr ? 1 : 0)
        : (aStr > bStr ? -1 : aStr < bStr ? 1 : 0);
      // Secondary sort: sort by doc count for equal string values
      if (primarySort === 0) {
        return b.docCountNum - a.docCountNum; // Descending order
      }
      return primarySort;
    });
    return sorted;
  }, [filteredData, sortColumn, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedData.length / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage(1);
  }, [sortedData.length]);

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedData.slice(start, start + PAGE_SIZE);
  }, [sortedData, currentPage]);

  const handleSortChange = useCallback((column: string | null, direction: SortDirection) => {
    setSortState({ column: column ?? 'indexingRate', direction: direction ?? 'desc' });
    try {
      localStorage.setItem(
        `datatable-sort-${TABLE_ID}`,
        JSON.stringify({ column: column ?? 'indexingRate', direction: direction ?? 'desc' })
      );
    } catch {
      // ignore
    }
  }, []);

  const [indexStatsInfoOpen, setIndexStatsInfoOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading index data...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Index Statistics
          </h3>
          <InfoPopup
            title="Index Statistics"
            modalTitle="Index Statistics - API & Calculations"
            open={indexStatsInfoOpen}
            onOpen={() => setIndexStatsInfoOpen(true)}
            onClose={() => setIndexStatsInfoOpen(false)}
          >
            <div className="space-y-3">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">API Endpoints</h3>
                <div className="space-y-1">
                  <code className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded block">/_cat/indices</code>
                  <code className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded block">/_stats</code>
                </div>
                <p className="mt-1">Index list with basic info + detailed per-index statistics.</p>
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">Calculations</h3>
                <p className="text-xs">Indexing metrics use primary shards only. Search metrics use all shards. Rates show operations per second, latencies show average time per operation. Total size includes primary and replica data.</p>
              </div>
            </div>
          </InfoPopup>
        </div>
        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search indices..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-8 py-1.5 text-xs border border-gray-300 rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-40"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <span className="text-xs text-gray-600 dark:text-gray-300">
            {filteredData.length} of {processedData.length} indices
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto min-h-0">
          <DataTable<typeof sortedData[0]>
            tableId={TABLE_ID}
            data={paginatedData}
            controlledSort={{
              sortColumn: sortColumn || null,
              sortDirection: sortDirection ?? null,
              onSortChange: handleSortChange
            }}
          columns={[
            {
              key: 'index',
              header: 'Index Name',
              sortable: true,
              className: 'font-mono text-xs'
            },
            {
              key: 'primaryShards',
              header: 'Primary / Total',
              align: 'center',
              sortable: true,
              render: (row: typeof sortedData[0]) => (
                <span className="font-mono text-xs text-gray-900 dark:text-gray-100">
                  {row.primaryShards} / {row.totalShards}
                </span>
              )
            },
            {
              key: 'totalSizeBytes',
              header: 'Total Size',
              align: 'right',
              sortable: true,
              render: (row: typeof sortedData[0]) => (
                <span className="font-mono text-xs text-gray-900 dark:text-gray-100">
                  {formatBytes(row.totalSizeBytes)}
                </span>
              )
            },
            {
              key: 'avgShardSizeBytes',
              header: 'Shard Size',
              align: 'right',
              sortable: true,
              render: (row: typeof sortedData[0]) => (
                <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
                  {formatBytes(row.avgShardSizeBytes)}
                </span>
              )
            },
            {
              key: 'docCountNum',
              header: 'Doc Count',
              align: 'right',
              sortable: true,
              render: (row: typeof sortedData[0]) => (
                <span className="font-mono text-xs text-gray-900 dark:text-gray-100">
                  {row.docCountNum.toLocaleString()}
                </span>
              )
            },
            {
              key: 'indexingRate',
              header: 'Indexing Rate/Sec',
              align: 'right',
              sortable: true,
              render: (row: typeof sortedData[0]) => (
                <span className="font-mono text-xs text-green-600 dark:text-green-400">
                  {row.indexingRate.toFixed(1)}
                </span>
              )
            },
            {
              key: 'searchRate',
              header: 'Search Rate/Sec',
              align: 'right',
              sortable: true,
              render: (row: typeof sortedData[0]) => (
                <span className="font-mono text-xs text-blue-600 dark:text-blue-400">
                  {row.searchRate.toFixed(1)}
                </span>
              )
            },
            {
              key: 'indexLatency',
              header: 'Indexing Latency',
              align: 'right',
              sortable: true,
              render: (row: typeof sortedData[0]) => (
                <span className="font-mono text-xs text-purple-600 dark:text-purple-400">
                  {formatLatency(row.indexLatency)}
                </span>
              )
            },
            {
              key: 'searchLatency',
              header: 'Search Latency',
              align: 'right',
              sortable: true,
              render: (row: typeof sortedData[0]) => (
                <span className="font-mono text-xs text-orange-600 dark:text-orange-400">
                  {formatLatency(row.searchLatency)}
                </span>
              )
            }
          ]}
          dense
          emptyMessage="No indices found"
        />
        </div>
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={sortedData.length}
          pageSize={PAGE_SIZE}
          onPageChange={setCurrentPage}
        />
      </div>
    </div>
  );
});

IndexTable.displayName = 'IndexTable';

export default IndexTable;
