import { memo, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { DataTable } from './DataTable';
import Pagination from './Pagination';
import { InfoPopup } from '@/components/ui/InfoPopup';
import { useMonitoring } from '@/context/MonitoringProvider';
import {
  getCatShardsForIndex,
  getFieldUsageStats,
  getIlmExplain,
  getIndexDetails,
  getIndexStatsForIndex
} from '@/services/elasticsearch';
import { Search, X } from 'lucide-react';
import type { CatShardRow, FieldUsageStatsResponse, IlmExplainResponse, IndexDetailsResponse, IndexInfo, IndexStats } from '@/types/api';
import { parseSearchTerms, hasSearchTerms, matchesParsedTermsInText } from '@/utils/search';

const TABLE_ID = 'index-statistics';

type SortDirection = 'asc' | 'desc' | null;

type ProcessedIndexRow = IndexInfo & {
  primaryShards: number;
  totalShards: number;
  indexingRate: number;
  searchRate: number;
  indexLatency: number;
  searchLatency: number;
  totalSizeBytes: number;
  avgShardSizeBytes: number;
  docCount: string;
  docCountNum: number;
};

type FieldUsagePopupSummary = {
  totalFields: number;
  usedFields: number;
  unusedFields: number;
  mostUsedFieldName: string | null;
  hasUsageData: boolean;
};

interface IndexTableProps {
  data: IndexInfo[];
  indexStats?: IndexStats;
  prevIndexStats?: IndexStats;
  fetchedAt?: string;
  prevFetchedAt?: string;
  pollIntervalMs?: number;
  loading?: boolean;
  /** When `panel`, uses the same tab-section-card layout as other main tabs (Indexing & Search). */
  variant?: 'plain' | 'panel';
  /** Optional callback when user clicks an index name row (used to open index details in Indices tab). */
  onOpenIndexDetails?: (indexName: string) => void;
}

const IndexTable = memo<IndexTableProps>(({
  data,
  indexStats,
  prevIndexStats,
  fetchedAt,
  prevFetchedAt,
  pollIntervalMs = 5000,
  loading = false,
  variant = 'plain',
  onOpenIndexDetails
}) => {
  const { activeCluster, isClusterUnreachable } = useMonitoring();
  const isPanel = variant === 'panel';
  const [searchTerm, setSearchTerm] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [detailRow, setDetailRow] = useState<ProcessedIndexRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailIndexDetails, setDetailIndexDetails] = useState<IndexDetailsResponse | null>(null);
  const [detailIlm, setDetailIlm] = useState<IlmExplainResponse | null>(null);
  const [detailShards, setDetailShards] = useState<CatShardRow[] | null>(null);
  const [detailFieldUsage, setDetailFieldUsage] = useState<FieldUsagePopupSummary | null>(null);
  const [detailPerfMetrics, setDetailPerfMetrics] = useState<{
    indexingRate: number;
    searchRate: number;
    indexLatency: number;
    searchLatency: number;
  } | null>(null);
  const [detailPerfLoading, setDetailPerfLoading] = useState(false);
  const [detailPerfError, setDetailPerfError] = useState<string | null>(null);
  const detailPerfPrevRef = useRef<{
    timestamp: number;
    indexOps: number;
    indexTimeMs: number;
    searchOps: number;
    searchTimeMs: number;
  } | null>(null);
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

  const getLatencyTextClass = (kind: 'search' | 'indexing', ms: number): string => {
    const neutral = 'text-gray-900 dark:text-gray-100';
    const warning = 'text-amber-600 dark:text-amber-400';
    const critical = 'text-red-600 dark:text-red-400';

    if (kind === 'search') {
      if (ms >= 1000) return critical;
      if (ms >= 100) return warning;
      return neutral;
    }

    // indexing latency
    if (ms >= 100) return critical;
    if (ms >= 20) return warning;
    return neutral;
  };

  const countLeafFieldsFromMapping = (props: Record<string, unknown> | undefined): number => {
    if (!props || typeof props !== 'object') return 0;
    let count = 0;
    for (const value of Object.values(props)) {
      if (!value || typeof value !== 'object') continue;
      const v = value as Record<string, unknown>;
      if (v.properties && typeof v.properties === 'object') {
        count += countLeafFieldsFromMapping(v.properties as Record<string, unknown>);
      } else if (v.fields && typeof v.fields === 'object') {
        if (v.type) count += 1;
        for (const sub of Object.values(v.fields as Record<string, unknown>)) {
          const s = sub as Record<string, unknown>;
          if (s?.properties && typeof s.properties === 'object') {
            count += countLeafFieldsFromMapping(s.properties as Record<string, unknown>);
          } else {
            count += 1;
          }
        }
      } else if (v.type) {
        count += 1;
      }
    }
    return count;
  };

  const parseFieldUsageSummary = (
    indexName: string,
    indexDetailsData: IndexDetailsResponse | null,
    usageData: FieldUsageStatsResponse | null
  ): FieldUsagePopupSummary => {
    const mappingObj = (indexDetailsData?.[indexName] as { mappings?: Record<string, unknown> } | undefined)?.mappings;
    const mappingProps =
      (mappingObj?.properties as Record<string, unknown> | undefined) ??
      ((mappingObj?._doc as { properties?: Record<string, unknown> } | undefined)?.properties);
    const totalFieldsFromMapping = mappingProps ? countLeafFieldsFromMapping(mappingProps) : 0;

    const indexUsage = usageData?.[indexName] as { shards?: unknown[] } | undefined;
    const shards = indexUsage?.shards;
    const fieldUsageMax: Record<string, number> = {};
    const userFields = new Set<string>();
    let mostUsedFieldName: string | null = null;
    let maxUsage = 0;
    let usedFields = 0;

    if (Array.isArray(shards)) {
      for (const shard of shards) {
        const fields = (shard as { stats?: { fields?: Record<string, Record<string, unknown>> } }).stats?.fields;
        if (!fields || typeof fields !== 'object') continue;
        for (const [fieldName, fieldData] of Object.entries(fields)) {
          if (fieldName.startsWith('_')) continue;
          userFields.add(fieldName);
          const any =
            typeof fieldData.any === 'number' ? fieldData.any : parseInt(String(fieldData.any ?? 0), 10) || 0;
          if (any > (fieldUsageMax[fieldName] ?? 0)) fieldUsageMax[fieldName] = any;
        }
      }

      for (const name of userFields) {
        const usage = fieldUsageMax[name] ?? 0;
        if (usage > 0) usedFields += 1;
        if (usage > maxUsage) {
          maxUsage = usage;
          mostUsedFieldName = name;
        }
      }
    }

    const totalFields = totalFieldsFromMapping > 0 ? totalFieldsFromMapping : userFields.size;
    return {
      totalFields,
      usedFields,
      unusedFields: Math.max(0, totalFields - usedFields),
      mostUsedFieldName,
      hasUsageData: Array.isArray(shards) && shards.length > 0
    };
  };

  useEffect(() => {
    const indexName = detailRow?.index;
    if (!indexName || !activeCluster || isClusterUnreachable) {
      setDetailIndexDetails(null);
      setDetailIlm(null);
      setDetailShards(null);
      setDetailFieldUsage(null);
      setDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    const signal = controller.signal;
    setDetailLoading(true);

    Promise.all([
      getIndexDetails(activeCluster, indexName, signal).catch(() => null),
      getIlmExplain(activeCluster, indexName, signal).catch(() => null),
      getCatShardsForIndex(activeCluster, indexName, signal).catch(() => [] as CatShardRow[]),
      getFieldUsageStats(activeCluster, indexName, signal).catch(() => null)
    ]).then(([details, ilm, shards, fieldUsage]) => {
      setDetailIndexDetails(details ?? null);
      setDetailIlm(ilm ?? null);
      setDetailShards(Array.isArray(shards) ? shards : null);
      setDetailFieldUsage(parseFieldUsageSummary(indexName, details ?? null, fieldUsage ?? null));
      setDetailLoading(false);
    });

    return () => controller.abort();
  }, [detailRow?.index, activeCluster, isClusterUnreachable]);

  useEffect(() => {
    const indexName = detailRow?.index;
    if (!indexName || !activeCluster || isClusterUnreachable) {
      detailPerfPrevRef.current = null;
      setDetailPerfMetrics(null);
      setDetailPerfError(null);
      setDetailPerfLoading(false);
      return;
    }

    // Seed with table row values so modal does not feel empty while first sample is prepared.
    setDetailPerfMetrics({
      indexingRate: detailRow.indexingRate,
      searchRate: detailRow.searchRate,
      indexLatency: detailRow.indexLatency,
      searchLatency: detailRow.searchLatency
    });

    let cancelled = false;
    const controller = new AbortController();
    const signal = controller.signal;

    const fetchPerf = async () => {
      if (cancelled) return;
      try {
        setDetailPerfError(null);
        setDetailPerfLoading(true);
        const stats = await getIndexStatsForIndex(activeCluster, indexName, signal);
        if (!stats?.indices) {
          setDetailPerfLoading(false);
          return;
        }
        const entry = Object.values(stats.indices)[0];
        const prim = entry?.primaries?.indexing;
        const search = entry?.total?.search;
        if (!prim || !search) {
          setDetailPerfLoading(false);
          return;
        }

        const raw = {
          timestamp: Date.now(),
          indexOps: prim.index_total ?? 0,
          indexTimeMs: prim.index_time_in_millis ?? 0,
          searchOps: search.query_total ?? 0,
          searchTimeMs: search.query_time_in_millis ?? 0
        };
        const prev = detailPerfPrevRef.current;
        detailPerfPrevRef.current = raw;
        if (!prev) {
          setDetailPerfLoading(false);
          return;
        }

        const dtSec = Math.max(1, (raw.timestamp - prev.timestamp) / 1000);
        const indexOpsDelta = Math.max(0, raw.indexOps - prev.indexOps);
        const searchOpsDelta = Math.max(0, raw.searchOps - prev.searchOps);
        const indexTimeDelta = Math.max(0, raw.indexTimeMs - prev.indexTimeMs);
        const searchTimeDelta = Math.max(0, raw.searchTimeMs - prev.searchTimeMs);
        setDetailPerfMetrics({
          indexingRate: indexOpsDelta / dtSec,
          searchRate: searchOpsDelta / dtSec,
          indexLatency: indexOpsDelta > 0 ? indexTimeDelta / indexOpsDelta : 0,
          searchLatency: searchOpsDelta > 0 ? searchTimeDelta / searchOpsDelta : 0
        });
        setDetailPerfLoading(false);
      } catch (e) {
        if (cancelled) return;
        setDetailPerfError(e instanceof Error ? e.message : 'Failed to load index performance');
        setDetailPerfLoading(false);
      }
    };

    fetchPerf();
    const intervalId = window.setInterval(fetchPerf, 10000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(intervalId);
      detailPerfPrevRef.current = null;
    };
  }, [detailRow, activeCluster, isClusterUnreachable]);

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
  const waitingForFirstDelta = !hasPreviousSnapshot && data.length > 0;

  const processedData = useMemo<ProcessedIndexRow[]>(() => {
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
    const parsed = parseSearchTerms(searchTerm);
    if (!hasSearchTerms(parsed)) return processedData;
    return processedData.filter((index) => matchesParsedTermsInText(index.index, parsed));
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

  const totalPages = Math.max(1, Math.ceil(sortedData.length / Math.max(1, pageSize)));

  useEffect(() => {
    setCurrentPage(1);
  }, [sortedData.length, pageSize]);

  const paginatedData = useMemo(() => {
    const size = Math.max(1, pageSize);
    const start = (currentPage - 1) * size;
    return sortedData.slice(start, start + size);
  }, [sortedData, currentPage, pageSize]);

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

  const infoPopup = (
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
  );

  const toolbarControls = (
    <>
      <div className="relative">
        <Search className="absolute left-1.5 top-1/2 transform -translate-y-1/2 h-3 w-3 text-gray-400" />
        <input
          type="text"
          placeholder="Search indices..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-36 tab-content-value"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            className="absolute right-1.5 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label="Clear search"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={sortedData.length}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        inline
      />
      <select
        value={String(pageSize)}
        onChange={(e) => setPageSize(parseInt(e.target.value, 10) || 10)}
        className="text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 px-2 py-1.5"
        aria-label="Items per page"
      >
        {[10, 20, 100].map((n) => (
          <option key={n} value={n}>
            Top {n}
          </option>
        ))}
      </select>
    </>
  );

  if (loading) {
    if (isPanel) {
      return (
        <section className="tab-section-card flex min-h-[8rem] flex-1 flex-col overflow-hidden">
          <div className="tab-section-body flex flex-1 items-center justify-center">
            <div className="text-sm text-gray-500 dark:text-gray-400">Loading index data...</div>
          </div>
        </section>
      );
    }
    return (
      <div className="flex items-center justify-center h-32">
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading index data...</div>
      </div>
    );
  }

  const dataTable = (
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
              className: 'font-mono tab-content-value',
              render: (row: typeof sortedData[0]) => (
                <button
                  type="button"
                  onClick={() => {
                    if (onOpenIndexDetails) {
                      onOpenIndexDetails(row.index);
                    } else {
                      setDetailRow(row);
                    }
                  }}
                  className="text-left font-mono tab-content-value text-blue-600 dark:text-blue-400 hover:underline break-all min-w-0"
                >
                  {row.index}
                </button>
              )
            },
            {
              key: 'primaryShards',
              header: 'Primary / Total',
              align: 'center',
              sortable: true,
              render: (row: typeof sortedData[0]) => (
                <span className="font-mono tab-content-value text-gray-900 dark:text-gray-100">
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
                <span className="font-mono tab-content-value text-gray-900 dark:text-gray-100">
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
                <span className="font-mono tab-content-value text-gray-600 dark:text-gray-400">
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
                <span className="font-mono tab-content-value text-gray-900 dark:text-gray-100">
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
                <span className="font-mono tab-content-value text-gray-900 dark:text-gray-100">
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
                <span className="font-mono tab-content-value text-gray-900 dark:text-gray-100">
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
                <span className={`font-mono tab-content-value ${getLatencyTextClass('indexing', row.indexLatency)}`}>
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
                <span className={`font-mono tab-content-value ${getLatencyTextClass('search', row.searchLatency)}`}>
                  {formatLatency(row.searchLatency)}
                </span>
              )
            }
          ]}
          emptyMessage="No indices found"
          />

  );

  if (isPanel) {
    return (
      <section className="tab-section-card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="tab-section-header tab-section-header-split">
          <div className="flex min-w-0 items-center gap-2 shrink-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Index Statistics</h2>
            {waitingForFirstDelta && (
              <span className="text-xs text-gray-500 dark:text-gray-400">Loading…</span>
            )}
            {infoPopup}
          </div>
          <div className="tab-section-inline-tools">{toolbarControls}</div>
        </div>
        <div className="tab-section-body flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="tab-section-scroll-fill tab-section-scroll-flush">
            {dataTable}
            {detailRow && (
              <div
                className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
                onClick={() => setDetailRow(null)}
              >
                <div
                  className="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 max-w-2xl w-full max-h-[80vh] overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono truncate">
                        {detailRow.index}
                      </h2>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        Detailed index view (same API family used by Indices tab).
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDetailRow(null)}
                      className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="p-4 space-y-4 text-sm overflow-y-auto max-h-[68vh]">
                    {detailLoading && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">Loading details…</div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Summary</h3>
                        <div className="space-y-1.5">
                          <div>
                            <span className="block text-xs text-gray-500 dark:text-gray-400">Primary / Total</span>
                            <span className="font-mono text-gray-900 dark:text-gray-100">{detailRow.primaryShards} / {detailRow.totalShards}</span>
                          </div>
                          <div>
                            <span className="block text-xs text-gray-500 dark:text-gray-400">Store size</span>
                            <span className="font-mono text-gray-900 dark:text-gray-100">{detailRow['store.size'] ?? formatBytes(detailRow.totalSizeBytes)}</span>
                          </div>
                          <div>
                            <span className="block text-xs text-gray-500 dark:text-gray-400">Shard size (primary)</span>
                            <span className="font-mono text-gray-900 dark:text-gray-100">{detailRow['pri.store.size'] ?? formatBytes(detailRow.avgShardSizeBytes)}</span>
                          </div>
                          <div>
                            <span className="block text-xs text-gray-500 dark:text-gray-400">Doc count</span>
                            <span className="font-mono text-gray-900 dark:text-gray-100">{detailRow.docCountNum.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Index config</h3>
                        <div className="space-y-1.5">
                          {(() => {
                            const idx = detailIndexDetails?.[detailRow.index] as
                              | { settings?: { index?: { refresh_interval?: string; mode?: string; version?: { created_string?: string }; tier?: string; routing?: { allocation?: { include?: { _tier_preference?: string } } } } } }
                              | undefined;
                            const s = idx?.settings?.index;
                            return (
                              <>
                                <div><span className="block text-xs text-gray-500 dark:text-gray-400">Refresh interval</span><span className="font-mono">{s?.refresh_interval ?? '1s'}</span></div>
                                <div><span className="block text-xs text-gray-500 dark:text-gray-400">Index mode</span><span className="font-mono">{s?.mode ?? 'standard'}</span></div>
                                <div><span className="block text-xs text-gray-500 dark:text-gray-400">Version</span><span className="font-mono">{s?.version?.created_string ?? '—'}</span></div>
                                <div><span className="block text-xs text-gray-500 dark:text-gray-400">Tier</span><span className="font-mono">{s?.tier ?? s?.routing?.allocation?.include?._tier_preference ?? '—'}</span></div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Indexing &amp; search</h3>
                        {detailPerfLoading && !detailPerfMetrics && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">Loading indexing &amp; search metrics…</p>
                        )}
                        {!detailPerfLoading && detailPerfError && (
                          <p className="text-xs text-amber-600 dark:text-amber-300">{detailPerfError}</p>
                        )}
                        {detailPerfMetrics && (
                          <div className="space-y-1.5">
                            <div><span className="block text-xs text-gray-500 dark:text-gray-400">Indexing rate</span><span className="font-mono text-gray-900 dark:text-gray-100">{detailPerfMetrics.indexingRate.toFixed(1)} /s</span></div>
                            <div><span className="block text-xs text-gray-500 dark:text-gray-400">Search rate</span><span className="font-mono text-gray-900 dark:text-gray-100">{detailPerfMetrics.searchRate.toFixed(1)} /s</span></div>
                            <div><span className="block text-xs text-gray-500 dark:text-gray-400">Indexing latency</span><span className={`font-mono ${getLatencyTextClass('indexing', detailPerfMetrics.indexLatency)}`}>{formatLatency(detailPerfMetrics.indexLatency)}</span></div>
                            <div><span className="block text-xs text-gray-500 dark:text-gray-400">Search latency</span><span className={`font-mono ${getLatencyTextClass('search', detailPerfMetrics.searchLatency)}`}>{formatLatency(detailPerfMetrics.searchLatency)}</span></div>
                          </div>
                        )}
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Lifecycle</h3>
                        {detailIlm?.indices?.[detailRow.index] ? (
                          <div className="space-y-1.5">
                            <div><span className="block text-xs text-gray-500 dark:text-gray-400">ILM policy</span><span className="font-mono">{detailIlm.indices[detailRow.index]?.policy ?? '—'}</span></div>
                            <div><span className="block text-xs text-gray-500 dark:text-gray-400">Phase</span><span className="font-mono">{detailIlm.indices[detailRow.index]?.phase ?? '—'}</span></div>
                            <div><span className="block text-xs text-gray-500 dark:text-gray-400">Action</span><span className="font-mono">{detailIlm.indices[detailRow.index]?.action ?? '—'}</span></div>
                            <div><span className="block text-xs text-gray-500 dark:text-gray-400">Step</span><span className="font-mono">{detailIlm.indices[detailRow.index]?.step?.name ?? '—'}</span></div>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400 dark:text-gray-500">—</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Field usage</h3>
                        {detailFieldUsage ? (
                          <div className="space-y-1.5">
                            <div><span className="block text-xs text-gray-500 dark:text-gray-400">Total fields</span><span className="font-mono">{detailFieldUsage.totalFields}</span></div>
                            <div><span className="block text-xs text-gray-500 dark:text-gray-400">Used fields</span><span className="font-mono">{detailFieldUsage.hasUsageData ? `${detailFieldUsage.usedFields} fields` : '—'}</span></div>
                            <div><span className="block text-xs text-gray-500 dark:text-gray-400">Unsearched fields</span><span className="font-mono">{detailFieldUsage.hasUsageData ? `${detailFieldUsage.unusedFields} fields` : '—'}</span></div>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400 dark:text-gray-500">—</p>
                        )}
                      </div>
                    </div>
                    {detailShards && detailShards.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Shard allocation</h3>
                        <div className="rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden bg-gray-50/50 dark:bg-gray-800/50">
                          <div className="overflow-x-auto max-h-48 overflow-y-auto">
                            <table className="w-full text-xs border-collapse">
                              <thead className="sticky top-0 bg-gray-100 dark:bg-gray-700/80 text-left">
                                <tr>
                                  <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Shard</th>
                                  <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Type</th>
                                  <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">State</th>
                                  <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Node</th>
                                  <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">IP</th>
                                  <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300 text-right">Docs</th>
                                  <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300 text-right">Store</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                                {detailShards.map((s, i) => (
                                  <tr key={`${s.shard}-${s.prirep}-${i}`} className="bg-white dark:bg-gray-800/50">
                                    <td className="px-3 py-2 font-mono">{s.shard}</td>
                                    <td className="px-3 py-2">{s.prirep === 'p' ? 'Primary' : 'Replica'}</td>
                                    <td className="px-3 py-2">{s.state}</td>
                                    <td className="px-3 py-2 font-mono">{s.node ?? '—'}</td>
                                    <td className="px-3 py-2 font-mono">{s.ip ?? '—'}</td>
                                    <td className="px-3 py-2 font-mono text-right">{s.docs != null ? Intl.NumberFormat('en-US').format(parseInt(String(s.docs), 10) || 0) : '—'}</td>
                                    <td className="px-3 py-2 font-mono text-right">{s.store ?? '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 flex items-center justify-between">
        <div className="ml-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Index Statistics</h3>
          {waitingForFirstDelta && (
            <span className="text-xs text-gray-500 dark:text-gray-400">Loading…</span>
          )}
          {infoPopup}
        </div>
        <div className="flex flex-wrap items-center gap-2">{toolbarControls}</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">{dataTable}</div>
      </div>
    </div>
  );
});

IndexTable.displayName = 'IndexTable';

export default IndexTable;
