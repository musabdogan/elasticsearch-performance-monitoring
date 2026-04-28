import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { useMonitoring } from '@/context/MonitoringProvider';
import type { CatShardRow } from '@/types/api';
import { getCatShardsPlacement, getIndicesCatalog, getNetworkErrorMessage, getNodesStatsShardsAll } from '@/services/elasticsearch';
import Pagination from '@/components/data/Pagination';
import { InfoPopup } from '@/components/ui/InfoPopup';
import { formatAlertValue, formatDocumentCount, formatNumber } from '@/utils/format';

const PAGE_SIZES = [
  { label: 'Top 10', value: 10 },
  { label: 'Top 20', value: 20 },
  { label: 'Top 100', value: 100 }
] as const;

type ShardCounters = {
  indexingOps: number;
  indexingTimeMs: number;
  searchOps: number;
  searchTimeMs: number;
};

type ShardRates = {
  indexingRate: number;
  indexLatency: number;
  searchRate: number;
  searchLatency: number;
};

const STATS_POLL_MS = 10000;

function normalizeNodeKey(node: string | null | undefined): string {
  const v = (node ?? '').trim();
  return v ? v : 'unassigned';
}

function naturalCompare(aRaw: string, bRaw: string): number {
  const a = String(aRaw ?? '');
  const b = String(bRaw ?? '');
  if (a === b) return 0;
  const re = /(\d+)|(\D+)/g;
  const aParts = a.match(re) ?? [a];
  const bParts = b.match(re) ?? [b];
  const n = Math.min(aParts.length, bParts.length);
  for (let i = 0; i < n; i++) {
    const ap = aParts[i];
    const bp = bParts[i];
    const an = ap.match(/^\d+$/) ? Number(ap) : NaN;
    const bn = bp.match(/^\d+$/) ? Number(bp) : NaN;
    const bothNum = Number.isFinite(an) && Number.isFinite(bn);
    if (bothNum) {
      if (an !== bn) return an - bn;
      continue;
    }
    const cmp = ap.localeCompare(bp);
    if (cmp !== 0) return cmp;
  }
  return aParts.length - bParts.length;
}

function shardKey(row: CatShardRow): string {
  const role = row.prirep === 'p' ? 'p' : 'r';
  const nodeKey = normalizeNodeKey(row.node);
  return `${nodeKey}#${row.index}#${row.shard}#${role}`;
}

function rateKeyForRow(row: CatShardRow): string {
  const role = row.prirep === 'p' ? 'p' : 'r';
  return `${row.index}#${row.shard}#${role}`;
}

function safeParseInt(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function parsePrimaryFlag(v: unknown): boolean | null {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return null;
}

function computeRates(prev: ShardCounters | undefined, curr: ShardCounters, dtSeconds: number): ShardRates {
  if (!prev || dtSeconds <= 0) {
    return { indexingRate: 0, indexLatency: 0, searchRate: 0, searchLatency: 0 };
  }
  const idxOpsDiff = Math.max(0, curr.indexingOps - prev.indexingOps);
  const idxTimeDiff = Math.max(0, curr.indexingTimeMs - prev.indexingTimeMs);
  const srchOpsDiff = Math.max(0, curr.searchOps - prev.searchOps);
  const srchTimeDiff = Math.max(0, curr.searchTimeMs - prev.searchTimeMs);

  const indexingRate = idxOpsDiff > 0 ? idxOpsDiff / dtSeconds : 0;
  const searchRate = srchOpsDiff > 0 ? srchOpsDiff / dtSeconds : 0;
  const indexLatency = idxOpsDiff > 0 ? idxTimeDiff / idxOpsDiff : 0;
  const searchLatency = srchOpsDiff > 0 ? srchTimeDiff / srchOpsDiff : 0;

  return { indexingRate, indexLatency, searchRate, searchLatency };
}

function intensityClass(value: number): string {
  // Bucketize to keep UI stable; value is ops/sec
  if (value <= 0) return 'bg-gray-100 text-gray-700 dark:bg-gray-700/60 dark:text-gray-200';
  if (value < 1) return 'bg-cyan-50 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-200';
  if (value < 10) return 'bg-cyan-100 text-cyan-900 dark:bg-cyan-900/45 dark:text-cyan-100';
  if (value < 100) return 'bg-cyan-200 text-cyan-900 dark:bg-cyan-900/65 dark:text-cyan-50';
  return 'bg-cyan-300 text-cyan-950 dark:bg-cyan-800/80 dark:text-cyan-50';
}

function renderRateValue(v: number): string {
  return formatAlertValue(v ?? 0, '/sec');
}

export function ShardsTabContent({
  onRefreshStateChange,
  onOpenIndexDetails
}: {
  onRefreshStateChange?: (loading: boolean) => void;
  onOpenIndexDetails?: (indexName: string) => void;
} = {}) {
  const { activeCluster } = useMonitoring();

  const [, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<CatShardRow[]>([]);
  const rowsRef = useRef<CatShardRow[]>([]);
  const [indicesHealthByName, setIndicesHealthByName] = useState<Record<string, string>>({});

  const [term, setTerm] = useState('');
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState(1);

  const [statsVersion, setStatsVersion] = useState(0);
  const indexOrderRef = useRef<string[] | null>(null);
  const [indexOrderVersion, setIndexOrderVersion] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const [statsWarm, setStatsWarm] = useState(false);

  const [selectedShard, setSelectedShard] = useState<{
    row: CatShardRow;
    rates: ShardRates | null;
  } | null>(null);

  const prevCountersRef = useRef<Map<string, ShardCounters>>(new Map());
  const prevFetchedAtRef = useRef<number | null>(null);

  const latestRatesByShardKeyRef = useRef<Map<string, ShardRates>>(new Map());

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const indicesAll = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.index);
    const arr = Array.from(set);
    const t = term.trim().toLowerCase();
    const filtered = t ? arr.filter((i) => i.toLowerCase().includes(t)) : arr;
    const order = indexOrderRef.current;
    if (order && order.length > 0) {
      const pos = new Map<string, number>();
      order.forEach((name, idx) => pos.set(name, idx));
      return filtered.sort((a, b) => {
        const pa = pos.get(a);
        const pb = pos.get(b);
        if (pa != null && pb != null) return pa - pb;
        if (pa != null) return -1;
        if (pb != null) return 1;
        return naturalCompare(a, b);
      });
    }
    return filtered.sort((a, b) => naturalCompare(a, b));
  }, [rows, term, indexOrderVersion]);

  const totalPages = Math.max(1, Math.ceil(indicesAll.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const indicesPage = useMemo(() => {
    const start = (pageSafe - 1) * pageSize;
    return indicesAll.slice(start, start + pageSize);
  }, [indicesAll, pageSafe, pageSize]);

  const nodeKeys = useMemo(() => {
    const set = new Set<string>();
    set.add('unassigned');
    for (const r of rows) set.add(normalizeNodeKey(r.node));
    return Array.from(set).sort((a, b) => {
      if (a === 'unassigned') return -1;
      if (b === 'unassigned') return 1;
      return naturalCompare(a, b);
    });
  }, [rows]);

  const indexTotals = useMemo(() => {
    const totals = new Map<string, { indexingRate: number; searchRate: number }>();
    for (const r of rows) {
      const rates = latestRatesByShardKeyRef.current.get(rateKeyForRow(r));
      if (!rates) continue;
      const prev = totals.get(r.index) ?? { indexingRate: 0, searchRate: 0 };
      totals.set(r.index, {
        indexingRate: prev.indexingRate + (rates.indexingRate ?? 0),
        searchRate: prev.searchRate + (rates.searchRate ?? 0)
      });
    }
    return totals;
  }, [rows, statsVersion]);

  const nodeTotals = useMemo(() => {
    const totals = new Map<string, { indexingRate: number; searchRate: number }>();
    for (const r of rows) {
      const nodeKey = normalizeNodeKey(r.node);
      const rates = latestRatesByShardKeyRef.current.get(rateKeyForRow(r));
      if (!rates) continue;
      const prev = totals.get(nodeKey) ?? { indexingRate: 0, searchRate: 0 };
      totals.set(nodeKey, {
        indexingRate: prev.indexingRate + (rates.indexingRate ?? 0),
        searchRate: prev.searchRate + (rates.searchRate ?? 0)
      });
    }
    return totals;
  }, [rows, statsVersion]);

  const cellMap = useMemo(() => {
    const m = new Map<string, CatShardRow[]>();
    for (const r of rows) {
      if (!indicesPage.includes(r.index)) continue;
      const nodeKey = normalizeNodeKey(r.node);
      const key = `${nodeKey}#${r.index}`;
      const arr = m.get(key);
      if (arr) arr.push(r);
      else m.set(key, [r]);
    }
    // Stable order inside cell
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => safeParseInt(a.shard) - safeParseInt(b.shard) || (a.prirep === 'p' ? -1 : 1));
      m.set(k, arr);
    }
    return m;
  }, [rows, indicesPage]);

  const fetchShardStatsAll = useCallback(async (signal?: AbortSignal | null) => {
    if (!activeCluster) return;
    try {
      const now = Date.now();
      const prevAt = prevFetchedAtRef.current;
      const dtSeconds = prevAt != null ? Math.max(0, (now - prevAt) / 1000) : 0;

      const nextCounters = new Map<string, ShardCounters>();
      const nextRates = new Map<string, ShardRates>();

      const data = await getNodesStatsShardsAll(activeCluster, signal);
      if (!data || typeof data !== 'object') return;

      const nodesObj = (data as any).nodes;
      if (!nodesObj || typeof nodesObj !== 'object') return;

      for (const nodeEntry of Object.values(nodesObj as Record<string, any>)) {
        const shardsByIndex = nodeEntry?.indices?.shards;
        if (!shardsByIndex || typeof shardsByIndex !== 'object') continue;

        for (const [indexName, shardsMap] of Object.entries(shardsByIndex as Record<string, any>)) {
          if (!shardsMap) continue;

          // Elasticsearch can return shards as either:
          // A) { "<shardId>": [ {routing, indexing, search}, ... ] }
          // B) [ { "<shardId>": {routing, indexing, search} }, ... ]
          const shardEntries: Array<[string, unknown]> = [];
          if (Array.isArray(shardsMap)) {
            for (const item of shardsMap) {
              if (!item || typeof item !== 'object') continue;
              for (const entry of Object.entries(item as Record<string, unknown>)) {
                shardEntries.push(entry);
              }
            }
          } else if (typeof shardsMap === 'object') {
            shardEntries.push(...Object.entries(shardsMap as Record<string, unknown>));
          }

          for (const [shardId, copyOrCopies] of shardEntries) {
            const copies = Array.isArray(copyOrCopies) ? copyOrCopies : [copyOrCopies];
            for (const copy of copies) {
              if (!copy || typeof copy !== 'object') continue;
              const primaryFlag = parsePrimaryFlag((copy as any)?.routing?.primary);

              const counters: ShardCounters = {
                indexingOps: safeParseInt((copy as any)?.indexing?.index_total),
                indexingTimeMs: safeParseInt((copy as any)?.indexing?.index_time_in_millis),
                searchOps: safeParseInt((copy as any)?.search?.query_total),
                searchTimeMs: safeParseInt((copy as any)?.search?.query_time_in_millis)
              };

              // Some clusters/proxies may stringify booleans or omit routing.primary in filtered responses.
              // If routing.primary is missing, infer primary when indexing counters are present.
              const isPrimary = primaryFlag ?? (counters.indexingOps > 0);
              const role = isPrimary ? 'p' : 'r';
              const k = `${indexName}#${String(shardId)}#${role}`;

              // We may see multiple copies (e.g. relocating); pick max counters to avoid undercount.
              const prevSeen = nextCounters.get(k);
              if (!prevSeen) {
                nextCounters.set(k, counters);
              } else {
                nextCounters.set(k, {
                  indexingOps: Math.max(prevSeen.indexingOps, counters.indexingOps),
                  indexingTimeMs: Math.max(prevSeen.indexingTimeMs, counters.indexingTimeMs),
                  searchOps: Math.max(prevSeen.searchOps, counters.searchOps),
                  searchTimeMs: Math.max(prevSeen.searchTimeMs, counters.searchTimeMs)
                });
              }
            }
          }
        }
      }

      for (const [k, counters] of nextCounters.entries()) {
        const prev = prevCountersRef.current.get(k);
        const rates =
          dtSeconds >= 1
            ? computeRates(prev, counters, dtSeconds)
            : { indexingRate: 0, indexLatency: 0, searchRate: 0, searchLatency: 0 };
        nextRates.set(k, rates);
      }

      prevFetchedAtRef.current = now;
      prevCountersRef.current = nextCounters;
      latestRatesByShardKeyRef.current = nextRates;
      setStatsVersion((v) => v + 1);
      if (!statsWarm && prevAt != null && dtSeconds >= 1) {
        setStatsWarm(true);
      }

      // Freeze index order based on first computed INDEXING totals; keep stable across 10s polling.
      // Prefer delta-based rate. If all rates are 0 on the first meaningful window, fall back to cumulative counters.
      // Use stats-derived keys first to avoid races with placement fetch on initial load.
      const totalsByIndexRate = new Map<string, number>();
      for (const [k, rates] of nextRates.entries()) {
        const indexName = k.split('#')[0] ?? '';
        if (!indexName) continue;
        totalsByIndexRate.set(indexName, (totalsByIndexRate.get(indexName) ?? 0) + (rates.indexingRate ?? 0));
      }

      const totalsByIndexCounter = new Map<string, number>();
      for (const [k, counters] of nextCounters.entries()) {
        const indexName = k.split('#')[0] ?? '';
        if (!indexName) continue;
        totalsByIndexCounter.set(indexName, (totalsByIndexCounter.get(indexName) ?? 0) + (counters.indexingOps ?? 0));
      }

      const indicesSet = new Set<string>();
      for (const r of rowsRef.current) indicesSet.add(r.index);
      for (const idx of totalsByIndexRate.keys()) indicesSet.add(idx);
      for (const idx of totalsByIndexCounter.keys()) indicesSet.add(idx);
      const indicesList = Array.from(indicesSet);
      const maxRate = indicesList.reduce((acc, name) => Math.max(acc, totalsByIndexRate.get(name) ?? 0), 0);
      const maxCounter = indicesList.reduce((acc, name) => Math.max(acc, totalsByIndexCounter.get(name) ?? 0), 0);
      const existing = indexOrderRef.current;
      // Important: don't "freeze" order on the very first stats fetch (dtSeconds ~ 0),
      // otherwise everything is 0 and we'd accidentally lock alphabetical order.
      const useCounterFallback = maxRate <= 0 && maxCounter > 0;
      if ((!existing || existing.length === 0) && dtSeconds >= 1 && (maxRate > 0 || maxCounter > 0)) {
        indexOrderRef.current = indicesList.sort((a, b) => {
          const ra = totalsByIndexRate.get(a) ?? 0;
          const rb = totalsByIndexRate.get(b) ?? 0;
          const ca = totalsByIndexCounter.get(a) ?? 0;
          const cb = totalsByIndexCounter.get(b) ?? 0;
          if (!useCounterFallback && rb !== ra) return rb - ra;
          if (useCounterFallback && cb !== ca) return cb - ca;
          // tie-breaker: use counters, then natural name
          if (cb !== ca) return cb - ca;
          return naturalCompare(a, b);
        });
        setIndexOrderVersion((v) => v + 1);
      } else {
        const seen = new Set(existing ?? []);
        const missing = indicesList.filter((i) => !seen.has(i));
        if (missing.length > 0) {
          missing.sort((a, b) => {
            const ra = totalsByIndexRate.get(a) ?? 0;
            const rb = totalsByIndexRate.get(b) ?? 0;
            const ca = totalsByIndexCounter.get(a) ?? 0;
            const cb = totalsByIndexCounter.get(b) ?? 0;
            if (!useCounterFallback && rb !== ra) return rb - ra;
            if (useCounterFallback && cb !== ca) return cb - ca;
            if (cb !== ca) return cb - ca;
            return naturalCompare(a, b);
          });
          indexOrderRef.current = (existing ?? []).concat(missing);
          setIndexOrderVersion((v) => v + 1);
        }
      }

    } catch (e) {
      // Ignore stats errors; placement view still works
      void e;
    }
  }, [activeCluster]);

  const fetchAll = useCallback(async (signal?: AbortSignal | null, opts?: { resetFrozenIndexOrder?: boolean }) => {
    if (!activeCluster) return;
    setLoading(true);
    onRefreshStateChange?.(true);
    setError(null);

    try {
      const [shards, indicesCatalog] = await Promise.all([
        getCatShardsPlacement(activeCluster, signal),
        getIndicesCatalog(activeCluster, signal).catch(() => [])
      ]);

      setRows(Array.isArray(shards) ? shards : []);
      // Keep index ordering stable during auto-refresh; only reset on explicit manual refresh.
      if (opts?.resetFrozenIndexOrder) {
        indexOrderRef.current = null;
        setIndexOrderVersion((v) => v + 1);
        // Re-warm shard stats (delta calculation needs 2 samples)
        prevFetchedAtRef.current = null;
        prevCountersRef.current = new Map();
        latestRatesByShardKeyRef.current = new Map();
        setStatsWarm(false);
      }

      const healthMap: Record<string, string> = {};
      if (Array.isArray(indicesCatalog)) {
        for (const r of indicesCatalog) {
          const name = String(r.index ?? '').trim();
          const health = String((r as any).health ?? '').trim(); // CatIndexRow has health
          if (name && health) healthMap[name] = health;
        }
      }
      setIndicesHealthByName(healthMap);

      // Shard load is fetched in a debounced effect based on visible columns (indicesPage)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load shards';
      const isTimeoutOrNetwork = msg.toLowerCase().includes('network') || msg.toLowerCase().includes('timed out');
      setError(isTimeoutOrNetwork ? getNetworkErrorMessage(activeCluster.baseUrl) : msg);
      setRows([]);
      setIndicesHealthByName({});
    } finally {
      setLoading(false);
      onRefreshStateChange?.(false);
    }
  }, [activeCluster, onRefreshStateChange]);

  // Initial fetch on mount/cluster change
  useEffect(() => {
    if (!activeCluster) return;
    const controller = new AbortController();
    void fetchAll(controller.signal, { resetFrozenIndexOrder: true });
    return () => controller.abort();
  }, [activeCluster?.baseUrl, activeCluster?.label, fetchAll]);

  // Tab-specific refresh event
  useEffect(() => {
    const onRefresh = () => {
      const controller = new AbortController();
      void fetchAll(controller.signal, { resetFrozenIndexOrder: true });
    };
    window.addEventListener('refreshShards', onRefresh);
    return () => window.removeEventListener('refreshShards', onRefresh);
  }, [fetchAll]);

  // Placement + index health auto-refresh (10s). Keep frozen index order.
  useEffect(() => {
    if (!activeCluster) return;
    let controller: AbortController | null = null;
    let inFlight = false;

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      // New controller per tick: prevents a single abort from poisoning future polls.
      controller?.abort();
      controller = new AbortController();
      try {
        await fetchAll(controller.signal, { resetFrozenIndexOrder: false });
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, STATS_POLL_MS);

    return () => {
      controller?.abort();
      window.clearInterval(id);
    };
  }, [activeCluster?.baseUrl, activeCluster?.label, fetchAll]);

  // Shard load auto-refresh (Indexing&Search style): every 10s
  useEffect(() => {
    if (!activeCluster) return;
    let controller: AbortController | null = null;
    let inFlight = false;

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      controller?.abort();
      controller = new AbortController();
      try {
        await fetchShardStatsAll(controller.signal);
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, STATS_POLL_MS);

    return () => {
      controller?.abort();
      window.clearInterval(id);
    };
  }, [activeCluster?.baseUrl, activeCluster?.label, fetchShardStatsAll]);

  // Reset page when term/page size changes
  useEffect(() => {
    setPage(1);
  }, [term, pageSize]);

  const closeShardModal = useCallback(() => setSelectedShard(null), []);

  useEffect(() => {
    if (!selectedShard) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeShardModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedShard, closeShardModal]);

  if (!activeCluster) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-gray-300 bg-white p-8 dark:bg-gray-800 dark:border-gray-600">
        <p className="text-sm text-gray-500 dark:text-gray-400">Select a cluster to view shards.</p>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-gray-300 bg-white shadow dark:bg-gray-800 dark:border-gray-600 flex-1 min-h-0 flex flex-col">
      {/* Header */}
      <div className="tab-section-header tab-section-header-split border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">Shards</h2>
          <InfoPopup
            title="Shards"
            modalTitle="Shards tab (Node × Index view)"
            open={infoOpen}
            onOpen={() => setInfoOpen(true)}
            onClose={() => setInfoOpen(false)}
          >
            <p>
              This view visualizes shard placement in an ElasticVue-style grid where rows are nodes (including <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">unassigned</code>)
              and columns are indices.
            </p>
            <p className="mt-2">
              Each shard badge shows <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">p</code> (primary) or <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">r</code> (replica) and the shard id.
              Click a shard to open details.
            </p>
            <p className="mt-2">
              Index and node headers show aggregated rates:
              <strong>Indexing rate</strong> and <strong>Search rate</strong> are shown in ops/sec.
              Data refreshes automatically every 10 seconds using <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">/_nodes/stats/indices?level=shards</code>.
            </p>
            <p className="mt-2">
              Sorting behavior:
              nodes are natural-sorted (<code className="px-1 rounded bg-gray-100 dark:bg-gray-800">d2</code> before <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">d10</code>),
              and indices are ranked by highest combined load on the first computed stats window and kept stable until the next manual refresh.
            </p>
          </InfoPopup>
          {!statsWarm && (
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Loading…</span>
          )}
        </div>
        <div className="tab-section-inline-tools">
          <div className="relative min-w-[8rem] max-w-[14rem] flex-1 sm:flex-none sm:w-44">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search index…"
              className="w-full pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 tab-content-value"
            />
            {term && (
              <button
                type="button"
                onClick={() => setTerm('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                aria-label="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 shrink-0">
            <span className="whitespace-nowrap">Columns:</span>
            <select
              className="text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 px-2 py-1"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {PAGE_SIZES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <Pagination
            inline
            currentPage={pageSafe}
            totalPages={totalPages}
            totalItems={indicesAll.length}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {error ? (
          <div className="p-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
              {error}
            </div>
          </div>
        ) : (
          <div className="w-full min-w-0">
            {/* Use fixed, compact index columns (ElasticVue-style) to avoid big gaps on wide screens */}
            <div
              className="grid w-full"
              style={{ gridTemplateColumns: `220px repeat(${indicesPage.length}, minmax(140px, 1fr))` }}
            >
              {/* Sticky header row */}
              <div className="sticky top-0 z-20 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200">
                Nodes
                <div className="text-[10px] font-normal text-gray-500 dark:text-gray-400 mt-0.5">
                  {rows.length > 0 ? `${formatNumber(rows.length)} shards` : '—'}
                </div>
              </div>
              {indicesPage.map((idx) => {
                const health = indicesHealthByName[idx];
                const healthDot =
                  health === 'green'
                    ? 'bg-emerald-500'
                    : health === 'yellow'
                      ? 'bg-amber-500'
                      : health === 'red'
                        ? 'bg-red-500'
                        : 'bg-gray-400';
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onOpenIndexDetails?.(idx)}
                    className="sticky top-0 z-20 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors"
                    title={idx}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`h-2 w-2 rounded-full ${healthDot}`} aria-hidden />
                      <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{idx}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                      {statsWarm ? (
                        <>
                          <div className="truncate">
                            Indexing rate {renderRateValue(indexTotals.get(idx)?.indexingRate ?? 0)}
                          </div>
                          <div className="truncate">
                            Search rate {renderRateValue(indexTotals.get(idx)?.searchRate ?? 0)}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </button>
                );
              })}

              {/* Data rows */}
              {nodeKeys.map((nodeKey) => (
                <>
                  <div
                    key={`node-${nodeKey}`}
                    className="sticky left-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-3 py-2"
                    title={nodeKey}
                  >
                    <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                      {nodeKey}
                    </div>
                    <div className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                      {nodeKey === 'unassigned' ? (
                        'No node assigned'
                      ) : (
                        statsWarm ? (
                          <>
                            <div className="truncate">
                              Indexing rate {renderRateValue(nodeTotals.get(nodeKey)?.indexingRate ?? 0)}
                            </div>
                            <div className="truncate">
                              Search rate {renderRateValue(nodeTotals.get(nodeKey)?.searchRate ?? 0)}
                            </div>
                          </>
                        ) : null
                      )}
                    </div>
                  </div>
                  {indicesPage.map((idx) => {
                    const key = `${nodeKey}#${idx}`;
                    const cellRows = cellMap.get(key) ?? [];
                    return (
                      <div
                        key={`${key}-cell`}
                        className="border-b border-gray-100 dark:border-gray-700 px-2 py-2 min-h-[54px]"
                      >
                        {cellRows.length === 0 ? (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {cellRows.map((r) => {
                              const k = shardKey(r);
                              const rk = rateKeyForRow(r);
                              const rates = latestRatesByShardKeyRef.current.get(rk);
                              const rate = Math.max(rates?.indexingRate ?? 0, rates?.searchRate ?? 0);
                              const badgeBase =
                                r.prirep === 'p'
                                  ? 'border border-emerald-400/80 dark:border-emerald-500/60'
                                  : 'border border-dashed border-emerald-400/60 dark:border-emerald-500/40';

                              const state =
                                r.state === 'STARTED'
                                  ? 'ring-0'
                                  : r.state === 'RELOCATING' || r.state === 'INITIALIZING'
                                    ? 'ring-1 ring-amber-400/60'
                                    : r.state === 'UNASSIGNED'
                                      ? 'ring-1 ring-red-400/70'
                                      : 'ring-0';

                              const roleLabel = r.prirep === 'p' ? 'p' : 'r';
                              const label = `${roleLabel}${r.shard}`;
                              const cls = `${badgeBase} ${state} ${intensityClass(rate)} px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-colors`;

                              return (
                                <button
                                  key={k}
                                  type="button"
                                  className={cls}
                                  onClick={() => setSelectedShard({ row: r, rates: rates ?? null })}
                                  title={`${r.index} shard ${r.shard} (${r.prirep})`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Shard detail modal (click a shard) */}
      {selectedShard &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[1px]"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeShardModal();
            }}
          >
            <div className="w-full max-w-xl mx-4 max-h-[85vh] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
              <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {selectedShard.row.index}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
                    Shard <span className="font-mono">{selectedShard.row.shard}</span> • {selectedShard.row.prirep === 'p' ? 'Primary' : 'Replica'} • {selectedShard.row.state}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeShardModal}
                  className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  aria-label="Close shard detail"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[calc(85vh-56px)] overflow-y-auto p-4">
                <div className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <span className="font-mono">{normalizeNodeKey(selectedShard.row.node)}</span>
                  <span className="font-mono">{selectedShard.row.ip ?? '—'}</span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-md bg-gray-50 p-2 dark:bg-gray-800/60">
                    <div className="text-[10px] text-gray-500 dark:text-gray-400">Docs</div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      {(() => {
                        const raw = selectedShard.row.docs;
                        const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
                        if (Number.isFinite(n) && n >= 0) return formatDocumentCount(n);
                        return raw ?? '—';
                      })()}
                    </div>
                  </div>
                  <div className="rounded-md bg-gray-50 p-2 dark:bg-gray-800/60">
                    <div className="text-[10px] text-gray-500 dark:text-gray-400">Store</div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">{selectedShard.row.store ?? '—'}</div>
                  </div>
                  <div className="rounded-md bg-gray-50 p-2 dark:bg-gray-800/60">
                    <div className="text-[10px] text-gray-500 dark:text-gray-400">State</div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">{selectedShard.row.state ?? '—'}</div>
                  </div>
                  <div className="rounded-md bg-gray-50 p-2 dark:bg-gray-800/60">
                    <div className="text-[10px] text-gray-500 dark:text-gray-400">Unassigned reason</div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">{(selectedShard.row as any)['unassigned.reason'] ?? '—'}</div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-md border border-cyan-200 bg-cyan-50 p-2 dark:border-cyan-900/40 dark:bg-cyan-900/20">
                    <div className="text-[10px] text-cyan-700 dark:text-cyan-200">Indexing</div>
                    <div className="mt-0.5 text-gray-900 dark:text-gray-100 space-y-0.5">
                      <div className="truncate">
                        <span className="text-gray-600 dark:text-gray-300">Indexing rate</span>{' '}
                        <span className="font-medium">{formatAlertValue(selectedShard.rates?.indexingRate ?? 0, '/sec')}</span>
                      </div>
                      <div className="truncate">
                        <span className="text-gray-600 dark:text-gray-300">Indexing latency</span>{' '}
                        <span className="font-medium">{formatAlertValue(selectedShard.rates?.indexLatency ?? 0, 'ms')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-md border border-cyan-200 bg-cyan-50 p-2 dark:border-cyan-900/40 dark:bg-cyan-900/20">
                    <div className="text-[10px] text-cyan-700 dark:text-cyan-200">Search</div>
                    <div className="mt-0.5 text-gray-900 dark:text-gray-100 space-y-0.5">
                      <div className="truncate">
                        <span className="text-gray-600 dark:text-gray-300">Search rate</span>{' '}
                        <span className="font-medium">{formatAlertValue(selectedShard.rates?.searchRate ?? 0, '/sec')}</span>
                      </div>
                      <div className="truncate">
                        <span className="text-gray-600 dark:text-gray-300">Search latency</span>{' '}
                        <span className="font-medium">{formatAlertValue(selectedShard.rates?.searchLatency ?? 0, 'ms')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}

