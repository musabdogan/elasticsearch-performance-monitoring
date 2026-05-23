import { memo, useMemo, useState, useEffect, useCallback } from 'react';
import { DataTable } from './DataTable';
import Pagination from './Pagination';
import { InfoPopup } from '@/components/ui/InfoPopup';
import { Search, X } from 'lucide-react';
import type { NodeInfo, NodeStats } from '@/types/api';
import { useMonitoring } from '@/context/MonitoringProvider';
import { hasSearchTerms, matchesParsedTermsInAnyText, parseSearchTerms } from '@/utils/search';

const TABLE_ID = 'node-statistics';

type SortDirection = 'asc' | 'desc' | null;

const ROLE_DESCRIPTIONS: Record<string, string> = {
  f: 'frozen node',
  c: 'cold node',
  w: 'warm node',
  h: 'hot node',
  d: 'data node',
  l: 'machine learning node',
  i: 'ingest node',
  t: 'transform node',
  s: 'content node',
  r: 'remote cluster client node',
  m: 'master-eligible node',
  v: 'voting-only master node'
};

function formatRoleTooltip(nodeRole: string): string {
  const uniqueRoles = [...new Set(nodeRole.split(''))];
  const rolesWithDesc = uniqueRoles
    .map((char) => {
      const desc = ROLE_DESCRIPTIONS[char.toLowerCase()];
      return desc ? `${char} = ${desc}` : null;
    })
    .filter((s): s is string => s !== null)
    .sort();
  return rolesWithDesc.length > 0 ? rolesWithDesc.join('\n') : nodeRole;
}

function formatLatency(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  return `${ms.toFixed(2)} ms`;
}

function getLatencyTextClass(kind: 'search' | 'indexing', ms: number): string {
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
}

interface NodeTableProps {
  nodeStats: NodeStats;
  nodes?: NodeInfo[];
  loading?: boolean;
  /** When `panel`, uses the same tab-section-card layout as other main tabs (Indexing & Search). */
  variant?: 'plain' | 'panel';
  onOpenNodeDetails?: (nodeName: string) => void;
}

const NodeTable = memo<NodeTableProps>(({ nodeStats, nodes = [], loading = false, variant = 'plain', onOpenNodeDetails }) => {
  const isPanel = variant === 'panel';
  const { snapshot, prevSnapshot, pollInterval } = useMonitoring();
  const [searchTerm, setSearchTerm] = useState('');
  const [pageSize, setPageSize] = useState(10);

  // Use actual elapsed time between snapshots (fetchedAt) when available; else fallback to poll interval
  const timeIntervalSec = useMemo(() => {
    const current = snapshot?.fetchedAt;
    const prev = prevSnapshot?.fetchedAt;
    if (current && prev) {
      const ms = new Date(current).getTime() - new Date(prev).getTime();
      const sec = ms / 1000;
      return sec > 0 ? sec : pollInterval / 1000;
    }
    return pollInterval / 1000;
  }, [snapshot?.fetchedAt, prevSnapshot?.fetchedAt, pollInterval]);

  const nameToNode = useMemo(() => {
    const map = new Map<string, NodeInfo>();
    nodes.forEach((n) => map.set(n.name, n));
    return map;
  }, [nodes]);

  const hasPreviousSnapshot = !!prevSnapshot?.nodeStats && !!prevSnapshot?.fetchedAt;
  const waitingForFirstDelta = !hasPreviousSnapshot && Object.keys(nodeStats.nodes ?? {}).length > 0;

  const nodeData = useMemo(() => {
    return Object.entries(nodeStats.nodes).map(([nodeId, node]) => {
      const prevNode = prevSnapshot?.nodeStats?.nodes?.[nodeId];
      const indexingOpsDiff = prevNode
        ? node.indices.indexing.index_total - prevNode.indices.indexing.index_total
        : 0;
      const searchOpsDiff = prevNode
        ? node.indices.search.query_total - prevNode.indices.search.query_total
        : 0;
      const indexingRate = timeIntervalSec > 0 ? Math.max(0, indexingOpsDiff / timeIntervalSec) : 0;
      const searchRate = timeIntervalSec > 0 ? Math.max(0, searchOpsDiff / timeIntervalSec) : 0;

      // Calculate latency from delta values (recent interval), not cumulative
      const indexingTimeDiff = prevNode
        ? node.indices.indexing.index_time_in_millis - prevNode.indices.indexing.index_time_in_millis
        : 0;
      const searchTimeDiff = prevNode
        ? node.indices.search.query_time_in_millis - prevNode.indices.search.query_time_in_millis
        : 0;
      
      const indexLatency = prevNode && indexingOpsDiff > 0 ? Math.max(0, indexingTimeDiff) / indexingOpsDiff : 0;
      const searchLatency = prevNode && searchOpsDiff > 0 ? Math.max(0, searchTimeDiff) / searchOpsDiff : 0;

      const nodeInfo = nameToNode.get(node.name);
      const nodeRole = nodeInfo?.nodeRole ?? '—';
      const ip = nodeInfo?.ip ?? '—';

      return {
        id: nodeId,
        name: node.name,
        nodeRole,
        ip,
        indexingRate,
        searchRate,
        indexLatency,
        searchLatency
      };
    });
  }, [nodeStats, prevSnapshot, timeIntervalSec, nameToNode]);

  const getInitialSortState = useCallback((): { column: string | null; direction: SortDirection } => {
    try {
      const stored = localStorage.getItem(`datatable-sort-${TABLE_ID}`);
      if (stored) {
        const parsed = JSON.parse(stored) as { column?: string | null; direction?: SortDirection };
        if (parsed.direction === null && (parsed.column === null || parsed.column === undefined)) {
          return { column: null, direction: null };
        }
        if (
          typeof parsed.column === 'string' &&
          (parsed.direction === 'asc' || parsed.direction === 'desc')
        ) {
          return { column: parsed.column, direction: parsed.direction };
        }
      }
    } catch {
      // ignore
    }
    return { column: 'indexingRate', direction: 'desc' as SortDirection };
  }, []);

  const [sortState, setSortState] = useState<{ column: string | null; direction: SortDirection }>(() =>
    getInitialSortState()
  );
  const [currentPage, setCurrentPage] = useState(1);

  const sortColumn = sortState.column;
  const sortDirection = sortState.direction;

  // Filter data based on search term
  const filteredData = useMemo(() => {
    const parsed = parseSearchTerms(searchTerm);
    if (!hasSearchTerms(parsed)) return nodeData;
    return nodeData.filter((node) =>
      matchesParsedTermsInAnyText([node.name, node.ip, node.nodeRole], parsed)
    );
  }, [nodeData, searchTerm]);

  const sortedData = useMemo(() => {
    if (!sortColumn || !sortDirection) {
      return [...filteredData].sort((a, b) => {
        const primarySort = b.indexingRate - a.indexingRate;
        if (primarySort === 0) {
          // Secondary sort: by node role
          const roleSort = a.nodeRole.localeCompare(b.nodeRole);
          if (roleSort === 0) {
            // Tertiary sort: by IP
            return a.ip.localeCompare(b.ip);
          }
          return roleSort;
        }
        return primarySort;
      });
    }
    const sorted = [...filteredData].sort((a, b) => {
      const aVal = a[sortColumn as keyof typeof a];
      const bVal = b[sortColumn as keyof typeof b];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        const primarySort = sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        // Secondary sort: sort by node role for equal values
        if (primarySort === 0) {
          const roleSort = a.nodeRole.localeCompare(b.nodeRole);
          if (roleSort === 0) {
            // Tertiary sort: by IP
            return a.ip.localeCompare(b.ip);
          }
          return roleSort;
        }
        return primarySort;
      }
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      const primarySort = sortDirection === 'asc'
        ? (aStr < bStr ? -1 : aStr > bStr ? 1 : 0)
        : (aStr > bStr ? -1 : aStr < bStr ? 1 : 0);
      // Secondary sort: sort by node role for equal string values
      if (primarySort === 0) {
        const roleSort = a.nodeRole.localeCompare(b.nodeRole);
        if (roleSort === 0) {
          // Tertiary sort: by IP
          return a.ip.localeCompare(b.ip);
        }
        return roleSort;
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
    setSortState({ column, direction });
    try {
      localStorage.setItem(`datatable-sort-${TABLE_ID}`, JSON.stringify({ column, direction }));
    } catch {
      // ignore
    }
  }, []);

  const [nodeStatsInfoOpen, setNodeStatsInfoOpen] = useState(false);

  const infoPopup = (
    <InfoPopup
      title="Node Statistics"
      modalTitle="Node Statistics - API & Calculations"
      open={nodeStatsInfoOpen}
      onOpen={() => setNodeStatsInfoOpen(true)}
      onClose={() => setNodeStatsInfoOpen(false)}
    >
      <div className="space-y-3">
        <div>
          <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">API Endpoints</h3>
          <div className="space-y-1">
            <code className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded block">/_nodes/stats/indices</code>
            <code className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded block">/_cat/nodes</code>
          </div>
          <p className="mt-1">Per-node indexing/search statistics + node metadata.</p>
        </div>
        <div>
          <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">Calculations</h3>
          <p className="text-xs">Shows per-node performance metrics. Rates show operations per second, latencies show average time per operation. IP addresses come from node metadata.</p>
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
          placeholder="Search nodes..."
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
            <div className="text-sm text-gray-500 dark:text-gray-400">Loading node data...</div>
          </div>
        </section>
      );
    }
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading node data...</div>
      </div>
    );
  }

  const dataTable = (
          <DataTable<typeof sortedData[0]>
            tableId={TABLE_ID}
            data={paginatedData}
            controlledSort={{
              sortColumn,
              sortDirection,
              onSortChange: handleSortChange
            }}
          columns={[
            {
              key: 'name',
              header: 'Node Name',
              sortable: true,
              className: 'font-mono tab-content-value',
              render: (node) => (
                <button
                  type="button"
                  onClick={() => onOpenNodeDetails?.(node.name)}
                  className={`text-left font-mono ${
                    onOpenNodeDetails
                      ? 'text-blue-600 hover:underline dark:text-blue-400'
                      : 'text-gray-900 dark:text-gray-100'
                  }`}
                  title={onOpenNodeDetails ? `Open node details for ${node.name}` : node.name}
                >
                  {node.name}
                </button>
              )
            },
            {
              key: 'nodeRole',
              header: 'Role',
              sortable: true,
              render: (node) => (
                <span
                  className="rounded bg-blue-100 px-1.5 py-0.5 tab-content-value font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                  title={formatRoleTooltip(node.nodeRole)}
                >
                  {node.nodeRole}
                </span>
              )
            },
            {
              key: 'ip',
              header: 'IP',
              sortable: true,
              className: 'font-mono tab-content-value'
            },
            {
              key: 'indexingRate',
              header: 'Indexing Rate/Sec',
              align: 'right',
              sortable: true,
              render: (node) => (
                <span className="font-mono tab-content-value text-gray-900 dark:text-gray-100">
                  {node.indexingRate.toFixed(1)}
                </span>
              )
            },
            {
              key: 'searchRate',
              header: 'Search Rate/Sec',
              align: 'right',
              sortable: true,
              render: (node) => (
                <span className="font-mono tab-content-value text-gray-900 dark:text-gray-100">
                  {node.searchRate.toFixed(1)}
                </span>
              )
            },
            {
              key: 'indexLatency',
              header: 'Indexing Latency',
              align: 'right',
              sortable: true,
              render: (node) => (
                <span className={`font-mono tab-content-value ${getLatencyTextClass('indexing', node.indexLatency)}`}>
                  {formatLatency(node.indexLatency)}
                </span>
              )
            },
            {
              key: 'searchLatency',
              header: 'Search Latency',
              align: 'right',
              sortable: true,
              render: (node) => (
                <span className={`font-mono tab-content-value ${getLatencyTextClass('search', node.searchLatency)}`}>
                  {formatLatency(node.searchLatency)}
                </span>
              )
            }
          ]}
          emptyMessage="No nodes found"
  />

  );

  if (isPanel) {
    return (
      <section className="tab-section-card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="tab-section-header tab-section-header-split">
          <div className="flex min-w-0 items-center gap-2 shrink-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Node Statistics</h2>
            {waitingForFirstDelta && (
              <span className="text-xs text-gray-500 dark:text-gray-400">Loading…</span>
            )}
            {infoPopup}
          </div>
          <div className="tab-section-inline-tools">{toolbarControls}</div>
        </div>
        <div className="tab-section-body flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="tab-section-scroll-fill tab-section-scroll-flush">{dataTable}</div>
        </div>
      </section>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 flex items-center justify-between">
        <div className="ml-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Node Statistics</h3>
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


NodeTable.displayName = 'NodeTable';

export default NodeTable;
