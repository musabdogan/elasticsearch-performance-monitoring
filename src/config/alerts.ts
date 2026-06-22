import type { AlertRule, AlertSettings } from '../types/alerts';

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  // Critical Alerts
  {
    id: 'cluster-status-red',
    name: 'Cluster Status Red',
    description: 'Cluster status is red - immediate attention required',
    severity: 'critical',
    threshold: 0, // Special case: string comparison
    unit: 'status',
    metricPath: 'health.status',
    condition: 'equals',
    enabled: true,
    category: 'cluster',
    cooldownMinutes: 0
  },
  {
    id: 'critical-jvm-heap',
    name: 'Critical JVM Heap Usage',
    description: 'JVM heap usage is critically high - risk of OutOfMemoryError',
    severity: 'critical',
    threshold: 85,
    unit: '%',
    metricPath: 'clusterResources.jvmHeap',
    condition: 'greater_than',
    enabled: true,
    category: 'resource',
    cooldownMinutes: 0
  },
  {
    id: 'low-disk-space',
    name: 'Low Disk Space',
    description: 'Cluster storage usage is critically high - risk of readonly mode',
    severity: 'critical',
    threshold: 90,
    unit: '%',
    metricPath: 'clusterResources.storagePercent',
    condition: 'greater_than',
    enabled: true,
    category: 'resource',
    cooldownMinutes: 0
  },
  {
    id: 'high-cpu-usage',
    name: 'Critical CPU Usage',
    description: 'CPU usage is critically high - performance can be impacted',
    severity: 'critical',
    threshold: 90,
    unit: '%',
    metricPath: 'clusterResources.cpuUsage',
    condition: 'greater_than',
    enabled: true,
    category: 'resource',
    cooldownMinutes: 0
  },
  {
    id: 'slow-search-critical',
    name: 'Slow Search Performance',
    description: 'Search latency is critically high - user experience can be impacted',
    severity: 'critical',
    threshold: 1000,
    unit: 'ms',
    metricPath: 'performanceMetrics.searchLatency',
    condition: 'greater_than',
    enabled: true,
    category: 'performance',
    cooldownMinutes: 0
  },

  // Warning Alerts
  {
    id: 'cluster-status-yellow',
    name: 'Cluster Status Warning',
    description: 'Cluster status is yellow - some issues detected',
    severity: 'warning',
    threshold: 0, // Special case: string comparison
    unit: 'status',
    metricPath: 'health.status',
    condition: 'equals',
    enabled: true,
    category: 'cluster',
    cooldownMinutes: 0
  },
  {
    id: 'high-jvm-heap',
    name: 'High JVM Heap Usage',
    description: 'JVM heap usage is getting high - monitor closely',
    severity: 'warning',
    threshold: 75,
    unit: '%',
    metricPath: 'clusterResources.jvmHeap',
    condition: 'greater_than',
    enabled: true,
    category: 'resource',
    cooldownMinutes: 0
  },
  {
    id: 'high-disk-usage',
    name: 'High Disk Usage',
    description: 'Storage usage is getting high - consider cleanup or expansion',
    severity: 'warning',
    threshold: 80,
    unit: '%',
    metricPath: 'clusterResources.storagePercent',
    condition: 'greater_than',
    enabled: true,
    category: 'resource',
    cooldownMinutes: 0
  },
  {
    id: 'high-cpu-load',
    name: 'High CPU Load',
    description: 'CPU usage is high - performance may be impacted',
    severity: 'warning',
    threshold: 80,
    unit: '%',
    metricPath: 'clusterResources.cpuUsage',
    condition: 'greater_than',
    enabled: true,
    category: 'resource',
    cooldownMinutes: 0
  },
  {
    id: 'slow-indexing',
    name: 'Slow Indexing Performance',
    description: 'Index latency is high - indexing performance degraded',
    severity: 'warning',
    threshold: 500,
    unit: 'ms',
    metricPath: 'performanceMetrics.indexLatency',
    condition: 'greater_than',
    enabled: true,
    category: 'performance',
    cooldownMinutes: 0
  },
  {
    id: 'large-shard-size',
    name: 'Large Shard Size Detected',
    description: 'One or more indices have very large shards - consider reindexing',
    severity: 'warning',
    threshold: 50 * 1024 * 1024 * 1024, // 50 GiB in bytes (displays as 50 GB)
    unit: 'bytes',
    metricPath: 'indices.maxShardSize',
    condition: 'greater_than',
    enabled: true,
    category: 'index',
    cooldownMinutes: 0
  },

  // Snapshot Alerts
  {
    id: 'no-successful-snapshots-1d',
    name: 'No Successful Snapshots in Last 1 Day',
    description: 'No successful snapshots in last 1 day',
    severity: 'warning',
    threshold: 0,
    unit: 'count',
    metricPath: 'snapshots.successfulCountLast24h',
    condition: 'equals',
    enabled: true,
    category: 'snapshot',
    cooldownMinutes: 0
  },

  // Cluster Health Alerts (from cluster health, health report, cluster settings)
  {
    id: 'cluster-read-only-blocked',
    name: 'Cluster Read-Only Blocked',
    description: 'Cluster has read-only or read-only-allow-delete block - writes are blocked',
    severity: 'critical',
    threshold: 0,
    unit: 'status',
    metricPath: 'clusterSettings.readOnlyBlocked',
    condition: 'greater_than',
    enabled: true,
    category: 'cluster',
    cooldownMinutes: 0
  },
  {
    id: 'pending-tasks',
    name: 'Pending Cluster Tasks',
    description: 'Cluster has pending tasks in queue - may indicate slow state updates',
    severity: 'warning',
    threshold: 0,
    unit: 'count',
    metricPath: 'health.number_of_pending_tasks',
    condition: 'greater_than',
    enabled: true,
    category: 'cluster',
    cooldownMinutes: 0
  },
  {
    id: 'unassigned-shards',
    name: 'Unassigned Shards',
    description: 'Shards are unassigned - data may be unavailable or replicating',
    severity: 'warning',
    threshold: 0,
    unit: 'count',
    metricPath: 'health.unassigned_shards',
    condition: 'greater_than',
    enabled: true,
    category: 'cluster',
    cooldownMinutes: 0
  },
  {
    id: 'disk-watermark-health-report',
    name: 'Disk High (Health Report)',
    description: 'Disk usage exceeds watermark threshold (from Elasticsearch health report)',
    severity: 'warning',
    threshold: 0,
    unit: 'status',
    metricPath: 'healthReport.diskStatusDegraded',
    condition: 'greater_than',
    enabled: true,
    category: 'resource',
    cooldownMinutes: 0
  },
  {
    id: 'indices-without-replicas',
    name: 'Indices Without Replicas',
    description: 'One or more user indices have no replicas - no redundancy if a node fails',
    severity: 'info',
    threshold: 0,
    unit: 'indices',
    metricPath: 'indices.countWithoutReplicas',
    condition: 'greater_than',
    enabled: true,
    category: 'index',
    cooldownMinutes: 0
  },
  {
    id: 'indexing-failures',
    name: 'Indexing Failures',
    description: 'One or more indices have indexing failures - check index health and mapping',
    severity: 'warning',
    threshold: 0,
    unit: 'count',
    metricPath: 'indices.indexingFailedTotal',
    condition: 'greater_than',
    enabled: true,
    category: 'index',
    cooldownMinutes: 0
  },
  {
    id: 'high-segment-count',
    name: 'High Segment Count',
    description: 'One or more indices have high segment count - consider force merge or ILM',
    severity: 'warning',
    threshold: 500,
    unit: 'segments',
    metricPath: 'indices.maxSegmentCount',
    condition: 'greater_than',
    enabled: true,
    category: 'index',
    cooldownMinutes: 0
  },
  {
    id: 'ilm-errors',
    name: 'ILM Degraded (Health Report)',
    description: 'ILM status is degraded - indices stagnating or stuck (from Elasticsearch health report)',
    severity: 'warning',
    threshold: 0,
    unit: 'count',
    metricPath: 'healthReport.ilmStatusDegraded',
    condition: 'greater_than',
    enabled: true,
    category: 'index',
    cooldownMinutes: 0
  },

  // Info Alerts
  {
    id: 'no-indexing-activity',
    name: 'No Indexing Activity',
    description: 'No indexing operations detected - verify if this is expected',
    severity: 'info',
    threshold: 0,
    unit: 'ops/sec',
    metricPath: 'performanceMetrics.indexingRate',
    condition: 'equals',
    enabled: true,
    category: 'performance',
    cooldownMinutes: 0
  },
  {
    id: 'no-search-activity',
    name: 'No Search Activity',
    description: 'No search activity detected - verify if this is expected',
    severity: 'info',
    threshold: 0,
    unit: 'ops/sec',
    metricPath: 'performanceMetrics.searchRate',
    condition: 'less_than',
    enabled: true, // Disabled by default as it might be noisy
    category: 'performance',
    cooldownMinutes: 0
  }
];

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  browserNotifications: true,
  soundAlerts: false,
  maxHistoryDays: 30
};

/** Per-rule detail config for alert detail modal: what was detected + recommendations. */
export const ALERT_DETAIL_CONFIG: Record<string, { whatWasDetected: string; recommendations: string[] }> = {
  'cluster-status-red': {
    whatWasDetected: 'Cluster status is red. Primary shards may be unassigned and data is unavailable.',
    recommendations: [
      'Check node availability and disk space',
      'Run GET _cluster/allocation/explain to diagnose',
      'Restore failed nodes or rebalance shards'
    ]
  },
  'cluster-status-yellow': {
    whatWasDetected: 'Cluster status is yellow. All primary shards are allocated but some replicas are not.',
    recommendations: [
      'Add more nodes to host replica shards',
      'Check GET _cat/shards?v for unassigned replicas',
      'Ensure disk space and cluster routing allow allocation'
    ]
  },
  'critical-jvm-heap': {
    whatWasDetected: 'JVM heap usage is critically high. Risk of OutOfMemoryError and node failure.',
    recommendations: [
      'Increase heap size or add more nodes',
      'Check for memory leaks or heavy aggregations',
      'Consider reducing index buffer or field data cache'
    ]
  },
  'high-jvm-heap': {
    whatWasDetected: 'JVM heap usage is getting high. Monitor closely for potential OOM.',
    recommendations: [
      'Monitor heap trends over time',
      'Consider increasing heap or scaling out',
      'Review slow queries and heavy aggregations'
    ]
  },
  'low-disk-space': {
    whatWasDetected: 'Cluster storage usage is critically high. Elasticsearch may enable read-only block.',
    recommendations: [
      'Delete old indices or use ILM to manage retention',
      'Add more disk or nodes',
      'Run GET _cat/allocation?v to see per-node usage'
    ]
  },
  'high-disk-usage': {
    whatWasDetected: 'Storage usage is getting high. Consider cleanup or expansion soon.',
    recommendations: [
      'Review index retention and delete unused data',
      'Add disk capacity or scale out',
      'Check GET _cat/allocation?v for node-level usage'
    ]
  },
  'high-cpu-usage': {
    whatWasDetected: 'CPU usage is critically high. Search and indexing performance can be impacted.',
    recommendations: [
      'Open Active searches in the Indices tab to inspect in-flight queries',
      'Check GET _nodes/hot_threads for hotspots on busy data nodes',
      'Scale out or optimize heavy aggregations and large terms filters'
    ]
  },
  'high-cpu-load': {
    whatWasDetected: 'CPU usage is high. Performance may be degraded.',
    recommendations: [
      'Open Active searches in the Indices tab',
      'Check thread pool stats: GET _cat/thread_pool?v',
      'Consider scaling out or optimizing queries'
    ]
  },
  'slow-search-critical': {
    whatWasDetected: 'Search latency is critically high. User experience can be severely impacted.',
    recommendations: [
      'Open Active searches to find long-running queries',
      'Use Index diagnosis on slow indices from Indexing & Search',
      'Identify slow queries via slow query log if enabled'
    ]
  },
  'slow-indexing': {
    whatWasDetected: 'Index latency is high. Indexing throughput may be degraded.',
    recommendations: [
      'Check bulk size and refresh interval',
      'Review mapping and avoid dynamic mapping explosions',
      'Scale indexing capacity or add nodes'
    ]
  },
  'large-shard-size': {
    whatWasDetected: 'One or more indices have very large shards. Rebalancing and recovery can be slow.',
    recommendations: [
      'Inspect store size per affected index (copy and run): GET /<index>/_stats?filter_path=indices.*.primaries.store',
      'Reindex into smaller shards (e.g. split by date)',
      'Use ILM to manage shard size',
      'Aim for shards between 10–50 GB'
    ]
  },
  'no-successful-snapshots-1d': {
    whatWasDetected: 'No successful snapshots in the last 24 hours. Backup may be failing.',
    recommendations: [
      'Check snapshot repository and permissions',
      'Run GET _cat/snapshots and GET _snapshot to inspect repositories and snapshot status',
      'Verify SLM policy or manual snapshot schedule'
    ]
  },
  'cluster-read-only-blocked': {
    whatWasDetected: 'Cluster has read-only or read-only-allow-delete block. Writes are blocked.',
    recommendations: [
      'Free disk space on nodes to clear watermark',
      'Remove block: PUT _cluster/settings with cluster.blocks.read_only_allow_delete: null',
      'Check GET _cat/allocation?v for disk usage'
    ]
  },
  'pending-tasks': {
    whatWasDetected: 'Cluster has pending tasks in queue. State updates may be delayed.',
    recommendations: [
      'Usually temporary; wait for tasks to complete',
      'Check GET _cat/pending_tasks?v for details',
      'If stuck, investigate master node load'
    ]
  },
  'unassigned-shards': {
    whatWasDetected: 'Shards are unassigned. Data may be unavailable or still initializing.',
    recommendations: [
      'Check allocation: GET _cluster/allocation/explain',
      'Ensure enough nodes and disk space',
      'If initializing, wait for recovery'
    ]
  },
  'disk-watermark-health-report': {
    whatWasDetected: 'Disk usage exceeds watermark threshold (from Elasticsearch health report).',
    recommendations: [
      'Free disk space or add capacity',
      'Delete old indices or use ILM',
      'Check GET _cat/allocation?v for node-level usage'
    ]
  },
  'indices-without-replicas': {
    whatWasDetected: 'One or more user indices have no replica shards. These indices have no redundancy if a node fails.',
    recommendations: [
      'Add replicas for production indices (one command per index, copy and run): PUT /<index>/_settings\n{"number_of_replicas": 1}',
      'If single-node or intentionally no replicas, you can disable this alert in Alert Management'
    ]
  },
  'indexing-failures': {
    whatWasDetected: 'One or more indices have indexing failures. Check index health and mapping.',
    recommendations: [
      'Inspect indexing stats per affected index (copy and run per index): GET /<index>/_stats?filter_path=indices.*.primaries.indexing',
      'Check mapping and dynamic mapping settings',
      'Review cluster and index health for allocation or disk issues'
    ]
  },
  'high-segment-count': {
    whatWasDetected: 'At least one index has a high segment count. This can slow searches and increase memory use.',
    recommendations: [
      'Consider force merge for read-heavy indices (copy and run per index; use with care): POST /<index>/_forcemerge?max_num_segments=1',
      'Use ILM to move indices to warm/cold and reduce segment count',
      'Review refresh interval and indexing rate'
    ]
  },
  'ilm-errors': {
    whatWasDetected: 'ILM status is degraded (yellow or red) - indices may be stagnating or stuck on an action.',
    recommendations: [
      'Check Cluster tab → Health report → ILM section for affected indices',
      'Run GET {index}/_ilm/explain for each affected index to see phase and step_info',
      'Fix policy configuration or retry the failed step'
    ]
  },
  'no-indexing-activity': {
    whatWasDetected: 'No indexing operations detected. Verify if this is expected for this cluster.',
    recommendations: [
      'Confirm cluster is receiving index requests',
      'Check ingest pipelines or Beats/Logstash if used',
      'If expected (e.g. read-only cluster), you can disable this alert'
    ]
  },
  'no-search-activity': {
    whatWasDetected: 'No search activity detected. Verify if this is expected.',
    recommendations: [
      'Confirm applications are querying the cluster',
      'Check Kibana or search clients',
      'If expected, you can disable this alert'
    ]
  }
};

// Alert severity colors for UI
export const ALERT_COLORS = {
  critical: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-500',
    text: 'text-red-800 dark:text-red-200',
    textSecondary: 'text-red-600 dark:text-red-300',
    icon: 'text-red-500',
    badge: 'bg-red-500'
  },
  warning: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    border: 'border-yellow-500',
    text: 'text-yellow-800 dark:text-yellow-200',
    textSecondary: 'text-yellow-600 dark:text-yellow-300',
    icon: 'text-yellow-500',
    badge: 'bg-yellow-500'
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-500',
    text: 'text-blue-800 dark:text-blue-200',
    textSecondary: 'text-blue-600 dark:text-blue-300',
    icon: 'text-blue-500',
    badge: 'bg-blue-500'
  }
} as const;

// Alert category icons
export const ALERT_CATEGORY_ICONS = {
  cluster: 'Server',
  performance: 'Zap',
  resource: 'Gauge',
  index: 'Database',
  snapshot: 'Camera'
} as const;

// Storage keys for localStorage
export const ALERT_STORAGE_KEYS = {
  RULES: 'elasticsearch-monitoring/alert-rules',
  SETTINGS: 'elasticsearch-monitoring/alert-settings',
  HISTORY: 'elasticsearch-monitoring/alert-history',
  ACKNOWLEDGED: 'elasticsearch-monitoring/alert-acknowledged'
} as const;