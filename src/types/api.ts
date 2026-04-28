export type ClusterStatus = 'green' | 'yellow' | 'red' | 'unknown';

export type Maybe<T> = T | null;

export interface ClusterHealth {
  cluster_name: string;
  cluster_uuid?: string;
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
        index_failed?: number;
      };
      search?: {
        query_total: number;
        query_time_in_millis: number;
      };
      store?: {
        size_in_bytes: number;
      };
      segments?: {
        count?: number;
      };
      merges?: {
        current?: number;
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
 * Lightweight single-index stats response used by index detail modal.
 * Same shape as IndexStats but filtered to one index and only indexing/search totals.
 */
export interface SingleIndexStatsResponse {
  indices?: Record<string, {
    primaries?: {
      indexing?: {
        index_total?: number;
        index_time_in_millis?: number;
      };
    };
    total?: {
      search?: {
        query_total?: number;
        query_time_in_millis?: number;
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

  /** Snapshot list from all repos (for alerts). Fetched in fetchAll; may be empty if API fails. */
  snapshots?: SnapshotInfo[];

  /** Health report (ES 8.x+). Fetched only in fetchAlerts; used for alert evaluation. */
  healthReport?: HealthReportResponse;
  /** Node-level heap/ram/disk from _cat/nodes. Fetched only in fetchAlerts; used for alert evaluation. */
  catNodesExtended?: CatNodeExtendedRow[];
  /** Cluster settings (read_only blocks etc.). Fetched only in fetchAlerts. */
  clusterSettings?: ClusterSettingsResponse;
}

/** GET _cluster/settings response. Nested structure: persistent/transient contain cluster.blocks etc. */
export interface ClusterSettingsResponse {
  persistent?: Record<string, unknown>;
  transient?: Record<string, unknown>;
}

// Cluster tab: _cluster/stats response (minimal fields)
export interface ClusterStats {
  cluster_name?: string;
  cluster_uuid?: string;
  indices?: { count?: number; shards?: { total?: number; primaries?: number } };
  nodes?: { count?: { total?: number }; versions?: string[] };
  status?: string;
}

// Cluster tab: _cat/shards row
export interface CatShardRow {
  index: string;
  shard: string;
  prirep: string;
  state: string;
  /** Optional columns when using _cat/shards with extended h=... */
  docs?: string;
  store?: string;
  dataset?: string;
  ip?: string;
  'unassigned.reason'?: string;
  'unassigned.for'?: string;
  'unassigned.details'?: string;
  node?: string;
}

/** GET _cluster/allocation/explain response (minimal subset used in UI). */
export interface AllocationExplainResponse {
  index?: string;
  shard?: number;
  primary?: boolean;
  current_state?: string;
  can_allocate?: string;
  allocate_explanation?: string;
  node_allocation_decisions?: Array<{
    node_name?: string;
    node_id?: string;
    transport_address?: string;
    node_attributes?: Record<string, unknown>;
    deciders?: Array<{
      decider?: string;
      decision?: string;
      explanation?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }>;
  unassigned_info?: {
    reason?: string;
    at?: string;
    last_allocation_status?: string;
    details?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// Cluster tab: _cat/pending_tasks row
export interface CatPendingTaskRow {
  insert_order?: string;
  time_in_queue?: string;
  priority?: string;
  source?: string;
}

// Cluster tab: _cat/recovery row (active_only)
export interface CatRecoveryRow {
  /** index */
  i?: string;
  /** shard */
  s?: string;
  /** time */
  t?: string;
  /** type */
  ty?: string;
  /** stage */
  st?: string;
  source_node?: string;
  target_node?: string;
  /** files */
  f?: string;
  /** files_percent */
  fp?: string;
  /** bytes */
  b?: string;
  /** bytes_percent */
  bp?: string;
  translog_ops_percent?: string;
}

// Cluster tab: GET _health_report (ES 8.x+). Each indicator: status, symptom; optional details/impacts/diagnosis when verbose=true.
export type HealthIndicatorStatus = 'green' | 'yellow' | 'red' | 'unknown';

export interface HealthReportIndicator {
  status: HealthIndicatorStatus;
  symptom: string;
  details?: Record<string, unknown>;
  impacts?: Array<{ severity?: number; description?: string; impact_areas?: string[] }>;
  diagnosis?: Array<{ cause?: string; action?: string; help_url?: string; affected_resources?: Record<string, unknown> }>;
}

export interface HealthReportResponse {
  cluster_name?: string;
  status?: HealthIndicatorStatus;
  indicators?: Record<string, HealthReportIndicator>;
}

// Nodes tab: _cat/nodes extended columns
export interface CatNodeExtendedRow {
  ip?: string;
  id?: string;
  name?: string;
  version?: string;
  'heap.percent'?: string;
  'heap.current'?: string;
  'heap.max'?: string;
  'ram.percent'?: string;
  'ram.current'?: string;
  'ram.max'?: string;
  'node.role'?: string;
  master?: string;
  cpu?: string;
  load_1m?: string;
  load_5m?: string;
  load_15m?: string;
  'disk.used_percent'?: string;
  'disk.used'?: string;
  'disk.total'?: string;
  shards?: string;
  uptime?: string;
}

/** GET _cat/nodeattrs row. One row per (node, attr). */
export interface CatNodeAttrsRow {
  node?: string;
  id?: string;
  host?: string;
  ip?: string;
  attr?: string;
  value?: string;
}

// Snapshots tab: GET _snapshot response (repositories). ES/OpenSearch: { repo1: { type }, ... } or { repositories: [{ name }] }
export interface SnapshotReposResponse {
  repositories?: Array<{ name: string; type?: string }>;
  [repoName: string]: unknown;
}

/** Single entry in snapshot response failures array (index/shard failure detail). */
export interface SnapshotFailure {
  index?: string;
  shard_id?: number;
  reason?: string;
  node_id?: string;
  status?: string;
  type?: string;
  [key: string]: unknown;
}

// GET _snapshot/{repo}/_all response (one snapshot entry)
export interface SnapshotInfo {
  snapshot: string;
  repository?: string;
  state?: string;
  indices?: string[];
  data_streams?: string[];
  metadata?: { policy?: string };
  start_time?: string;
  end_time?: string;
  duration_in_millis?: number;
  shards?: { total: number; successful: number; failed: number };
  failures?: SnapshotFailure[];
}

export interface SnapshotAllResponse {
  snapshots?: SnapshotInfo[];
  total?: number;
  remaining?: number;
}

/** GET _snapshot/{repo}/{snapshot}/_status shard entry. */
export interface SnapshotStatusShard {
  stage?: string;
  reason?: string;
  stats?: {
    start_time_in_millis?: number;
    time_in_millis?: number;
    incremental?: { file_count?: number; size_in_bytes?: number };
    total?: { file_count?: number; size_in_bytes?: number };
  };
}

/** GET _snapshot/{repo}/{snapshot}/_status index entry. */
export interface SnapshotStatusIndex {
  shards?: Record<string, SnapshotStatusShard>;
  shards_stats?: {
    initializing?: number;
    started?: number;
    finalizing?: number;
    done?: number;
    failed?: number;
    total?: number;
  };
}

/** GET _snapshot/{repo}/{snapshot}/_status snapshot entry. */
export interface SnapshotStatusEntry {
  snapshot: string;
  repository?: string;
  state?: string;
  include_global_state?: boolean;
  shards_stats?: {
    initializing?: number;
    started?: number;
    finalizing?: number;
    done?: number;
    failed?: number;
    total?: number;
  };
  stats?: {
    start_time_in_millis?: number;
    time_in_millis?: number;
    incremental?: {
      file_count?: number;
      size_in_bytes?: number;
    };
    total?: {
      file_count?: number;
      size_in_bytes?: number;
    };
  };
  indices?: Record<string, SnapshotStatusIndex>;
}

/** GET _snapshot/{repo}/{snapshot}/_status response. */
export interface SnapshotStatusResponse {
  snapshots?: SnapshotStatusEntry[];
}

/** GET _snapshot/{repo}/_verify node entry. */
export interface SnapshotRepositoryVerifyNode {
  name?: string;
}

/** GET _snapshot/{repo}/_verify response. */
export interface SnapshotRepositoryVerifyResponse {
  nodes?: Record<string, SnapshotRepositoryVerifyNode>;
}

// Nodes tab: _nodes/stats/transport,http,breaker,fs,indices (extended stats)
export interface NodesStatsExtendedResponse {
  nodes?: Record<string, NodeStatsExtendedEntry>;
}
export interface NodeStatsExtendedEntry {
  name?: string;
  transport?: {
    rx_size_in_bytes?: number;
    tx_size_in_bytes?: number;
    rx_count?: number;
    tx_count?: number;
    server_open?: number;
    total_outbound_connections?: number;
  };
  http?: {
    current_open?: number;
    total_opened?: number;
  };
  breakers?: Record<string, {
    limit_size_in_bytes?: number;
    estimated_size_in_bytes?: number;
    tripped?: number;
    overhead?: number;
  }>;
  fs?: {
    io_stats?: {
      total?: {
        read_operations_count?: number;
        write_operations_count?: number;
        read_kilobytes?: number;
        write_kilobytes?: number;
        /** ES 8.x: total.read.operations.count, total.read.kb */
        read?: { operations?: { count?: number }; operations_count?: number; kb?: number };
        write?: { operations?: { count?: number }; operations_count?: number; kb?: number };
      };
    };
    /** Per-device stats; io_stats can be here instead of or in addition to io_stats.total */
    data?: Array<{
      path?: string;
      io_stats?: {
        read_operations_count?: number;
        write_operations_count?: number;
        read_kilobytes?: number;
        write_kilobytes?: number;
        read?: { operations?: { count?: number }; operations_count?: number; kb?: number };
        write?: { operations?: { count?: number }; operations_count?: number; kb?: number };
      };
    }>;
  };
  indices?: {
    indexing?: {
      index_failed?: number;
      index_total?: number;
    };
  };
}

// Shards tab: index-scoped _stats?level=shards parsing is done as unknown to stay compatible across ES versions.

// Nodes tab: _cat/thread_pool?format=json response row
export interface CatThreadPoolRow {
  node_name?: string;
  name?: string;
  type?: string;
  active?: string;
  queue?: string;
  rejected?: string;
  largest?: string;
  completed?: string;
  core?: string;
  max?: string;
  keep_alive?: string;
  host?: string;
  ip?: string;
  ephemeral_id?: string;
}

// Snapshots tab: table row (from _snapshot/repo/_all, normalized)
export interface CatSnapshotRow {
  id?: string;
  /** SLM policy name from metadata.policy (shown under snapshot name) */
  policy?: string;
  repository?: string;
  status?: string;
  start_epoch?: string;
  start_time?: string;
  end_epoch?: string;
  end_time?: string;
  duration?: string;
  indices?: string;
  /** Resolved index names for popover (from API indices array) */
  indicesList?: string[];
  data_streams?: string;
  /** Resolved data stream names for popover (from API data_streams array) */
  dataStreamsList?: string[];
  successful_shards?: string;
  failed_shards?: string;
  total_shards?: string;
  /** total_shards - failed_shards - successful_shards */
  remaining_shards?: string;
  /** From API failures[]; shown in popover when Failed shards is clicked */
  failures?: SnapshotFailure[];
  reason?: string;
}

// ——— Indices tab ———

/** Row from _cat/indices (indices catalog). */
export interface CatIndexRow {
  index: string;
  health?: string;
  pri?: string;
  rep?: string;
  'docs.count'?: string;
  'docs.deleted'?: string;
  'store.size'?: string;
  'pri.store.size'?: string;
  'creation.date.string'?: string;
  'indexing.index_failed'?: string;
}

/** Row from _cat/aliases. */
export interface CatAliasRow {
  alias?: string;
  index?: string;
  filter?: string;
  'routing.index'?: string;
  'routing.search'?: string;
  is_write_index?: string;
}

/** Single data stream from GET _data_stream. */
export interface DataStreamInfo {
  name: string;
  timestamp_field?: { name: string };
  indices?: Array<{ index_name: string; index_uuid: string }>;
  generation?: number;
  status?: string;
  template?: string;
}

export interface DataStreamsResponse {
  data_streams?: DataStreamInfo[];
}

/** Minimal GET /_nodes response slice used for tier mapping. */
export interface NodesRolesResponse {
  nodes?: Record<string, { name?: string; roles?: string[] }>;
}

/** GET /{index} response (mappings + settings). filter_path=*.mappings,*.settings.index */
export interface IndexDetailsResponse {
  [indexName: string]: {
    mappings?: Record<string, unknown>;
    settings?: {
      index?: Record<string, unknown>;
    };
  };
}

/** GET _ilm/policy response. Policy name -> definition with phases (delete.min_age = retention). */
export interface IlmPolicyResponse {
  [policyName: string]: {
    policy?: {
      phases?: {
        delete?: { min_age?: string; actions?: Record<string, unknown> };
        hot?: unknown;
        warm?: unknown;
        cold?: unknown;
      };
    };
  };
}

/** GET _ilm/explain response. indices[].index, phase, policy, age, step, step_info (errors). */
export interface IlmExplainResponse {
  indices?: Record<
    string,
    {
      index?: string;
      managed?: boolean;
      policy?: string;
      index_creation_date_millis?: number;
      time_since_index_creation?: string;
      phase?: string;
      phase_execution?: {
        policy?: string;
        version?: number;
        modified_date_in_millis?: number;
        phase_definition?: {
          min_age?: string;
          actions?: {
            rollover?: {
              max_age?: string;
              min_docs?: number;
              max_primary_shard_docs?: number;
              min_size?: string;
              max_primary_shard_size?: string;
              [k: string]: unknown;
            };
            [k: string]: unknown;
          };
          [k: string]: unknown;
        };
      };
      age?: string;
      phase_definition?: unknown;
      step?: { name?: string; time_since_start?: string };
      step_info?: { reason?: string; type?: string; message?: string };
      action?: string;
      step_time?: string;
      phase_time_millis?: number;
      lifecycle_date_millis?: number;
    }
  >;
}

/** GET _field_usage_stats response (ES 7.15+). Index names are top-level keys (e.g. "my-index": { shards: [...] }). */
export type FieldUsageStatsResponse = {
  _shards?: { total: number; successful: number; failed: number };
} & Record<string, unknown>;

// ——— Templates tab ———

/** GET _index_template response (composable index templates, ES 7.9+). */
export interface IndexTemplateItem {
  name: string;
  index_template?: {
    index_patterns?: string[];
    template?: { settings?: Record<string, unknown>; mappings?: Record<string, unknown> };
    priority?: number;
    version?: number;
    data_stream?: { hidden?: boolean };
    composed_of?: string[];
    _meta?: Record<string, unknown>;
  };
}

export interface IndexTemplateListResponse {
  index_templates?: IndexTemplateItem[];
}

/** GET _template response (legacy index templates). */
export interface LegacyTemplateItem {
  name: string;
  index_patterns?: string[];
  order?: number;
  settings?: Record<string, unknown>;
  mappings?: Record<string, unknown>;
  aliases?: Record<string, unknown>;
}

export type LegacyTemplateListResponse = Record<string, Omit<LegacyTemplateItem, 'name'>>;

