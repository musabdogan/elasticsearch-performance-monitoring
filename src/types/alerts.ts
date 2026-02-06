export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertCondition = 'greater_than' | 'less_than' | 'equals' | 'not_equals';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved' | 'snoozed';

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  severity: AlertSeverity;
  threshold: number;
  unit: string;
  metricPath: string; // Path to extract value from monitoring data
  condition: AlertCondition;
  enabled: boolean;
  category: 'cluster' | 'performance' | 'resource' | 'index';
  cooldownMinutes: number; // Minimum time between same alert triggers
}

export interface AlertInstance {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  description: string;
  currentValue: number | string;
  threshold: number | string;
  unit: string;
  triggeredAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  snoozedUntil?: string;
  category: string;
  nodeId?: string; // For node-specific alerts
  indexName?: string; // For index-specific alerts
}

export interface AlertStats {
  total: number;
  active: number;
  acknowledged: number;
  resolved: number;
  snoozed: number;
  bySeverity: {
    critical: number;
    warning: number;
    info: number;
  };
  byCategory: {
    cluster: number;
    performance: number;
    resource: number;
    index: number;
  };
}

export interface AlertSettings {
  enabled: boolean;
  browserNotifications: boolean;
  soundAlerts: boolean;
  autoAcknowledgeResolved: boolean;
  maxHistoryDays: number;
}

export interface AlertHistoryFilter {
  severity?: AlertSeverity[];
  category?: string[];
  status?: AlertStatus[];
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}