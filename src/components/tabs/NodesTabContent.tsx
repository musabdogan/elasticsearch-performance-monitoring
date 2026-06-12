import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useMonitoring } from '@/context/MonitoringProvider';
import type { CatAllocationRow, CatNodeExtendedRow, CatShardRow } from '@/types/api';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { InfoPopup } from '@/components/ui/InfoPopup';
import Pagination from '@/components/data/Pagination';
import { RefreshCw, ArrowUp, ArrowDown, ArrowUpDown, Search, X } from 'lucide-react';
import { TabSectionExpandTrigger } from '@/components/ui/TabSectionExpandTrigger';
import { formatBytes, parseDiskSizeToBytes } from '@/utils/format';
import { getCatAllocation, getCatShards, getNodeStats } from '@/services/elasticsearch';
import { hasSearchTerms, parseSearchTerms } from '@/utils/search';

type SortKey = keyof CatNodeExtendedRow;
type SortDirection = 'asc' | 'desc' | null;

const DEFAULT_SORT_COLUMN: SortKey = 'node.role';
const DEFAULT_SORT_DIRECTION: SortDirection = 'asc';
const SECONDARY_SORT_COLUMN: SortKey = 'name';
const SECONDARY_SORT_DIRECTION: SortDirection = 'asc';

const NUMERIC_KEYS: SortKey[] = ['cpu', 'ram.percent', 'heap.percent', 'disk.used_percent', 'load_1m', 'shards'];

const DEFAULT_NODES_PAGE_SIZE = 10;
const NODES_TABLE_COL_COUNT = 11;

/** System/default node attributes (in popup show name only, not value). */
const DEFAULT_NODE_ATTRS = new Set([
  'xpack.installed',
  'transform.config_version',
  'transform.node',
  'ml.config_version',
  'ml.enabled',
  'node.ml',
  'ml.allocated_processors_double',
  'ml.machine_memory',
  'ml.max_jvm_size',
  'ml.allocated_processors'
]);

/** Shown in cell when present; rest go under "+ N more" and in popup. */
const RACK_ZONE_REGION = new Set(['rack', 'zone', 'region']);

/** Node role letter → description for tooltip. */
const NODE_ROLE_DESCRIPTIONS: Record<string, string> = {
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

function formatNodeRoleReadable(nodeRole: string | null | undefined): string {
  const raw = String(nodeRole ?? '').trim();
  if (!raw) return '—';
  const uniqueRoles = [...new Set(raw.split('').filter(Boolean))];
  const labels = uniqueRoles.map((char) => {
    const desc = NODE_ROLE_DESCRIPTIONS[char.toLowerCase()];
    if (!desc) return char;
    return desc.replace(/\s+node$/i, '');
  });
  return labels.join(', ');
}

function normalizeForSearch(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function nodeRoleSearchText(nodeRole: string | null | undefined): string {
  const raw = String(nodeRole ?? '').trim();
  if (!raw) return '';
  const parts: string[] = [raw];
  const uniqueRoles = [...new Set(raw.split('').filter(Boolean))];
  for (const char of uniqueRoles) {
    const desc = NODE_ROLE_DESCRIPTIONS[char.toLowerCase()];
    if (desc) {
      parts.push(desc);
      parts.push(desc.replace(/\s+node$/i, ''));
    }
  }
  return parts.join(' ');
}

function formatNodeRoleTooltip(nodeRole: string): string {
  const uniqueRoles = [...new Set(nodeRole.split('').filter(Boolean))];
  const lines = uniqueRoles
    .map((char) => {
      const desc = NODE_ROLE_DESCRIPTIONS[char.toLowerCase()];
      return desc ? `${char} = ${desc}` : null;
    })
    .filter((s): s is string => s !== null)
    .sort();
  return lines.length > 0 ? lines.join('\n') : nodeRole || '—';
}

function getSortValue(r: CatNodeExtendedRow, key: SortKey): string | number | null {
  const raw = r[key as keyof CatNodeExtendedRow];
  if (raw == null || raw === '') return null;
  if (NUMERIC_KEYS.includes(key)) {
    const num = key === 'shards' ? parseFloat(String(raw).replace(/,/g, '')) : parsePercent(String(raw));
    return num != null ? num : null;
  }
  return String(raw).toLowerCase();
}

function compareOne(a: CatNodeExtendedRow, b: CatNodeExtendedRow, column: SortKey, direction: SortDirection): number {
  const dir = direction === 'desc' ? -1 : 1;
  const aVal = getSortValue(a, column);
  const bVal = getSortValue(b, column);
  if (aVal == null && bVal == null) return 0;
  if (aVal == null) return 1;
  if (bVal == null) return -1;
  const cmp =
    typeof aVal === 'number' && typeof bVal === 'number'
      ? aVal - bVal
      : String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
  return cmp * dir;
}

function compareNodes(a: CatNodeExtendedRow, b: CatNodeExtendedRow, column: SortKey, direction: SortDirection): number {
  const primary = compareOne(a, b, column, direction);
  if (primary !== 0) return primary;
  if (column !== SECONDARY_SORT_COLUMN) {
    const secondary = compareOne(a, b, SECONDARY_SORT_COLUMN, SECONDARY_SORT_DIRECTION);
    if (secondary !== 0) return secondary;
  }
  return 0;
}

function parsePercent(s: string | undefined): number | null {
  if (s == null || s === '') return null;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

/** Parse size string (e.g. "3.3gb" or "3300000000") to bytes, then format as "3.3 GB" / "6.3 GB". */
function formatUsedTotal(
  used: string | undefined,
  total: string | undefined
): string | undefined {
  if (!used || !total) return undefined;
  const uBytes = parseDiskSizeToBytes(used) || (parseFloat(String(used).replace(/,/g, '')) || 0);
  const tBytes = parseDiskSizeToBytes(total) || (parseFloat(String(total).replace(/,/g, '')) || 0);
  if (!uBytes && !tBytes) return `${used}/${total}`;
  return `${formatBytes(uBytes)}/${formatBytes(tBytes)}`;
}

function buildDiskTooltip(allocation: CatAllocationRow | null): string | undefined {
  if (!allocation) return undefined;
  const lines = [
    `disk.total: ${allocation['disk.total'] ?? '—'}`,
    `disk.used: ${allocation['disk.used'] ?? '—'}`,
    `disk.indices: ${allocation['disk.indices'] ?? '—'}`,
    `disk.available: ${allocation['disk.avail'] ?? '—'}`
  ];
  return lines.join('\n');
}

import type { OpenIndexDetailsFn } from '@/types/indexDetail';

interface NodesTabContentProps {
  onRefreshStateChange?: (loading: boolean) => void;
  onOpenNodeDetails?: (nodeName: string) => void;
  onOpenIndexDetails?: OpenIndexDetailsFn;
  modalOnly?: boolean;
  externalOpenNode?: string | null;
  onExternalModalClose?: () => void;
}

export function NodesTabContent({
  onRefreshStateChange,
  onOpenNodeDetails,
  onOpenIndexDetails,
  modalOnly = false,
  externalOpenNode = null,
  onExternalModalClose
}: NodesTabContentProps = {}) {
  const {
    activeCluster,
    catNodesExtended,
    nodeAttrsByNodeId,
    snapshot,
    prevSnapshot,
    nodesLoading,
    nodesError,
    refreshNodes,
    isClusterUnreachable
  } = useMonitoring();
  const nodes = catNodesExtended ?? [];
  const [infoOpen, setInfoOpen] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortKey | null>(DEFAULT_SORT_COLUMN);
  const [sortDirection, setSortDirection] = useState<SortDirection>(DEFAULT_SORT_DIRECTION);
  const [searchTerm, setSearchTerm] = useState('');
  const [nodesPage, setNodesPage] = useState(1);
  const [nodesPageSize, setNodesPageSize] = useState(DEFAULT_NODES_PAGE_SIZE);
  const [expandedComingSoon, setExpandedComingSoon] = useState<Set<string>>(new Set());
  const [nodeAttrsPopover, setNodeAttrsPopover] = useState<{ nodeName: string; attrs: Array<{ attr: string; value: string }> } | null>(null);
  const [selectedNodeName, setSelectedNodeName] = useState<string | null>(null);
  const [selectedNodeShardRows, setSelectedNodeShardRows] = useState<CatShardRow[]>([]);
  const [selectedNodeShardsLoading, setSelectedNodeShardsLoading] = useState(false);
  const [selectedNodeShardsError, setSelectedNodeShardsError] = useState<string | null>(null);
  const [liveNodeRates, setLiveNodeRates] = useState<{ indexingRate: number; searchRate: number } | null>(null);
  const [catAllocationRows, setCatAllocationRows] = useState<CatAllocationRow[]>([]);
  const prevLiveTotalsRef = useRef<{ indexTotal: number; searchTotal: number; fetchedAt: number } | null>(null);
  const nodeDetailBackdropMouseDownRef = useRef(false);
  const nodeAttrsBackdropMouseDownRef = useRef(false);

  const toggleComingSoon = useCallback((id: string) => {
    setExpandedComingSoon((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!nodeAttrsPopover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNodeAttrsPopover(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodeAttrsPopover]);

  const closeNodeModal = useCallback(() => {
    setSelectedNodeName(null);
    setSelectedNodeShardRows([]);
    setSelectedNodeShardsError(null);
    if (modalOnly) onExternalModalClose?.();
  }, [modalOnly, onExternalModalClose]);

  const openNodeDetails = useCallback((nodeName: string) => {
    if (!nodeName) return;
    if (onOpenNodeDetails) {
      onOpenNodeDetails(nodeName);
      return;
    }
    setSelectedNodeName(nodeName);
  }, [onOpenNodeDetails]);

  const effectiveColumn = sortColumn ?? DEFAULT_SORT_COLUMN;
  const effectiveDirection = sortDirection ?? DEFAULT_SORT_DIRECTION;

  const filteredNodes = useMemo(() => {
    const parsed = parseSearchTerms(searchTerm);
    if (!hasSearchTerms(parsed)) return nodes;

    return nodes.filter((r) => {
      const name = normalizeForSearch(r.name);
      const ip = normalizeForSearch(r.ip);
      const id = normalizeForSearch(r.id);
      const role = normalizeForSearch(nodeRoleSearchText(r['node.role']));
      const version = normalizeForSearch(r.version);
      const attrs: Array<{ attr: string; value: string }> =
        nodeAttrsByNodeId?.[r.name ?? ''] ?? nodeAttrsByNodeId?.[r.id ?? ''] ?? [];
      const attrsText = normalizeForSearch(
        attrs
          .map((a) => `${a.attr} ${a.value} ${a.attr}=${a.value}`)
          .join(' ')
      );
      const includeMatch = parsed.includeTerms.every((term) =>
        name.includes(term) ||
        ip.includes(term) ||
        id.includes(term) ||
        role.includes(term) ||
        version.includes(term) ||
        attrsText.includes(term)
      );
      const excludeMatch = parsed.excludeTerms.every((term) =>
        !name.includes(term) &&
        !ip.includes(term) &&
        !id.includes(term) &&
        !role.includes(term) &&
        !version.includes(term) &&
        !attrsText.includes(term)
      );
      return includeMatch && excludeMatch;
    });
  }, [nodes, searchTerm, nodeAttrsByNodeId]);

  const sortedNodes = useMemo(() => {
    return [...filteredNodes].sort((a, b) => compareNodes(a, b, effectiveColumn, effectiveDirection));
  }, [filteredNodes, effectiveColumn, effectiveDirection]);

  const nodesTotalPages = Math.max(1, Math.ceil(sortedNodes.length / Math.max(1, nodesPageSize)));

  const paginatedNodes = useMemo(() => {
    const start = (nodesPage - 1) * nodesPageSize;
    return sortedNodes.slice(start, start + nodesPageSize);
  }, [sortedNodes, nodesPage, nodesPageSize]);

  useEffect(() => setNodesPage(1), [searchTerm, nodesPageSize]);

  useEffect(() => {
    setNodesPage((p) => Math.min(p, nodesTotalPages));
  }, [nodesTotalPages]);

  const handleSort = useCallback((column: SortKey) => {
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDirection(NUMERIC_KEYS.includes(column) ? 'desc' : 'asc');
      return;
    }
    if (sortDirection === 'asc') {
      setSortDirection('desc');
      return;
    }
    if (sortDirection === 'desc') {
      setSortColumn(null);
      setSortDirection(null);
      return;
    }
    setSortColumn(column);
    setSortDirection('asc');
  }, [sortColumn, sortDirection]);

  // Fetch nodes whenever the tab is shown (same as Cluster / Indices / etc.)
  useEffect(() => {
    if (!externalOpenNode) return;
    setSelectedNodeName(externalOpenNode);
  }, [externalOpenNode]);

  useEffect(() => {
    if (!selectedNodeName || !activeCluster) return;
    const controller = new AbortController();
    setSelectedNodeShardsLoading(true);
    setSelectedNodeShardsError(null);
    void getCatShards(activeCluster, controller.signal)
      .then((rows) => {
        if (!Array.isArray(rows)) {
          setSelectedNodeShardRows([]);
          return;
        }
        setSelectedNodeShardRows(
          rows.filter((row) => String(row.node ?? '').trim() === selectedNodeName)
        );
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : 'Failed to load node shard placement';
        setSelectedNodeShardsError(msg);
        setSelectedNodeShardRows([]);
      })
      .finally(() => setSelectedNodeShardsLoading(false));
    return () => controller.abort();
  }, [activeCluster, selectedNodeName]);

  useEffect(() => {
    if (!selectedNodeName) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeNodeModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeNodeModal, selectedNodeName]);

  useEffect(() => {
    if (modalOnly || isClusterUnreachable) return;
    if (activeCluster) {
      refreshNodes();
    }
  }, [activeCluster, modalOnly, isClusterUnreachable, refreshNodes]);

  useEffect(() => {
    if (modalOnly || isClusterUnreachable || !activeCluster) {
      setCatAllocationRows([]);
      return;
    }
    const controller = new AbortController();
    void getCatAllocation(activeCluster, controller.signal)
      .then((rows) => setCatAllocationRows(Array.isArray(rows) ? rows : []))
      .catch(() => setCatAllocationRows([]));
    return () => controller.abort();
  }, [activeCluster, modalOnly, isClusterUnreachable, nodes]);

  // Global Refresh button only triggers _cat/nodes when on Nodes tab
  useEffect(() => {
    if (modalOnly) return;
    const onRefreshNodes = async () => {
      if (!activeCluster || isClusterUnreachable) return;
      onRefreshStateChange?.(true);
      try {
        await refreshNodes();
      } finally {
        onRefreshStateChange?.(false);
      }
    };
    window.addEventListener('refreshNodes', onRefreshNodes);
    return () => window.removeEventListener('refreshNodes', onRefreshNodes);
  }, [activeCluster, modalOnly, isClusterUnreachable, refreshNodes, onRefreshStateChange]);

  const selectedNodeRow = useMemo(() => {
    if (!selectedNodeName) return null;
    return nodes.find((row) => row.name === selectedNodeName || row.id === selectedNodeName) ?? null;
  }, [nodes, selectedNodeName]);

  const allocationByNodeKey = useMemo(() => {
    const byKey = new Map<string, CatAllocationRow>();
    for (const row of catAllocationRows) {
      const node = String(row.node ?? '').trim();
      const ip = String(row.ip ?? '').trim();
      const host = String(row.host ?? '').trim();
      if (node) byKey.set(`node:${node}`, row);
      if (ip) byKey.set(`ip:${ip}`, row);
      if (host) byKey.set(`host:${host}`, row);
    }
    return byKey;
  }, [catAllocationRows]);

  const selectedNodeStats = useMemo(() => {
    if (!selectedNodeName || !snapshot?.nodeStats?.nodes) return null;
    const statsEntries = Object.entries(snapshot.nodeStats.nodes);
    const byName = statsEntries.find(([, node]) => node.name === selectedNodeName)?.[1];
    if (byName) return byName;
    if (selectedNodeRow?.id && snapshot.nodeStats.nodes[selectedNodeRow.id]) {
      return snapshot.nodeStats.nodes[selectedNodeRow.id];
    }
    return null;
  }, [selectedNodeName, selectedNodeRow?.id, snapshot?.nodeStats?.nodes]);

  const selectedNodeRates = useMemo(() => {
    if (!selectedNodeName || !snapshot?.nodeStats?.nodes || !prevSnapshot?.nodeStats?.nodes) {
      return { indexingRate: 0, searchRate: 0, isWarm: false };
    }

    const currentFetchedAt = Date.parse(snapshot.fetchedAt ?? '');
    const previousFetchedAt = Date.parse(prevSnapshot.fetchedAt ?? '');
    const dtSeconds =
      Number.isFinite(currentFetchedAt) && Number.isFinite(previousFetchedAt)
        ? Math.max(0, (currentFetchedAt - previousFetchedAt) / 1000)
        : 0;
    if (dtSeconds <= 0) return { indexingRate: 0, searchRate: 0, isWarm: false };

    const findNodeStats = (
      nodesObj: Record<string, { name?: string; indices?: { indexing?: { index_total?: number }; search?: { query_total?: number } } }>
    ) => {
      const byName = Object.values(nodesObj).find((node) => node?.name === selectedNodeName);
      if (byName) return byName;
      if (selectedNodeRow?.id && nodesObj[selectedNodeRow.id]) return nodesObj[selectedNodeRow.id];
      return null;
    };

    const currentNode = findNodeStats(snapshot.nodeStats.nodes as any);
    const previousNode = findNodeStats(prevSnapshot.nodeStats.nodes as any);
    if (!currentNode || !previousNode) return { indexingRate: 0, searchRate: 0, isWarm: false };

    const currentIndexTotal = Number(currentNode.indices?.indexing?.index_total ?? 0);
    const previousIndexTotal = Number(previousNode.indices?.indexing?.index_total ?? 0);
    const currentSearchTotal = Number(currentNode.indices?.search?.query_total ?? 0);
    const previousSearchTotal = Number(previousNode.indices?.search?.query_total ?? 0);

    return {
      indexingRate: Math.max(0, currentIndexTotal - previousIndexTotal) / dtSeconds,
      searchRate: Math.max(0, currentSearchTotal - previousSearchTotal) / dtSeconds,
      isWarm: true
    };
  }, [selectedNodeName, selectedNodeRow?.id, snapshot, prevSnapshot]);

  useEffect(() => {
    if (!selectedNodeName || !activeCluster || isClusterUnreachable) {
      setLiveNodeRates(null);
      prevLiveTotalsRef.current = null;
      return;
    }

    let controller: AbortController | null = null;
    let inFlight = false;

    const resolveNodeStats = (
      nodesObj: Record<string, { name?: string; indices?: { indexing?: { index_total?: number }; search?: { query_total?: number } } }>
    ) => {
      const byName = Object.values(nodesObj).find((node) => node?.name === selectedNodeName);
      if (byName) return byName;
      if (selectedNodeRow?.id && nodesObj[selectedNodeRow.id]) return nodesObj[selectedNodeRow.id];
      return null;
    };

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      controller?.abort();
      controller = new AbortController();
      try {
        const stats = await getNodeStats(activeCluster, controller.signal);
        const nodesObj = stats?.nodes;
        if (!nodesObj || typeof nodesObj !== 'object') return;
        const node = resolveNodeStats(nodesObj as any);
        if (!node) return;

        const currentIndexTotal = Number(node.indices?.indexing?.index_total ?? 0);
        const currentSearchTotal = Number(node.indices?.search?.query_total ?? 0);
        const now = Date.now();
        const prev = prevLiveTotalsRef.current;
        if (prev) {
          const dtSeconds = Math.max(0, (now - prev.fetchedAt) / 1000);
          if (dtSeconds > 0) {
            setLiveNodeRates({
              indexingRate: Math.max(0, currentIndexTotal - prev.indexTotal) / dtSeconds,
              searchRate: Math.max(0, currentSearchTotal - prev.searchTotal) / dtSeconds
            });
          }
        }
        prevLiveTotalsRef.current = {
          indexTotal: currentIndexTotal,
          searchTotal: currentSearchTotal,
          fetchedAt: now
        };
      } catch {
        // Keep last known rate, ignore transient polling errors.
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 10000);

    return () => {
      controller?.abort();
      window.clearInterval(id);
    };
  }, [selectedNodeName, selectedNodeRow?.id, activeCluster, isClusterUnreachable]);

  const placementSummary = useMemo(() => {
    if (!selectedNodeShardRows.length) {
      return { total: 0, primaries: 0, replicas: 0, storeBytes: 0, topIndices: [] as Array<{ index: string; shards: number }> };
    }
    const byIndex = new Map<string, number>();
    let primaries = 0;
    let replicas = 0;
    let storeBytes = 0;
    for (const row of selectedNodeShardRows) {
      if (row.prirep === 'p') primaries += 1;
      if (row.prirep === 'r') replicas += 1;
      storeBytes += parseDiskSizeToBytes(row.store) || 0;
      byIndex.set(row.index, (byIndex.get(row.index) ?? 0) + 1);
    }
    const topIndices = Array.from(byIndex.entries())
      .map(([index, shards]) => ({ index, shards }))
      .sort((a, b) => b.shards - a.shards || a.index.localeCompare(b.index))
      .slice(0, 3);
    return { total: selectedNodeShardRows.length, primaries, replicas, storeBytes, topIndices };
  }, [selectedNodeShardRows]);

  const nodeDetailModal = selectedNodeName && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        nodeDetailBackdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && nodeDetailBackdropMouseDownRef.current) {
          closeNodeModal();
        }
        nodeDetailBackdropMouseDownRef.current = false;
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="node-details-modal-title"
    >
      <div
        className="max-h-[86vh] w-full max-w-5xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-600">
          <div className="min-w-0">
            <h3 id="node-details-modal-title" className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
              Node Details: <span className="font-mono">{selectedNodeName}</span>
            </h3>
            <div className="mt-1 grid grid-cols-1 gap-2 text-xs text-gray-600 dark:text-gray-300 sm:grid-cols-3">
              <span>Cluster: <span className="font-medium text-gray-900 dark:text-gray-100">{activeCluster?.label ?? '—'}</span></span>
              <span>Uptime: <span className="font-mono text-gray-900 dark:text-gray-100">{selectedNodeRow?.uptime ?? '—'}</span></span>
              <span className="sm:text-right">
                Node Role: <span className="font-medium text-gray-900 dark:text-gray-100">{formatNodeRoleReadable(selectedNodeRow?.['node.role'])}</span>
              </span>
            </div>
            <div className="mt-1 grid grid-cols-1 gap-2 text-xs text-gray-600 dark:text-gray-300 sm:grid-cols-2">
              <span>Node ID: <span className="font-mono text-gray-900 dark:text-gray-100">{selectedNodeRow?.id ?? '—'}</span></span>
              <span>IP: <span className="font-mono text-gray-900 dark:text-gray-100">{selectedNodeRow?.ip ?? '—'}</span></span>
            </div>
          </div>
          <button
            type="button"
            onClick={closeNodeModal}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[62vh] overflow-y-auto p-4">
          <div className="space-y-4">
            <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-600 dark:bg-gray-700/40">
              <div className="font-medium text-gray-900 dark:text-gray-100">Overview</div>
              <div className="mt-1 font-mono text-gray-700 dark:text-gray-200">
                CPU: {selectedNodeRow?.cpu ?? '—'}%&nbsp;&nbsp; RAM: {selectedNodeRow?.['ram.percent'] ?? '—'}%&nbsp;&nbsp; Heap: {selectedNodeRow?.['heap.percent'] ?? '—'}%&nbsp;&nbsp; Disk: {selectedNodeRow?.['disk.used_percent'] ?? '—'}%
              </div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                Disk Used: {selectedNodeRow?.['disk.used'] && selectedNodeRow?.['disk.total'] ? `${selectedNodeRow['disk.used']} / ${selectedNodeRow['disk.total']}` : '—'}
              </div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                Shards: {placementSummary.total} (Primary: {placementSummary.primaries}, Replica: {placementSummary.replicas})
              </div>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-600 dark:bg-gray-700/40">
              <div className="font-medium text-gray-900 dark:text-gray-100">Quick Placement Summary</div>
              {selectedNodeShardsLoading ? (
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Loading shard placement...</div>
              ) : selectedNodeShardsError ? (
                <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{selectedNodeShardsError}</div>
              ) : (
                <>
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                    <p>Top indices on this node:</p>
                    {placementSummary.topIndices.length > 0 ? (
                      <div className="mt-1 space-y-0.5">
                        {placementSummary.topIndices.map((item) => (
                          <div key={item.index} className="font-mono break-all">
                            {onOpenIndexDetails ? (
                              <button
                                type="button"
                                onClick={() => onOpenIndexDetails(item.index)}
                                className="entity-name-link"
                                title={`Open index details for ${item.index}`}
                              >
                                - {item.index}
                              </button>
                            ) : (
                              <span>- {item.index}</span>
                            )}{' '}
                            ({item.shards})
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1">—</p>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                    Estimated store on node: {placementSummary.storeBytes > 0 ? formatBytes(placementSummary.storeBytes) : '—'}
                  </div>
                </>
              )}
            </div>
            {selectedNodeStats && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-600 dark:bg-gray-700/40">
                <p className="text-xs text-gray-500 dark:text-gray-400">Indexing rate</p>
                <p className="mt-1 font-mono text-gray-900 dark:text-gray-100">
                  {liveNodeRates != null || selectedNodeRates.isWarm
                    ? `${(liveNodeRates?.indexingRate ?? selectedNodeRates.indexingRate).toFixed(2)}/sec`
                    : '—'}
                </p>
              </div>
              <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-600 dark:bg-gray-700/40">
                <p className="text-xs text-gray-500 dark:text-gray-400">Search rate</p>
                <p className="mt-1 font-mono text-gray-900 dark:text-gray-100">
                  {liveNodeRates != null || selectedNodeRates.isWarm
                    ? `${(liveNodeRates?.searchRate ?? selectedNodeRates.searchRate).toFixed(2)}/sec`
                    : '—'}
                </p>
              </div>
              </div>
            )}
            <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-600 dark:bg-gray-700/40">
              <div className="text-xs text-gray-500 dark:text-gray-400">Node allocation summary</div>
              <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
                Total shards: {placementSummary.total} · Primary: {placementSummary.primaries} · Replica: {placementSummary.replicas}
              </div>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-600 dark:bg-gray-700/40">
              <div className="text-xs text-gray-500 dark:text-gray-400">Attributes</div>
              {(() => {
                const attrs = nodeAttrsByNodeId?.[selectedNodeRow?.name ?? ''] ?? nodeAttrsByNodeId?.[selectedNodeRow?.id ?? ''] ?? [];
                if (!attrs.length) return <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">No attributes found.</div>;
                return (
                  <div className="mt-2 space-y-1 text-xs font-mono">
                    {attrs.map((a, idx) => (
                      <div key={`${a.attr}-${idx}`} className="text-gray-700 dark:text-gray-200">
                        {a.attr}={DEFAULT_NODE_ATTRS.has(a.attr) ? '—' : a.value}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (!activeCluster) {
    if (modalOnly) return nodeDetailModal;
    return (
      <div className="rounded-lg border border-gray-300 bg-white p-4 text-center text-sm text-gray-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400">
        No cluster selected.
      </div>
    );
  }

  if (nodesLoading && nodes.length === 0) {
    if (modalOnly) return nodeDetailModal;
    return (
      <div className="flex items-center justify-center rounded-lg border border-gray-300 bg-white p-8 dark:bg-gray-800 dark:border-gray-600">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (nodesError) {
    if (modalOnly) return nodeDetailModal;
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
        {nodesError}
        <button
          type="button"
          onClick={refreshNodes}
          className="ml-2 rounded px-2 py-1 text-xs font-medium text-rose-800 underline dark:text-rose-200"
        >
          Retry
        </button>
      </div>
    );
  }

  if (modalOnly) {
    return nodeDetailModal;
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="tab-section-card">
        <div className="tab-section-header tab-section-header-split">
          <div className="flex min-w-0 items-center gap-2 shrink-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Nodes</h2>
            <InfoPopup title="Nodes" modalTitle="Nodes" open={infoOpen} onOpen={() => setInfoOpen(true)} onClose={() => setInfoOpen(false)}>
              <p>Node metadata comes from <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET /_cat/nodes</code>; shard and disk allocation stats come from <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET /_cat/allocation</code>. Requires <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">monitor</code> cluster privilege.</p>
            </InfoPopup>
            {nodesLoading && nodes.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <RefreshCw className="h-3 w-3 animate-spin shrink-0" aria-hidden />
                Refreshing…
              </span>
            )}
          </div>
          <div className="tab-section-inline-tools">
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
              <input
                type="text"
                placeholder="Search nodes"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-36 tab-content-value"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <Pagination
              currentPage={nodesPage}
              totalPages={nodesTotalPages}
              totalItems={sortedNodes.length}
              pageSize={nodesPageSize}
              onPageChange={setNodesPage}
              inline
            />
            <select
              value={String(nodesPageSize)}
              onChange={(e) => setNodesPageSize(parseInt(e.target.value, 10) || DEFAULT_NODES_PAGE_SIZE)}
              className="text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 px-2 py-1.5"
              aria-label="Items per page"
            >
              {[10, 20, 100].map((n) => (
                <option key={n} value={n}>
                  Top {n}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="tab-section-body">
          <div className="tab-section-scroll tab-section-scroll-flush">
            <div className="overflow-x-auto">
          <table className="w-full text-left tab-content-value border-collapse">
            <thead>
              <tr className="border-b-2 border-gray-300 bg-gray-100 dark:border-gray-600 dark:bg-gray-800">
                {([
                  { label: 'Name', sortKey: 'name' as SortKey, sortable: true },
                  { label: 'Uptime', sortKey: 'name' as SortKey, sortable: false },
                  { label: 'IP', sortKey: 'ip' as SortKey, sortable: false },
                  { label: 'Shards', sortKey: 'shards' as SortKey, sortable: false },
                  { label: 'Node Role', sortKey: 'node.role' as SortKey, sortable: true },
                  { label: 'Attributes', sortKey: 'name' as SortKey, sortable: false },
                  { label: 'Load', sortKey: 'load_1m' as SortKey, sortable: false },
                  { label: 'CPU usage', sortKey: 'cpu' as SortKey, sortable: false },
                  { label: 'System RAM', sortKey: 'ram.percent' as SortKey, sortable: false },
                  { label: 'JVM Heap', sortKey: 'heap.percent' as SortKey, sortable: false },
                  { label: 'Disk', sortKey: 'disk.used_percent' as SortKey, sortable: false }
                ] as const).map(({ label, sortKey, sortable }) => (
                  <th
                    key={label}
                    className={`px-3 py-2.5 font-bold text-gray-900 dark:text-gray-50 tab-content-value ${sortable ? 'cursor-pointer select-none hover:bg-gray-200 dark:hover:bg-gray-700' : ''} ${label === 'Shards' ? 'text-right' : 'text-left'} ${['CPU usage', 'System RAM', 'JVM Heap', 'Disk'].includes(label) ? 'min-w-[100px]' : ''}`}
                    onClick={sortable ? () => handleSort(sortKey) : undefined}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {label}
                      {sortable && (effectiveColumn === sortKey
                        ? (effectiveDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : effectiveDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-50" />)
                        : <ArrowUpDown className="h-3 w-3 opacity-40" />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedNodes.length === 0 ? (
                <tr>
                  <td colSpan={NODES_TABLE_COL_COUNT} className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    {searchTerm.trim() ? 'No nodes match the search.' : 'No nodes'}
                  </td>
                </tr>
              ) : (
              paginatedNodes.map((r, idx) => (
                <tr
                  key={r.id ?? r.name ?? idx}
                  className="border-b border-gray-200 text-gray-800 transition hover:bg-blue-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/50"
                >
                  {(() => {
                    const allocationRow =
                      allocationByNodeKey.get(`node:${String(r.name ?? '').trim()}`) ??
                      allocationByNodeKey.get(`ip:${String(r.ip ?? '').trim()}`) ??
                      allocationByNodeKey.get(`host:${String(r.ip ?? '').trim()}`) ??
                      null;
                    const shardCount = allocationRow?.shards ?? r.shards ?? '—';
                    const diskUsedPercent = allocationRow?.['disk.percent'] ?? r['disk.used_percent'];
                    const diskUsed = allocationRow?.['disk.used'] ?? r['disk.used'];
                    const diskTotal = allocationRow?.['disk.total'] ?? r['disk.total'];
                    const diskTooltip = buildDiskTooltip(allocationRow);
                    return (
                      <>
                  <td className="px-3 py-2 font-mono tab-content-value text-gray-900 dark:text-gray-100 whitespace-nowrap" title={r.master === '*' ? 'elected-master node' : undefined}>
                    <button
                      type="button"
                      onClick={() => openNodeDetails(r.name ?? '')}
                      className="text-left font-mono entity-name-link"
                      title={r.name ? `Open node details for ${r.name}` : undefined}
                    >
                      {r.master === '*' ? '⭐ ' : ''}{r.name ?? '—'}
                    </button>
                  </td>
                  <td className="px-3 py-2 tab-content-value text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.uptime ?? '—'}</td>
                  <td className="px-3 py-2 font-mono tab-content-value text-gray-800 dark:text-gray-200">{r.ip ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums tab-content-value text-gray-800 dark:text-gray-200">{shardCount}</td>
                  <td className="px-3 py-2 tab-content-value text-gray-800 dark:text-gray-200" title={formatNodeRoleTooltip(r['node.role'] ?? '')}>{r['node.role'] ?? '—'}</td>
                  <td className="px-3 py-2 tab-content-value text-gray-500 dark:text-gray-400 align-top">
                    {(() => {
                      const attrs: Array<{ attr: string; value: string }> =
                        nodeAttrsByNodeId?.[r.name ?? ''] ?? nodeAttrsByNodeId?.[r.id ?? ''] ?? [];
                      if (attrs.length === 0) return '—';
                      // Only default/system attrs → show nothing (no popup)
                      const meaningfulAttrs = attrs.filter(
                        (a) => RACK_ZONE_REGION.has(a.attr) || !DEFAULT_NODE_ATTRS.has(a.attr)
                      );
                      if (meaningfulAttrs.length === 0) return '—';
                      const preferredAttrs = attrs.filter((a) => RACK_ZONE_REGION.has(a.attr));
                      const restMeaningful = meaningfulAttrs.filter((a) => !RACK_ZONE_REGION.has(a.attr));
                      const hasRest = restMeaningful.length > 0;
                      const nodeName = r.name ?? r.id ?? '';
                      return (
                        <span className="block">
                          {preferredAttrs.map((a, i) => (
                            <span key={i} className="block">{a.attr}={a.value}</span>
                          ))}
                          {hasRest && (
                            <button
                              type="button"
                              onClick={() => setNodeAttrsPopover({ nodeName, attrs: meaningfulAttrs })}
                              className="entity-name-link focus:outline-none focus:underline text-left mt-0.5"
                              title="Show all attributes"
                            >
                              +{restMeaningful.length} more
                            </button>
                          )}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 tabular-nums tab-content-value text-gray-800 dark:text-gray-200">
                    {[r.load_1m, r.load_5m, r.load_15m].filter(Boolean).length
                      ? `${r.load_1m ?? '—'}/${r.load_5m ?? '—'}/${r.load_15m ?? '—'}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 min-w-[100px]">
                    <ProgressBar value={parsePercent(r.cpu)} labelPosition="top" className="tab-content-value" />
                  </td>
                  <td className="px-3 py-2 min-w-[100px]">
                    <ProgressBar
                      value={parsePercent(r['ram.percent'])}
                      labelPosition="top"
                      rightLabel={formatUsedTotal(r['ram.current'], r['ram.max'])}
                      className="tab-content-value"
                    />
                  </td>
                  <td className="px-3 py-2 min-w-[100px]">
                    <ProgressBar
                      value={parsePercent(r['heap.percent'])}
                      labelPosition="top"
                      rightLabel={formatUsedTotal(r['heap.current'], r['heap.max'])}
                      className="tab-content-value"
                    />
                  </td>
                  <td className="px-3 py-2 min-w-[100px]" title={diskTooltip}>
                    <ProgressBar
                      value={parsePercent(diskUsedPercent)}
                      labelPosition="top"
                      rightLabel={formatUsedTotal(diskUsed, diskTotal)}
                      className="tab-content-value"
                    />
                  </td>
                      </>
                    );
                  })()}
                </tr>
              ))
              )}
            </tbody>
          </table>
            </div>
          </div>
        </div>
      </section>

      {/* Coming soon: collapsible sections — no API requests for these yet */}
      {[
        { id: 'thread-pools', title: 'Thread pools' },
        { id: 'network', title: 'Network' },
        { id: 'circuit-breakers', title: 'Circuit breakers (parent)' },
        { id: 'disk', title: 'Disk' },
        { id: 'indexing-failed', title: 'Indexing failed' }
      ].map(({ id, title }) => {
        const isOpen = expandedComingSoon.has(id);
        return (
          <section key={id} className="tab-section-card">
            <div className="tab-section-header">
              <TabSectionExpandTrigger
                expanded={isOpen}
                onToggle={() => toggleComingSoon(id)}
                label={title}
                fillHitArea={true}
              />
            </div>
            {isOpen && (
              <div className="tab-section-body">
                <div className="tab-section-scroll tab-section-scroll-flush px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  Coming soon...
                </div>
              </div>
            )}
          </section>
        );
      })}

      {nodeAttrsPopover && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onMouseDown={(e) => {
            nodeAttrsBackdropMouseDownRef.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && nodeAttrsBackdropMouseDownRef.current) {
              setNodeAttrsPopover(null);
            }
            nodeAttrsBackdropMouseDownRef.current = false;
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="node-attrs-popover-title"
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-600">
              <h3 id="node-attrs-popover-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono">
                {nodeAttrsPopover.attrs.length} attributes — {nodeAttrsPopover.nodeName}
              </h3>
              <button
                type="button"
                onClick={() => setNodeAttrsPopover(null)}
                className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="tab-section-scroll">
              <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-600">
                <table className="w-full min-w-[280px] text-left text-sm tab-content-value border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-700/50">
                      <th className="px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">Attribute</th>
                      <th className="px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodeAttrsPopover.attrs.map((a, i) => (
                      <tr
                        key={a.attr ?? i}
                        className="border-b border-gray-100 text-gray-800 dark:border-gray-700 dark:text-gray-200 last:border-b-0"
                      >
                        <td className="px-3 py-2 font-mono text-xs break-all">{a.attr}</td>
                        <td className="px-3 py-2 font-mono text-xs break-all">
                          {DEFAULT_NODE_ATTRS.has(a.attr) ? '—' : a.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
      {nodeDetailModal}
    </div>
  );
}
