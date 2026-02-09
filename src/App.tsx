import { PageHeader } from '@/components/layout/PageHeader';
import { Footer } from '@/components/layout/Footer';
import { ErrorState } from '@/components/feedback/ErrorState';
import MetricCard from '@/components/charts/MetricCard';
import IndexTable from '@/components/data/IndexTable';
import NodeTable from '@/components/data/NodeTable';
import { InfoPopup } from '@/components/ui/InfoPopup';
import AlertManagement from '@/components/alerts/AlertManagement';
import { useMonitoring } from '@/context/MonitoringProvider';
import { useMemo, useState } from 'react';
import { Activity, Zap, Clock, TrendingUp, Cpu, Database, HardDrive, BarChart3, X } from 'lucide-react';
import { formatBytes } from '@/utils/format';

function WelcomeScreen({ onClose }: { onClose?: () => void }) {
  const apiEndpoints = [
    { name: '/_cluster/health', desc: 'Cluster health' },
    { name: '/_cat/nodes', desc: 'Node inventory & resource usage' },
    { name: '/_cat/indices', desc: 'Index health & document counts' },
    { name: '/_stats', desc: 'Search & indexing performance metrics' },
    { name: '/_nodes/stats', desc: 'System resources & JVM statistics' }
  ];

  return (
    <div className="flex-1 flex items-center justify-center min-h-0 bg-gray-50 dark:bg-gray-900 relative">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors z-10"
          title="Close"
        >
          <X className="h-5 w-5" />
        </button>
      )}
      <div className="max-w-3xl mx-auto text-center space-y-8 p-8">
        {/* Logo and Title */}
        <div className="space-y-6">
          <div className="flex items-center justify-center">
            <img 
              src="/searchali_logo.png" 
              alt="SearchAli Logo" 
              className="h-20 w-auto"
            />
          </div>
          
          <div className="space-y-3">
            <h1 className="text-3xl font-light text-gray-900 dark:text-gray-100">
              Elasticsearch Performance Monitoring Dashboard
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-lg font-light">
              Monitor search and indexing performance in real-time
            </p>
          </div>
        </div>

        {/* Add Cluster Button */}
        <div className="flex justify-center">
          <button 
            onClick={() => {
              // This will trigger the cluster selector modal
              const event = new CustomEvent('openClusterSelector');
              window.dispatchEvent(event);
            }}
            className="inline-flex items-center gap-3 px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
          >
            <div className="w-5 h-5 border-2 border-white rounded flex items-center justify-center">
              <div className="w-3 h-0.5 bg-white"></div>
              <div className="w-0.5 h-3 bg-white absolute"></div>
            </div>
            Add Elasticsearch Cluster
          </button>
        </div>

        {/* API Endpoints - Trust Building */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-blue-500" />
            Elasticsearch Management APIs Used
          </h3>
          <div className="grid grid-cols-1 gap-3 text-sm">
            {apiEndpoints.map((api, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <code className="font-mono text-blue-600 dark:text-blue-400 font-medium">
                  {api.name}
                </code>
                <span className="text-gray-600 dark:text-gray-300 text-xs">
                  {api.desc}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-4 text-center">
            All data is retrieved directly from official Elasticsearch Management APIs
          </p>
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
    error,
    connectionFailed,
    refresh,
    retryConnection,
    activeCluster,
    clusters,
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
  const [lastSeenAlertCount, setLastSeenAlertCount] = useState(0);
  const [lastSeenCriticalCount, setLastSeenCriticalCount] = useState(0);

  const unseenAlertCount = Math.max(0, alerts.length - lastSeenAlertCount);
  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const unseenCriticalCount = Math.max(0, criticalCount - lastSeenCriticalCount);

  const handleOpenAlerts = () => {
    setShowAlertManagement((prev) => {
      const next = !prev;
      if (next) {
        setLastSeenAlertCount(alerts.length);
        setLastSeenCriticalCount(criticalCount);
      }
      return next;
    });
  };

  // Alert indicators for resource cards
  const getResourceAlertLevel = (metricType: 'cpu' | 'jvm' | 'storage') => {
    const cpuAlerts = alerts.filter(a => a.ruleId.includes('cpu') && a.status === 'active');
    const jvmAlerts = alerts.filter(a => a.ruleId.includes('jvm') && a.status === 'active');
    const storageAlerts = alerts.filter(a => a.ruleId.includes('disk') && a.status === 'active');
    
    switch (metricType) {
      case 'cpu':
        if (cpuAlerts.some(a => a.severity === 'critical')) return 'critical';
        if (cpuAlerts.some(a => a.severity === 'warning')) return 'warning';
        break;
      case 'jvm':
        if (jvmAlerts.some(a => a.severity === 'critical')) return 'critical';
        if (jvmAlerts.some(a => a.severity === 'warning')) return 'warning';
        break;
      case 'storage':
        if (storageAlerts.some(a => a.severity === 'critical')) return 'critical';
        if (storageAlerts.some(a => a.severity === 'warning')) return 'warning';
        break;
    }
    return 'normal';
  };

  const getAlertClasses = (alertLevel: string) => {
    switch (alertLevel) {
      case 'critical':
        return 'ring-4 ring-red-500/50 animate-pulse';
      case 'warning':
        return 'ring-2 ring-yellow-500/50';
      default:
        return '';
    }
  };

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
    return {
      name: snapshot.health.cluster_name,
      status: snapshot.health.status,
      nodeCount: snapshot.health.number_of_nodes,
      indexCount: snapshot.indices?.length || 0
    };
  }, [snapshot]);

  const clusterResources = useMemo(() => {
    if (!snapshot?.nodeStats) return null;
    
    const nodes = Object.values(snapshot.nodeStats.nodes);
    
    // CPU Usage (average across nodes; filtered API returns os.cpu.percent)
    const cpuValues = nodes
      .map(node => node.os?.cpu?.percent ?? node.process?.cpu?.percent ?? 0)
      .filter(cpu => cpu > 0);
    const avgCpuUsage = cpuValues.length > 0 
      ? cpuValues.reduce((sum, cpu) => sum + cpu, 0) / cpuValues.length 
      : 0;

    // JVM Heap Usage (average across nodes)
    const jvmValues = nodes
      .map(node => {
        const used = node.jvm?.mem?.heap_used_in_bytes || 0;
        const max = node.jvm?.mem?.heap_max_in_bytes || 0;
        return max > 0 ? (used / max) * 100 : 0;
      })
      .filter(heap => heap > 0);
    const avgJvmHeap = jvmValues.length > 0
      ? jvmValues.reduce((sum, heap) => sum + heap, 0) / jvmValues.length
      : 0;

    // Storage Usage (total across cluster)
    const storage = nodes.reduce((acc, node) => {
      const total = node.fs?.total?.total_in_bytes || 0;
      const available = node.fs?.total?.available_in_bytes || 0;
      const used = total - available;
      return {
        total: acc.total + total,
        used: acc.used + used
      };
    }, { total: 0, used: 0 });
    
    const storagePercent = storage.total > 0 
      ? (storage.used / storage.total) * 100 
      : 0;

    return {
      cpuUsage: avgCpuUsage,
      jvmHeap: avgJvmHeap,
      storagePercent,
      storageUsed: storage.used,
      storageTotal: storage.total
    };
  }, [snapshot]);

  const isRedStatus = snapshot?.health.status === 'red';
  const [clusterStatsInfoOpen, setClusterStatsInfoOpen] = useState(false);

  return (
    <main className={`w-full h-screen overflow-hidden flex flex-col ${
      isRedStatus 
        ? 'bg-gradient-to-br from-red-50 via-rose-50 to-pink-50 dark:from-red-950 dark:via-rose-950 dark:to-pink-950' 
        : ''
    }`}>
      <PageHeader
        onOpenAlerts={handleOpenAlerts}
        onOpenWelcome={() => setShowWelcomePage((prev) => !prev)}
        unseenAlertCount={unseenAlertCount}
        unseenCriticalCount={unseenCriticalCount}
      />
      
      {/* Main content area with flex-1 to push footer down */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Left content area - min-h-0 so it stays within viewport and only this area scrolls */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 px-4 pt-4 pb-4">

        {error && !activeCluster ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="rounded-lg border border-gray-300 bg-white p-4 text-center shadow-lg dark:border-gray-700 dark:bg-gray-800">
              <p className="text-sm text-gray-700 dark:text-gray-300">{error}</p>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Use the cluster selector in the header to add your first cluster.
              </p>
            </div>
          </div>
        ) : connectionFailed && error ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-center shadow-lg dark:border-red-700 dark:bg-red-900/20">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200">{error}</p>
              <button
                type="button"
                onClick={retryConnection}
                className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Reload
              </button>
            </div>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <ErrorState message={error} onRetry={refresh} />
          </div>
        ) : null}

        {clusters.length === 0 || showWelcomePage ? (
          <WelcomeScreen onClose={showWelcomePage ? () => setShowWelcomePage(false) : undefined} />
        ) : snapshot && !connectionFailed && performanceData ? (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 px-4 pt-4 pb-4">
            {/* Cluster Overview */}
          <section className="grid grid-cols-7 gap-2 flex-shrink-0">
            <div
                className={`flex h-20 flex-col justify-center items-center rounded-lg px-3 py-2 text-center shadow-lg ${
                snapshot.health.status === 'green'
                  ? 'bg-gradient-to-br from-emerald-500 to-green-600'
                  : snapshot.health.status === 'yellow'
                    ? 'bg-gradient-to-br from-amber-500 to-yellow-600'
                    : snapshot.health.status === 'red'
                      ? 'bg-gradient-to-br from-red-600 to-rose-700'
                      : 'bg-gradient-to-br from-gray-500 to-gray-600'
              }`}
            >
                <div className="text-2xl font-bold uppercase tracking-wider text-white">
                {snapshot.health.status}
              </div>
                <div className="text-xs font-medium uppercase tracking-wide text-white/80">
                Cluster Status
                </div>
              </div>
              <div className="flex h-20 flex-col justify-center items-center rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 px-3 py-2 text-center shadow-lg">
                <div className="text-2xl font-bold text-white">
                  {clusterInfo?.nodeCount || 0}
                </div>
                <div className="text-xs font-medium text-blue-100">Nodes</div>
              </div>
              <div className="flex h-20 flex-col justify-center items-center rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 px-3 py-2 text-center shadow-lg">
                <div className="text-2xl font-bold text-white">
                  {clusterInfo?.indexCount || 0}
                </div>
                <div className="text-xs font-medium text-purple-100">Indices</div>
                  </div>
              <div className="flex h-20 flex-col justify-center items-center rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 px-3 py-2 text-center shadow-lg">
                <div className="text-2xl font-bold text-white">
                  {snapshot.health.active_shards}
                </div>
                <div className="text-xs font-medium text-indigo-100">Active Shards</div>
            </div>
            
            {/* CPU Usage */}
            <div className={`flex h-20 items-center rounded-lg bg-gradient-to-br from-orange-500 to-red-600 px-3 py-2 shadow-lg transition-all duration-300 ${getAlertClasses(getResourceAlertLevel('cpu'))}`}>
              <div className="flex items-center gap-3 w-full">
                <Cpu className="h-5 w-5 text-white/90 flex-shrink-0" />
                <div className="flex flex-col justify-center gap-1 flex-1">
                  <div className="text-lg font-bold text-white">
                    {clusterResources?.cpuUsage?.toFixed(0) || 0}%
                  </div>
                  <div className="w-full bg-white/20 rounded-full h-1.5">
                    <div 
                      className="bg-white rounded-full h-1.5 transition-all duration-300"
                      style={{ width: `${Math.min(clusterResources?.cpuUsage || 0, 100)}%` }}
                    />
                  </div>
                  <div className="text-xs font-medium text-white/80">CPU</div>
                </div>
              </div>
            </div>

            {/* JVM Heap */}
            <div className={`flex h-20 items-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 px-3 py-2 shadow-lg transition-all duration-300 ${getAlertClasses(getResourceAlertLevel('jvm'))}`}>
              <div className="flex items-center gap-3 w-full">
                <Database className="h-5 w-5 text-white/90 flex-shrink-0" />
                <div className="flex flex-col justify-center gap-1 flex-1">
                  <div className="text-lg font-bold text-white">
                    {clusterResources?.jvmHeap?.toFixed(0) || 0}%
                  </div>
                  <div className="w-full bg-white/20 rounded-full h-1.5">
                    <div 
                      className="bg-white rounded-full h-1.5 transition-all duration-300"
                      style={{ width: `${Math.min(clusterResources?.jvmHeap || 0, 100)}%` }}
                    />
                  </div>
                  <div className="text-xs font-medium text-white/80">JVM Heap</div>
                </div>
              </div>
            </div>

            {/* Storage */}
            <div className={`flex h-20 items-center rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 px-3 py-2 shadow-lg transition-all duration-300 ${getAlertClasses(getResourceAlertLevel('storage'))}`}>
              <div className="flex items-center gap-3 w-full">
                <HardDrive className="h-5 w-5 text-white/90 flex-shrink-0" />
                <div className="flex flex-col justify-center gap-1 flex-1">
                  <div className="text-lg font-bold text-white">
                    {clusterResources?.storagePercent?.toFixed(0) || 0}%
                  </div>
                  <div className="w-full bg-white/20 rounded-full h-1.5">
                    <div 
                      className="bg-white rounded-full h-1.5 transition-all duration-300"
                      style={{ width: `${Math.min(clusterResources?.storagePercent || 0, 100)}%` }}
                    />
                  </div>
                  <div className="text-xs font-medium text-white/80">
                    {clusterResources ? 
                      `${formatBytes(clusterResources.storageUsed)} / ${formatBytes(clusterResources.storageTotal)}` 
                      : 'Storage'
                    }
                  </div>
                </div>
              </div>
            </div>
          </section>

            {/* Cluster Statistics */}
            <section className="rounded-lg border border-gray-300 bg-white shadow-lg dark:bg-gray-800 dark:border-gray-600">
              <div className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Cluster Statistics
                  </h2>
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
                        <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">Calculations</h3>
                        <p className="text-xs">Rates show operations per second. Latencies show average time per operation.</p>
                      </div>
                    </div>
                  </InfoPopup>
                </div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
                <MetricCard
                  title="Indexing Rate"
                  value={performanceData.metrics.indexingRate}
                  unit="/sec"
                  data={[]}
                  dataKey="indexingRate"
                  color="#10b981"
                  icon={<TrendingUp className="h-4 w-4" />}
                />
                <MetricCard
                  title="Search Rate"
                  value={performanceData.metrics.searchRate}
                  unit="/sec"
                  data={[]}
                  dataKey="searchRate"
                  color="#06b6d4"
                  icon={<Activity className="h-4 w-4" />}
                />
                <MetricCard
                  title="Index Latency"
                  value={performanceData.metrics.indexLatency}
                  unit="ms"
                  data={[]}
                  dataKey="indexLatency"
                  color="#f59e0b"
                  icon={<Clock className="h-4 w-4" />}
                />
                <MetricCard
                  title="Search Latency"
                  value={performanceData.metrics.searchLatency}
                  unit="ms"
                  data={[]}
                  dataKey="searchLatency"
                  color="#ef4444"
                  icon={<Zap className="h-4 w-4" />}
                />
              </div>
            </section>

            {/* Tables - stacked vertically */}
            <section className="grid grid-cols-1 gap-4 min-h-0 flex-1">
              <div className="flex flex-col rounded-lg border border-gray-300 bg-white shadow-lg dark:bg-gray-800 dark:border-gray-600">
                <div className="flex-1 p-4">
                  <IndexTable
                    data={performanceData.indices}
                    indexStats={snapshot?.indexStats}
                    prevIndexStats={prevSnapshot?.indexStats}
                    fetchedAt={snapshot?.fetchedAt}
                    prevFetchedAt={prevSnapshot?.fetchedAt}
                    pollIntervalMs={pollInterval}
                  />
                </div>
              </div>

              <div className="flex flex-col rounded-lg border border-gray-300 bg-white shadow-lg dark:bg-gray-800 dark:border-gray-600">
                <div className="flex-1 p-4">
                  {snapshot?.nodeStats && (
                    <NodeTable nodeStats={snapshot.nodeStats} nodes={snapshot.nodes} />
                  )}
                </div>
              </div>
            </section>
            </div>
          </>
        ) : null}
        </div>

        {/* Alert Management Panel - Right Side */}
        {showAlertManagement && activeCluster && (
          <div className="w-[480px] min-h-0 flex flex-col overflow-y-auto border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
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
      </div>
      
      <Footer />
    </main>
  );
}