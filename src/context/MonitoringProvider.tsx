import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { toast } from 'sonner';
import { apiConfig } from '@/config/api';
import {
  getNodeStats,
  getIndexStats,
  getIndices,
  getClusterHealth,
  getClusterHealthFull,
  getNodes,
  getHealthReport,
  getCatNodesExtended,
  getCatNodeAttrs,
  getClusterSettings,
  checkClusterHealth,
  getNetworkErrorMessage,
  getSnapshotRepositories,
  getSnapshotAll,
} from '@/services/elasticsearch';
import { PerformanceTracker } from '@/utils/performanceTracker';
import { alertEngine } from '@/utils/alertEngine';
import type {
  CatHealthRow,
  CatNodeAttrsRow,
  CatNodeExtendedRow,
  ClusterHealth,
  ClusterStatus,
  MonitoringSnapshot,
  PerformanceMetrics,
  ChartDataPoint,
  SnapshotInfo
} from '@/types/api';
import type { ClusterConnection, CreateClusterInput } from '@/types/app';
import type { AlertInstance, AlertRule, AlertSettings, AlertStats } from '../types/alerts';
import { getStoredValue, setStoredValue } from '@/utils/storage';
import { formatAlertValue } from '@/utils/format';

const POLL_STORAGE_KEY = 'eum/poll-interval';
const CLUSTERS_STORAGE_KEY = 'eum/clusters';
const ACTIVE_CLUSTER_KEY = 'eum/active-cluster';

type MonitoringContextValue = {
  snapshot: MonitoringSnapshot | null;
  prevSnapshot: MonitoringSnapshot | null;
  performanceMetrics: PerformanceMetrics;
  chartData: ChartDataPoint[];
  healthHistory: CatHealthRow[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  // Alert system
  alerts: AlertInstance[];
  alertStats: AlertStats;
  alertRules: AlertRule[];
  alertSettings: AlertSettings;
  connectionFailed: boolean;
  /** Set when background health check or fetch fails; show "Network error..." + Reload (ElasticVue-style). */
  connectionLost: boolean;
  connectionLostUri: string | null;
  lastUpdated: string | null;
  refresh: () => Promise<void>;
  retryConnection: () => Promise<void>;
  pollInterval: number;
  setPollInterval: (ms: number) => void;
  /** When false, auto-refresh (polling) does not run. App sets this from current tab (only true for Indexing & Search). */
  setPollingEnabled: (enabled: boolean) => void;
  statusSummary: Record<ClusterStatus, number>;
  clusters: ClusterConnection[];
  activeCluster: ClusterConnection | null;
  setActiveCluster: (clusterLabel: string) => void;
  addCluster: (input: CreateClusterInput) => Promise<void>;
  updateCluster: (clusterLabel: string, input: CreateClusterInput) => void;
  updateClusterUuid: (clusterLabel: string, cluster_uuid: string) => void;
  updateClusterName: (clusterLabel: string, cluster_name: string) => void;
  deleteCluster: (clusterLabel: string) => void;
  reorderClusters: (reordered: ClusterConnection[]) => void;
  // Alert management
  snoozeAlert: (alertId: string, minutes: number) => void;
  dismissAlert: (alertId: string) => void;
  updateAlertRule: (ruleId: string, updates: Partial<AlertRule>) => void;
  updateAlertSettings: (updates: Partial<AlertSettings>) => void;
  resetAlertsToDefaults: () => void;
  getAlertHistory: () => AlertInstance[];
  clearAlertHistory: () => void;
  // Nodes tab (same data as fetchAlerts catNodesExtended; updated by fetchAlerts and refreshNodes)
  catNodesExtended: CatNodeExtendedRow[] | null;
  /** Node id -> list of { attr, value } from GET _cat/nodeattrs */
  nodeAttrsByNodeId: Record<string, Array<{ attr: string; value: string }>> | null;
  nodesLoading: boolean;
  nodesError: string | null;
  refreshNodes: () => Promise<void>;
};

const MonitoringContext = createContext<MonitoringContextValue | undefined>(undefined);

function mergeHealthHistory(
  prev: CatHealthRow[],
  incoming: CatHealthRow[]
): CatHealthRow[] {
  const merged = new Map<string, CatHealthRow>();

  [...prev, ...incoming].forEach((item) => {
    merged.set(item.timestamp, item);
  });

  return Array.from(merged.values())
    .sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    .slice(-40);
}

/** Group _cat/nodeattrs rows by node id for lookup in Nodes tab */
function groupNodeAttrs(rows: CatNodeAttrsRow[]): Record<string, Array<{ attr: string; value: string }>> {
  const byId: Record<string, Array<{ attr: string; value: string }>> = {};
  for (const row of rows) {
    const id = row.id ?? row.node ?? '';
    if (!id) continue;
    if (!byId[id]) byId[id] = [];
    const attr = row.attr ?? '';
    const value = row.value ?? '';
    if (attr) byId[id].push({ attr, value });
  }
  return byId;
}

/** Build a single CatHealthRow from cluster health for health history (replaces /_cat/health response) */
function clusterHealthToCatRow(health: ClusterHealth, fetchedAt: string): CatHealthRow {
  return {
    epoch: '',
    timestamp: fetchedAt,
    cluster: health.cluster_name,
    status: health.status,
    'node.total': String(health.number_of_nodes ?? 0),
    'node.data': '',
    shards: String(health.active_shards ?? 0),
    pri: '',
    relo: '',
    init: '',
    unassign: '',
    pending_tasks: '',
    max_task_wait_time: '',
    active_shards_percent: ''
  };
}

export function MonitoringProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics>({
    indexingRate: 0,
    searchRate: 0,
    indexLatency: 0,
    searchLatency: 0
  });
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [healthHistory, setHealthHistory] = useState<CatHealthRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [connectionLostUri, setConnectionLostUri] = useState<string | null>(null);
  const [pollInterval, setPollIntervalState] = useState<number>(() =>
    getStoredValue(POLL_STORAGE_KEY, apiConfig.pollIntervalMs)
  );
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [clusters, setClusters] = useState<ClusterConnection[]>(() =>
    getStoredValue(CLUSTERS_STORAGE_KEY, [] as ClusterConnection[])
  );
  const [activeClusterLabel, setActiveClusterLabel] = useState(() =>
    getStoredValue<string>(ACTIVE_CLUSTER_KEY, '')
  );
  const lastUpdatedRef = useRef<string | null>(null);
  const performanceTrackerRef = useRef<PerformanceTracker>(new PerformanceTracker());
  const prevSnapshotRef = useRef<MonitoringSnapshot | null>(null);
  const snapshotRef = useRef<MonitoringSnapshot | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const alertAbortControllerRef = useRef<AbortController | null>(null);
  const alertPerformanceTrackerRef = useRef<PerformanceTracker>(new PerformanceTracker());
  /** When true, skip health_report (ES 7.x returns 400). Reset on cluster change. */
  const healthReportUnsupportedRef = useRef(false);

  // Alert system state
  const [alerts, setAlerts] = useState<AlertInstance[]>([]);
  const [alertStats, setAlertStats] = useState<AlertStats>(() => alertEngine.getAlertStats());
  const [alertRules, setAlertRules] = useState<AlertRule[]>(() => alertEngine.getRules());
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(() => alertEngine.getSettings());

  // Nodes tab: same API as fetchAlerts getCatNodesExtended; updated by fetchAlerts and refreshNodes
  const [catNodesExtended, setCatNodesExtended] = useState<CatNodeExtendedRow[] | null>(null);
  const [nodeAttrsByNodeId, setNodeAttrsByNodeId] = useState<Record<string, Array<{ attr: string; value: string }>> | null>(null);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [nodesError, setNodesError] = useState<string | null>(null);

  // Keep snapshotRef in sync with snapshot state
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  // Cluster metrics are updated only in fetchAll via addSnapshot; no duplicate add on snapshot change
  const healthCheckDoneRef = useRef<boolean>(false);
  const autoRetryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  const activeCluster =
    clusters.find((cluster) => cluster.label === activeClusterLabel) ?? clusters[0] ?? null;
  
  useEffect(() => {
    setStoredValue(CLUSTERS_STORAGE_KEY, clusters);
  }, [clusters]);
  
  useEffect(() => {
    if (activeCluster) {
      setStoredValue(ACTIVE_CLUSTER_KEY, activeCluster.label);
    } else {
      setStoredValue(ACTIVE_CLUSTER_KEY, '');
    }
  }, [activeCluster]);
  
  const fetchAll = useCallback(async () => {
    let controller: AbortController | null = null;
    try {
      if (!activeCluster) {
        setError(null);
        setLoading(false);
        setRefreshing(false);
        setConnectionFailed(false);
        return;
      }
      
      if (connectionFailed) {
        return;
      }
      
      // Cancel any ongoing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      
      // Create new abort controller for this request
      controller = new AbortController();
      abortControllerRef.current = controller;
      const signal = controller.signal;
      
      setRefreshing(true);
      setError(null);
      setConnectionFailed(false);
      // Indexing & Search tab only: nodeStats, indexStats, indices, health, nodes (no snapshots)
      const [nodeStats, indexStats, indices, health, nodes] = await Promise.all([
        getNodeStats(activeCluster, signal),
        getIndexStats(activeCluster, signal),
        getIndices(activeCluster, signal),
        getClusterHealth(activeCluster, signal),
        getNodes(activeCluster, signal)
      ]);

      const performanceMetrics = performanceTrackerRef.current.addSnapshot(nodeStats, null, indexStats, null);
      const chartData = performanceTrackerRef.current.getChartData();

      const fetchedAt = new Date().toISOString();
      lastUpdatedRef.current = fetchedAt;

      const newSnapshot: MonitoringSnapshot = {
        nodeStats,
        indexStats,
        indices,
        performanceMetrics,
        health,
        nodes,
        settings: { persistent: {}, transient: {} },
        fetchedAt
      };

      prevSnapshotRef.current = snapshotRef.current;
      snapshotRef.current = newSnapshot;
      setSnapshot(newSnapshot);

      setPerformanceMetrics(performanceMetrics);
      setChartData(chartData);
      setHealthHistory((prev) =>
        mergeHealthHistory(prev, [clusterHealthToCatRow(health, fetchedAt)])
      );
      setConnectionFailed(false);
      setConnectionLost(false);
      setConnectionLostUri(null);

      // Run alert evaluation for resolution (cluster status etc.) - fetchAll has health data, so we can resolve immediately when cluster turns green
      try {
        alertEngine.evaluateAlerts(newSnapshot, activeCluster?.label);
        setAlerts(alertEngine.getActiveAlerts());
        setAlertStats(alertEngine.getAlertStats());
      } catch (alertErr) {
        console.error('Alert evaluation failed:', alertErr);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setRefreshing(false);
        return;
      }

      let message = err instanceof Error ? err.message : 'Unknown error occurred';
      if (message.toLowerCase().includes('fetch') &&
          (message.toLowerCase().includes('failed') || message.toLowerCase().includes('error'))) {
        message = 'Network error';
      }

      const isTimeoutOrNetwork =
        message.toLowerCase().includes('timeout') ||
        message.toLowerCase().includes('network error');

      if (activeCluster) {
        const uri = activeCluster.baseUrl.replace(/\/$/, '');
        const userMessage = `Network error, cannot access your cluster. Cluster uri: ${uri}`;
        if (isTimeoutOrNetwork) {
          setError(userMessage);
          setConnectionFailed(true);
          setConnectionLost(true);
          setConnectionLostUri(uri);
        } else {
          setError(message);
          setConnectionFailed(true);
        }
      } else {
        setError(message);
        setConnectionFailed(true);
      }

      if (!message.toLowerCase().includes('mock')) {
        toast.error('Data refresh failed', { description: message });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      // Clear ref only if this fetch still owns it (avoid clearing when cluster changed and new fetch started)
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [activeCluster, connectionFailed]);

  /** Alert-only fetch: runs every 1 min, fetches all APIs with _alert=1, evaluates alerts. Completely separate from fetchAll. */
  const fetchAlerts = useCallback(async () => {
    if (!activeCluster || connectionFailed) return;
    let controller: AbortController | null = null;
    try {
      if (alertAbortControllerRef.current) {
        alertAbortControllerRef.current.abort();
      }
      controller = new AbortController();
      alertAbortControllerRef.current = controller;
      const signal = controller.signal;

      const [nodeStats, indexStats, indices, health, healthReport, catNodesExtended, clusterSettings, nodeAttrsRows] = await Promise.all([
        getNodeStats(activeCluster, signal),
        getIndexStats(activeCluster, signal),
        getIndices(activeCluster, signal),
        getClusterHealthFull(activeCluster, signal),
        getHealthReport(activeCluster, signal, healthReportUnsupportedRef),
        getCatNodesExtended(activeCluster, signal),
        getClusterSettings(activeCluster, signal),
        getCatNodeAttrs(activeCluster, signal)
      ]);

      // Derive NodeInfo[] from catNodesExtended so we don't call GET _cat/nodes twice (was getNodes + getCatNodesExtended)
      const nodesFromCat = Array.isArray(catNodesExtended)
        ? catNodesExtended.map((row) => ({
            nodeRole: row['node.role'] ?? '',
            name: row.name ?? '',
            ip: row.ip,
            version: row.version
          }))
        : [];

      const performanceMetrics = alertPerformanceTrackerRef.current.addSnapshot(nodeStats, null, indexStats, null);
      const fetchedAt = new Date().toISOString();

      let snapshots: SnapshotInfo[] | undefined;
      try {
        const repos = await getSnapshotRepositories(activeCluster, signal);
        snapshots = [];
        for (const repo of repos) {
          const resp = await getSnapshotAll(activeCluster, repo, signal, { size: 1, order: 'desc' });
          snapshots = snapshots.concat(resp.snapshots ?? []);
        }
      } catch {
        snapshots = undefined;
      }

      const alertSnapshot: MonitoringSnapshot = {
        nodeStats,
        indexStats,
        indices,
        performanceMetrics,
        health,
        nodes: nodesFromCat,
        settings: { persistent: {}, transient: {} },
        fetchedAt,
        snapshots,
        healthReport: healthReport ?? undefined,
        catNodesExtended: Array.isArray(catNodesExtended) ? catNodesExtended : undefined,
        clusterSettings: clusterSettings ?? undefined
      };

      const newAlerts = alertEngine.evaluateAlerts(alertSnapshot, activeCluster.label);
      const activeAlerts = alertEngine.getActiveAlerts();
      const stats = alertEngine.getAlertStats();
      setAlerts(activeAlerts);
      setAlertStats(stats);
      setCatNodesExtended(Array.isArray(catNodesExtended) ? catNodesExtended : []);
      setNodeAttrsByNodeId(groupNodeAttrs(Array.isArray(nodeAttrsRows) ? nodeAttrsRows : []));

      newAlerts.forEach((alert) => {
        if (alert.severity === 'critical') {
          toast.error(`Critical Alert: ${alert.ruleName}`, {
            description: `${alert.description} (${formatAlertValue(alert.currentValue as number, alert.unit)})`,
            duration: 10000
          });
        }
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Alert fetch failed:', err);
    } finally {
      if (alertAbortControllerRef.current === controller) {
        alertAbortControllerRef.current = null;
      }
    }
  }, [activeCluster, connectionFailed]);

  const refreshNodes = useCallback(async () => {
    if (!activeCluster) return;
    setNodesLoading(true);
    setNodesError(null);
    try {
      const [data, attrsRows] = await Promise.all([
        getCatNodesExtended(activeCluster),
        getCatNodeAttrs(activeCluster)
      ]);
      setCatNodesExtended(Array.isArray(data) ? data : []);
      setNodeAttrsByNodeId(groupNodeAttrs(Array.isArray(attrsRows) ? attrsRows : []));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load nodes';
      const isTimeoutOrNetwork =
        msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
      setNodesError(
        isTimeoutOrNetwork ? getNetworkErrorMessage(activeCluster.baseUrl) : msg
      );
      setCatNodesExtended([]);
      setNodeAttrsByNodeId(null);
    } finally {
      setNodesLoading(false);
    }
  }, [activeCluster]);

  const retryConnection = useCallback(async () => {
    if (!activeCluster) {
      return;
    }
    
    if (autoRetryIntervalRef.current) {
      clearInterval(autoRetryIntervalRef.current);
      autoRetryIntervalRef.current = null;
    }
    
    healthCheckDoneRef.current = false;
    
    setLoading(true);
    setError(null);
    setConnectionFailed(false);
    setConnectionLost(false);
    setConnectionLostUri(null);

    const healthResult = await checkClusterHealth(activeCluster);

    if (!healthResult.success) {
      setConnectionFailed(true);
      setConnectionLost(true);
      setConnectionLostUri(activeCluster.baseUrl.replace(/\/$/, ''));
      const baseMsg = healthResult.error || 'Network error, cannot access your cluster.';
      const uri = healthResult.clusterUri ?? activeCluster.baseUrl;
      setError(uri ? `${baseMsg} Cluster uri: ${uri}` : baseMsg);
      setLoading(false);

      autoRetryIntervalRef.current = setInterval(async () => {
        if (!activeCluster) {
          if (autoRetryIntervalRef.current) {
            clearInterval(autoRetryIntervalRef.current);
            autoRetryIntervalRef.current = null;
          }
          return;
        }
        
        const autoHealthResult = await checkClusterHealth(activeCluster);
        if (autoHealthResult.success) {
          if (autoRetryIntervalRef.current) {
            clearInterval(autoRetryIntervalRef.current);
            autoRetryIntervalRef.current = null;
          }
          setConnectionFailed(false);
          healthCheckDoneRef.current = true;
          await fetchAll();
        }
      }, 60000);
      
      return;
    }
    
    setConnectionFailed(false);
    healthCheckDoneRef.current = true;
    await fetchAll();
  }, [activeCluster, fetchAll]);
  
  // Initial load
  useEffect(() => {
    if (healthCheckDoneRef.current) {
      return;
    }
    
    const timer = setTimeout(async () => {
      if (!activeCluster) {
        setError(null);
        setConnectionFailed(false);
        return;
      }
      
      healthCheckDoneRef.current = true;
      
      setLoading(true);
      setError(null);
      const healthResult = await checkClusterHealth(activeCluster);
      
      if (!healthResult.success) {
        setConnectionFailed(true);
        setConnectionLost(true);
        setConnectionLostUri(activeCluster.baseUrl.replace(/\/$/, ''));
        const baseMsg = healthResult.error || 'Network error, cannot access your cluster.';
        const uri = healthResult.clusterUri ?? activeCluster.baseUrl;
        setError(uri ? `${baseMsg} Cluster uri: ${uri}` : baseMsg);
        setLoading(false);

        if (!autoRetryIntervalRef.current) {
          autoRetryIntervalRef.current = setInterval(async () => {
            if (!activeCluster) {
              if (autoRetryIntervalRef.current) {
                clearInterval(autoRetryIntervalRef.current);
                autoRetryIntervalRef.current = null;
              }
              return;
            }
            
            const autoHealthResult = await checkClusterHealth(activeCluster);
            if (autoHealthResult.success) {
              if (autoRetryIntervalRef.current) {
                clearInterval(autoRetryIntervalRef.current);
                autoRetryIntervalRef.current = null;
              }
              setConnectionFailed(false);
              healthCheckDoneRef.current = true;
              await fetchAll();
            }
          }, 60000);
        }
        
        return;
      }
      
      setConnectionFailed(false);
      await fetchAll();
    }, 100);
    
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCluster]);
  
  // Auto-refresh when cluster changes
  const prevActiveClusterLabelRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevActiveClusterLabelRef.current === null) {
      prevActiveClusterLabelRef.current = activeClusterLabel;
      return;
    }
    
    if (prevActiveClusterLabelRef.current !== activeClusterLabel && activeCluster) {
      prevActiveClusterLabelRef.current = activeClusterLabel;
      
      // Clear all previous states immediately
      setSnapshot(null);
      setPerformanceMetrics({
        indexingRate: 0,
        searchRate: 0,
        indexLatency: 0,
        searchLatency: 0
      });
      setChartData([]);
      setHealthHistory([]);
      setCatNodesExtended(null);
      setNodeAttrsByNodeId(null);
      setNodesError(null);

      // Clear connection states
      setConnectionFailed(false);
      setConnectionLost(false);
      setConnectionLostUri(null);
      setError(null);
      setLoading(false);
      setRefreshing(false);

      // Clear health check state
      healthCheckDoneRef.current = false;
      
      // Cancel any ongoing requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (alertAbortControllerRef.current) {
        alertAbortControllerRef.current.abort();
        alertAbortControllerRef.current = null;
      }

      // Reset alert performance tracker and unsupported flags for new cluster
      alertPerformanceTrackerRef.current = new PerformanceTracker();
      healthReportUnsupportedRef.current = false;

      // Clear auto retry if running
      if (autoRetryIntervalRef.current) {
        clearInterval(autoRetryIntervalRef.current);
        autoRetryIntervalRef.current = null;
      }
      
      // Reset performance tracker for new cluster: clear storage so the new tracker
      // does not load the previous cluster's history (would mix totals and cause huge Search Rate spikes).
      try {
        sessionStorage.removeItem('elasticsearch-performance-data');
      } catch {
        // ignore
      }
      performanceTrackerRef.current = new PerformanceTracker();

      // Fetch new cluster data (fetchAlerts runs from its own effect with delay)
      fetchAll();
    }
  }, [activeClusterLabel, activeCluster, fetchAll]);

  // Alert fetch: runs every 1 min, completely separate from metrics fetchAll. First run delayed 2s to avoid initial burst.
  const alertIntervalMs = apiConfig.alertIntervalMs ?? 60000;
  const ALERT_INITIAL_DELAY_MS = 2000;
  useEffect(() => {
    if (connectionFailed || !activeCluster) return;
    const delayId = setTimeout(() => fetchAlerts(), ALERT_INITIAL_DELAY_MS);
    const intervalId = setInterval(fetchAlerts, alertIntervalMs);
    return () => {
      clearTimeout(delayId);
      clearInterval(intervalId);
    };
  }, [fetchAlerts, connectionFailed, activeCluster, alertIntervalMs]);

  // Polling: runs only when Indexing & Search tab is active (App controls via setPollingEnabled)
  useEffect(() => {
    if (connectionFailed || !activeCluster || pollInterval === 0 || !pollingEnabled) {
      return;
    }
    const interval = setInterval(() => {
      fetchAll();
    }, pollInterval);
    return () => clearInterval(interval);
  }, [fetchAll, pollInterval, connectionFailed, activeCluster, pollingEnabled]);

  // Background health check every 30s (ElasticVue-style): if it fails, show "Network error..."; when it succeeds again, refresh data
  const healthCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectionWasLostRef = useRef(false);
  useEffect(() => {
    if (!activeCluster) {
      connectionWasLostRef.current = false;
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
        healthCheckIntervalRef.current = null;
      }
      return;
    }
    const intervalMs = apiConfig.healthCheckIntervalMs ?? 30000;
    healthCheckIntervalRef.current = setInterval(async () => {
      const result = await checkClusterHealth(activeCluster);
      if (!result.success) {
        connectionWasLostRef.current = true;
        setConnectionLost(true);
        setConnectionLostUri(activeCluster.baseUrl.replace(/\/$/, ''));
      } else {
        const health = result.health;
        if (health) {
          const fetchedAt = new Date().toISOString();
          setSnapshot((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              // Keep original metrics fetch timestamp so rate calculations
              // continue using real stats-to-stats intervals.
              health
            };
          });
          setHealthHistory((prev) =>
            mergeHealthHistory(prev, [clusterHealthToCatRow(health, fetchedAt)])
          );
        }
        const wasLost = connectionWasLostRef.current;
        setConnectionLost(false);
        setConnectionLostUri(null);
        setConnectionFailed(false);
        setError(null);
        connectionWasLostRef.current = false;
        if (wasLost) {
          await fetchAll();
        }
      }
    }, intervalMs);
    return () => {
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
        healthCheckIntervalRef.current = null;
      }
    };
  }, [activeCluster, fetchAll]);

  // Auto-retry when back online or when user returns to the tab (e.g. after laptop sleep / network change)
  useEffect(() => {
    if (!activeCluster) {
      return;
    }

    const tryRecover = () => {
      if (connectionFailed || error) {
        retryConnection();
      }
    };

    const handleOnline = () => tryRecover();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        tryRecover();
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeCluster, connectionFailed, error, retryConnection]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (autoRetryIntervalRef.current) {
        clearInterval(autoRetryIntervalRef.current);
        autoRetryIntervalRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [activeCluster]);
  
  const addCluster = useCallback(async (input: CreateClusterInput) => {
    try {
      const sanitizedBaseUrl = input.baseUrl.trim().replace(/\/$/, '');
      const clusterLabel = (input.label || sanitizedBaseUrl).trim();

      const authType = input.authType ?? (input.apiKey?.trim() ? 'apiKey' : input.username && input.password ? 'basic' : 'none');
      const newCluster: ClusterConnection = {
        label: clusterLabel,
        baseUrl: sanitizedBaseUrl,
        authType,
        username: input.username?.trim() || '',
        password: input.password?.trim() || '',
        apiKey: input.apiKey?.trim() || '',
        cluster_uuid: input.cluster_uuid,
        category: input.category
      };

      // Fetch health once to get cluster_name and cluster_uuid and persist with the cluster
      try {
        const health = await getClusterHealth(newCluster);
        if (health.cluster_name) newCluster.cluster_name = health.cluster_name;
        if (health.cluster_uuid) newCluster.cluster_uuid = health.cluster_uuid;
      } catch {
        // Still add cluster; uuid will be filled when health is fetched later (e.g. in dropdown)
      }

      setClusters((prev) => {
        const exists = prev.some((c) => c.label === newCluster.label);
        if (exists) {
          return prev.map((c) => (c.label === newCluster.label ? newCluster : c));
        }
        return [...prev, newCluster];
      });
      setActiveClusterLabel(newCluster.label);

      toast.success('Cluster added', {
        description: `${newCluster.label} is now active.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add cluster';
      toast.error('Failed to add cluster', { description: message });
      throw error;
    }
  }, []);
  
  const updateCluster = useCallback((clusterLabel: string, input: CreateClusterInput) => {
    const sanitizedBaseUrl = input.baseUrl.trim().replace(/\/$/, '');
    const newLabel = input.label || sanitizedBaseUrl;

    const authType = input.authType ?? (input.apiKey?.trim() ? 'apiKey' : input.username && input.password ? 'basic' : 'none');
    setClusters((prev) =>
      prev.map((cluster) => {
        if (cluster.label !== clusterLabel) return cluster;
        const baseUrlChanged = cluster.baseUrl !== sanitizedBaseUrl;
        return {
          ...cluster,
          label: newLabel,
          baseUrl: sanitizedBaseUrl,
          authType,
          username: input.username?.trim() || '',
          password: input.password?.trim() || '',
          apiKey: input.apiKey?.trim() || '',
          cluster_name: baseUrlChanged ? undefined : (input.cluster_name ?? cluster.cluster_name),
          // Keep stored cluster_uuid unless URL changed (new cluster = new uuid)
          cluster_uuid: baseUrlChanged ? undefined : (input.cluster_uuid ?? cluster.cluster_uuid),
          category: input.category
        };
      })
    );

    if (activeClusterLabel === clusterLabel) {
      setActiveClusterLabel(newLabel);
    }

    toast.success('Cluster updated', {
      description: `${newLabel} has been updated.`
    });
  }, [activeClusterLabel]);

  const updateClusterUuid = useCallback((clusterLabel: string, cluster_uuid: string) => {
    setClusters((prev) =>
      prev.map((c) => (c.label === clusterLabel ? { ...c, cluster_uuid } : c))
    );
  }, []);

  const updateClusterName = useCallback((clusterLabel: string, cluster_name: string) => {
    setClusters((prev) =>
      prev.map((c) => (c.label === clusterLabel ? { ...c, cluster_name } : c))
    );
  }, []);

  const deleteCluster = useCallback(
    (clusterLabel: string) => {
      const clusterToDelete = clusters.find((c) => c.label === clusterLabel);
      if (clusters.length === 1) {
        toast.error('Cannot delete', {
          description: 'At least one cluster must remain.'
        });
        return;
      }
      
      setClusters((prev) => prev.filter((c) => c.label !== clusterLabel));
      if (activeClusterLabel === clusterLabel) {
        const remaining = clusters.filter((c) => c.label !== clusterLabel);
        setActiveClusterLabel(remaining[0]?.label ?? '');
      }
      toast.success('Cluster deleted', {
        description: clusterToDelete ? `${clusterToDelete.label} has been removed.` : undefined
      });
    },
    [clusters, activeClusterLabel]
  );
  
  const value = useMemo<MonitoringContextValue>(() => {
    const statusSummary: Record<ClusterStatus, number> = {
      green: 0,
      yellow: 0,
      red: 0,
      unknown: 0
    };
    
    healthHistory.forEach((row) => {
      statusSummary[row.status] = statusSummary[row.status] + 1;
    });
    
    return {
      snapshot,
      prevSnapshot: prevSnapshotRef.current,
      performanceMetrics,
      chartData,
      healthHistory,
      loading,
      refreshing,
      error,
      connectionFailed,
      connectionLost,
      connectionLostUri,
      lastUpdated: lastUpdatedRef.current,
      refresh: fetchAll,
      retryConnection,
      pollInterval,
      setPollInterval: (ms: number) => {
        const safeValue = ms === 0 ? 0 : Math.min(Math.max(ms, 3000), 60000);
        setPollIntervalState(safeValue);
        setStoredValue(POLL_STORAGE_KEY, safeValue);
      },
      setPollingEnabled,
      statusSummary,
      clusters,
      activeCluster,
      setActiveCluster: (clusterLabel: string) => {
        // Cancel any ongoing requests first
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        
        // Clear auto retry if running
        if (autoRetryIntervalRef.current) {
          clearInterval(autoRetryIntervalRef.current);
          autoRetryIntervalRef.current = null;
        }
        
        // Reset all states
        setActiveClusterLabel(clusterLabel);
        healthCheckDoneRef.current = false;
        setConnectionFailed(false);
        setConnectionLost(false);
        setConnectionLostUri(null);
        setError(null);
        setLoading(false);
        setRefreshing(false);
      },
      addCluster,
      updateCluster,
      updateClusterUuid,
      updateClusterName,
      deleteCluster,
      reorderClusters: (reordered: ClusterConnection[]) => setClusters(reordered),
      // Alert system
      alerts,
      alertStats,
      alertRules,
      alertSettings,
      snoozeAlert: (alertId: string, minutes: number) => {
        alertEngine.snoozeAlert(alertId, minutes);
        setAlerts(alertEngine.getActiveAlerts());
        setAlertStats(alertEngine.getAlertStats());
      },
      dismissAlert: (alertId: string) => {
        alertEngine.dismissAlert(alertId);
        setAlerts(alertEngine.getActiveAlerts());
        setAlertStats(alertEngine.getAlertStats());
      },
      updateAlertRule: (ruleId: string, updates: Partial<AlertRule>) => {
        alertEngine.updateRule(ruleId, updates);
        setAlertRules(alertEngine.getRules());
      },
      updateAlertSettings: (updates: Partial<AlertSettings>) => {
        alertEngine.updateSettings(updates);
        setAlertSettings(alertEngine.getSettings());
      },
      resetAlertsToDefaults: () => {
        alertEngine.resetToDefaults();
        setAlertRules(alertEngine.getRules());
        setAlertSettings(alertEngine.getSettings());
        setAlerts(alertEngine.getActiveAlerts());
        setAlertStats(alertEngine.getAlertStats());
      },
      getAlertHistory: () => alertEngine.getAlertHistory(),
      clearAlertHistory: () => {
        alertEngine.clearAlertHistory();
        // No need to update state as history is fetched on demand
      },
      catNodesExtended,
      nodeAttrsByNodeId,
      nodesLoading,
      nodesError,
      refreshNodes,
    };
  }, [
    snapshot,
    healthHistory,
    loading,
    refreshing,
    error,
    connectionFailed,
    connectionLost,
    connectionLostUri,
    fetchAll,
    retryConnection,
    pollInterval,
    clusters,
    activeCluster,
    addCluster,
    updateCluster,
    deleteCluster,
    alerts,
    alertStats,
    alertRules,
    alertSettings,
    catNodesExtended,
    nodeAttrsByNodeId,
    nodesLoading,
    nodesError,
    refreshNodes,
  ]);
  
  return (
    <MonitoringContext.Provider value={value}>
      {children}
    </MonitoringContext.Provider>
  );
}

export function useMonitoring() {
  const ctx = useContext(MonitoringContext);
  if (!ctx) {
    throw new Error('useMonitoring must be used within MonitoringProvider');
  }
  return ctx;
}

