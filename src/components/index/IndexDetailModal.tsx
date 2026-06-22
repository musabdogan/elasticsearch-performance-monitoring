import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useMonitoring } from '@/context/MonitoringProvider';
import { CodeBlockWithCopy } from '@/components/ui/CodeBlockWithCopy';
import { IndexDataTab } from './IndexDataTab';
import { IndexDiagnosisPanel } from './IndexDiagnosisPanel';
import type { IndexDetailTab } from '@/types/indexDetail';
import type {
  CatAliasRow,
  CatIndexRow,
  CatShardRow,
  FieldUsageStatsResponse,
  IlmExplainResponse,
  IndexDetailsResponse
} from '@/types/api';
import {
  getCatAliases,
  getCatIndexRow,
  getCatShardsForIndex,
  getFieldUsageStats,
  getIlmExplain,
  getIndexDetails,
  getIndexStatsForIndex
} from '@/services/elasticsearch';
import { formatRelativeTimeShort } from '@/utils/format';
import {
  buildMappingSummary,
  buildOverviewRowFromShards,
  FIELD_USAGE_TYPE_LABELS,
  healthToBadgeClass,
  parseCatByteSizeToBytes,
  parseFieldUsageIndexDetailed,
  type FieldUsageSummary
} from '@/utils/indexDetailHelpers';

const SHARD_ALLOCATION_VISIBLE = 6;

const INDEX_DETAIL_TABS: { id: IndexDetailTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'mappings', label: 'Mappings' },
  { id: 'settings', label: 'Settings' },
  { id: 'ilm', label: 'ILM' },
  { id: 'data', label: 'Data' },
  { id: 'diagnosis', label: 'Slow search' }
];

type MappingsResponse = Record<string, { mappings?: { properties?: Record<string, unknown> } }>;

interface IndexDetailModalProps {
  indexName: string;
  initialTab?: IndexDetailTab;
  searchLatencyFromPoll?: number | null;
  catalogRow?: CatIndexRow;
  onClose: () => void;
  onOpenNodeDetails?: (nodeName: string) => void;
}

type IndexPerfSampleRaw = {
  timestamp: number;
  indexOps: number;
  indexTimeMs: number;
  searchOps: number;
  searchTimeMs: number;
};

type IndexPerfMetrics = {
  indexingRate: number;
  searchRate: number;
  indexLatency: number;
  searchLatency: number;
};

type FieldPopoverMode = 'used' | 'unsearched' | null;

function mappingsFromDetails(
  indexName: string,
  indexDetails: IndexDetailsResponse | null
): MappingsResponse | null {
  const entry = indexDetails?.[indexName] as
    | { mappings?: { properties?: Record<string, unknown> } }
    | undefined;
  if (!entry?.mappings) return null;
  return { [indexName]: { mappings: entry.mappings } };
}

function UsedFieldsModal({
  indexName,
  summary,
  onClose
}: {
  indexName: string;
  summary: FieldUsageSummary | undefined;
  onClose: () => void;
}) {
  const backdropRef = useRef(false);
  const fieldList = (summary?.fieldList ?? []).filter((f) => f.usage > 0);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        backdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropRef.current) onClose();
        backdropRef.current = false;
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="used-fields-title"
    >
      <div
        className="max-h-[70vh] w-full max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-600">
          <h3 id="used-fields-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono">
            Used fields — {indexName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[calc(70vh-3.5rem)]">
          {!summary?.hasUsageData ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Usage data not available for this index.</p>
          ) : fieldList.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No used fields observed yet.</p>
          ) : (
            <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-600">
              <table className="w-full min-w-[400px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-700/50">
                    <th className="min-w-[140px] px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">Field</th>
                    <th className="min-w-[90px] px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">Usage</th>
                    <th className="min-w-[180px] px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">Usage type</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldList.map((f) => (
                    <tr
                      key={f.name}
                      className="border-b border-gray-100 text-gray-800 dark:border-gray-700 dark:text-gray-200 last:border-b-0"
                    >
                      <td className="max-w-[220px] px-3 py-2 font-mono truncate" title={f.name}>
                        {f.name}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono">
                        {Intl.NumberFormat('en-US').format(f.usage)} docs
                      </td>
                      <td className="px-3 py-2">
                        {f.usageTypes.length === 0 ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span className="inline-flex flex-wrap gap-1.5">
                            {f.usageTypes.map((t) => (
                              <span
                                key={t}
                                className="inline-flex shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800 dark:bg-blue-900/50 dark:text-blue-200"
                              >
                                {FIELD_USAGE_TYPE_LABELS[t] ?? t}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UnsearchedFieldsModal({
  indexName,
  summary,
  onClose
}: {
  indexName: string;
  summary: FieldUsageSummary | undefined;
  onClose: () => void;
}) {
  const backdropRef = useRef(false);
  const unsearchedNames =
    (summary?.unusedFieldNames?.length ? summary.unusedFieldNames : null) ??
    (summary?.fieldList ?? []).filter((f) => f.usage === 0).map((f) => f.name).sort((a, b) => a.localeCompare(b));

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        backdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropRef.current) onClose();
        backdropRef.current = false;
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsearched-fields-title"
    >
      <div
        className="max-h-[70vh] w-full max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-600">
          <h3 id="unsearched-fields-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono">
            Unsearched fields — {indexName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[calc(70vh-3.5rem)]">
          {!summary?.hasUsageData ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Usage data not available for this index.</p>
          ) : unsearchedNames.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No unsearched fields.</p>
          ) : (
            <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-600">
              <table className="w-full min-w-[400px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-700/50">
                    <th className="min-w-[140px] px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">Field</th>
                    <th className="min-w-[90px] px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">Usage</th>
                  </tr>
                </thead>
                <tbody>
                  {unsearchedNames.map((name) => (
                    <tr
                      key={name}
                      className="border-b border-gray-100 text-gray-800 dark:border-gray-700 dark:text-gray-200 last:border-b-0"
                    >
                      <td className="max-w-[220px] px-3 py-2 font-mono truncate" title={name}>
                        {name}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-amber-600 dark:text-amber-400">unsearched</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function IndexDetailModal({
  indexName,
  initialTab,
  catalogRow,
  onClose,
  onOpenNodeDetails
}: IndexDetailModalProps) {
  const { activeCluster, isClusterUnreachable } = useMonitoring();

  const [activeTab, setActiveTab] = useState<IndexDetailTab>(initialTab ?? 'overview');
  const [aliasesOpen, setAliasesOpen] = useState(false);
  const [shardsExpanded, setShardsExpanded] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [indexDetails, setIndexDetails] = useState<IndexDetailsResponse | null>(null);
  const [indexShards, setIndexShards] = useState<CatShardRow[] | null>(null);
  const [catIndexRow, setCatIndexRow] = useState<CatIndexRow | null>(null);
  const [ilmExplain, setIlmExplain] = useState<IlmExplainResponse | null>(null);
  const [ilmForbidden, setIlmForbidden] = useState(false);
  const [ilmUnavailable, setIlmUnavailable] = useState(false);
  const [indexAliases, setIndexAliases] = useState<string[]>([]);
  const [fieldUsageSummary, setFieldUsageSummary] = useState<FieldUsageSummary | null>(null);
  const [fieldPopoverMode, setFieldPopoverMode] = useState<FieldPopoverMode>(null);

  const [indexPerfMetrics, setIndexPerfMetrics] = useState<IndexPerfMetrics | null>(null);
  const [indexPerfLoading, setIndexPerfLoading] = useState(true);
  const [indexPerfError, setIndexPerfError] = useState<string | null>(null);
  const [indexPerfInitialized, setIndexPerfInitialized] = useState(false);
  const indexPerfPrevRef = useRef<IndexPerfSampleRaw | null>(null);

  const backdropMouseDownRef = useRef(false);
  const aliasesButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setActiveTab(initialTab ?? 'overview');
    setAliasesOpen(false);
    setShardsExpanded(false);
    setFieldPopoverMode(null);
    setIndexPerfMetrics(null);
    setIndexPerfError(null);
    setIndexPerfLoading(true);
    setIndexPerfInitialized(false);
    indexPerfPrevRef.current = null;
  }, [indexName, initialTab]);

  useEffect(() => {
    if (!activeCluster || isClusterUnreachable) {
      setIndexDetails(null);
      setIndexShards(null);
      setCatIndexRow(null);
      setIlmExplain(null);
      setIlmForbidden(false);
      setIlmUnavailable(false);
      setIndexAliases([]);
      setFieldUsageSummary(null);
      setDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    const signal = controller.signal;
    setDetailLoading(true);
    setIlmForbidden(false);
    setIlmUnavailable(false);

    Promise.all([
      getIndexDetails(activeCluster, indexName, signal).catch(() => null),
      getCatShardsForIndex(activeCluster, indexName, signal).catch(() => [] as CatShardRow[]),
      getCatIndexRow(activeCluster, indexName, signal).catch(() => null),
      getIlmExplain(activeCluster, indexName, signal).catch((e) => {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) setIlmForbidden(true);
        else if (msg.includes('404') || msg.includes('400') || msg.includes('no handler')) setIlmUnavailable(true);
        return null;
      }),
      getFieldUsageStats(activeCluster, indexName, signal).catch(() => null),
      getCatAliases(activeCluster, signal).catch(() => [] as CatAliasRow[])
    ]).then(([details, shards, catRow, ilm, fieldUsage, aliasesRes]) => {
      setIndexDetails(details ?? null);
      setIndexShards(Array.isArray(shards) ? shards : null);
      setCatIndexRow(catRow ?? null);
      setIlmExplain(ilm ?? null);

      const aliases = (aliasesRes ?? [])
        .filter((r) => (r.index ?? '') === indexName)
        .map((r) => r.alias ?? '')
        .filter(Boolean);
      setIndexAliases(aliases);

      const mappings = mappingsFromDetails(indexName, details ?? null);
      const summary = parseFieldUsageIndexDetailed(
        indexName,
        fieldUsage as FieldUsageStatsResponse | null,
        mappings
      );
      setFieldUsageSummary(summary);
      setDetailLoading(false);
    });

    return () => controller.abort();
  }, [indexName, activeCluster?.baseUrl, isClusterUnreachable]);

  useEffect(() => {
    if (!activeCluster || isClusterUnreachable) {
      setIndexPerfMetrics(null);
      setIndexPerfError(null);
      indexPerfPrevRef.current = null;
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const signal = controller.signal;

    const fetchOnce = async () => {
      if (cancelled) return;
      try {
        setIndexPerfError(null);
        const stats = await getIndexStatsForIndex(activeCluster, indexName, signal);
        if (!stats?.indices) return;

        const entry = Object.values(stats.indices)[0];
        if (!entry) return;

        const prim = entry.primaries?.indexing;
        const search = entry.total?.search;
        if (!prim || !search) return;

        const now = Date.now();
        const raw: IndexPerfSampleRaw = {
          timestamp: now,
          indexOps: prim.index_total ?? 0,
          indexTimeMs: prim.index_time_in_millis ?? 0,
          searchOps: search.query_total ?? 0,
          searchTimeMs: search.query_time_in_millis ?? 0
        };
        const prev = indexPerfPrevRef.current;
        indexPerfPrevRef.current = raw;
        if (!prev) return;

        const dtSec = Math.max(1, (raw.timestamp - prev.timestamp) / 1000);
        const indexOpsDelta = Math.max(0, raw.indexOps - prev.indexOps);
        const searchOpsDelta = Math.max(0, raw.searchOps - prev.searchOps);
        const indexTimeDelta = Math.max(0, raw.indexTimeMs - prev.indexTimeMs);
        const searchTimeDelta = Math.max(0, raw.searchTimeMs - prev.searchTimeMs);

        setIndexPerfMetrics({
          indexingRate: indexOpsDelta / dtSec,
          searchRate: searchOpsDelta / dtSec,
          indexLatency: indexOpsDelta > 0 ? indexTimeDelta / indexOpsDelta : 0,
          searchLatency: searchOpsDelta > 0 ? searchTimeDelta / searchOpsDelta : 0
        });
        setIndexPerfLoading(false);
        setIndexPerfInitialized(true);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'Failed to load index performance';
        setIndexPerfError(msg);
        setIndexPerfLoading(false);
        setIndexPerfInitialized(true);
      }
    };

    fetchOnce();
    const intervalId = window.setInterval(fetchOnce, 10000);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [indexName, activeCluster, isClusterUnreachable]);

  const handleEscape = useCallback(() => {
    // Nested overlays (e.g. Query details in Slow search) use useNestedEscapeClose — see modal-escape-stack.mdc
    if (fieldPopoverMode) {
      setFieldPopoverMode(null);
    } else if (aliasesOpen) {
      setAliasesOpen(false);
    } else {
      onClose();
    }
  }, [fieldPopoverMode, aliasesOpen, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleEscape]);

  const overviewRow = useMemo((): CatIndexRow | undefined => {
    if (catalogRow) return catalogRow;
    const fromShards =
      indexShards && indexShards.length > 0
        ? (buildOverviewRowFromShards(indexName, indexShards) as CatIndexRow)
        : undefined;
    const fromCat = catIndexRow ?? undefined;
    if (!fromShards && !fromCat) return undefined;
    if (!fromShards) return fromCat;
    if (!fromCat) return fromShards;
    const deleted = fromCat['docs.deleted'];
    return {
      ...fromShards,
      ...(deleted != null && deleted !== '' ? { 'docs.deleted': deleted } : {})
    };
  }, [catalogRow, catIndexRow, indexName, indexShards]);

  const mappingSummary = useMemo(
    () => buildMappingSummary(indexName, indexDetails),
    [indexName, indexDetails]
  );

  const detailEntry = indexDetails?.[indexName] as
    | {
        mappings?: unknown;
        settings?: {
          index?: {
            creation_date_string?: string;
            refresh_interval?: string;
            mode?: string;
            version?: { created_string?: string };
            tier?: string;
            routing?: { allocation?: { include?: { _tier_preference?: string } } };
          };
        };
      }
    | undefined;

  const renderTier = () => {
    const s = detailEntry?.settings?.index;
    const tierRaw = s?.tier ?? s?.routing?.allocation?.include?._tier_preference ?? '';
    if (!tierRaw) return '—';
    const tierOrder = ['data_hot', 'data_warm', 'data_cold', 'data_frozen'];
    const parts = tierRaw.split(',').map((p) => p.trim()).filter(Boolean);
    const sorted = [...parts].sort((a, b) => tierOrder.indexOf(a) - tierOrder.indexOf(b));
    return sorted.length === 0 ? tierRaw : sorted.map((t) => <span key={t} className="block">{t}</span>);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onMouseDown={(e) => {
          backdropMouseDownRef.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && backdropMouseDownRef.current) onClose();
          backdropMouseDownRef.current = false;
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="index-detail-title"
      >
        <div
          className="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 flex flex-col max-h-[85vh] w-full max-w-4xl min-w-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3 shrink-0 gap-3 min-w-0">
            <div className="min-w-0 flex-1 relative">
              <h2
                id="index-detail-title"
                className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono truncate"
              >
                {indexName}
              </h2>
              {indexAliases.length === 1 && (
                <span
                  className="mt-0.5 inline-block text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate"
                  title="Alias"
                >
                  {indexAliases[0]}
                </span>
              )}
              {indexAliases.length > 1 && (
                <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                  <span className="font-mono truncate max-w-[160px]">{indexAliases[0]}</span>
                  <button
                    type="button"
                    onClick={() => setAliasesOpen((o) => !o)}
                    className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                    title={`Aliases: ${indexAliases.join(', ')}`}
                    aria-expanded={aliasesOpen}
                    aria-haspopup="true"
                    ref={aliasesButtonRef}
                  >
                    +{indexAliases.length - 1} more
                  </button>
                  {aliasesOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        aria-hidden="true"
                        onClick={() => setAliasesOpen(false)}
                      />
                      <div
                        className="absolute left-0 top-[3.25rem] z-50 min-w-[160px] rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg py-2 px-2 max-h-48 overflow-y-auto"
                        role="dialog"
                        aria-label="All aliases"
                      >
                        {indexAliases.map((al) => (
                          <div
                            key={al}
                            className="font-mono text-xs py-1 px-2 text-gray-800 dark:text-gray-200 truncate"
                          >
                            {al}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            {overviewRow && (
              <div className="shrink-0 flex items-center gap-2">
                <span className="text-[11px] text-gray-500 dark:text-gray-400">Health</span>
                <span
                  className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${healthToBadgeClass(
                    overviewRow.health
                  )}`}
                >
                  {overviewRow.health ?? '—'}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Close"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex border-b border-gray-200 dark:border-gray-700 min-w-0 shrink-0">
            {INDEX_DETAIL_TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex-1 min-w-0 px-3 py-2.5 text-xs font-medium transition-colors truncate ${
                  activeTab === id
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border-b-2 border-blue-500'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-4 overflow-y-auto min-h-0 flex-1">
            {!activeCluster && (
              <p className="text-sm text-gray-500">No cluster selected.</p>
            )}

            {activeCluster && isClusterUnreachable && (
              <p className="text-sm text-gray-500">Cluster is unreachable.</p>
            )}

            {activeCluster && !isClusterUnreachable && detailLoading && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Loading details…
              </div>
            )}

            {activeCluster && !isClusterUnreachable && !detailLoading && activeTab === 'overview' && overviewRow && (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Summary</h4>
                    <div className="space-y-2">
                      <div>
                        <span className="text-gray-500 dark:text-gray-400 block text-xs">Health</span>
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${healthToBadgeClass(overviewRow.health)}`}>
                          {overviewRow.health ?? '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400 block text-xs">Primary / Total</span>
                        <div className="font-mono text-gray-900 dark:text-gray-100">
                          {overviewRow.pri != null && overviewRow.rep != null
                            ? `${overviewRow.pri} / ${(parseInt(String(overviewRow.pri), 10) || 0) * (1 + (parseInt(String(overviewRow.rep), 10) || 0))}`
                            : '—'}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400 block text-xs">Store size</span>
                        <div className="font-mono text-gray-900 dark:text-gray-100">{overviewRow['store.size'] ?? '—'}</div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400 block text-xs">Shard size (primary)</span>
                        <div className="font-mono text-gray-900 dark:text-gray-100">{overviewRow['pri.store.size'] ?? '—'}</div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400 block text-xs">Doc count</span>
                        <div className="font-mono">
                          {typeof overviewRow['docs.count'] === 'string'
                            ? Intl.NumberFormat('en-US').format(parseInt(overviewRow['docs.count'], 10) || 0)
                            : Intl.NumberFormat('en-US').format(Number(overviewRow['docs.count']) || 0)}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400 block text-xs">Deleted doc count</span>
                        <div className="font-mono">
                          {overviewRow['docs.deleted'] != null && overviewRow['docs.deleted'] !== ''
                            ? Intl.NumberFormat('en-US').format(
                                parseInt(String(overviewRow['docs.deleted']), 10) || 0
                              )
                            : '—'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Index config</h4>
                    <div className="space-y-2">
                      <div>
                        <span className="text-gray-500 dark:text-gray-400 block text-xs">Created at</span>
                        <div className="font-mono" title={detailEntry?.settings?.index?.creation_date_string}>
                          {formatRelativeTimeShort(detailEntry?.settings?.index?.creation_date_string)}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400 block text-xs">Refresh interval</span>
                        <div className="font-mono">{detailEntry?.settings?.index?.refresh_interval ?? '1s'}</div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400 block text-xs">Index mode</span>
                        <div className="font-mono">{detailEntry?.settings?.index?.mode ?? 'standard'}</div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400 block text-xs">Version</span>
                        <div className="font-mono">{detailEntry?.settings?.index?.version?.created_string ?? '—'}</div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400 block text-xs">Tier</span>
                        <div className="font-mono">{renderTier()}</div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Indexing &amp; search
                    </h4>
                    {indexPerfLoading && !indexPerfMetrics && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">Loading indexing &amp; search metrics…</p>
                    )}
                    {!indexPerfLoading && indexPerfError && (
                      <p className="text-xs text-amber-600 dark:text-amber-300">{indexPerfError}</p>
                    )}
                    {!indexPerfError && indexPerfMetrics && (
                      <div className="space-y-1.5">
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 block text-xs">Indexing rate</span>
                          <div className="font-mono text-gray-900 dark:text-gray-100">
                            {indexPerfMetrics.indexingRate.toFixed(1)}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 block text-xs">Search rate</span>
                          <div className="font-mono text-gray-900 dark:text-gray-100">
                            {indexPerfMetrics.searchRate.toFixed(1)}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 block text-xs">Indexing latency</span>
                          <div className="font-mono text-gray-900 dark:text-gray-100">
                            {indexPerfMetrics.indexLatency >= 1000
                              ? `${(indexPerfMetrics.indexLatency / 1000).toFixed(2)} s`
                              : `${indexPerfMetrics.indexLatency.toFixed(2)} ms`}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 block text-xs">Search latency</span>
                          <div className="font-mono text-gray-900 dark:text-gray-100">
                            {indexPerfMetrics.searchLatency >= 1000
                              ? `${(indexPerfMetrics.searchLatency / 1000).toFixed(2)} s`
                              : `${indexPerfMetrics.searchLatency.toFixed(2)} ms`}
                          </div>
                        </div>
                      </div>
                    )}
                    {!indexPerfLoading && !indexPerfError && !indexPerfMetrics && indexPerfInitialized && (
                      <p className="text-xs text-gray-400 dark:text-gray-500">Loading...</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Lifecycle</h4>
                    {ilmExplain?.indices?.[indexName] != null ? (
                      <div className="space-y-2">
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 block text-xs">ILM policy</span>
                          <div className="font-mono truncate" title={ilmExplain.indices[indexName]?.policy}>
                            {ilmExplain.indices[indexName]?.policy ?? '—'}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 block text-xs">Phase</span>
                          <div className="font-mono">{ilmExplain.indices[indexName]?.phase ?? '—'}</div>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 block text-xs">Action</span>
                          <div className="font-mono">{ilmExplain.indices[indexName]?.action ?? '—'}</div>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 block text-xs">Step</span>
                          <div className="font-mono">{ilmExplain.indices[indexName]?.step?.name ?? '—'}</div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-400 dark:text-gray-500 text-xs">—</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Field usage</h4>
                    {fieldUsageSummary?.hasUsageData ? (
                      <div className="space-y-2">
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 block text-xs">Total fields</span>
                          <div className="font-mono">
                            {fieldUsageSummary.totalFields > 0 ? (
                              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {fieldUsageSummary.totalFields}
                              </div>
                            ) : (
                              '—'
                            )}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 block text-xs">Used fields</span>
                          <div className="font-mono">
                            <button
                              type="button"
                              onClick={() => setFieldPopoverMode('used')}
                              className="inline-flex items-center rounded border border-gray-300 bg-gray-50 px-2 py-0.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                              title="Click to see used fields"
                            >
                              {fieldUsageSummary.usedFields} field{fieldUsageSummary.usedFields !== 1 ? 's' : ''}
                            </button>
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 block text-xs">Unsearched fields</span>
                          <div className="font-mono">
                            <button
                              type="button"
                              onClick={() => setFieldPopoverMode('unsearched')}
                              className="inline-flex items-center rounded border border-gray-300 bg-gray-50 px-2 py-0.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                              title="Click to see field names"
                            >
                              {fieldUsageSummary.unusedFields} field{fieldUsageSummary.unusedFields !== 1 ? 's' : ''}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-400 dark:text-gray-500 text-xs">—</p>
                    )}
                  </div>
                </div>

                {indexShards && indexShards.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                      Shard allocation
                    </h4>
                    <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-gray-600 dark:text-gray-400">
                      {(() => {
                        const byNode: Record<string, { total: number; primaries: number; replicas: number; storeBytes: number }> = {};
                        for (const s of indexShards) {
                          const node = s.node ?? '—';
                          if (!byNode[node]) byNode[node] = { total: 0, primaries: 0, replicas: 0, storeBytes: 0 };
                          byNode[node].total += 1;
                          if (s.prirep === 'p') byNode[node].primaries += 1;
                          else if (s.prirep === 'r') byNode[node].replicas += 1;
                          byNode[node].storeBytes += parseCatByteSizeToBytes(s.store);
                        }
                        const rows = Object.entries(byNode).sort(
                          (a, b) => b[1].storeBytes - a[1].storeBytes || b[1].total - a[1].total
                        );
                        return rows.slice(0, 6).map(([node, v]) => (
                          <span
                            key={node}
                            className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-600 dark:bg-gray-700/40"
                            title={`Total shards: ${v.total} (p:${v.primaries}, r:${v.replicas})`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                if (node !== '—') onOpenNodeDetails?.(node);
                              }}
                              disabled={node === '—'}
                              className={`font-mono ${
                                node === '—'
                                  ? 'text-gray-800 dark:text-gray-200 cursor-default'
                                  : 'entity-name-link'
                              }`}
                              title={node === '—' ? 'Node unavailable' : `Open node details for ${node}`}
                            >
                              {node}
                            </button>
                            <span className="text-gray-500 dark:text-gray-400">·</span>
                            <span>{v.total}</span>
                            <span className="text-gray-500 dark:text-gray-400">shards</span>
                          </span>
                        ));
                      })()}
                    </div>
                    <div className="rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden bg-gray-50/50 dark:bg-gray-800/50">
                      <div className="overflow-x-auto max-h-40 overflow-y-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead className="sticky top-0 bg-gray-100 dark:bg-gray-700/80 text-left">
                            <tr>
                              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300 w-16">Shard</th>
                              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300 w-24">Type</th>
                              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300 w-24">State</th>
                              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300 min-w-0">Node</th>
                              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300 w-28">IP</th>
                              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300 w-24 text-right">Docs</th>
                              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300 w-24 text-right">Store</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                            {(shardsExpanded ? indexShards : indexShards.slice(0, SHARD_ALLOCATION_VISIBLE)).map((s, i) => (
                              <tr key={i} className="bg-white dark:bg-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                <td className="px-3 py-2 font-mono tabular-nums text-gray-800 dark:text-gray-200">{s.shard}</td>
                                <td className="px-3 py-2">
                                  <span
                                    className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      s.prirep === 'p'
                                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                                        : 'bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-300'
                                    }`}
                                  >
                                    {s.prirep === 'p' ? 'Primary' : 'Replica'}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  <span
                                    className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      s.state === 'STARTED'
                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                                        : s.state === 'UNASSIGNED'
                                          ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
                                          : s.state === 'INITIALIZING'
                                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                                            : s.state === 'RELOCATING'
                                              ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200'
                                              : 'bg-gray-100 text-gray-700 dark:bg-gray-600 dark:text-gray-300'
                                    }`}
                                  >
                                    {s.state}
                                  </span>
                                </td>
                                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 truncate max-w-[200px]" title={s.node ?? ''}>
                                  {s.node ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (s.node && s.node !== '—') onOpenNodeDetails?.(s.node);
                                      }}
                                      className="font-mono entity-name-link"
                                      title={`Open node details for ${s.node}`}
                                    >
                                      {s.node}
                                    </button>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400 truncate" title={s.ip ?? ''}>
                                  {s.ip ?? '—'}
                                </td>
                                <td className="px-3 py-2 font-mono tabular-nums text-gray-700 dark:text-gray-300 text-right">
                                  {s.docs != null && String(s.docs).trim() !== ''
                                    ? Intl.NumberFormat('en-US').format(parseInt(String(s.docs), 10) || 0)
                                    : '—'}
                                </td>
                                <td className="px-3 py-2 font-mono tabular-nums text-gray-700 dark:text-gray-300 text-right">
                                  {s.store ?? '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {indexShards.length > SHARD_ALLOCATION_VISIBLE && (
                      <button
                        type="button"
                        onClick={() => setShardsExpanded((e) => !e)}
                        className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        {shardsExpanded
                          ? 'Show less'
                          : `Show more (${indexShards.length - SHARD_ALLOCATION_VISIBLE} more shards)`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeCluster && !isClusterUnreachable && !detailLoading && activeTab === 'overview' && !overviewRow && (
              <p className="text-sm text-gray-500">No overview data.</p>
            )}

            {activeCluster && !isClusterUnreachable && activeTab === 'data' && (
              <IndexDataTab
                cluster={activeCluster}
                indexName={indexName}
                active={activeTab === 'data'}
                fieldUsageSummary={fieldUsageSummary}
              />
            )}

            {activeCluster && !isClusterUnreachable && activeTab === 'mappings' && indexDetails?.[indexName] && (
              <div className="space-y-3">
                {mappingSummary && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50/60 dark:bg-gray-900/20">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
                      <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Total fields</div>
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                          {Intl.NumberFormat('en-US').format(mappingSummary.totalFields)}
                        </div>
                      </div>
                      <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Field types</div>
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                          {Intl.NumberFormat('en-US').format(mappingSummary.distinctTypeCount)}
                        </div>
                      </div>
                      <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Text fields</div>
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                          {Intl.NumberFormat('en-US').format(mappingSummary.textFieldCount)}
                        </div>
                      </div>
                      <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Keyword fields</div>
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                          {Intl.NumberFormat('en-US').format(mappingSummary.keywordFieldCount)}
                        </div>
                      </div>
                      <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Analyzers</div>
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                          {Intl.NumberFormat('en-US').format(
                            new Set([
                              ...mappingSummary.definedAnalyzerNames,
                              ...mappingSummary.analyzerNames
                            ]).size
                          )}
                        </div>
                      </div>
                      <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Search analyzers</div>
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                          {Intl.NumberFormat('en-US').format(mappingSummary.searchAnalyzerNames.length)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Top field types</div>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(mappingSummary.typeCounts)
                            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                            .slice(0, 8)
                            .map(([typeName, count]) => (
                              <span
                                key={typeName}
                                className="inline-flex items-center rounded border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 bg-white dark:bg-gray-800 font-mono"
                              >
                                {typeName}:{count}
                              </span>
                            ))}
                          {Object.keys(mappingSummary.typeCounts).length === 0 && (
                            <span className="text-gray-500 dark:text-gray-400">—</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Analyzers (field + defined)</div>
                        <div className="flex flex-wrap gap-1">
                          {Array.from(
                            new Set([
                              ...mappingSummary.definedAnalyzerNames,
                              ...mappingSummary.analyzerNames
                            ])
                          )
                            .sort((a, b) => a.localeCompare(b))
                            .slice(0, 10)
                            .map((name) => (
                              <span
                                key={name}
                                className="inline-flex items-center rounded border border-blue-300 dark:border-blue-700 px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/20 font-mono text-blue-700 dark:text-blue-300"
                              >
                                {name}
                              </span>
                            ))}
                          {mappingSummary.definedAnalyzerNames.length === 0 &&
                            mappingSummary.analyzerNames.length === 0 && (
                              <span className="text-gray-500 dark:text-gray-400">—</span>
                            )}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Search analyzers</div>
                        <div className="flex flex-wrap gap-1">
                          {mappingSummary.searchAnalyzerNames.slice(0, 10).map((name) => (
                            <span
                              key={name}
                              className="inline-flex items-center rounded border border-violet-300 dark:border-violet-700 px-1.5 py-0.5 bg-violet-50 dark:bg-violet-900/20 font-mono text-violet-700 dark:text-violet-300"
                            >
                              {name}
                            </span>
                          ))}
                          {mappingSummary.searchAnalyzerNames.length === 0 && (
                            <span className="text-gray-500 dark:text-gray-400">—</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <CodeBlockWithCopy
                  text={JSON.stringify((indexDetails[indexName] as { mappings?: unknown }).mappings ?? {}, null, 2)}
                  label="Mapping JSON"
                />
              </div>
            )}

            {activeCluster && !isClusterUnreachable && activeTab === 'mappings' && (!indexDetails || !indexDetails[indexName]) && !detailLoading && (
              <p className="text-sm text-gray-500">No mapping data.</p>
            )}

            {activeCluster && !isClusterUnreachable && activeTab === 'settings' && indexDetails?.[indexName] && (
              <CodeBlockWithCopy
                text={JSON.stringify(
                  (indexDetails[indexName] as { settings?: { index?: unknown } }).settings?.index ?? {},
                  null,
                  2
                )}
                label="Settings JSON"
              />
            )}

            {activeCluster && !isClusterUnreachable && activeTab === 'settings' && (!indexDetails || !indexDetails[indexName]) && !detailLoading && (
              <p className="text-sm text-gray-500">No settings data.</p>
            )}

            {activeCluster && !isClusterUnreachable && activeTab === 'diagnosis' && (
              <IndexDiagnosisPanel
                indexName={indexName}
                indexAliases={indexAliases}
                activeCluster={activeCluster}
                isClusterUnreachable={isClusterUnreachable}
                isActive={activeTab === 'diagnosis'}
              />
            )}

            {activeCluster && !isClusterUnreachable && activeTab === 'ilm' && (
              <div className="text-sm">
                {ilmForbidden && (
                  <p className="text-amber-600 dark:text-amber-400">
                    Requires manage_ilm (or view_index_metadata).
                  </p>
                )}
                {ilmUnavailable && !ilmForbidden && (
                  <p className="text-gray-500">
                    ILM explain not available for this cluster or index (e.g. managed cloud or data stream backing index).
                  </p>
                )}
                {!ilmForbidden && !ilmUnavailable && ilmExplain?.indices?.[indexName] && (
                  <pre className="bg-gray-100 dark:bg-gray-700 rounded p-2 text-xs overflow-x-auto">
                    {JSON.stringify(ilmExplain.indices[indexName], null, 2)}
                  </pre>
                )}
                {!ilmForbidden && !ilmUnavailable && ilmExplain && !ilmExplain.indices?.[indexName] && (
                  <p className="text-gray-500">No ILM or index not in explain result.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {fieldPopoverMode === 'used' && (
        <UsedFieldsModal
          indexName={indexName}
          summary={fieldUsageSummary ?? undefined}
          onClose={() => setFieldPopoverMode(null)}
        />
      )}
      {fieldPopoverMode === 'unsearched' && (
        <UnsearchedFieldsModal
          indexName={indexName}
          summary={fieldUsageSummary ?? undefined}
          onClose={() => setFieldPopoverMode(null)}
        />
      )}
    </>
  );
}
