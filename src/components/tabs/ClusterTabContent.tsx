import { useEffect, useState, useCallback, useMemo } from 'react';
import { useMonitoring } from '@/context/MonitoringProvider';
import { getCatShards, getCatPendingTasks, getCatRecoveryActive, getHealthReport, getNetworkErrorMessage, getShardAllocationExplain } from '@/services/elasticsearch';
import type { AllocationExplainResponse, CatShardRow, CatPendingTaskRow, CatRecoveryRow, HealthReportResponse } from '@/types/api';
import { DataTable } from '@/components/data/DataTable';
import Pagination from '@/components/data/Pagination';
import { InfoPopup } from '@/components/ui/InfoPopup';
import { AllClearEmpty } from '@/components/ui/AllClearEmpty';
import { TabSectionExpandTrigger } from '@/components/ui/TabSectionExpandTrigger';
import { RefreshCw, Copy, Check, Search, X, CheckCircle2 } from 'lucide-react';

const INDICATOR_LABELS: Record<string, string> = {
  master_is_stable: 'Master stability',
  shards_availability: 'Shards availability',
  disk: 'Disk',
  ilm: 'ILM',
  repository_integrity: 'Repository integrity',
  slm: 'SLM',
  shards_capacity: 'Shards capacity',
  data_stream_lifecycle: 'Data stream lifecycle',
  file_settings: 'File settings'
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function getStatusPillClass(status: string | undefined): string {
  if (status === 'green') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (status === 'yellow') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  if (status === 'red') return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
  return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
}

function formatShortRelativeTime(isoString: string | undefined): string {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (!Number.isFinite(date.getTime())) return isoString;
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

const AFFECTED_INDICES_COLLAPSE_THRESHOLD = 10;

/** Extract API calls from action text, e.g. "[GET _cluster/allocation/explain]" -> ["GET _cluster/allocation/explain"] */
function extractApiCallsFromAction(actionRaw: string): string[] {
  const matches = actionRaw.matchAll(/\[((?:GET|POST|PUT|DELETE|HEAD)\s+[^\]]+)\]/gi);
  return Array.from(matches, (m) => (m[1] ?? '').trim()).filter(Boolean);
}

function CopyableCodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onCopy}
        title={copied ? 'Copied' : 'Copy'}
        className="absolute right-1.5 top-1.5 rounded p-1 text-gray-200/90 hover:bg-white/10"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre className="overflow-x-auto rounded bg-gray-900 px-2 py-1.5 text-[11px] text-gray-100 dark:bg-gray-950">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function HeaderAllClear({ label = 'All Clear!' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

export function ClusterTabContent({ onRefreshStateChange }: { onRefreshStateChange?: (loading: boolean) => void } = {}) {
  const { activeCluster } = useMonitoring();
  const clusterKey = activeCluster?.baseUrl ?? activeCluster?.label ?? '';

  // Collapsible sections — default collapsed so header summaries show at a glance
  const [healthExpanded, setHealthExpanded] = useState(false);
  const [unassignedExpanded, setUnassignedExpanded] = useState(false);
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [recoveryExpanded, setRecoveryExpanded] = useState(false);

  const [healthReport, setHealthReport] = useState<HealthReportResponse | null>(null);
  const [shards, setShards] = useState<CatShardRow[]>([]);
  const [pendingTasks, setPendingTasks] = useState<CatPendingTaskRow[]>([]);
  const [activeRecovery, setActiveRecovery] = useState<CatRecoveryRow[]>([]);

  // Per-section loading/error — start true so first paint never shows a false “All Clear!” before fetches run
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [unassignedLoading, setUnassignedLoading] = useState(true);
  const [unassignedError, setUnassignedError] = useState<string | null>(null);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [recoveryLoading, setRecoveryLoading] = useState(true);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const [allocationExplain, setAllocationExplain] = useState<Record<string, AllocationExplainResponse | null>>({});
  const [allocationLoading, setAllocationLoading] = useState(false);
  const [allocationError, setAllocationError] = useState<string | null>(null);

  // Search/pagination/topN (per table)
  const [unassignedSearch, setUnassignedSearch] = useState('');
  const [unassignedPage, setUnassignedPage] = useState(1);
  const [unassignedPageSize, setUnassignedPageSize] = useState(10);

  const [pendingSearch, setPendingSearch] = useState('');
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingPageSize, setPendingPageSize] = useState(10);

  const [recoverySearch, setRecoverySearch] = useState('');
  const [recoveryPage, setRecoveryPage] = useState(1);
  const [recoveryPageSize, setRecoveryPageSize] = useState(10);

  const [infoOpen, setInfoOpen] = useState<'health' | 'unassigned' | 'pending' | 'recovery' | null>(null);
  const [selectedShardKey, setSelectedShardKey] = useState<string | null>(null);
  /** Keys `${indicatorKey}-${diagIdx}` for which "Affected index/indices" list is expanded (when >10 items). */
  const [expandedIndicesKeys, setExpandedIndicesKeys] = useState<Set<string>>(new Set());

  const fetchHealth = useCallback(async () => {
    if (!activeCluster) return;
    setHealthLoading(true);
    setHealthError(null);
    try {
      const res = await getHealthReport(activeCluster);
      setHealthReport(res ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load health report';
      const isTimeoutOrNetwork = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
      setHealthError(isTimeoutOrNetwork ? getNetworkErrorMessage(activeCluster.baseUrl) : msg);
    } finally {
      setHealthLoading(false);
    }
  }, [activeCluster]);

  const fetchUnassigned = useCallback(async () => {
    if (!activeCluster) return;
    setUnassignedLoading(true);
    setUnassignedError(null);
    try {
      const res = await getCatShards(activeCluster);
      setShards(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load shards';
      const isTimeoutOrNetwork = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
      setUnassignedError(isTimeoutOrNetwork ? getNetworkErrorMessage(activeCluster.baseUrl) : msg);
    } finally {
      setUnassignedLoading(false);
    }
  }, [activeCluster]);

  const fetchPending = useCallback(async () => {
    if (!activeCluster) return;
    setPendingLoading(true);
    setPendingError(null);
    try {
      const res = await getCatPendingTasks(activeCluster);
      setPendingTasks(Array.isArray(res) ? res : []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load pending tasks';
      const isTimeoutOrNetwork = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
      setPendingError(isTimeoutOrNetwork ? getNetworkErrorMessage(activeCluster.baseUrl) : msg);
    } finally {
      setPendingLoading(false);
    }
  }, [activeCluster]);

  const fetchRecovery = useCallback(async () => {
    if (!activeCluster) return;
    setRecoveryLoading(true);
    setRecoveryError(null);
    try {
      const res = await getCatRecoveryActive(activeCluster);
      setActiveRecovery(Array.isArray(res) ? res : []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load active recovery';
      const isTimeoutOrNetwork = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
      setRecoveryError(isTimeoutOrNetwork ? getNetworkErrorMessage(activeCluster.baseUrl) : msg);
    } finally {
      setRecoveryLoading(false);
    }
  }, [activeCluster]);

  useEffect(() => {
    if (!clusterKey) return;

    // Reset on cluster change; load all sections in parallel (headers show summaries while collapsed)
    setHealthReport(null);
    setShards([]);
    setPendingTasks([]);
    setActiveRecovery([]);
    setExpandedIndicesKeys(new Set());
    setAllocationExplain({});

    setHealthExpanded(false);
    setUnassignedExpanded(false);
    setPendingExpanded(false);
    setRecoveryExpanded(false);

    setHealthError(null);
    setUnassignedError(null);
    setPendingError(null);
    setRecoveryError(null);
    setAllocationError(null);

    setUnassignedSearch('');
    setUnassignedPage(1);
    setUnassignedPageSize(10);
    setPendingSearch('');
    setPendingPage(1);
    setPendingPageSize(10);
    setRecoverySearch('');
    setRecoveryPage(1);
    setRecoveryPageSize(10);

    void fetchHealth();
    void fetchUnassigned();
    void fetchPending();
    void fetchRecovery();
  }, [clusterKey, fetchHealth, fetchUnassigned, fetchPending, fetchRecovery]);

  const unassignedShards = useMemo(() => shards.filter((s) => s.state === 'UNASSIGNED'), [shards]);

  const shardKey = (row: CatShardRow): string => {
    return `${row.index}#${row.shard}#${row.prirep === 'p' ? 'primary' : 'replica'}`;
  };

  // Close unassigned shard details popup with Escape
  useEffect(() => {
    if (!selectedShardKey) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSelectedShardKey(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedShardKey]);

  useEffect(() => {
    if (!unassignedExpanded || !activeCluster || unassignedShards.length === 0) return;

    let cancelled = false;
    const controller = new AbortController();

    const loadExplanations = async () => {
      setAllocationLoading(true);
      setAllocationError(null);
      try {
        const entries = await Promise.all(
          unassignedShards.map(async (row) => {
            const key = shardKey(row);
            try {
              const res = await getShardAllocationExplain(
                activeCluster,
                {
                  index: row.index,
                  shard: Number(row.shard),
                  primary: row.prirep === 'p'
                },
                controller.signal
              );
              return [key, res] as const;
            } catch {
              return [key, null] as const;
            }
          })
        );
        if (cancelled) return;
        setAllocationExplain((prev) => {
          const next: Record<string, AllocationExplainResponse | null> = { ...prev };
          for (const [key, value] of entries) {
            next[key] = value;
          }
          return next;
        });
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Failed to load allocation explanations';
          setAllocationError(msg);
        }
      } finally {
        if (!cancelled) {
          setAllocationLoading(false);
        }
      }
    };

    void loadExplanations();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [unassignedExpanded, activeCluster, unassignedShards]);

  // Global Refresh: reload all cluster sections while on Cluster tab
  useEffect(() => {
    const onRefreshCluster = async () => {
      if (!activeCluster) return;
      onRefreshStateChange?.(true);
      try {
        await Promise.all([fetchHealth(), fetchUnassigned(), fetchPending(), fetchRecovery()]);
      } finally {
        onRefreshStateChange?.(false);
      }
    };
    window.addEventListener('refreshCluster', onRefreshCluster);
    return () => window.removeEventListener('refreshCluster', onRefreshCluster);
  }, [activeCluster, onRefreshStateChange, fetchHealth, fetchUnassigned, fetchPending, fetchRecovery]);
  const allClearEmpty = <AllClearEmpty />;

  const filteredUnassigned = useMemo(() => {
    const term = unassignedSearch.trim().toLowerCase();
    if (!term) return unassignedShards;
    return unassignedShards.filter((s) => (s.index ?? '').toLowerCase().includes(term) || (s.node ?? '').toLowerCase().includes(term));
  }, [unassignedShards, unassignedSearch]);

  const filteredPending = useMemo(() => {
    const term = pendingSearch.trim().toLowerCase();
    if (!term) return pendingTasks;
    return pendingTasks.filter((t) =>
      [t.insert_order, t.time_in_queue, t.priority, t.source].some((v) => String(v ?? '').toLowerCase().includes(term))
    );
  }, [pendingTasks, pendingSearch]);

  const filteredRecovery = useMemo(() => {
    const term = recoverySearch.trim().toLowerCase();
    if (!term) return activeRecovery;
    return activeRecovery.filter((r) =>
      [r.i, r.ty, r.st, r.source_node, r.target_node].some((v) => String(v ?? '').toLowerCase().includes(term))
    );
  }, [activeRecovery, recoverySearch]);

  const unassignedTotalPages = Math.max(1, Math.ceil(filteredUnassigned.length / Math.max(1, unassignedPageSize)));
  const pendingTotalPages = Math.max(1, Math.ceil(filteredPending.length / Math.max(1, pendingPageSize)));
  const recoveryTotalPages = Math.max(1, Math.ceil(filteredRecovery.length / Math.max(1, recoveryPageSize)));

  useEffect(() => setUnassignedPage(1), [unassignedSearch, unassignedPageSize]);
  useEffect(() => setPendingPage(1), [pendingSearch, pendingPageSize]);
  useEffect(() => setRecoveryPage(1), [recoverySearch, recoveryPageSize]);

  /** Order: red → yellow → green; same status keeps API order */
  const indicators = useMemo(() => {
    const entries = healthReport?.indicators ? Object.entries(healthReport.indicators) : [];
    const order = (s: string | undefined) => (s === 'red' ? 0 : s === 'yellow' ? 1 : s === 'green' ? 2 : 3);
    return [...entries].sort((a, b) => order(a[1].status) - order(b[1].status));
  }, [healthReport?.indicators]);

  if (!activeCluster) {
    return (
      <div className="rounded-lg border border-gray-300 bg-white p-4 text-center text-sm text-gray-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400">
        No cluster selected.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <div className="flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Cluster details</h2>
      </div>

      {/* Health report */}
      <section className="tab-section-card">
        <div className="tab-section-header">
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
            <TabSectionExpandTrigger
              expanded={healthExpanded}
              onToggle={() => setHealthExpanded((p) => !p)}
              label="Health report"
              fillHitArea={true}
              suffix={
                <>
                  <InfoPopup title="Health report" modalTitle="Health report" open={infoOpen === 'health'} onOpen={() => setInfoOpen('health')} onClose={() => setInfoOpen(null)}>
                    <p>From <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET /_health_report</code> (Elasticsearch 8.x+).</p>
                  </InfoPopup>
                  {healthError ? (
                    <span className="text-xs max-w-[220px] truncate text-rose-600 dark:text-rose-400" title={healthError}>
                      Error
                    </span>
                  ) : healthLoading && !healthReport ? (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <RefreshCw className="h-3 w-3 animate-spin shrink-0" aria-hidden />
                      Loading…
                    </span>
                  ) : healthReport?.status ? (
                    <>
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${getStatusPillClass(healthReport.status)}`}>
                        {healthReport.status}
                      </span>
                      {healthExpanded && healthLoading && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <RefreshCw className="h-3 w-3 animate-spin shrink-0" aria-hidden />
                          Refreshing…
                        </span>
                      )}
                    </>
                  ) : !healthLoading ? (
                    <span className="text-xs text-gray-500 dark:text-gray-400">No report (ES 8+)</span>
                  ) : null}
                </>
              }
            />
          </div>
        </div>
        {healthExpanded && (
          <div className="tab-section-body">
            {healthError && (
              <div className="m-2 flex-shrink-0 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                {healthError}{' '}
                <button type="button" onClick={fetchHealth} className="ml-1 underline">
                  Retry
                </button>
              </div>
            )}
            <div className="tab-section-scroll tab-section-scroll-flush">
            {indicators.length > 0 ? (
              <ul className="divide-y divide-gray-200 dark:divide-gray-600">
                {indicators.map(([key, ind]) => (
                  <li key={key} className="border-l-2 border-transparent pl-3 pr-3 py-2.5 text-xs">
                    {/* Level 1: main indicator title */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {INDICATOR_LABELS[key] ?? key}
                      </span>
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${getStatusPillClass(ind.status)}`}
                      >
                        {ind.status}
                      </span>
                    </div>
                    {ind.symptom && (
                      <p className="mt-1 text-gray-600 dark:text-gray-400">{ind.symptom}</p>
                    )}
                    {(() => {
                      const items: Array<{ label: string; value: string }> = [];
                      const details = ind.details;
                      if (isRecord(details)) {
                        if (key === 'master_is_stable') {
                          const currentMaster = isRecord(details.current_master) ? (details.current_master.name as string | undefined) : undefined;
                          const recentMastersNames = Array.isArray(details.recent_masters)
                            ? (details.recent_masters as Array<{ name?: string }>).map((m) => m?.name).filter(Boolean) as string[]
                            : [];
                          if (currentMaster) items.push({ label: 'Current master', value: currentMaster });
                          if (recentMastersNames.length > 0) items.push({ label: 'Recent masters', value: recentMastersNames.join(', ') });
                        } else if (key === 'repository_integrity') {
                          const total = details.total_repositories;
                          if (typeof total === 'number') items.push({ label: 'Repositories', value: String(total) });
                        } else if (key === 'disk') {
                          const ro = details.indices_with_readonly_block;
                          const high = details.nodes_over_high_watermark;
                          const flood = details.nodes_over_flood_stage_watermark;
                          const enough = details.nodes_with_enough_disk_space;
                          if (typeof ro === 'number') items.push({ label: 'Readonly indices', value: String(ro) });
                          if (typeof enough === 'number') items.push({ label: 'Nodes with enough disk', value: String(enough) });
                          if (typeof high === 'number') items.push({ label: 'Over high watermark', value: String(high) });
                          if (typeof flood === 'number') items.push({ label: 'Over flood stage', value: String(flood) });
                        } else if (key === 'shards_capacity') {
                          const data = isRecord(details.data) ? (details.data.max_shards_in_cluster as number | undefined) : undefined;
                          const frozen = isRecord(details.frozen) ? (details.frozen.max_shards_in_cluster as number | undefined) : undefined;
                          if (typeof data === 'number') items.push({ label: 'Max shards (data)', value: String(data) });
                          if (typeof frozen === 'number') items.push({ label: 'Max shards (frozen)', value: String(frozen) });
                        } else if (key === 'shards_availability') {
                          const startedPri = details.started_primaries;
                          const startedRep = details.started_replicas;
                          const up = details.unassigned_primaries;
                          const ur = details.unassigned_replicas;
                          if (typeof startedPri === 'number') items.push({ label: 'Started primaries', value: String(startedPri) });
                          if (typeof startedRep === 'number') items.push({ label: 'Started replicas', value: String(startedRep) });
                          if (typeof up === 'number') items.push({ label: 'Unassigned primaries', value: String(up) });
                          if (typeof ur === 'number') items.push({ label: 'Unassigned replicas', value: String(ur) });
                        } else if (key === 'data_stream_lifecycle') {
                          const stagnating = details.stagnating_backing_indices_count;
                          const errors = details.total_backing_indices_in_error;
                          if (typeof stagnating === 'number') items.push({ label: 'Stagnating', value: String(stagnating) });
                          if (typeof errors === 'number') items.push({ label: 'Errors', value: String(errors) });
                        } else if (key === 'slm') {
                          const slmStatus = details.slm_status;
                          const policies = details.policies;
                          if (typeof slmStatus === 'string') items.push({ label: 'SLM status', value: slmStatus });
                          if (typeof policies === 'number') items.push({ label: 'Policies', value: String(policies) });
                        } else if (key === 'ilm') {
                          const ilmStatus = details.ilm_status;
                          const policies = details.policies;
                          const stagnating = details.stagnating_indices;
                          if (typeof ilmStatus === 'string') items.push({ label: 'ILM status', value: ilmStatus });
                          if (typeof policies === 'number') items.push({ label: 'Policies', value: String(policies) });
                          if (typeof stagnating === 'number') items.push({ label: 'Stagnating indices', value: String(stagnating) });
                        }
                      }

                      if (items.length === 0) return null;
                      return (
                        <div className="mt-1 ml-0.5 flex flex-wrap gap-1.5">
                          {items.map((it) => (
                            <span
                              key={`${key}-${it.label}`}
                              className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700 dark:bg-gray-700/50 dark:text-gray-200"
                            >
                              <span className="text-gray-500 dark:text-gray-400">{it.label}:</span>
                              <span className="font-medium">{it.value}</span>
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                    {Array.isArray(ind.impacts) && ind.impacts.length > 0 && (
                      <div className="mt-2 ml-2 pl-3 border-l border-gray-200 dark:border-gray-600 space-y-1 text-[11px] text-gray-600 dark:text-gray-400">
                        <span className="block text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-500">Impacts</span>
                        {ind.impacts.map((impact, idx) => (
                          <div key={`${key}-impact-${idx}`} className="rounded bg-gray-50 px-2 py-1.5 dark:bg-gray-700/40">
                            {typeof impact.severity === 'number' && (
                              <span className="mr-1.5 font-medium">Severity: {impact.severity}</span>
                            )}
                            {impact.description && <p className="mt-0.5">{impact.description}</p>}
                            {Array.isArray(impact.impact_areas) && impact.impact_areas.length > 0 && (
                              <p className="mt-0.5 text-gray-500 dark:text-gray-500">Areas: {impact.impact_areas.join(', ')}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {Array.isArray(ind.diagnosis) && ind.diagnosis.length > 0 && (
                      <div className="mt-2 ml-2 pl-3 border-l border-gray-200 dark:border-gray-600 space-y-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                        <span className="block text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-500">Diagnosis</span>
                        {ind.diagnosis.map((diag, idx) => {
                          const resources = isRecord(diag.affected_resources) ? diag.affected_resources : null;
                          const policies = Array.isArray(resources?.ilm_policies) ? (resources!.ilm_policies as string[]) : [];
                          const indices = Array.isArray(resources?.indices) ? (resources!.indices as string[]) : [];
                          return (
                            <div key={`${key}-diag-${idx}`} className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-700/40">
                              {diag.cause && <p><span className="font-medium">Cause:</span> {diag.cause}</p>}
                              {policies.length > 0 && (
                                <p className="mt-0.5"><span className="font-medium">ILM policy/ies:</span> {policies.join(', ')}</p>
                              )}
                              {indices.length > 0 && (() => {
                                const expandKey = `${key}-diag-${idx}`;
                                const isExpanded = expandedIndicesKeys.has(expandKey);
                                const showCollapsed = indices.length > AFFECTED_INDICES_COLLAPSE_THRESHOLD;
                                const visibleIndices = showCollapsed && !isExpanded ? indices.slice(0, AFFECTED_INDICES_COLLAPSE_THRESHOLD) : indices;
                                const remaining = indices.length - AFFECTED_INDICES_COLLAPSE_THRESHOLD;
                                return (
                                  <div className="mt-0.5">
                                    <p><span className="font-medium">Affected index/indices:</span></p>
                                    <ul className="mt-0.5 ml-4 list-disc space-y-0.5">
                                      {visibleIndices.map((name) => (
                                        <li key={`${key}-diag-${idx}-${name}`} className="font-mono text-[11px] text-gray-700 dark:text-gray-200">
                                          {name}
                                        </li>
                                      ))}
                                    </ul>
                                    {showCollapsed && (
                                      <button
                                        type="button"
                                        onClick={() => setExpandedIndicesKeys((prev) => {
                                          const next = new Set(prev);
                                          if (isExpanded) next.delete(expandKey);
                                          else next.add(expandKey);
                                          return next;
                                        })}
                                        className="mt-1 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                                      >
                                        {isExpanded ? 'Show less' : `Show ${remaining} more`}
                                      </button>
                                    )}
                                  </div>
                                );
                              })()}
                              {diag.help_url && (
                                <a
                                  href={diag.help_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-0.5 inline-flex text-[11px] font-medium text-sky-700 hover:underline dark:text-sky-300"
                                >
                                  Help link
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {Array.isArray(ind.diagnosis) && ind.diagnosis.length > 0 && (
                      <div className="mt-2 ml-2 pl-3 border-l border-gray-200 dark:border-gray-600 space-y-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                        <span className="block text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-500">Action</span>
                        {ind.diagnosis.map((diag, idx) => {
                          const resources = isRecord(diag.affected_resources) ? diag.affected_resources : null;
                          const indices = Array.isArray(resources?.indices) ? (resources!.indices as string[]) : [];
                          const actionRaw = typeof diag.action === 'string' ? diag.action : '';
                          const shouldGenerateIlmExplain = indices.length > 0 && (actionRaw.includes('<affected_index_name>') || actionRaw.includes('_ilm/explain'));
                          const isSlmStart = key === 'slm' && actionRaw.toLowerCase().includes('_slm/start');
                          const actionText = shouldGenerateIlmExplain
                            ? 'Check the current status of the Index Lifecycle Management for every affected index using the following API call.'
                            : isSlmStart
                              ? 'Start Snapshot Lifecycle Management using the following API call.'
                              : (actionRaw ? actionRaw.split('Please replace')[0].trim() : '');
                          const actionCode = shouldGenerateIlmExplain
                            ? `GET ${indices.join(',')}/_ilm/explain`
                            : isSlmStart
                              ? 'POST /_slm/start'
                              : '';
                          const extractedApis = extractApiCallsFromAction(actionRaw).filter((api) => {
                            if (actionCode && api === actionCode) return false;
                            if (/<[^>]+>/.test(api)) return false;
                            return true;
                          });

                          if (!actionText && !actionCode && extractedApis.length === 0) return null;
                          return (
                            <div key={`${key}-action-${idx}`} className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-700/40">
                              {actionText && <p>{actionText}</p>}
                              {actionCode && (
                                <div className="mt-1">
                                  <CopyableCodeBlock code={actionCode} />
                                </div>
                              )}
                              {extractedApis.length > 0 && (
                                <div className="mt-1 space-y-1">
                                  {extractedApis.map((apiCall, apiIdx) => (
                                    <CopyableCodeBlock key={`${key}-action-${idx}-api-${apiIdx}`} code={apiCall} />
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">No health report (ES 8.x+).</p>
            )}
            </div>
          </div>
        )}
      </section>

      {/* Unassigned shards */}
      <section className="tab-section-card">
        <div className="tab-section-header tab-section-header-split">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TabSectionExpandTrigger
              expanded={unassignedExpanded}
              onToggle={() => setUnassignedExpanded((p) => !p)}
              label="Unassigned shards"
              fillHitArea={true}
              suffix={
                <>
                  <InfoPopup
                    title="Unassigned shards"
                    modalTitle="Unassigned shards"
                    open={infoOpen === 'unassigned'}
                    onOpen={() => setInfoOpen('unassigned')}
                    onClose={() => setInfoOpen(null)}
                  >
                    <p>
                      Shards in <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">UNASSIGNED</code> state from{' '}
                      <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET /_cat/shards</code>.
                    </p>
                  </InfoPopup>
                  {unassignedError ? (
                    <span className="text-xs max-w-[220px] truncate text-rose-600 dark:text-rose-400" title={unassignedError}>
                      Error
                    </span>
                  ) : unassignedLoading ? (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <RefreshCw className="h-3 w-3 animate-spin shrink-0" aria-hidden />
                      Loading…
                    </span>
                  ) : allocationLoading ? (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <RefreshCw className="h-3 w-3 animate-spin shrink-0" aria-hidden />
                      Explaining…
                    </span>
                  ) : unassignedShards.length === 0 ? (
                    <HeaderAllClear />
                  ) : (
                    <span className="text-xs font-medium text-amber-800 dark:text-amber-200">{unassignedShards.length} unassigned</span>
                  )}
                </>
              }
            />
          </div>
          {unassignedExpanded && (
            <div className="tab-section-inline-tools">
              <div className="relative">
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search index/node"
                  value={unassignedSearch}
                  onChange={(e) => setUnassignedSearch(e.target.value)}
                  className="pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-36 tab-content-value"
                />
                {unassignedSearch && (
                  <button
                    type="button"
                    onClick={() => setUnassignedSearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <Pagination
                currentPage={unassignedPage}
                totalPages={unassignedTotalPages}
                totalItems={filteredUnassigned.length}
                pageSize={unassignedPageSize}
                onPageChange={setUnassignedPage}
                inline
              />

              <select
                value={String(unassignedPageSize)}
                onChange={(e) => setUnassignedPageSize(parseInt(e.target.value, 10) || 10)}
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
          )}
        </div>

        {unassignedExpanded && (
          <div className="tab-section-body">
            {unassignedError && (
              <div className="mx-2 mt-2 flex-shrink-0 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                {unassignedError}{' '}
                <button type="button" onClick={fetchUnassigned} className="ml-1 underline">
                  Retry
                </button>
              </div>
            )}
            {allocationError && (
              <div className="mx-2 mt-2 flex-shrink-0 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                {allocationError}
              </div>
            )}
            <div className="tab-section-scroll tab-section-scroll-flush">
            <DataTable
              data={filteredUnassigned.slice((unassignedPage - 1) * unassignedPageSize, unassignedPage * unassignedPageSize)}
              columns={[
                {
                  key: 'index',
                  header: 'Index',
                  sortable: true,
                  className: 'font-mono tab-content-value',
                  render: (r) => {
                    const key = shardKey(r);
                    const explain = allocationExplain[key];
                    const disabled = !explain;
                    return (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setSelectedShardKey(key)}
                        className={`inline-flex max-w-full items-center gap-1 truncate text-left underline-offset-2 ${
                          disabled
                            ? 'cursor-default text-gray-500 dark:text-gray-500'
                            : 'cursor-pointer text-sky-700 hover:text-sky-900 hover:underline dark:text-sky-300 dark:hover:text-sky-200'
                        }`}
                        title={r.index}
                      >
                        <span className="truncate">{r.index}</span>
                      </button>
                    );
                  }
                },
                { key: 'shard', header: 'Shard', sortable: true, className: 'font-mono tab-content-value' },
                { key: 'prirep', header: 'Pri/Rep', sortable: true, className: 'tab-content-value' },
                { key: 'unassigned.reason', header: 'Reason', render: (r) => r['unassigned.reason'] ?? '-', className: 'tab-content-value max-w-[260px] truncate' },
                {
                  key: 'unassigned_info.at',
                  header: 'Unassigned at',
                  render: (r) => {
                    const key = shardKey(r);
                    const info = allocationExplain[key]?.unassigned_info;
                    return formatShortRelativeTime(info?.at);
                  },
                  className: 'tab-content-value'
                },
                {
                  key: 'allocate_explanation',
                  header: 'Allocate explanation',
                  render: (r) => {
                    const key = shardKey(r);
                    return allocationExplain[key]?.allocate_explanation ?? '-';
                  },
                  className: 'tab-content-value max-w-[480px] whitespace-normal break-words'
                }
              ]}
              emptyMessage={allClearEmpty}
              dense
            />
            </div>
          </div>
        )}
      </section>

      {/* Unassigned shard allocation details modal */}
      {selectedShardKey && allocationExplain[selectedShardKey] && (() => {
        const explain = allocationExplain[selectedShardKey]!;
        const nodeDecisions = Array.isArray(explain.node_allocation_decisions) ? explain.node_allocation_decisions : [];
        const [indexName, shardId, role] = selectedShardKey.split('#');
        const isPrimary = role === 'primary';
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3">
            <div className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-black/10 dark:bg-slate-900 dark:ring-slate-700">
              <div className="flex items-start justify-between border-b border-gray-200 px-4 py-3 dark:border-slate-700">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {indexName}
                    </h3>
                    {healthReport?.status && (
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${getStatusPillClass(
                          healthReport.status
                        )}`}
                      >
                        {healthReport.status}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                    Shard {shardId} • {isPrimary ? 'Primary' : 'Replica'} • {explain.current_state ?? 'unassigned'}
                  </p>
                  {explain.unassigned_info?.reason && (
                    <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                      Reason: {explain.unassigned_info.reason}
                    </p>
                  )}
                  {explain.unassigned_info?.at && (
                    <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                      Unassigned since {formatShortRelativeTime(explain.unassigned_info.at)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedShardKey(null)}
                  className="ml-3 inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-gray-200"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[60vh] overflow-auto px-4 py-3">
                {nodeDecisions.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    No node allocation decisions available for this shard.
                  </p>
                ) : (
                  <table className="min-w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500 dark:border-slate-700 dark:text-gray-400">
                        <th className="px-2 py-1 text-left font-medium">Node</th>
                        <th className="px-2 py-1 text-left font-medium">Decider</th>
                        <th className="px-2 py-1 text-left font-medium">Decision</th>
                        <th className="px-2 py-1 text-left font-medium">Explanation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nodeDecisions.map((node, nodeIdx) => {
                        const deciders = Array.isArray(node.deciders) ? node.deciders : [];
                        if (deciders.length === 0) {
                          return (
                            <tr key={`${nodeIdx}-empty`} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                              <td className="px-2 py-1 align-top font-mono text-[11px] text-gray-800 dark:text-gray-100">
                                {node.node_name ?? node.node_id ?? 'Unknown node'}
                              </td>
                              <td className="px-2 py-1 align-top text-gray-500 dark:text-gray-400" colSpan={3}>
                                No decider information.
                              </td>
                            </tr>
                          );
                        }
                        return deciders.map((d, decIdx) => (
                          <tr
                            key={`${nodeIdx}-${decIdx}`}
                            className="border-b border-gray-100 last:border-0 dark:border-slate-800"
                          >
                            {decIdx === 0 && (
                              <td
                                className="px-2 py-1 align-top font-mono text-[11px] text-gray-800 dark:text-gray-100"
                                rowSpan={deciders.length}
                              >
                                {node.node_name ?? node.node_id ?? 'Unknown node'}
                              </td>
                            )}
                            <td className="px-2 py-1 align-top text-gray-700 dark:text-gray-200">
                              {d.decider ?? '-'}
                            </td>
                            <td className="px-2 py-1 align-top text-gray-700 dark:text-gray-200">
                              {d.decision ?? '-'}
                            </td>
                            <td className="px-2 py-1 align-top text-gray-600 dark:text-gray-300">
                              <span className="line-clamp-3">
                                {d.explanation ?? '-'}
                              </span>
                            </td>
                          </tr>
                        ));
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Pending tasks */}
      <section className="tab-section-card">
        <div className="tab-section-header tab-section-header-split">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TabSectionExpandTrigger
              expanded={pendingExpanded}
              onToggle={() => setPendingExpanded((p) => !p)}
              label="Pending tasks"
              fillHitArea={true}
              suffix={
                <>
                  <InfoPopup
                    title="Pending tasks"
                    modalTitle="Pending tasks"
                    open={infoOpen === 'pending'}
                    onOpen={() => setInfoOpen('pending')}
                    onClose={() => setInfoOpen(null)}
                  >
                    <p>
                      Cluster-level tasks from <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET /_cat/pending_tasks</code>.
                    </p>
                  </InfoPopup>
                  {pendingError ? (
                    <span className="text-xs max-w-[220px] truncate text-rose-600 dark:text-rose-400" title={pendingError}>
                      Error
                    </span>
                  ) : pendingLoading ? (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <RefreshCw className="h-3 w-3 animate-spin shrink-0" aria-hidden />
                      Loading…
                    </span>
                  ) : pendingTasks.length === 0 ? (
                    <HeaderAllClear />
                  ) : (
                    <span className="text-xs font-medium text-amber-800 dark:text-amber-200">{pendingTasks.length} pending</span>
                  )}
                </>
              }
            />
          </div>
          {pendingExpanded && (
            <div className="tab-section-inline-tools">
              <div className="relative">
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search name, patterns, fields…"
                  value={pendingSearch}
                  onChange={(e) => setPendingSearch(e.target.value)}
                  className="pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-36 tab-content-value"
                />
                {pendingSearch && (
                  <button
                    type="button"
                    onClick={() => setPendingSearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <Pagination
                currentPage={pendingPage}
                totalPages={pendingTotalPages}
                totalItems={filteredPending.length}
                pageSize={pendingPageSize}
                onPageChange={setPendingPage}
                inline
              />

              <select
                value={String(pendingPageSize)}
                onChange={(e) => setPendingPageSize(parseInt(e.target.value, 10) || 10)}
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
          )}
        </div>

        {pendingExpanded && (
          <div className="tab-section-body">
            {pendingError && (
              <div className="mx-2 mt-2 flex-shrink-0 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                {pendingError}{' '}
                <button type="button" onClick={fetchPending} className="ml-1 underline">
                  Retry
                </button>
              </div>
            )}
            <div className="tab-section-scroll tab-section-scroll-flush">
            <DataTable
              data={filteredPending.slice((pendingPage - 1) * pendingPageSize, pendingPage * pendingPageSize)}
              columns={[
                { key: 'insert_order', header: 'Order', render: (r) => r.insert_order ?? '-', sortable: true, className: 'tab-content-value' },
                { key: 'time_in_queue', header: 'Time in queue', render: (r) => r.time_in_queue ?? '-', sortable: true, className: 'tab-content-value' },
                { key: 'priority', header: 'Priority', render: (r) => r.priority ?? '-', sortable: true, className: 'tab-content-value' },
                { key: 'source', header: 'Source', render: (r) => r.source ?? '-', sortable: true, className: 'tab-content-value font-mono' }
              ]}
              emptyMessage={allClearEmpty}
              dense
            />
            </div>
          </div>
        )}
      </section>

      {/* Active recovery */}
      <section className="tab-section-card">
        <div className="tab-section-header tab-section-header-split">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TabSectionExpandTrigger
              expanded={recoveryExpanded}
              onToggle={() => setRecoveryExpanded((p) => !p)}
              label="Active recovery"
              fillHitArea={true}
              suffix={
                <>
                  <InfoPopup
                    title="Active recovery"
                    modalTitle="Active recovery"
                    open={infoOpen === 'recovery'}
                    onOpen={() => setInfoOpen('recovery')}
                    onClose={() => setInfoOpen(null)}
                  >
                    <p>
                      Active shard recoveries from <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET /_cat/recovery</code> (active_only).
                    </p>
                  </InfoPopup>
                  {recoveryError ? (
                    <span className="text-xs max-w-[220px] truncate text-rose-600 dark:text-rose-400" title={recoveryError}>
                      Error
                    </span>
                  ) : recoveryLoading ? (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <RefreshCw className="h-3 w-3 animate-spin shrink-0" aria-hidden />
                      Loading…
                    </span>
                  ) : activeRecovery.length === 0 ? (
                    <HeaderAllClear />
                  ) : (
                    <span className="text-xs font-medium text-sky-800 dark:text-sky-200">{activeRecovery.length} active</span>
                  )}
                </>
              }
            />
          </div>
          {recoveryExpanded && (
            <div className="tab-section-inline-tools">
              <div className="relative">
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search"
                  value={recoverySearch}
                  onChange={(e) => setRecoverySearch(e.target.value)}
                  className="pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-36 tab-content-value"
                />
                {recoverySearch && (
                  <button
                    type="button"
                    onClick={() => setRecoverySearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <Pagination
                currentPage={recoveryPage}
                totalPages={recoveryTotalPages}
                totalItems={filteredRecovery.length}
                pageSize={recoveryPageSize}
                onPageChange={setRecoveryPage}
                inline
              />

              <select
                value={String(recoveryPageSize)}
                onChange={(e) => setRecoveryPageSize(parseInt(e.target.value, 10) || 10)}
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
          )}
        </div>

        {recoveryExpanded && (
          <div className="tab-section-body">
            {recoveryError && (
              <div className="mx-2 mt-2 flex-shrink-0 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                {recoveryError}{' '}
                <button type="button" onClick={fetchRecovery} className="ml-1 underline">
                  Retry
                </button>
              </div>
            )}
            <div className="tab-section-scroll tab-section-scroll-flush">
            <DataTable
              data={filteredRecovery.slice((recoveryPage - 1) * recoveryPageSize, recoveryPage * recoveryPageSize)}
              columns={[
                { key: 'i', header: 'Index', sortable: true, className: 'font-mono tab-content-value max-w-[320px] truncate', render: (r) => r.i ?? '-' },
                { key: 's', header: 'Shard', sortable: true, className: 'tab-content-value', render: (r) => r.s ?? '-' },
                { key: 't', header: 'Time', sortable: true, className: 'tab-content-value', render: (r) => r.t ?? '-' },
                { key: 'ty', header: 'Type', sortable: true, className: 'tab-content-value', render: (r) => r.ty ?? '-' },
                { key: 'st', header: 'Stage', sortable: true, className: 'tab-content-value', render: (r) => r.st ?? '-' },
                { key: 'source_node', header: 'Source', sortable: true, className: 'font-mono tab-content-value max-w-[160px] truncate', render: (r) => r.source_node ?? '-' },
                { key: 'target_node', header: 'Target', sortable: true, className: 'font-mono tab-content-value max-w-[160px] truncate', render: (r) => r.target_node ?? '-' },
                { key: 'fp', header: 'Files', sortable: true, className: 'tab-content-value', render: (r) => r.fp ?? '-' },
                { key: 'bp', header: 'Bytes', sortable: true, className: 'tab-content-value', render: (r) => r.bp ?? '-' },
                { key: 'translog_ops_percent', header: 'Translog', sortable: true, className: 'tab-content-value', render: (r) => r.translog_ops_percent ?? '-' }
              ]}
              emptyMessage={allClearEmpty}
              dense
            />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
