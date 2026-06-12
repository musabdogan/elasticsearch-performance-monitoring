import { PageHeader, type MainTab } from '@/components/layout/PageHeader';
import { formatBytes, formatDocumentCount } from '@/utils/format';
import { Footer } from '@/components/layout/Footer';
import { ErrorState } from '@/components/feedback/ErrorState';
import { ProgressBar } from '@/components/ui/ProgressBar';
import AlertManagement from '@/components/alerts/AlertManagement';
import { ClusterTabContent } from '@/components/tabs/ClusterTabContent';
import { IndexingSearchTabContent } from '@/components/tabs/IndexingSearchTabContent';
import type { GlobalIndexModalState, OpenIndexDetailsFn } from '@/types/indexDetail';
import { IndexDetailModal } from '@/components/index/IndexDetailModal';
import { IndicesTabContent } from '@/components/tabs/IndicesTabContent';
import { NodesTabContent } from '@/components/tabs/NodesTabContent';
import { QueryTabContent } from '@/components/tabs/QueryTabContent';
import { ShardsTabContent } from '@/components/tabs/ShardsTabContent';
import { SnapshotsTabContent } from '@/components/tabs/SnapshotsTabContent';
import { TemplatesTabContent } from '@/components/tabs/TemplatesTabContent';
import { useMonitoring } from '@/context/MonitoringProvider';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, HelpCircle, Upload } from 'lucide-react';
import { GettingStartedTour } from '@/components/onboarding/GettingStartedTour';
import { ImportBackupModal } from '@/components/onboarding/ImportBackupModal';
import { SearchAliWordmark } from '@/components/brand/SearchAliWordmark';

/**
 * Tab-specific refresh: Header Refresh must NOT call context.refresh() (fetchAll) for these tabs.
 * Each tab listens for its own event and calls only its own APIs.
 * When adding a new tab, add it to this map. See docs/REFRESH_BEHAVIOR.md
 */
const TAB_REFRESH_EVENTS: Record<Exclude<MainTab, 'indexing-search'>, string> = {
  cluster: 'refreshCluster',
  nodes: 'refreshNodes',
  indices: 'refreshIndices',
  search: 'refreshSearch',
  shards: 'refreshShards',
  templates: 'refreshTemplates',
  snapshots: 'refreshSnapshots'
};

/** Severity by %: ≤70 green, >70–80 amber, >80 red. */
function getSeverityClasses(pct: number | null | undefined): {
  border: string;
  labelBg: string;
  labelText: string;
} {
  if (pct == null || !Number.isFinite(pct)) {
    return {
      border: 'border-l-slate-500',
      labelBg: 'bg-slate-100 dark:bg-slate-600',
      labelText: 'text-slate-700 dark:text-gray-200'
    };
  }
  if (pct > 80) {
    return {
      border: 'border-l-red-600',
      labelBg: 'bg-red-100 dark:bg-red-900/80',
      labelText: 'text-red-900 dark:text-gray-200'
    };
  }
  if (pct > 70) {
    return {
      border: 'border-l-amber-500',
      labelBg: 'bg-amber-100 dark:bg-amber-900/80',
      labelText: 'text-amber-900 dark:text-gray-200'
    };
  }
  return {
    border: 'border-l-emerald-600',
    labelBg: 'bg-emerald-100 dark:bg-emerald-900/80',
    labelText: 'text-emerald-900 dark:text-gray-200'
  };
}

const NEUTRAL_SUMMARY_CARD =
  'cluster-summary-card flex h-[4.5rem] flex-col justify-center items-center rounded px-1.5 py-1 text-center shadow-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 border-l-4 border-l-slate-400 dark:border-l-slate-500';

function WelcomeScreen({ onClose }: { onClose?: () => void }) {
  const { clusters } = useMonitoring();
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="flex-1 flex min-h-0 bg-gray-50 dark:bg-gray-900 relative overflow-y-auto">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors z-10"
          title="Close"
        >
          <X className="h-5 w-5" />
        </button>
      )}
      <div className="w-full flex-1 min-h-0 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto flex min-h-full w-full max-w-xl items-center justify-center">
            <div className="flex flex-col items-center text-center space-y-5 md:space-y-8 w-full">
            <SearchAliWordmark heightClass="h-14 md:h-16" className="justify-center" />
            <div className="space-y-4">
              <h1 className="text-2xl md:text-3xl font-semibold text-gray-900 dark:text-gray-100 tracking-tight">
                Elasticsearch Performance Monitoring Dashboard
              </h1>
              <p className="text-base md:text-lg text-gray-500 dark:text-gray-400 font-normal">
                Monitor search and indexing performance in real-time.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('openClusterSelector'));
                  }}
                  data-tour="add-cluster"
                  className="inline-flex items-center gap-3 px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                >
                  <div className="relative w-5 h-5 flex-shrink-0 flex items-center justify-center">
                    <span className="sr-only">Add</span>
                    <div className="w-3 h-0.5 bg-white rounded-full" />
                    <div className="absolute w-0.5 h-3 bg-white rounded-full" />
                  </div>
                  Add Elasticsearch Cluster
                </button>
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="inline-flex items-center gap-2 px-6 py-3.5 bg-white hover:bg-gray-50 text-gray-800 font-medium rounded-xl shadow border border-gray-200 hover:border-gray-300 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 dark:hover:bg-gray-700 dark:focus:ring-offset-gray-900"
                >
                  <Upload className="h-5 w-5 shrink-0" />
                  Import/Export
                </button>
              </div>
              <ImportBackupModal
                open={importOpen}
                onClose={() => setImportOpen(false)}
                onImported={onClose}
              />
              {clusters.length === 0 && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('startGettingStartedTour'))}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 transition-colors text-xs"
                    title="Start guided tour"
                  >
                    <HelpCircle className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                    Start tour
                  </button>
                </div>
              )}
              <div className="rounded-lg bg-gray-100 dark:bg-gray-800 px-4 py-3 text-left">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Get started in 3 steps</p>
                <ol className="text-xs text-gray-600 dark:text-gray-400 space-y-1 list-decimal list-inside">
                  <li>Add your cluster (URL and credentials if needed)</li>
                  <li>Select the cluster from the dropdown</li>
                  <li>View metrics, indices, and alerts across tabs</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const {
    snapshot,
    error,
    connectionLost,
    connectionLostUri,
    retryConnection,
    activeCluster,
    clusters,
    refreshing,
    setPollingEnabled,
    // Alert system
    alerts,
    alertRules,
    alertSettings,
    updateAlertSettings,
    updateAlertRule,
    resetAlertsToDefaults,
    getAlertHistory
  } = useMonitoring();

  const [showAlertManagement, setShowAlertManagement] = useState(false);
  const [showWelcomePage, setShowWelcomePage] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>('indexing-search');
  const [tabRefreshing, setTabRefreshing] = useState(false);
  const [globalIndexModal, setGlobalIndexModal] = useState<GlobalIndexModalState | null>(null);
  const [globalNodeModalNode, setGlobalNodeModalNode] = useState<string | null>(null);
  const [queryPrefillIndex, setQueryPrefillIndex] = useState<string | null>(null);

  const openIndexDetails: OpenIndexDetailsFn = useCallback((indexName, tab) => {
    setGlobalIndexModal({ indexName, tab });
  }, []);

  const openInQuery = useCallback((indexName: string) => {
    setQueryPrefillIndex(indexName);
    setShowWelcomePage(false);
    setMainTab('search');
  }, []);

  useEffect(() => {
    const onOpenQueryTab = (e: Event) => {
      const ev = e as CustomEvent<{ indexName?: string }>;
      const name = ev.detail?.indexName?.trim();
      if (name) setQueryPrefillIndex(name);
      setShowWelcomePage(false);
      setMainTab('search');
    };
    window.addEventListener('openQueryTab', onOpenQueryTab as EventListener);
    return () => window.removeEventListener('openQueryTab', onOpenQueryTab as EventListener);
  }, []);
  /** Alert IDs already seen when user opened the panel; badge shows only unseen (new) alerts until next open. */
  const [seenAlertIdsByCluster, setSeenAlertIdsByCluster] = useState<Record<string, string[]>>({});

  // Auto-refresh runs only when Indexing & Search tab is active
  useEffect(() => {
    setPollingEnabled(mainTab === 'indexing-search');
  }, [mainTab, setPollingEnabled]);

  const alertsForCluster = activeCluster
    ? alerts.filter(a => a.clusterName === activeCluster.label)
    : alerts;
  const seenIds = activeCluster ? seenAlertIdsByCluster[activeCluster.label] ?? [] : [];
  const unseenAlerts = alertsForCluster.filter(a => !seenIds.includes(a.id));
  const alertCount = unseenAlerts.length;
  const criticalCount = unseenAlerts.filter(a => a.severity === 'critical').length;

  const handleOpenAlerts = () => {
    setShowAlertManagement((prev) => {
      const willOpen = !prev;
      if (willOpen && activeCluster && alertsForCluster.length > 0) {
        setSeenAlertIdsByCluster((prevSeen) => ({
          ...prevSeen,
          [activeCluster.label]: alertsForCluster.map((a) => a.id)
        }));
      }
      return !prev;
    });
  };

  /** Tab-specific refresh: only the event from TAB_REFRESH_EVENTS is dispatched; context.refresh() is never called. */
  const handleRefresh = useCallback(() => {
    const eventName = mainTab === 'indexing-search' ? null : TAB_REFRESH_EVENTS[mainTab];
    if (eventName) {
      window.dispatchEvent(new CustomEvent(eventName));
    }
  }, [mainTab]);

  const clusterInfo = useMemo(() => {
    if (!snapshot) return null;
    const totalDocs = (snapshot.indices ?? []).reduce(
      (sum, idx) => sum + (parseInt(idx['docs.count'], 10) || 0),
      0
    );
    return {
      name: snapshot.health.cluster_name,
      status: snapshot.health.status,
      /** Prefer nodes array length so total matches role breakdown; fallback to health count */
      nodeCount: snapshot.nodes?.length ?? snapshot.health.number_of_nodes ?? 0,
      indexCount: snapshot.indices?.length || 0,
      documentCountFormatted: totalDocs > 0 ? formatDocumentCount(totalDocs) : null
    };
  }, [snapshot]);

  const clusterResources = useMemo(() => {
    if (!snapshot?.nodeStats) return null;
    const nodes = Object.values(snapshot.nodeStats.nodes);
    const cpuValues = nodes
      .map(node => node.os?.cpu?.percent ?? node.process?.cpu?.percent ?? 0)
      .filter(cpu => cpu > 0);
    const avgCpuUsage = cpuValues.length > 0
      ? cpuValues.reduce((sum, cpu) => sum + cpu, 0) / cpuValues.length
      : 0;
    const heap = nodes.reduce((acc, node) => {
      const used = node.jvm?.mem?.heap_used_in_bytes || 0;
      const max = node.jvm?.mem?.heap_max_in_bytes || 0;
      return { used: acc.used + used, max: acc.max + max };
    }, { used: 0, max: 0 });
    const avgJvmHeap = heap.max > 0 ? (heap.used / heap.max) * 100 : 0;
    const storage = nodes.reduce((acc, node) => {
      const total = node.fs?.total?.total_in_bytes || 0;
      const available = node.fs?.total?.available_in_bytes || 0;
      const used = total - available;
      return { total: acc.total + total, used: acc.used + used };
    }, { total: 0, used: 0 });
    const storagePercent = storage.total > 0 ? (storage.used / storage.total) * 100 : 0;
    return {
      cpuUsage: avgCpuUsage,
      jvmHeap: avgJvmHeap,
      heapUsed: heap.used,
      heapMax: heap.max,
      storagePercent,
      storageUsed: storage.used,
      storageTotal: storage.total
    };
  }, [snapshot]);

  const isRedStatus = snapshot?.health.status === 'red';
  const isYellowStatus = snapshot?.health.status === 'yellow';

  const statusBgClass = isRedStatus
    ? 'bg-gradient-to-br from-red-50 via-rose-50 to-pink-50 dark:from-red-950 dark:via-rose-950 dark:to-pink-950'
    : isYellowStatus
      ? 'bg-gradient-to-br from-yellow-50 via-amber-50 to-yellow-100 dark:from-yellow-950 dark:via-amber-950 dark:to-yellow-900'
      : '';

  return (
    <main className={`w-full h-screen overflow-hidden flex flex-col bg-slate-50 dark:bg-slate-900 ${statusBgClass}`}>
      <GettingStartedTour />
      <PageHeader
        onRefresh={handleRefresh}
        refreshing={refreshing || tabRefreshing}
        mainTab={clusters.length > 0 && !showWelcomePage && (!error || connectionLost) ? mainTab : undefined}
        onTabChange={setMainTab}
        onOpenAlerts={handleOpenAlerts}
        onOpenWelcome={() => setShowWelcomePage((prev) => !prev)}
        alertCount={alertCount}
        criticalCount={criticalCount}
      />

      {/* Main content area with flex-1 to push footer down */}
      <div className="flex-1 flex min-h-0 relative">
        {connectionLost ? (
          /* Connection lost: only the error card on a clean background (no dashboard) */
          <div className="flex flex-1 min-h-0 items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
            <ErrorState
              message={`Network error, cannot access your cluster. Cluster uri: ${connectionLostUri ?? activeCluster?.baseUrl ?? ''}`}
              onRetry={retryConnection}
              actionLabel="Try again"
            />
          </div>
        ) : (
        <>
        {/* Left content area - min-h-0 so it stays within viewport and only this area scrolls */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 px-4 pt-2 pb-0.5">

        {error ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <ErrorState
              message={error}
              onRetry={retryConnection}
              actionLabel="Try again"
            />
          </div>
        ) : clusters.length === 0 || showWelcomePage ? (
          <WelcomeScreen onClose={showWelcomePage ? () => setShowWelcomePage(false) : undefined} />
        ) : (
          <>
            {/* Cluster summary bar - text scales with card height (cluster-summary-card) */}
            {snapshot && (
              <section className="grid grid-cols-4 sm:grid-cols-7 gap-1 flex-shrink-0">
                <div
                  className={`cluster-summary-card relative flex h-[4.5rem] flex-col justify-center items-center rounded px-1.5 py-1 text-center shadow-sm border border-slate-200 dark:border-slate-700 border-l-4 overflow-hidden ${
                    snapshot.health.status === 'green'
                      ? 'bg-emerald-50 dark:bg-emerald-800/50 border-l-emerald-600'
                      : snapshot.health.status === 'yellow'
                        ? 'bg-amber-50 dark:bg-yellow-800/50 border-l-amber-500'
                        : snapshot.health.status === 'red'
                          ? 'bg-red-50 dark:bg-red-800/50 border-l-red-600'
                          : 'bg-white dark:bg-slate-800 border-l-slate-400 dark:border-l-slate-500'
                  }`}
                >
                  {/* Background watermark: status + label + ES version */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500" aria-hidden>
                    <span className="text-[0.65rem] font-bold uppercase tracking-widest opacity-30 dark:opacity-20">{snapshot.health.status}</span>
                    <span className="text-[0.5rem] font-medium opacity-25 dark:opacity-15">Status</span>
                    {(() => {
                      const esVersion = snapshot.nodes?.find((n) => n.version)?.version;
                      return esVersion ? <span className="text-[0.45rem] opacity-25 dark:opacity-15">ES {esVersion}</span> : null;
                    })()}
                  </div>
                  <div className="cluster-card-value relative z-10 font-bold uppercase tracking-wider text-slate-900 dark:text-gray-200 leading-tight">{snapshot.health.status}</div>
                  <div className="cluster-card-label relative z-10 font-medium text-slate-600 dark:text-gray-400">Status</div>
                  {(() => {
                    const esVersion = snapshot.nodes?.find((n) => n.version)?.version;
                    return esVersion ? (
                      <div className="relative z-10 mt-0.5 text-xs font-normal text-slate-500 dark:text-gray-500 leading-tight">ES {esVersion}</div>
                    ) : null;
                  })()}
                </div>
                <div className={NEUTRAL_SUMMARY_CARD}>
                  <div className="cluster-card-value font-bold text-slate-900 dark:text-gray-200 leading-tight">{clusterInfo?.nodeCount ?? 0}</div>
                  <div className="cluster-card-label font-medium text-slate-600 dark:text-gray-400">Nodes</div>
                </div>
                <div className={NEUTRAL_SUMMARY_CARD}>
                  <div className="cluster-card-value font-bold text-slate-900 dark:text-gray-200 leading-tight">{clusterInfo?.indexCount ?? 0}</div>
                  <div className="cluster-card-label font-medium text-slate-600 dark:text-gray-400">Indices</div>
                  {clusterInfo?.documentCountFormatted && (
                    <div className="mt-0.5 text-xs font-normal text-slate-600 dark:text-gray-400 leading-tight">
                      documents: {clusterInfo.documentCountFormatted}
                    </div>
                  )}
                </div>
                <div className={NEUTRAL_SUMMARY_CARD}>
                  <div className="cluster-card-value font-bold text-slate-900 dark:text-gray-200 leading-tight">{snapshot.health.active_shards}</div>
                  <div className="cluster-card-label font-medium text-slate-600 dark:text-gray-400">Active Shards</div>
                  {typeof snapshot.health.active_primary_shards === 'number' && (
                    <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-1 gap-y-0 text-xs font-normal text-slate-600 dark:text-gray-400 leading-tight">
                      <span>primary: {snapshot.health.active_primary_shards}</span>
                      <span className="text-slate-400 dark:text-gray-600">·</span>
                      <span>replica: {Math.max(0, snapshot.health.active_shards - snapshot.health.active_primary_shards)}</span>
                    </div>
                  )}
                </div>
                {/* CPU: label left (colored by %) | percent + progress bar right */}
                {(() => {
                  const sc = getSeverityClasses(clusterResources?.cpuUsage);
                  return (
                    <div className={`cluster-summary-card cluster-metric-card flex h-[4.5rem] flex-row items-stretch rounded shadow-sm min-w-0 overflow-hidden border border-slate-200 dark:border-slate-700 border-l-4 bg-white dark:bg-slate-800 ${sc.border}`}>
                      <div className={`cluster-metric-label-wrap flex flex-shrink-0 items-center justify-center pl-2 pr-2 border-r border-slate-200 dark:border-gray-600 ${sc.labelBg}`}>
                        <span className={`cluster-metric-label font-bold leading-tight ${sc.labelText}`}>CPU</span>
                      </div>
                  <div className="flex flex-1 min-w-0 flex-col justify-center gap-0.5 py-1.5 pr-2 pl-2">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="cluster-card-pct tabular-nums text-slate-900 dark:text-gray-200 font-bold">
                        {clusterResources != null ? `${clusterResources.cpuUsage.toFixed(0)}%` : '—'}
                      </span>
                    </div>
                    <ProgressBar compact value={clusterResources?.cpuUsage ?? null} variant="card" showLabel={false} />
                  </div>
                </div>
                  );
                })()}
                {/* Heap: label left (colored by %) | percent + progress bar + actual value right */}
                {(() => {
                  const sc = getSeverityClasses(clusterResources?.jvmHeap);
                  return (
                    <div className={`cluster-summary-card cluster-metric-card flex h-[4.5rem] flex-row items-stretch rounded shadow-sm min-w-0 overflow-hidden border border-slate-200 dark:border-slate-700 border-l-4 bg-white dark:bg-slate-800 ${sc.border}`}>
                      <div className={`cluster-metric-label-wrap flex flex-shrink-0 items-center justify-center pl-2 pr-2 border-r border-slate-200 dark:border-gray-600 ${sc.labelBg}`}>
                        <span className={`cluster-metric-label font-bold leading-tight ${sc.labelText}`}>Heap</span>
                      </div>
                  <div className="flex flex-1 min-w-0 flex-col justify-center gap-0.5 py-1.5 pr-2 pl-2">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="cluster-card-pct tabular-nums text-slate-900 dark:text-gray-200 font-bold">
                        {clusterResources != null ? `${clusterResources.jvmHeap.toFixed(0)}%` : '—'}
                      </span>
                    </div>
                    <ProgressBar compact value={clusterResources?.jvmHeap ?? null} variant="card" showLabel={false} />
                    <div className="cluster-card-usage truncate text-slate-600 dark:text-gray-300 text-left">
                      {clusterResources && clusterResources.heapMax > 0
                        ? `${formatBytes(clusterResources.heapUsed)} / ${formatBytes(clusterResources.heapMax)}`
                        : '—'}
                    </div>
                  </div>
                </div>
                  );
                })()}
                {/* Disk: label left (colored by %) | percent + progress bar + actual value right */}
                {(() => {
                  const sc = getSeverityClasses(clusterResources?.storagePercent);
                  return (
                    <div className={`cluster-summary-card cluster-metric-card flex h-[4.5rem] flex-row items-stretch rounded shadow-sm min-w-0 overflow-hidden border border-slate-200 dark:border-slate-700 border-l-4 bg-white dark:bg-slate-800 ${sc.border}`} title={clusterResources ? `${formatBytes(clusterResources.storageUsed)} / ${formatBytes(clusterResources.storageTotal)}` : undefined}>
                      <div className={`cluster-metric-label-wrap flex flex-shrink-0 items-center justify-center pl-2 pr-2 border-r border-slate-200 dark:border-gray-600 ${sc.labelBg}`}>
                        <span className={`cluster-metric-label font-bold leading-tight ${sc.labelText}`}>Disk</span>
                      </div>
                  <div className="flex flex-1 min-w-0 flex-col justify-center gap-0.5 py-1.5 pr-2 pl-2">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="cluster-card-pct tabular-nums text-slate-900 dark:text-gray-200 font-bold">
                        {clusterResources != null ? `${clusterResources.storagePercent.toFixed(0)}%` : '—'}
                      </span>
                    </div>
                    <ProgressBar compact value={clusterResources?.storagePercent ?? null} variant="card" showLabel={false} />
                    <div className="cluster-card-usage truncate text-slate-600 dark:text-gray-300 text-left">
                      {clusterResources && clusterResources.storageTotal > 0
                        ? `${formatBytes(clusterResources.storageUsed)} / ${formatBytes(clusterResources.storageTotal)}`
                        : '—'}
                    </div>
                  </div>
                </div>
                  );
                })()}
              </section>
            )}

            {/* Tab content - overflow-y-auto so cluster/nodes/snapshots tabs can scroll */}
            <div className="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden">
              {mainTab === 'indexing-search' && (
                <IndexingSearchTabContent
                  onOpenIndexDetails={openIndexDetails}
                  onOpenNodeDetails={(nodeName) => setGlobalNodeModalNode(nodeName)}
                />
              )}
              {mainTab === 'cluster' && (
                <ClusterTabContent
                  onRefreshStateChange={setTabRefreshing}
                  onOpenNodeDetails={(nodeName) => setGlobalNodeModalNode(nodeName)}
                />
              )}
              {mainTab === 'nodes' && (
                <NodesTabContent
                  onRefreshStateChange={setTabRefreshing}
                  onOpenNodeDetails={(nodeName) => setGlobalNodeModalNode(nodeName)}
                  onOpenIndexDetails={openIndexDetails}
                />
              )}
              {mainTab === 'indices' && (
                <IndicesTabContent
                  onRefreshStateChange={setTabRefreshing}
                  onOpenNodeDetails={(nodeName) => setGlobalNodeModalNode(nodeName)}
                  onOpenIndexDetails={openIndexDetails}
                  onOpenInQuery={openInQuery}
                />
              )}
              {mainTab === 'search' && (
                <QueryTabContent
                  onRefreshStateChange={setTabRefreshing}
                  prefillIndex={queryPrefillIndex}
                  onPrefillConsumed={() => setQueryPrefillIndex(null)}
                />
              )}
              {mainTab === 'shards' && (
                <ShardsTabContent
                  onRefreshStateChange={setTabRefreshing}
                  onOpenIndexDetails={openIndexDetails}
                  onOpenNodeDetails={(nodeName) => setGlobalNodeModalNode(nodeName)}
                />
              )}
              {mainTab === 'templates' && <TemplatesTabContent onRefreshStateChange={setTabRefreshing} />}
              {mainTab === 'snapshots' && (
                <SnapshotsTabContent
                  onRefreshStateChange={setTabRefreshing}
                  onOpenIndexDetails={openIndexDetails}
                  onOpenNodeDetails={(nodeName) => setGlobalNodeModalNode(nodeName)}
                  isIndexDetailModalOpen={globalIndexModal != null}
                />
              )}
            </div>
            {globalIndexModal && (
              <IndexDetailModal
                indexName={globalIndexModal.indexName}
                initialTab={globalIndexModal.tab}
                onClose={() => setGlobalIndexModal(null)}
                onOpenNodeDetails={(nodeName) => setGlobalNodeModalNode(nodeName)}
              />
            )}
            <NodesTabContent
              modalOnly
              externalOpenNode={globalNodeModalNode}
              onExternalModalClose={() => setGlobalNodeModalNode(null)}
            />
          </>
        )}
        </div>

        {/* Alert Management Panel - Right Side */}
        {showAlertManagement && activeCluster && (
          <div className="w-[380px] min-h-0 flex flex-col overflow-y-auto border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
            <AlertManagement
              isOpen={true}
              onClose={() => setShowAlertManagement(false)}
              history={getAlertHistory()}
              settings={alertSettings}
              rules={alertRules}
              alerts={alerts}
              clusterName={activeCluster?.label}
              onUpdateSettings={updateAlertSettings}
              onUpdateRule={updateAlertRule}
              onResetToDefaults={resetAlertsToDefaults}
              isPanel={true}
            />
          </div>
        )}
        </>
        )}
      </div>
      
      <Footer />
    </main>
  );
}