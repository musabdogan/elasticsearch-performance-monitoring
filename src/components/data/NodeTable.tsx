import { memo, useMemo, useState, useEffect, useCallback } from 'react';
import { DataTable } from './DataTable';
import Pagination from './Pagination';
import { InfoPopup } from '@/components/ui/InfoPopup';
import { Search, X } from 'lucide-react';
import type { NodeInfo, NodeStats } from '@/types/api';
import { useMonitoring } from '@/context/MonitoringProvider';

const PAGE_SIZE = 10;
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

interface NodeTableProps {
  nodeStats: NodeStats;
  nodes?: NodeInfo[];
  loading?: boolean;
}

const NodeTable = memo<NodeTableProps>(({ nodeStats, nodes = [], loading = false }) => {
  const { snapshot, prevSnapshot, pollInterval } = useMonitoring();
  const [searchTerm, setSearchTerm] = useState('');

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

      const indexingOps = node.indices.indexing.index_total;
      const searchOps = node.indices.search.query_total;
      const indexingTime = node.indices.indexing.index_time_in_millis;
      const searchTime = node.indices.search.query_time_in_millis;
      // Show 0 latency on first snapshot (no previous data)
      const indexLatency = prevNode && indexingOps > 0 ? indexingTime / indexingOps : 0;
      const searchLatency = prevNode && searchOps > 0 ? searchTime / searchOps : 0;

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
      return nodeData;
    }
    
    const term = searchTerm.toLowerCase();
    return nodeData.filter(node => 
      node.name.toLowerCase().includes(term) ||
      node.ip.toLowerCase().includes(term) ||
      node.nodeRole.toLowerCase().includes(term)
    );
  }, [nodeData, searchTerm]);

  const sortedData = useMemo(() => {
    if (!sortColumn || !sortDirection) {
      return [...filteredData].sort((a, b) => {
        const primarySort = b.indexingRate - a.indexingRate;
        if (primarySort === 0) {
          // İkincil sıralama: node role'e göre
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

  const [nodeStatsInfoOpen, setNodeStatsInfoOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading node data...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Node Statistics
          </h3>
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
        </div>
        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search nodes..."
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
            {filteredData.length} of {nodeData.length} nodes
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
              key: 'name',
              header: 'Node Name',
              sortable: true,
              className: 'font-mono text-xs'
            },
            {
              key: 'nodeRole',
              header: 'Role',
              sortable: true,
              render: (node) => (
                <span
                  className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200"
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
              className: 'font-mono text-xs'
            },
            {
              key: 'indexingRate',
              header: 'Indexing Rate/Sec',
              align: 'right',
              sortable: true,
              render: (node) => (
                <span className="font-mono text-xs text-green-600 dark:text-green-400">
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
                <span className="font-mono text-xs text-blue-600 dark:text-blue-400">
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
                <span className="font-mono text-xs text-purple-600 dark:text-purple-400">
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
                <span className="font-mono text-xs text-orange-600 dark:text-orange-400">
                  {formatLatency(node.searchLatency)}
                </span>
              )
            }
          ]}
          dense
          emptyMessage="No nodes found"
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

NodeTable.displayName = 'NodeTable';

export default NodeTable;
