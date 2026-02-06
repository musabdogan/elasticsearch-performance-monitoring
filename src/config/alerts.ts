import type { AlertRule, AlertSettings } from '../types/alerts';

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  // Critical Alerts
  {
    id: 'cluster-status-red',
    name: 'Cluster Status Critical',
    description: 'Cluster status is red - immediate attention required',
    severity: 'critical',
    threshold: 0, // Special case: string comparison
    unit: 'status',
    metricPath: 'health.status',
    condition: 'equals',
    enabled: true,
    category: 'cluster',
    cooldownMinutes: 5
  },
  {
    id: 'high-jvm-heap',
    name: 'High JVM Heap Usage',
    description: 'JVM heap usage is critically high - risk of OutOfMemoryError',
    severity: 'critical',
    threshold: 85,
    unit: '%',
    metricPath: 'clusterResources.jvmHeap',
    condition: 'greater_than',
    enabled: true,
    category: 'resource',
    cooldownMinutes: 2
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
    cooldownMinutes: 5
  },
  {
    id: 'high-cpu-usage',
    name: 'High CPU Usage',
    description: 'CPU usage is critically high - performance severely impacted',
    severity: 'critical',
    threshold: 90,
    unit: '%',
    metricPath: 'clusterResources.cpuUsage',
    condition: 'greater_than',
    enabled: true,
    category: 'resource',
    cooldownMinutes: 2
  },
  {
    id: 'slow-search-critical',
    name: 'Slow Search Performance',
    description: 'Search latency is critically high - user experience severely impacted',
    severity: 'critical',
    threshold: 1000,
    unit: 'ms',
    metricPath: 'performanceMetrics.searchLatency',
    condition: 'greater_than',
    enabled: true,
    category: 'performance',
    cooldownMinutes: 1
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
    cooldownMinutes: 10
  },
  {
    id: 'medium-jvm-heap',
    name: 'Medium JVM Heap Usage',
    description: 'JVM heap usage is getting high - monitor closely',
    severity: 'warning',
    threshold: 75,
    unit: '%',
    metricPath: 'clusterResources.jvmHeap',
    condition: 'greater_than',
    enabled: true,
    category: 'resource',
    cooldownMinutes: 5
  },
  {
    id: 'medium-disk-usage',
    name: 'Medium Disk Usage',
    description: 'Storage usage is getting high - consider cleanup or expansion',
    severity: 'warning',
    threshold: 80,
    unit: '%',
    metricPath: 'clusterResources.storagePercent',
    condition: 'greater_than',
    enabled: true,
    category: 'resource',
    cooldownMinutes: 10
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
    cooldownMinutes: 5
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
    cooldownMinutes: 2
  },
  {
    id: 'large-shard-size',
    name: 'Large Shard Size Detected',
    description: 'One or more indices have very large shards - consider reindexing',
    severity: 'warning',
    threshold: 50000000000, // 50GB in bytes
    unit: 'bytes',
    metricPath: 'indices.maxShardSize',
    condition: 'greater_than',
    enabled: true,
    category: 'index',
    cooldownMinutes: 60
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
    cooldownMinutes: 30
  },
  {
    id: 'low-search-activity',
    name: 'Low Search Activity',
    description: 'Very low search activity detected - verify if this is expected',
    severity: 'info',
    threshold: 1,
    unit: 'ops/sec',
    metricPath: 'performanceMetrics.searchRate',
    condition: 'less_than',
    enabled: false, // Disabled by default as it might be noisy
    category: 'performance',
    cooldownMinutes: 30
  },
  {
    id: 'high-document-count',
    name: 'High Document Count',
    description: 'An index has a very high document count - monitor performance',
    severity: 'info',
    threshold: 1000000, // 1M documents
    unit: 'docs',
    metricPath: 'indices.maxDocCount',
    condition: 'greater_than',
    enabled: true,
    category: 'index',
    cooldownMinutes: 120
  }
];

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  browserNotifications: true,
  soundAlerts: false,
  maxHistoryDays: 30
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
  index: 'Database'
} as const;

// Storage keys for localStorage
export const ALERT_STORAGE_KEYS = {
  RULES: 'elasticsearch-monitoring/alert-rules',
  SETTINGS: 'elasticsearch-monitoring/alert-settings',
  HISTORY: 'elasticsearch-monitoring/alert-history',
  ACKNOWLEDGED: 'elasticsearch-monitoring/alert-acknowledged'
} as const;