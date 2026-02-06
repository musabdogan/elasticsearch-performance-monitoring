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
  getNodes,
  checkClusterHealth,
  flushCluster,
  disableShardAllocation,
  stopShardRebalance,
  enableShardAllocation,
  enableShardRebalance
} from '@/services/elasticsearch';
import { PerformanceTracker } from '@/utils/performanceTracker';
import type {
  CatHealthRow,
  ClusterHealth,
  ClusterStatus,
  MonitoringSnapshot,
  PerformanceMetrics,
  ChartDataPoint
} from '@/types/api';
import type { ClusterConnection, CreateClusterInput } from '@/types/app';
import { getStoredValue, setStoredValue } from '@/utils/storage';

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
  connectionFailed: boolean;
  lastUpdated: string | null;
  refresh: () => Promise<void>;
  retryConnection: () => Promise<void>;
  pollInterval: number;
  setPollInterval: (ms: number) => void;
  statusSummary: Record<ClusterStatus, number>;
  clusters: ClusterConnection[];
  activeCluster: ClusterConnection | null;
  setActiveCluster: (clusterLabel: string) => void;
  addCluster: (input: CreateClusterInput) => void;
  updateCluster: (clusterLabel: string, input: CreateClusterInput) => void;
  deleteCluster: (clusterLabel: string) => void;
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
  const [pollInterval, setPollIntervalState] = useState<number>(() =>
    getStoredValue(POLL_STORAGE_KEY, apiConfig.pollIntervalMs)
  );
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
    try {
      if (!activeCluster) {
        setError('Please add a cluster to start monitoring.');
        setLoading(false);
        setRefreshing(false);
        setConnectionFailed(false);
        return;
      }
      
      if (connectionFailed) {
        return;
      }
      
      setRefreshing(true);
      setError(null);
      setConnectionFailed(false);
      
      const [nodeStats, indexStats, indices, health, nodes] = await Promise.all([
        getNodeStats(activeCluster),
        getIndexStats(activeCluster),
        getIndices(activeCluster),
        getClusterHealth(activeCluster),
        getNodes(activeCluster)
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
    } catch (err) {
      let message = err instanceof Error ? err.message : 'Unknown error occurred';
      
      if (message.toLowerCase().includes('fetch') && 
          (message.toLowerCase().includes('failed') || message.toLowerCase().includes('error'))) {
        message = 'Network error';
      }
      
      const isTimeout = err instanceof Error && (
        err.name === 'AbortError' || 
        err.name === 'TimeoutError' ||
        message.toLowerCase().includes('timeout') ||
        message.toLowerCase().includes('aborted')
      );
      
      if (isTimeout && activeCluster) {
        const healthResult = await checkClusterHealth(activeCluster);
        if (!healthResult.success) {
          setConnectionFailed(true);
          setError(healthResult.error || `Network error, cannot access your cluster. Cluster uri: ${activeCluster.baseUrl}`);
          setLoading(false);
          setRefreshing(false);
          return;
        }
        setError(message);
        setConnectionFailed(false);
      } else {
        if (message.toLowerCase().includes('network error') && activeCluster) {
          setError(`Network error, cannot access your cluster. Cluster uri: ${activeCluster.baseUrl}`);
        } else {
          setError(message);
        }
        setConnectionFailed(true);
      }
      
      if (!message.toLowerCase().includes('mock')) {
        toast.error('Data refresh failed', { description: message });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeCluster, connectionFailed]);
  
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
    
    const healthResult = await checkClusterHealth(activeCluster);
    
    if (!healthResult.success) {
      setConnectionFailed(true);
      setError(healthResult.error || `Network error, cannot access your cluster. Cluster uri: ${activeCluster.baseUrl}`);
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
        setError('Please add a cluster to start monitoring.');
        setConnectionFailed(false);
        return;
      }
      
      healthCheckDoneRef.current = true;
      
      setLoading(true);
      setError(null);
      const healthResult = await checkClusterHealth(activeCluster);
      
      if (!healthResult.success) {
        setConnectionFailed(true);
        setError(healthResult.error || `Network error, cannot access your cluster. Cluster uri: ${activeCluster.baseUrl}`);
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
      fetchAll();
    }
  }, [activeClusterLabel, activeCluster, fetchAll]);
  
  // Polling
  useEffect(() => {
    if (connectionFailed || !activeCluster || pollInterval === 0) {
      return;
    }
    
    const interval = setInterval(() => {
      fetchAll();
    }, pollInterval);
    
    return () => clearInterval(interval);
  }, [fetchAll, pollInterval, connectionFailed, activeCluster]);
  
  // Cleanup
  useEffect(() => {
    return () => {
      if (autoRetryIntervalRef.current) {
        clearInterval(autoRetryIntervalRef.current);
        autoRetryIntervalRef.current = null;
      }
    };
  }, [activeCluster]);
  
  const addCluster = useCallback(async (input: CreateClusterInput) => {
    try {
      const sanitizedBaseUrl = input.baseUrl.trim().replace(/\/$/, '');
      const clusterLabel = (input.label || sanitizedBaseUrl).trim();
      
      const newCluster: ClusterConnection = {
        label: clusterLabel,
        baseUrl: sanitizedBaseUrl,
        username: input.username?.trim() || '',
        password: input.password?.trim() || ''
      };
      
      setClusters((prev) => {
        const exists = prev.some(c => c.label === newCluster.label);
        if (exists) {
          return prev.map(c => c.label === newCluster.label ? newCluster : c);
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
    
    setClusters((prev) =>
      prev.map((cluster) => {
        if (cluster.label === clusterLabel) {
          return {
            ...cluster,
            label: newLabel,
            baseUrl: sanitizedBaseUrl,
            username: input.username?.trim() || '',
            password: input.password?.trim() || ''
          };
        }
        return cluster;
      })
    );
    
    if (activeClusterLabel === clusterLabel) {
      setActiveClusterLabel(newLabel);
    }
    
    toast.success('Cluster updated', {
      description: `${newLabel} has been updated.`
    });
  }, [activeClusterLabel]);
  
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
  
  const handleFlushCluster = useCallback(async () => {
    if (!activeCluster) {
      toast.error('No active cluster', { description: 'Please select a cluster first.' });
      return;
    }
    
    try {
      await flushCluster(activeCluster);
      toast.success('Flush completed', { description: 'Cluster has been flushed successfully.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Flush failed';
      toast.error('Flush failed', { description: message });
    }
  }, [activeCluster]);
  
  const handleDisableShardAllocation = useCallback(async () => {
    if (!activeCluster) {
      toast.error('No active cluster', { description: 'Please select a cluster first.' });
      return;
    }
    try {
      await disableShardAllocation(activeCluster);
      toast.success('Shard allocation disabled', { description: 'Primary shard allocation has been disabled.' });
      fetchAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to disable shard allocation';
      toast.error('Failed', { description: message });
    }
  }, [activeCluster, fetchAll]);
  
  const handleStopShardRebalance = useCallback(async () => {
    if (!activeCluster) {
      toast.error('No active cluster', { description: 'Please select a cluster first.' });
      return;
    }
    try {
      await stopShardRebalance(activeCluster);
      toast.success('Shard rebalance stopped', { description: 'Shard rebalancing has been disabled.' });
      fetchAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop shard rebalance';
      toast.error('Failed', { description: message });
    }
  }, [activeCluster, fetchAll]);
  
  const handleEnableShardAllocation = useCallback(async () => {
    if (!activeCluster) {
      toast.error('No active cluster', { description: 'Please select a cluster first.' });
      return;
    }
    try {
      await enableShardAllocation(activeCluster);
      toast.success('Shard allocation enabled', { description: 'Shard allocation has been enabled for all shards.' });
      fetchAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to enable shard allocation';
      toast.error('Failed', { description: message });
    }
  }, [activeCluster, fetchAll]);
  
  const handleEnableShardRebalance = useCallback(async () => {
    if (!activeCluster) {
      toast.error('No active cluster', { description: 'Please select a cluster first.' });
      return;
    }
    try {
      await enableShardRebalance(activeCluster);
      toast.success('Shard rebalance enabled', { description: 'Shard rebalancing has been enabled.' });
      fetchAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to enable shard rebalance';
      toast.error('Failed', { description: message });
    }
  }, [activeCluster, fetchAll]);
  
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
      lastUpdated: lastUpdatedRef.current,
      refresh: fetchAll,
      retryConnection,
      pollInterval,
      setPollInterval: (ms: number) => {
        // Allow OFF (0) value, otherwise enforce minimum 3000
        const safeValue = ms === 0 ? 0 : Math.min(Math.max(ms, 3000), 60000);
        setPollIntervalState(safeValue);
        setStoredValue(POLL_STORAGE_KEY, safeValue);
      },
      statusSummary,
      clusters,
      activeCluster,
      setActiveCluster: (clusterLabel: string) => {
        setActiveClusterLabel(clusterLabel);
        healthCheckDoneRef.current = false;
      },
      addCluster,
      updateCluster,
      deleteCluster,
    };
  }, [
    snapshot,
    healthHistory,
    loading,
    refreshing,
    error,
    connectionFailed,
    fetchAll,
    retryConnection,
    pollInterval,
    clusters,
    activeCluster,
    addCluster,
    updateCluster,
    deleteCluster,
    handleFlushCluster,
    handleDisableShardAllocation,
    handleStopShardRebalance,
    handleEnableShardAllocation,
    handleEnableShardRebalance
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

