import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { RefreshCw, ExternalLink } from 'lucide-react';
import { getCatThreadPool, getNodeHotThreads } from '@/services/elasticsearch';
import type { ClusterConnection } from '@/types/app';
import type { HotThreadPoolShare, HotThreadStackFamily, ThreadPoolPoolMetric } from '@/types/diagnosis';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { openActiveSearchesInNewTab } from '@/utils/extensionNavigation';
import {
  buildCpuWorkloadConclusion,
  buildNodeThreadPoolMetrics,
  getThreadPoolLabel,
  parseHotThreadPoolShares,
  parseHotThreadsText,
  summarizeThreadPool
} from '@/utils/searchDiagnosis';

const THROTTLE_MS = 10 * 60 * 1000;
const CPU_HISTORY_MAX = 16;
const CHART_POOLS = ['search', 'write', 'refresh', 'flush', 'force_merge', 'generic', 'management', 'get'];

const POOL_COLORS: Record<string, string> = {
  search: '#3b82f6',
  write: '#10b981',
  refresh: '#f59e0b',
  flush: '#8b5cf6',
  force_merge: '#a855f7',
  generic: '#64748b',
  management: '#06b6d4',
  get: '#14b8a6'
};

type CpuSnapshot = { t: number; cpu: number };

type InvestigationResult = {
  ranAt: number;
  poolSummary: ReturnType<typeof summarizeThreadPool>;
  poolMetrics: ThreadPoolPoolMetric[];
  hotThreadShares: HotThreadPoolShare[];
  dominantPool: string;
  primaryStack: HotThreadStackFamily;
  maxCpu: number | null;
  conclusion: string;
};

export interface NodeCpuInvestigatePanelProps {
  nodeId: string;
  nodeName: string;
  cpuPercent?: string;
  load1m?: string;
  searchRate?: number;
  indexingRate?: number;
  activeCluster: ClusterConnection;
  isClusterUnreachable: boolean;
}

function formatRate(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function ChartTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-gray-200 bg-white px-2 py-1.5 text-xs shadow dark:border-gray-600 dark:bg-gray-800">
      <div className="font-medium text-gray-900 dark:text-gray-100">{label}</div>
      {payload.map((entry) => (
        <div key={entry.name} className="tabular-nums text-gray-600 dark:text-gray-300">
          <span style={{ color: entry.color }}>{entry.name}</span>: {entry.value ?? 0}
        </div>
      ))}
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  accent
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'warn' | 'danger' | 'ok';
}) {
  const accentClass =
    accent === 'danger'
      ? 'text-rose-600 dark:text-rose-400'
      : accent === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-gray-900 dark:text-gray-100';

  return (
    <div className="rounded border border-gray-200 bg-white px-2.5 py-2 dark:border-gray-600 dark:bg-gray-800/60">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${accentClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 dark:text-gray-400">{sub}</div>}
    </div>
  );
}

function showActiveSearchesLink(result: InvestigationResult): boolean {
  const { poolSummary, dominantPool } = result;
  return (
    poolSummary.searchQueue > 0 ||
    poolSummary.searchRejected > 0 ||
    dominantPool === 'search' ||
    result.poolMetrics.some((m) => m.pool === 'search' && m.active > 0)
  );
}

export function NodeCpuInvestigatePanel({
  nodeId,
  nodeName,
  cpuPercent,
  load1m,
  searchRate,
  indexingRate,
  activeCluster,
  isClusterUnreachable
}: NodeCpuInvestigatePanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InvestigationResult | null>(null);
  const cpuHistoryRef = useRef<CpuSnapshot[]>([]);
  const [cpuHistory, setCpuHistory] = useState<CpuSnapshot[]>([]);
  const cpuPercentRef = useRef(cpuPercent);
  cpuPercentRef.current = cpuPercent;

  const runInvestigate = useCallback(async () => {
    if (!activeCluster || isClusterUnreachable || !nodeId) return;
    setLoading(true);
    setError(null);
    try {
      const [pools, hotText] = await Promise.all([
        getCatThreadPool(activeCluster),
        getNodeHotThreads(activeCluster, nodeId)
      ]);
      const poolSummary = summarizeThreadPool(pools, nodeName);
      const poolMetrics = buildNodeThreadPoolMetrics(pools, nodeName);
      const hot = parseHotThreadsText(hotText);
      const hotThreadShares = parseHotThreadPoolShares(hotText, nodeName);
      const nodeHot =
        hot.byNode.find((n) => n.nodeName.toLowerCase() === nodeName.toLowerCase()) ?? hot.byNode[0];

      const dominantPool = nodeHot?.dominantPool ?? poolSummary.dominantPool;
      const primaryStack = hot.primaryStackFamily;

      const conclusion = buildCpuWorkloadConclusion({
        dominantPool,
        primaryStack,
        searchQueue: poolSummary.searchQueue,
        searchRejected: poolSummary.searchRejected,
        hotThreadShares,
        poolMetrics
      });

      const now = Date.now();

      const cpuNum = parseFloat(cpuPercentRef.current ?? '');
      if (Number.isFinite(cpuNum)) {
        const nextHistory = [...cpuHistoryRef.current, { t: now, cpu: cpuNum }].slice(-CPU_HISTORY_MAX);
        cpuHistoryRef.current = nextHistory;
        setCpuHistory(nextHistory);
      }

      setResult({
        ranAt: now,
        poolSummary,
        poolMetrics,
        hotThreadShares,
        dominantPool,
        primaryStack,
        maxCpu: nodeHot?.maxCpuPercent ?? null,
        conclusion
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load CPU workload data');
    } finally {
      setLoading(false);
    }
  }, [activeCluster, isClusterUnreachable, nodeId, nodeName]);

  useEffect(() => {
    setResult(null);
    setError(null);
    cpuHistoryRef.current = [];
    setCpuHistory([]);
  }, [nodeId]);

  useEffect(() => {
    if (!nodeId || !activeCluster || isClusterUnreachable) return;
    void runInvestigate();
  }, [nodeId, activeCluster?.baseUrl, isClusterUnreachable, runInvestigate]);

  const throttleHint =
    result != null && Date.now() - result.ranAt < THROTTLE_MS
      ? `Updated ${Math.max(0, Math.floor((Date.now() - result.ranAt) / 1000))}s ago`
      : null;

  const cpuNum = parseFloat(cpuPercent ?? '');
  const showHighCpuBanner = Number.isFinite(cpuNum) && cpuNum >= 80;

  const threadPoolChartData = useMemo(() => {
    if (!result) return [];
    const byPool = new Map(result.poolMetrics.map((m) => [m.pool, m]));
    return CHART_POOLS.map((pool) => {
      const row = byPool.get(pool);
      const active = row?.active ?? 0;
      const queue = row?.queue ?? 0;
      const rejected = row?.rejected ?? 0;
      return {
        pool,
        label: getThreadPoolLabel(pool),
        active,
        queue,
        rejected,
        total: active + queue + rejected
      };
    }).filter((row) => row.total > 0);
  }, [result]);

  const saturationPools = useMemo(() => {
    if (!result) return [];
    return ['search', 'write', 'refresh']
      .map((pool) => result.poolMetrics.find((m) => m.pool === pool))
      .filter(
        (m): m is ThreadPoolPoolMetric =>
          m != null &&
          m.max > 0 &&
          ((m.utilizationPct ?? 0) >= 40 || m.queue > 0 || m.rejected > 0)
      );
  }, [result]);

  const cpuTrendData = useMemo(
    () =>
      cpuHistory.map((point, index) => ({
        index,
        cpu: point.cpu,
        label: new Date(point.t).toLocaleTimeString()
      })),
    [cpuHistory]
  );

  const hotThreadChartData = useMemo(() => {
    if (!result?.hotThreadShares.length) return [];
    return result.hotThreadShares
      .filter((entry) => entry.cpuPercent > 0)
      .map((entry) => ({
        ...entry,
        label: getThreadPoolLabel(entry.pool)
      }));
  }, [result]);

  const searchRejectedAccent =
    result && result.poolSummary.searchRejected > 0
      ? 'danger'
      : result && result.poolSummary.searchQueue > 0
        ? 'warn'
        : 'ok';

  const mainWorkloadLabel = result ? getThreadPoolLabel(result.dominantPool) : '—';

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-600 dark:bg-gray-700/40">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium text-gray-900 dark:text-gray-100">What&apos;s using CPU?</div>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            Automatic check when you open this node — no Elasticsearch expertise needed.
          </p>
        </div>
        <button
          type="button"
          disabled={loading || isClusterUnreachable}
          onClick={() => void runInvestigate()}
          className="inline-flex shrink-0 items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-600 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {showHighCpuBanner && (
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          CPU is {cpuPercent}% — review the summary below and check running searches if load stays high.
        </p>
      )}

      {loading && !result && (
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
          Checking thread pools and workload…
        </div>
      )}

      {throttleHint && !loading && <p className="mt-1 text-[10px] text-gray-500">{throttleHint}</p>}
      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      {result && !error && (
        <div className="mt-3 space-y-4">
          <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/30">
            <p className="text-xs font-medium text-blue-900 dark:text-blue-100 leading-relaxed">
              {result.conclusion}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <KpiTile
              label="Node CPU"
              value={cpuPercent != null ? `${cpuPercent}%` : '—'}
              sub={load1m ? `1m load: ${load1m}` : undefined}
              accent={cpuNum >= 80 ? 'warn' : undefined}
            />
            <KpiTile
              label="Searches waiting"
              value={String(result.poolSummary.searchQueue)}
              accent={result.poolSummary.searchQueue > 0 ? 'warn' : 'ok'}
            />
            <KpiTile
              label="Dropped searches"
              value={String(result.poolSummary.searchRejected)}
              accent={searchRejectedAccent}
            />
            <KpiTile
              label="Main workload"
              value={mainWorkloadLabel}
              sub={result.maxCpu != null ? `peak thread: ${result.maxCpu.toFixed(0)}%` : undefined}
            />
          </div>

          {(searchRate != null || indexingRate != null) && (
            <div className="grid grid-cols-2 gap-2">
              <KpiTile label="Search traffic" value={`${formatRate(searchRate)} /s`} sub="queries per second" />
              <KpiTile label="Index traffic" value={`${formatRate(indexingRate)} /s`} sub="documents per second" />
            </div>
          )}

          {threadPoolChartData.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-gray-800 dark:text-gray-200">
                Busy workers right now
              </div>
              <p className="mb-2 text-[10px] text-gray-500 dark:text-gray-400">
                How many workers each task type is using (active + waiting). Only non-zero pools are shown.
              </p>
              <div className="h-36 rounded border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800/60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={threadPoolChartData}
                    layout="vertical"
                    margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-600" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} className="text-gray-500" allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={108}
                      tick={{ fontSize: 10 }}
                      className="text-gray-600 dark:text-gray-300"
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="active" stackId="pool" fill="#3b82f6" name="Active" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="queue" stackId="pool" fill="#f59e0b" name="Waiting" radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {result.poolSummary.searchRejected > 0 && (
                <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-400">
                  {result.poolSummary.searchRejected} searches were dropped since node start — consider scaling or
                  finding heavy queries.
                </p>
              )}
            </div>
          )}

          {saturationPools.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium text-gray-800 dark:text-gray-200">
                Pool capacity used
              </div>
              <p className="mb-2 text-[10px] text-gray-500 dark:text-gray-400">
                How full each worker pool is. Above ~80% means this node is near its limit for that work type.
              </p>
              <div className="space-y-2">
                {saturationPools.map((pool) => (
                  <div key={pool.pool}>
                    <div className="mb-0.5 flex justify-between text-[10px] text-gray-600 dark:text-gray-300">
                      <span>{getThreadPoolLabel(pool.pool)}</span>
                      <span className="tabular-nums">
                        {pool.active} / {pool.max} workers
                        {pool.utilizationPct != null ? ` (${pool.utilizationPct.toFixed(0)}%)` : ''}
                      </span>
                    </div>
                    <ProgressBar value={pool.utilizationPct} max={100} showLabel={false} labelPosition="top" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {hotThreadChartData.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-gray-800 dark:text-gray-200">
                Where CPU time went (sample)
              </div>
              <p className="mb-2 text-[10px] text-gray-500 dark:text-gray-400">
                Snapshot of the busiest threads on this node.
              </p>
              <div className="h-32 rounded border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800/60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hotThreadChartData} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-600" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={48} />
                    <YAxis tick={{ fontSize: 10 }} unit="%" width={36} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="cpuPercent" name="Thread CPU %" radius={[2, 2, 0, 0]}>
                      {hotThreadChartData.map((entry) => (
                        <Cell key={entry.pool} fill={POOL_COLORS[entry.pool] ?? '#64748b'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {cpuTrendData.length >= 2 && (
            <div>
              <div className="mb-1 text-xs font-medium text-gray-800 dark:text-gray-200">CPU while you investigate</div>
              <div className="h-16 rounded border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800/60">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cpuTrendData} margin={{ top: 6, right: 8, left: 0, bottom: 2 }}>
                    <XAxis dataKey="index" hide />
                    <YAxis domain={[0, 100]} hide />
                    <Tooltip content={<ChartTooltip />} labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ''} />
                    <Line type="monotone" dataKey="cpu" stroke="#3b82f6" strokeWidth={1.5} dot={{ r: 2 }} name="CPU %" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {showActiveSearchesLink(result) && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
              onClick={() => openActiveSearchesInNewTab()}
            >
              View running searches on cluster
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
