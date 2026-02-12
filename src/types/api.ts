export type ClusterStatus = 'green' | 'yellow' | 'red' | 'unknown';

export type Maybe<T> = T | null;

export interface ClusterHealth {
  cluster_name: string;
  status: ClusterStatus;
  number_of_nodes: number;
  active_shards: number;
  /** Optional fields when using filter_path (only essential fields requested) */
  timed_out?: boolean;
  number_of_data_nodes?: number;
  active_primary_shards?: number;
  relocating_shards?: number;
  initializing_shards?: number;
  unassigned_shards?: number;
  delayed_unassigned_shards?: number;
  number_of_pending_tasks?: number;
  task_max_waiting_in_queue_millis?: number;
  active_shards_percent_as_number?: number;
}

export interface NodeInfo {
  nodeRole: string;
  name: string;
  ip?: string;
  /** Optional when nodes endpoint is called with minimal columns (e.g. node.role,name,ip) */
  version?: string;
  uptime?: string;
  tier?: string;
}

export interface CatHealthRow {
  epoch: string;
  timestamp: string;
  cluster: string;
  status: ClusterStatus;
  'node.total': string;
  'node.data': string;
  shards: string;
  pri: string;
  relo: string;
  init: string;
  unassign: string;
  pending_tasks: string;
  max_task_wait_time: string;
  active_shards_percent: string;
}

// Performance monitoring types
export interface NodeStats {
  nodes: Record<string, NodePerformanceStats>;
}

export interface NodePerformanceStats {
  name: string;
  indices: {
    indexing: {
      index_total: number;
      index_time_in_millis: number;
      index_current?: number;
    };
    search: {
      query_total: number;
      query_time_in_millis: number;
      query_current?: number;
    };
  };
  /** OS-level stats including CPU load averages */
  os?: {
    cpu?: {
      percent?: number;
      load_average?: {
        '1m'?: number;
        '5m'?: number;
        '15m'?: number;
      };
    };
  };
  /** JVM memory statistics */
  jvm?: {
    mem?: {
      heap_used_in_bytes?: number;
      heap_max_in_bytes?: number;
      heap_used_percent?: number;
    };
  };
  /** Process-level CPU usage */
  process?: {
    cpu?: {
      percent?: number;
    };
  };
  /** Filesystem statistics */
  fs?: {
    total?: {
      total_in_bytes?: number;
      available_in_bytes?: number;
    };
  };
}

export interface IndexInfo {
  index: string;
  pri: string; // Primary shards
  rep: string; // Replica shards
  'pri.store.size': string; // Primary store size
  'store.size': string; // Total store size
  'docs.count': string; // Document count
}

/**
 * Index statistics from /_stats API
 * 
 * Per Elastic's definition:
 * - Indexing rate/latency: Use **primaries** only (documents indexed per second on primary shards)
 * - Search rate/latency: Use **total** (search requests per second on all shards)
 */
export interface IndexStats {
  indices: Record<string, {
    /** Statistics for primary shards only - use for indexing metrics */
    primaries?: {
      indexing?: {
        index_total: number;
        index_time_in_millis: number;
      };
      search?: {
        query_total: number;
        query_time_in_millis: number;
      };
      store?: {
        size_in_bytes: number;
      };
    };
    /** Statistics for all shards (primary + replica) - use for search metrics and total size */
    total?: {
      indexing?: {
        index_total: number;
        index_time_in_millis: number;
      };
      search?: {
        query_total: number;
        query_time_in_millis: number;
      };
      store?: {
        size_in_bytes: number;
      };
    };
  }>;
}

/**
 * Performance metrics calculated from Elasticsearch stats
 * 
 * Rate calculation: (current_ops - previous_ops) / time_interval_seconds
 * Latency calculation: total_time_in_millis / total_operations
 * 
 * Per Elastic's definition:
 * - Index-level: indexing uses primaries, search uses total (all shards)
 * - Node/Cluster-level: uses aggregated stats from all nodes
 */
export interface PerformanceMetrics {
  /** Indexing operations per second */
  indexingRate: number;
  /** Search operations per second */
  searchRate: number;
  /** Average indexing latency in milliseconds per operation */
  indexLatency: number;
  /** Average search latency in milliseconds per operation */
  searchLatency: number;
}

export interface ChartDataPoint {
  timestamp: number;
  indexingRate: number;
  searchRate: number;
  indexLatency: number;
  searchLatency: number;
}

export interface PerformanceHistory {
  timestamp: number;
  totalIndexingOps: number;
  totalSearchOps: number;
  totalIndexTimeMs: number;
  totalSearchTimeMs: number;
}

export interface MonitoringSnapshot {
  // Performance data
  nodeStats: NodeStats;
  indexStats: IndexStats;
  indices: IndexInfo[];
  performanceMetrics: PerformanceMetrics;

  // Cluster info
  health: ClusterHealth;
  nodes: NodeInfo[];
  settings: { persistent: Record<string, string>; transient: Record<string, string> };
  fetchedAt: string;
}

