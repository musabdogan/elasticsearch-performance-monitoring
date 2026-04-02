import { PageHeader, type MainTab } from '@/components/layout/PageHeader';
import { formatBytes, formatDocumentCount, formatRelativeTime } from '@/utils/format';
import { Footer } from '@/components/layout/Footer';
import { ErrorState } from '@/components/feedback/ErrorState';
import MetricCard from '@/components/charts/MetricCard';
import IndexTable from '@/components/data/IndexTable';
import NodeTable from '@/components/data/NodeTable';
import { InfoPopup } from '@/components/ui/InfoPopup';
import { ProgressBar } from '@/components/ui/ProgressBar';
import AlertManagement from '@/components/alerts/AlertManagement';
import { ClusterTabContent } from '@/components/tabs/ClusterTabContent';
import { IndicesTabContent } from '@/components/tabs/IndicesTabContent';
import { NodesTabContent } from '@/components/tabs/NodesTabContent';
import { SnapshotsTabContent } from '@/components/tabs/SnapshotsTabContent';
import { TemplatesTabContent } from '@/components/tabs/TemplatesTabContent';
import { useMonitoring } from '@/context/MonitoringProvider';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Zap, Clock, TrendingUp, X, Copy, Check } from 'lucide-react';

type WelcomeTab = 'apis' | 'monitoring-user';

const INDEXING_POLL_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
  { label: '60s', value: 60000 }
];

/**
 * Tab-specific refresh: Header Refresh must NOT call context.refresh() (fetchAll) for these tabs.
 * Each tab listens for its own event and calls only its own APIs.
 * When adding a new tab, add it to this map. See docs/REFRESH_BEHAVIOR.md
 */
const TAB_REFRESH_EVENTS: Record<Exclude<MainTab, 'indexing-search'>, string> = {
  cluster: 'refreshCluster',
  nodes: 'refreshNodes',
  indices: 'refreshIndices',
  templates: 'refreshTemplates',
  snapshots: 'refreshSnapshots'
};

/** Severity by %: ≤70 green, >70–80 amber, >80 red. Returns border and label-strip background classes. */
function getSeverityClasses(pct: number | null | undefined): { border: string; labelBg: string } {
  if (pct == null || !Number.isFinite(pct)) return { border: 'border-l-slate-500', labelBg: 'bg-slate-600 dark:bg-slate-600' };
  if (pct > 80) return { border: 'border-l-red-600', labelBg: 'bg-red-800/90 dark:bg-red-900/80' };
  if (pct > 70) return { border: 'border-l-amber-500', labelBg: 'bg-amber-800/90 dark:bg-amber-900/80' };
  return { border: 'border-l-emerald-600', labelBg: 'bg-emerald-800/90 dark:bg-emerald-900/80' };
}

const KIBANA_SNIPPET = `POST _security/user/searchali_monitoring_user
{
  "password": "searchali_monitoring_password",
  "roles": ["remote_monitoring_collector", "snapshot_user"]
}`;

function getCurlSnippet(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, '');
  return `curl -u elastic:YOUR_ELASTIC_PASSWORD -X POST "${base}/_security/user/searchali_monitoring_user" -H "Content-Type: application/json" -d'
{
  "password": "searchali_monitoring_password",
  "roles": ["remote_monitoring_collector", "snapshot_user"]
}'`;
}

function CodeBlockWithCopy({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };
  return (
    <div className="relative group min-w-0">
      <pre className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 pr-10 text-xs font-mono whitespace-pre overflow-x-auto max-w-full">
        {text}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? 'Copied!' : `Copy ${label}`}
        className="absolute top-2 right-2 p-1.5 rounded text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 transition-colors"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function WelcomeScreen({ onClose }: { onClose?: () => void }) {
  const { activeCluster } = useMonitoring();
  const [activeTab, setActiveTab] = useState<WelcomeTab>('apis');
  const clusterBaseUrl = activeCluster?.baseUrl?.replace(/\/$/, '') ?? 'https://localhost:9200';
  const curlSnippet = useMemo(() => getCurlSnippet(clusterBaseUrl), [clusterBaseUrl]);

  useEffect(() => {
    if (!onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const apiEndpoints = [
    { name: '/_cluster/health', desc: 'Cluster health status & shard counts' },
    { name: '/_cluster/stats', desc: 'Cluster statistics' },
    { name: '/_cluster/settings', desc: 'Cluster settings (e.g. read_only)' },
    { name: '/_health_report', desc: 'Cluster health report (ES 8.x+)' },
    { name: '/_cat/indices', desc: 'Index list, store size & document counts' },
    { name: '/_cat/nodes', desc: 'Node list, roles, version' },
    { name: '/_cat/nodeattrs', desc: 'Node attributes' },
    { name: '/_cat/shards', desc: 'Shard allocation & state' },
    { name: '/_cat/pending_tasks', desc: 'Pending cluster tasks' },
    { name: '/_cat/thread_pool', desc: 'Thread pool stats' },
    { name: '/_cat/aliases', desc: 'Index aliases' },
    { name: '/_snapshot', desc: 'Snapshot repositories' },
    { name: '/_stats', desc: 'Index-level search & indexing metrics' },
    { name: '/_nodes/stats', desc: 'Node-level stats: CPU, heap, disk, indices' },
    { name: '/_data_stream', desc: 'Data streams' },
    { name: '/_mapping', desc: 'Mappings for all indices' },
    { name: '/_settings', desc: 'Index mapping & settings' },
    { name: '/_ilm/explain', desc: 'ILM status per index' },
    { name: '/_field_usage_stats', desc: 'Field usage (unsearched fields, ES 7.15+)' },
    { name: '/_index_template', desc: 'Composable index templates' },
    { name: '/_template', desc: 'Legacy index templates' }
  ];

  return (
    <div className="flex-1 flex min-h-0 bg-gray-50 dark:bg-gray-900 relative">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors z-10"
          title="Close"
        >
          <X className="h-5 w-5" />
        </button>
      )}
      <div className="w-full flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0 p-6 md:p-10">
        {/* Left half: logo, title, tagline, and button at bottom — centered in the half */}
        <div className="flex items-center justify-center min-h-0 py-6 lg:py-0">
          <div className="flex flex-col items-center text-center space-y-8 max-w-md">
            <img
              src="/icons/searchali_logo.png"
              alt="SearchAli Logo"
              className="h-16 md:h-20 w-auto"
            />
            <div className="space-y-4">
              <h1 className="text-2xl md:text-3xl font-semibold text-gray-900 dark:text-gray-100 tracking-tight">
                Elasticsearch Performance Monitoring Dashboard
              </h1>
              <p className="text-base md:text-lg text-gray-500 dark:text-gray-400 font-normal">
                Monitor search and indexing performance in real-time.
              </p>
              <div className="rounded-lg bg-gray-100 dark:bg-gray-800 px-4 py-3 text-left">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Get started in 3 steps</p>
                <ol className="text-xs text-gray-600 dark:text-gray-400 space-y-1 list-decimal list-inside">
                  <li>Add your cluster (URL and credentials if needed)</li>
                  <li>Select the cluster from the dropdown</li>
                  <li>View metrics, indices, and alerts across tabs</li>
                </ol>
              </div>
            </div>
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('openClusterSelector'));
              }}
              className="inline-flex items-center gap-3 px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
              <div className="relative w-5 h-5 flex-shrink-0 flex items-center justify-center">
                <span className="sr-only">Add</span>
                <div className="w-3 h-0.5 bg-white rounded-full" />
                <div className="absolute w-0.5 h-3 bg-white rounded-full" />
              </div>
              Add Elasticsearch Cluster
            </button>
          </div>
        </div>

        {/* Right half: card centered in the half */}
        <div className="flex items-center justify-center min-h-0 min-w-0 py-6 lg:py-0">
          <div className="w-full max-w-xl min-w-0">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden min-w-0">
              <div className="flex border-b border-gray-200 dark:border-gray-700 min-w-0">
            <button
              type="button"
              onClick={() => setActiveTab('apis')}
              className={`flex-1 min-w-0 px-3 py-3 text-xs sm:text-sm font-medium transition-colors truncate ${
                activeTab === 'apis'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border-b-2 border-blue-500'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              Elasticsearch Monitoring APIs
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('monitoring-user')}
              className={`flex-1 min-w-0 px-3 py-3 text-xs sm:text-sm font-medium transition-colors truncate ${
                activeTab === 'monitoring-user'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border-b-2 border-blue-500'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
              title="Dedicated Monitoring User (optional)"
            >
              Monitoring User (optional)
            </button>
              </div>
              <div className="p-6 text-left min-w-0 flex flex-col min-h-0">
            {activeTab === 'apis' && (
              <>
                <div className="grid grid-cols-1 gap-2 text-xs overflow-y-auto overflow-x-hidden max-h-[min(60vh,420px)] pr-1">
                  {apiEndpoints.map((api, index) => (
                    <div key={index} className="flex items-center justify-between gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-lg shrink-0">
                      <code className="font-mono text-blue-600 dark:text-blue-400 font-medium text-xs break-all min-w-0">
                        {api.name}
                      </code>
                      <span className="text-gray-600 dark:text-gray-300 text-xs shrink-0 text-right">
                        {api.desc}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 text-center shrink-0">
                  All data is retrieved directly from these{' '}
                  <a
                    href="https://www.elastic.co/docs/api/doc/elasticsearch/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    &quot;Elasticsearch APIs official documentation&quot;
                  </a>
                </p>
              </>
            )}
            {activeTab === 'monitoring-user' && (
              <div className="space-y-4 text-xs text-gray-700 dark:text-gray-300 break-words min-w-0">
                <p className="break-words">
                  To maintain a secure cluster, it is a best practice to create a dedicated user for health checks and metric collection rather than using a superuser account.
                </p>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-gray-100 mb-1 text-xs">Recommended roles</p>
                  <ul className="text-[11px] text-gray-500 dark:text-gray-400 mb-1 list-disc list-inside space-y-0.5 break-words">
                    <li><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded text-blue-600 dark:text-blue-400 break-all">remote_monitoring_collector</code> — cluster health, node stats, index metrics</li>
                    <li><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded text-blue-600 dark:text-blue-400 break-all">snapshot_user</code> — built-in role for snapshot repositories and snapshot list (optional)</li>
                  </ul>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 break-words">
                    The snippets below create a user with both roles so the app can fetch monitoring and snapshot data. <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded break-all">snapshot_user</code> and <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded break-all">remote_monitoring_collector</code> are built-in Elasticsearch roles; no need to create them.
                  </p>
                  <a
                    href="https://www.elastic.co/docs/reference/elasticsearch/roles"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline text-[11px]"
                  >
                    Official Documentation
                  </a>
                </div>
                <h4 className="font-medium text-gray-900 dark:text-gray-100 text-xs">Implementation</h4>
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100 mb-1.5 text-xs">Option A: Kibana Dev Tools (Console)</p>
                  <CodeBlockWithCopy text={KIBANA_SNIPPET} label="Kibana snippet" />
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100 mb-1.5 text-xs">Option B: Terminal (cURL)</p>
                  <CodeBlockWithCopy text={curlSnippet} label="curl command" />
                </div>
              </div>
            )}
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
    prevSnapshot,
    performanceMetrics,
    pollInterval,
    setPollInterval,
    lastUpdated,
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
  const [globalIndexModalIndex, setGlobalIndexModalIndex] = useState<string | null>(null);
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

  // Performance data from context
  const performanceData = useMemo(() => {
    if (!snapshot) return null;
    return {
      metrics: performanceMetrics,
      indices: snapshot.indices
    };
  }, [snapshot, performanceMetrics]);

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
  const [clusterStatsInfoOpen, setClusterStatsInfoOpen] = useState(false);

  const statusBgClass = isRedStatus
    ? 'bg-gradient-to-br from-red-50 via-rose-50 to-pink-50 dark:from-red-950 dark:via-rose-950 dark:to-pink-950'
    : isYellowStatus
      ? 'bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 dark:from-amber-950 dark:via-yellow-950 dark:to-orange-950'
      : '';

  return (
    <main className={`w-full h-screen overflow-hidden flex flex-col ${statusBgClass}`}>
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
                  className={`cluster-summary-card relative flex h-[4.5rem] flex-col justify-center items-center rounded px-1.5 py-1 text-center shadow border-l-4 overflow-hidden ${
                    snapshot.health.status === 'green'
                      ? 'bg-emerald-900/70 dark:bg-emerald-800/50 border-l-emerald-600'
                      : snapshot.health.status === 'yellow'
                        ? 'bg-amber-900/70 dark:bg-amber-800/50 border-l-amber-600'
                        : snapshot.health.status === 'red'
                          ? 'bg-red-900/70 dark:bg-red-800/50 border-l-red-700'
                          : 'bg-slate-700 dark:bg-slate-800 border-l-slate-500'
                  }`}
                >
                  {/* Background watermark: status + label + ES version */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-slate-600 dark:text-slate-500" aria-hidden>
                    <span className="text-[0.65rem] font-bold uppercase tracking-widest opacity-20">{snapshot.health.status}</span>
                    <span className="text-[0.5rem] font-medium opacity-15">Status</span>
                    {(() => {
                      const esVersion = snapshot.nodes?.find((n) => n.version)?.version;
                      return esVersion ? <span className="text-[0.45rem] opacity-15">ES {esVersion}</span> : null;
                    })()}
                  </div>
                  <div className="cluster-card-value relative z-10 font-bold uppercase tracking-wider text-gray-200 leading-tight">{snapshot.health.status}</div>
                  <div className="cluster-card-label relative z-10 font-medium text-gray-400">Status</div>
                  {(() => {
                    const esVersion = snapshot.nodes?.find((n) => n.version)?.version;
                    return esVersion ? (
                      <div className="relative z-10 mt-0.5 text-xs font-normal text-gray-500 leading-tight">ES {esVersion}</div>
                    ) : null;
                  })()}
                </div>
                <div className="cluster-summary-card flex h-[4.5rem] flex-col justify-center items-center rounded px-1.5 py-1 text-center shadow bg-slate-700 dark:bg-slate-800 border-l-4 border-l-slate-500">
                  <div className="cluster-card-value font-bold text-gray-200 leading-tight">{clusterInfo?.nodeCount ?? 0}</div>
                  <div className="cluster-card-label font-medium text-gray-400">Nodes</div>
                </div>
                <div className="cluster-summary-card flex h-[4.5rem] flex-col justify-center items-center rounded px-1.5 py-1 text-center shadow bg-slate-700 dark:bg-slate-800 border-l-4 border-l-slate-500">
                  <div className="cluster-card-value font-bold text-gray-200 leading-tight">{clusterInfo?.indexCount ?? 0}</div>
                  <div className="cluster-card-label font-medium text-gray-400">Indices</div>
                  {clusterInfo?.documentCountFormatted && (
                    <div className="mt-0.5 text-xs font-normal text-gray-500 leading-tight">
                      documents: {clusterInfo.documentCountFormatted}
                    </div>
                  )}
                </div>
                <div className="cluster-summary-card flex h-[4.5rem] flex-col justify-center items-center rounded px-1.5 py-1 text-center shadow bg-slate-700 dark:bg-slate-800 border-l-4 border-l-slate-500">
                  <div className="cluster-card-value font-bold text-gray-200 leading-tight">{snapshot.health.active_shards}</div>
                  <div className="cluster-card-label font-medium text-gray-400">Active Shards</div>
                  {typeof snapshot.health.active_primary_shards === 'number' && (
                    <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-1 gap-y-0 text-xs font-normal text-gray-500 leading-tight">
                      <span>primary: {snapshot.health.active_primary_shards}</span>
                      <span className="text-gray-600">·</span>
                      <span>replica: {Math.max(0, snapshot.health.active_shards - snapshot.health.active_primary_shards)}</span>
                    </div>
                  )}
                </div>
                {/* CPU: label left (colored by %) | percent + progress bar right */}
                {(() => {
                  const sc = getSeverityClasses(clusterResources?.cpuUsage);
                  return (
                    <div className={`cluster-summary-card cluster-metric-card flex h-[4.5rem] flex-row items-stretch rounded px-0 py-0 shadow min-w-0 overflow-hidden border-l-4 bg-slate-700 dark:bg-slate-800 ${sc.border}`}>
                      <div className={`cluster-metric-label-wrap flex flex-shrink-0 items-center justify-center pl-2 pr-2 border-r border-gray-600 ${sc.labelBg}`}>
                        <span className="cluster-metric-label text-gray-200 font-bold leading-tight">CPU</span>
                      </div>
                  <div className="flex flex-1 min-w-0 flex-col justify-center gap-0.5 py-1.5 pr-2 pl-2">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="cluster-card-pct tabular-nums text-gray-200 font-bold">
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
                    <div className={`cluster-summary-card cluster-metric-card flex h-[4.5rem] flex-row items-stretch rounded px-0 py-0 shadow min-w-0 overflow-hidden border-l-4 bg-slate-700 dark:bg-slate-800 ${sc.border}`}>
                      <div className={`cluster-metric-label-wrap flex flex-shrink-0 items-center justify-center pl-2 pr-2 border-r border-gray-600 ${sc.labelBg}`}>
                        <span className="cluster-metric-label text-gray-200 font-bold leading-tight">Heap</span>
                      </div>
                  <div className="flex flex-1 min-w-0 flex-col justify-center gap-0.5 py-1.5 pr-2 pl-2">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="cluster-card-pct tabular-nums text-gray-200 font-bold">
                        {clusterResources != null ? `${clusterResources.jvmHeap.toFixed(0)}%` : '—'}
                      </span>
                    </div>
                    <ProgressBar compact value={clusterResources?.jvmHeap ?? null} variant="card" showLabel={false} />
                    <div className="cluster-card-usage truncate text-gray-300 text-left">
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
                    <div className={`cluster-summary-card cluster-metric-card flex h-[4.5rem] flex-row items-stretch rounded px-0 py-0 shadow min-w-0 overflow-hidden border-l-4 bg-slate-700 dark:bg-slate-800 ${sc.border}`} title={clusterResources ? `${formatBytes(clusterResources.storageUsed)} / ${formatBytes(clusterResources.storageTotal)}` : undefined}>
                      <div className={`cluster-metric-label-wrap flex flex-shrink-0 items-center justify-center pl-2 pr-2 border-r border-gray-600 ${sc.labelBg}`}>
                        <span className="cluster-metric-label text-gray-200 font-bold leading-tight">Disk</span>
                      </div>
                  <div className="flex flex-1 min-w-0 flex-col justify-center gap-0.5 py-1.5 pr-2 pl-2">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="cluster-card-pct tabular-nums text-gray-200 font-bold">
                        {clusterResources != null ? `${clusterResources.storagePercent.toFixed(0)}%` : '—'}
                      </span>
                    </div>
                    <ProgressBar compact value={clusterResources?.storagePercent ?? null} variant="card" showLabel={false} />
                    <div className="cluster-card-usage truncate text-gray-300 text-left">
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
                <>
                  {snapshot && performanceData ? (
                    <>
                      <section className="rounded-lg border border-gray-300 bg-white shadow dark:bg-gray-800 dark:border-gray-600 flex-shrink-0">
                        <div className="flex items-stretch gap-2 p-2">
                          <div className="flex items-center gap-2 shrink-0 pr-2 border-r border-gray-200 dark:border-gray-600">
                            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Cluster Statistics</h2>
                            <InfoPopup
                              title="Cluster Statistics"
                              modalTitle="Cluster Statistics - API & Calculations"
                              open={clusterStatsInfoOpen}
                              onOpen={() => setClusterStatsInfoOpen(true)}
                              onClose={() => setClusterStatsInfoOpen(false)}
                            >
                              <div className="space-y-3">
                                <div>
                                  <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">API Endpoint</h3>
                                  <code className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">/_nodes/stats/indices</code>
                                  <p className="mt-1">Aggregates indexing and search statistics from all cluster nodes.</p>
                                </div>
                                <div>
                                  <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">Metrics</h3>
                                  <ul className="text-xs space-y-1 list-disc list-inside">
                                    <li><strong>Indexing Rate</strong> — indexing operations per second (index_total delta over time).</li>
                                    <li><strong>Search Rate</strong> — search queries per second (query_total delta over time).</li>
                                    <li><strong>Index Latency</strong> — average time per indexing op (index_time_in_millis / index_total).</li>
                                    <li><strong>Search Latency</strong> — average time per search query (query_time_in_millis / query_total).</li>
                                  </ul>
                                </div>
                              </div>
                            </InfoPopup>
                          </div>
                          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 flex-1 min-w-0">
                            <MetricCard title="Indexing Rate" value={performanceData.metrics.indexingRate} unit="/sec" data={[]} dataKey="indexingRate" color="#10b981" icon={<TrendingUp className="h-3.5 w-3.5" />} />
                            <MetricCard title="Search Rate" value={performanceData.metrics.searchRate} unit="/sec" data={[]} dataKey="searchRate" color="#06b6d4" icon={<Activity className="h-3.5 w-3.5" />} />
                            <MetricCard title="Index Latency" value={performanceData.metrics.indexLatency} unit="ms" data={[]} dataKey="indexLatency" color="#f59e0b" icon={<Clock className="h-3.5 w-3.5" />} />
                            <MetricCard title="Search Latency" value={performanceData.metrics.searchLatency} unit="ms" data={[]} dataKey="searchLatency" color="#ef4444" icon={<Zap className="h-3.5 w-3.5" />} />
                          </div>
                          <div className="flex items-center gap-2 shrink-0 pl-2 border-l border-gray-200 dark:border-gray-600">
                            <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                              <span>Interval:</span>
                              <select
                                className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                                value={pollInterval}
                                onChange={(e) => setPollInterval(Number(e.target.value))}
                              >
                                {INDEXING_POLL_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </label>
                            {lastUpdated && (
                              <span
                                className="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap"
                                title={`Updated at ${new Date(lastUpdated).toLocaleTimeString('en-US')}`}
                              >
                                Updated {formatRelativeTime(lastUpdated)}
                              </span>
                            )}
                          </div>
                        </div>
                      </section>
                      <section className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                          <IndexTable
                            variant="panel"
                            data={performanceData.indices}
                            indexStats={snapshot?.indexStats}
                            prevIndexStats={prevSnapshot?.indexStats}
                            fetchedAt={snapshot?.fetchedAt}
                            prevFetchedAt={prevSnapshot?.fetchedAt}
                            pollIntervalMs={pollInterval}
                            onOpenIndexDetails={(indexName) => setGlobalIndexModalIndex(indexName)}
                          />
                        </div>
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                          {snapshot?.nodeStats && (
                            <NodeTable variant="panel" nodeStats={snapshot.nodeStats} nodes={snapshot.nodes} />
                          )}
                        </div>
                      </section>
                    </>
                  ) : (
                    <div className="flex flex-1 items-center justify-center rounded-lg border border-gray-300 bg-white p-8 dark:bg-gray-800 dark:border-gray-600">
                      <p className="text-sm text-gray-500 dark:text-gray-400">Loading cluster data…</p>
                    </div>
                  )}
                </>
              )}
              {mainTab === 'cluster' && <ClusterTabContent onRefreshStateChange={setTabRefreshing} />}
              {mainTab === 'nodes' && <NodesTabContent onRefreshStateChange={setTabRefreshing} />}
              {mainTab === 'indices' && <IndicesTabContent onRefreshStateChange={setTabRefreshing} />}
              {mainTab === 'templates' && <TemplatesTabContent onRefreshStateChange={setTabRefreshing} />}
              {mainTab === 'snapshots' && <SnapshotsTabContent onRefreshStateChange={setTabRefreshing} />}
            </div>
            <IndicesTabContent
              modalOnly
              externalOpenIndex={globalIndexModalIndex}
              onExternalModalClose={() => setGlobalIndexModalIndex(null)}
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