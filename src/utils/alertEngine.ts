import type { 
  AlertRule, 
  AlertInstance, 
  AlertStats,
  AlertSettings 
} from '../types/alerts';
import type { MonitoringSnapshot } from '../types/api';
import { DEFAULT_ALERT_RULES, DEFAULT_ALERT_SETTINGS, ALERT_STORAGE_KEYS } from '../config/alerts';
import { parseDiskSizeToBytes, formatAlertValue } from '@/utils/format';

export class AlertEngine {
  private rules: AlertRule[] = [];
  private activeAlerts: Map<string, AlertInstance> = new Map();
  private alertHistory: AlertInstance[] = [];
  private settings: AlertSettings = DEFAULT_ALERT_SETTINGS;
  private lastEvaluationTime: Map<string, number> = new Map();
  private alertConditionStartTime: Map<string, number> = new Map(); // Track when alert condition started
  private readonly ALERT_DELAY_MS = 30 * 1000; // 30 seconds delay before creating alert

  constructor() {
    this.loadFromStorage();
  }

  // Load alert data from localStorage
  private loadFromStorage(): void {
    try {
      // Load rules
      const storedRules = localStorage.getItem(ALERT_STORAGE_KEYS.RULES);
      let rules: AlertRule[] = storedRules ? JSON.parse(storedRules) : [...DEFAULT_ALERT_RULES];
      // Remove deprecated "High Document Count" rule if present (from older config or custom)
      rules = rules.filter(
        (r) => r.id !== 'high-document-count' && r.name !== 'High Document Count'
      );
      // Rename "Medium Disk Usage" -> "High Disk Usage" for stored rules
      rules = rules.map((r) => {
        if (r.id === 'medium-disk-usage' || r.name === 'Medium Disk Usage') {
          return { ...r, id: 'high-disk-usage', name: 'High Disk Usage' };
        }
        return r;
      });
      // Rename "Low Search Activity" -> "No Search Activity" for stored rules
      rules = rules.map((r) => {
        if (r.id === 'low-search-activity' || r.name === 'Low Search Activity') {
          return { ...r, id: 'no-search-activity', name: 'No Search Activity' };
        }
        return r;
      });
      this.rules = rules;

      // Load settings
      const storedSettings = localStorage.getItem(ALERT_STORAGE_KEYS.SETTINGS);
      this.settings = storedSettings ? JSON.parse(storedSettings) : DEFAULT_ALERT_SETTINGS;

      // Load history (drop deprecated High Document Count alerts)
      const storedHistory = localStorage.getItem(ALERT_STORAGE_KEYS.HISTORY);
      let history: AlertInstance[] = storedHistory ? JSON.parse(storedHistory) : [];
      history = history.filter(
        (a) => a.ruleId !== 'high-document-count' && a.ruleName !== 'High Document Count'
      );
      // Normalize Medium Disk Usage -> High Disk Usage in history
      history = history.map((a) => {
        if (a.ruleId === 'medium-disk-usage' || a.ruleName === 'Medium Disk Usage') {
          return { ...a, ruleId: 'high-disk-usage', ruleName: 'High Disk Usage' };
        }
        return a;
      });
      // Normalize Low Search Activity -> No Search Activity in history
      history = history.map((a) => {
        if (a.ruleId === 'low-search-activity' || a.ruleName === 'Low Search Activity') {
          return { ...a, ruleId: 'no-search-activity', ruleName: 'No Search Activity' };
        }
        return a;
      });
      this.alertHistory = history;

      // Clean old history
      this.cleanOldHistory();
    } catch (error) {
      console.error('Failed to load alert data from storage:', error);
      this.rules = [...DEFAULT_ALERT_RULES];
      this.settings = DEFAULT_ALERT_SETTINGS;
    }
  }

  // Save alert data to localStorage
  private saveToStorage(): void {
    try {
      localStorage.setItem(ALERT_STORAGE_KEYS.RULES, JSON.stringify(this.rules));
      localStorage.setItem(ALERT_STORAGE_KEYS.SETTINGS, JSON.stringify(this.settings));
      localStorage.setItem(ALERT_STORAGE_KEYS.HISTORY, JSON.stringify(this.alertHistory));
    } catch (error) {
      console.error('Failed to save alert data to storage:', error);
    }
  }

  // Clean old alert history based on settings
  private cleanOldHistory(): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.settings.maxHistoryDays);
    
    this.alertHistory = this.alertHistory.filter(alert => 
      new Date(alert.triggeredAt) > cutoffDate
    );
  }

  // Extract value from monitoring data using metric path
  private extractMetricValue(data: MonitoringSnapshot, path: string): number | string | null {
    try {
      // Handle derived metrics first (not present on snapshot; computed from nodeStats/indices)
      if (path === 'clusterResources.storagePercent' || path === 'clusterResources.jvmHeap' || path === 'clusterResources.cpuUsage') {
        // Derive cluster resource metrics from nodeStats (same logic as dashboard)
        const nodeStats = data.nodeStats;
        if (!nodeStats?.nodes) return null;
        const nodes = Object.values(nodeStats.nodes);
        if (nodes.length === 0) return null;

        if (path === 'clusterResources.storagePercent') {
          const storage = nodes.reduce((acc, node) => {
            const total = node.fs?.total?.total_in_bytes ?? 0;
            const available = node.fs?.total?.available_in_bytes ?? 0;
            const used = total - available;
            return { total: acc.total + total, used: acc.used + used };
          }, { total: 0, used: 0 });
          return storage.total > 0 ? (storage.used / storage.total) * 100 : 0;
        }

        if (path === 'clusterResources.jvmHeap') {
          const jvmValues = nodes
            .map(node => {
              const used = node.jvm?.mem?.heap_used_in_bytes ?? 0;
              const max = node.jvm?.mem?.heap_max_in_bytes ?? 0;
              return max > 0 ? (used / max) * 100 : 0;
            })
            .filter(h => h > 0);
          return jvmValues.length > 0 ? jvmValues.reduce((s, h) => s + h, 0) / jvmValues.length : 0;
        }

        if (path === 'clusterResources.cpuUsage') {
          const cpuValues = nodes
            .map(node => node.os?.cpu?.percent ?? node.process?.cpu?.percent ?? 0)
            .filter(c => c > 0);
          return cpuValues.length > 0 ? cpuValues.reduce((s, c) => s + c, 0) / cpuValues.length : 0;
        }
      }

      if (path === 'indices.maxShardSize') {
        // Calculate max shard size from indices data (_cat/indices returns e.g. "20.4gb")
        if (data.indices && Array.isArray(data.indices)) {
          const maxSize = Math.max(...data.indices.map(index => {
            const primarySizeBytes = parseDiskSizeToBytes(index['pri.store.size']);
            const priCount = parseInt(index.pri, 10) || 1;
            return priCount > 0 ? primarySizeBytes / priCount : 0; // Avg shard size in bytes
          }));
          return maxSize;
        }
        return 0;
      }

      if (path === 'indices.maxDocCount') {
        // Calculate max document count from indices data
        if (data.indices && Array.isArray(data.indices)) {
          const maxDocs = Math.max(...data.indices.map(index => 
            parseInt(index['docs.count'], 10) || 0
          ));
          return maxDocs;
        }
        return 0;
      }

      // Path exists on snapshot (health.status, performanceMetrics.*, etc.)
      const pathParts = path.split('.');
      let value: unknown = data;
      for (const part of pathParts) {
        if (value && typeof value === 'object' && part in value) {
          value = (value as Record<string, unknown>)[part];
        } else {
          return null;
        }
      }
      return value as number | string | null;
    } catch (error) {
      console.error(`Failed to extract metric value for path: ${path}`, error);
      return null;
    }
  }

  // Evaluate only the condition (no cooldown). Used to decide if alert stays active or gets resolved.
  private evaluateRuleCondition(rule: AlertRule, data: MonitoringSnapshot): boolean {
    if (!rule.enabled) return false;

    const currentValue = this.extractMetricValue(data, rule.metricPath);
    if (currentValue === null || currentValue === undefined) return false;

    // Handle string comparisons (for cluster status)
    if (typeof currentValue === 'string') {
      switch (rule.condition) {
        case 'equals':
          return rule.id === 'cluster-status-red' ? currentValue === 'red' :
                 rule.id === 'cluster-status-yellow' ? currentValue === 'yellow' : false;
        case 'not_equals':
          return rule.id === 'cluster-status-red' ? currentValue !== 'red' :
                 rule.id === 'cluster-status-yellow' ? currentValue !== 'yellow' : false;
        default:
          return false;
      }
    }

    // Handle numeric comparisons
    const numericValue = typeof currentValue === 'number' ? currentValue : parseFloat(String(currentValue));
    if (isNaN(numericValue)) return false;

    switch (rule.condition) {
      case 'greater_than':
        return numericValue > rule.threshold;
      case 'less_than':
        return numericValue < rule.threshold;
      case 'equals':
        // For zero comparison, use a small tolerance to handle floating point precision
        if (rule.threshold === 0) {
          return Math.abs(numericValue) < 0.001; // Less than 0.001 is considered zero
        }
        return numericValue === rule.threshold;
      case 'not_equals':
        return numericValue !== rule.threshold;
      default:
        return false;
    }
  }

  // Evaluate rule for creating NEW alert (condition only; no cooldown).
  private evaluateRuleForNewAlert(rule: AlertRule, data: MonitoringSnapshot): boolean {
    return this.evaluateRuleCondition(rule, data);
  }

  // Create alert instance from rule
  private createAlertInstance(rule: AlertRule, currentValue: number | string, clusterName?: string): AlertInstance {
    const now = new Date().toISOString();
    
    return {
      id: `${rule.id}-${Date.now()}`,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      status: 'active',
      message: rule.name,
      description: rule.description,
      currentValue,
      threshold: rule.threshold,
      unit: rule.unit,
      triggeredAt: now,
      firstTriggeredAt: now,
      count: 1,
      category: rule.category,
      clusterName
    };
  }

  // Evaluate all rules against monitoring data
  public evaluateAlerts(data: MonitoringSnapshot, clusterName?: string): AlertInstance[] {
    if (!this.settings.enabled) return [];

    const newAlerts: AlertInstance[] = [];
    const now = Date.now();

    for (const rule of this.rules) {
      // Use condition-only check (no cooldown) so we correctly keep/resolve existing alerts
      const conditionMet = this.evaluateRuleCondition(rule, data);
      const existingAlert = Array.from(this.activeAlerts.values()).find(alert => alert.ruleId === rule.id);

      if (conditionMet) {
        if (existingAlert) {
          // Condition still true: keep alert active and update value
          const currentValue = this.extractMetricValue(data, rule.metricPath);
          if (currentValue !== null) {
            existingAlert.currentValue = currentValue;
            if (existingAlert.status !== 'active') {
              existingAlert.status = 'active';
              existingAlert.resolvedAt = undefined;
              existingAlert.triggeredAt = new Date().toISOString();
              existingAlert.count = (existingAlert.count || 1) + 1;
              newAlerts.push(existingAlert);
              if (rule.severity === 'critical' && this.settings.browserNotifications) {
                this.sendBrowserNotification(existingAlert);
              }
            }
          }
        } else {
          // No existing alert: apply delay before creating new one
          const conditionStartTime = this.alertConditionStartTime.get(rule.id);
          if (!conditionStartTime) {
            this.alertConditionStartTime.set(rule.id, now);
          } else if (now - conditionStartTime >= this.ALERT_DELAY_MS) {
            if (this.evaluateRuleForNewAlert(rule, data)) {
              const currentValue = this.extractMetricValue(data, rule.metricPath);
              if (currentValue !== null) {
                const alertInstance = this.createAlertInstance(rule, currentValue, clusterName);
                this.activeAlerts.set(alertInstance.id, alertInstance);
                this.alertHistory.unshift(alertInstance);
                newAlerts.push(alertInstance);
                this.lastEvaluationTime.set(rule.id, now);
                this.alertConditionStartTime.delete(rule.id);
                if (rule.severity === 'critical' && this.settings.browserNotifications) {
                  this.sendBrowserNotification(alertInstance);
                }
              }
            }
          }
        }
      } else {
        // Condition is no longer met, clear tracking and resolve any active alerts
        this.alertConditionStartTime.delete(rule.id);
        
        // Resolve active alert for this rule
        const activeAlert = Array.from(this.activeAlerts.values())
          .find(alert => alert.ruleId === rule.id && alert.status === 'active');

        if (activeAlert && activeAlert.status === 'active') {
          activeAlert.status = 'resolved';
          activeAlert.resolvedAt = new Date().toISOString();
        }
      }
    }

    // Don't remove resolved alerts from activeAlerts map
    // They might become active again if condition persists

    this.saveToStorage();
    return newAlerts;
  }

  // Send browser notification
  private sendBrowserNotification(alert: AlertInstance): void {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      new Notification(`Elasticsearch Alert: ${alert.ruleName}`, {
        body: `${alert.description}\nCurrent: ${formatAlertValue(alert.currentValue as number, alert.unit)}`,
        icon: '/icons/icon48.png',
        tag: `elasticsearch-alert-${alert.ruleId}`,
        requireInteraction: alert.severity === 'critical'
      });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          this.sendBrowserNotification(alert);
        }
      });
    }
  }

  // Get current active alerts
  public getActiveAlerts(): AlertInstance[] {
    return Array.from(this.activeAlerts.values())
      .filter(alert => alert.status === 'active')
      .sort((a, b) => {
        // Sort by severity (critical first), then by time
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDiff !== 0) return severityDiff;
        return new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime();
      });
  }

  // Get alert statistics
  public getAlertStats(): AlertStats {
    const activeAlerts = this.getActiveAlerts();
    const allAlerts = this.alertHistory;

    return {
      total: allAlerts.length,
      active: activeAlerts.length,
      resolved: allAlerts.filter(a => a.status === 'resolved').length,
      snoozed: allAlerts.filter(a => a.status === 'snoozed').length,
      bySeverity: {
        critical: activeAlerts.filter(a => a.severity === 'critical').length,
        warning: activeAlerts.filter(a => a.severity === 'warning').length,
        info: activeAlerts.filter(a => a.severity === 'info').length
      },
      byCategory: {
        cluster: activeAlerts.filter(a => a.category === 'cluster').length,
        performance: activeAlerts.filter(a => a.category === 'performance').length,
        resource: activeAlerts.filter(a => a.category === 'resource').length,
        index: activeAlerts.filter(a => a.category === 'index').length
      }
    };
  }


  // Snooze alert
  public snoozeAlert(alertId: string, minutes: number): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert && alert.status === 'active') {
      alert.status = 'snoozed';
      const snoozeUntil = new Date();
      snoozeUntil.setMinutes(snoozeUntil.getMinutes() + minutes);
      alert.snoozedUntil = snoozeUntil.toISOString();
      this.saveToStorage();
    }
  }

  // Dismiss alert
  public dismissAlert(alertId: string): void {
    this.activeAlerts.delete(alertId);
    this.saveToStorage();
  }

  // Get alert rules
  public getRules(): AlertRule[] {
    return [...this.rules];
  }

  // Update alert rule
  public updateRule(ruleId: string, updates: Partial<AlertRule>): void {
    const ruleIndex = this.rules.findIndex(r => r.id === ruleId);
    if (ruleIndex !== -1) {
      this.rules[ruleIndex] = { ...this.rules[ruleIndex], ...updates };
      this.saveToStorage();
    }
  }

  // Get alert settings
  public getSettings(): AlertSettings {
    return { ...this.settings };
  }

  // Update alert settings
  public updateSettings(updates: Partial<AlertSettings>): void {
    this.settings = { ...this.settings, ...updates };
    this.saveToStorage();
  }

  // Get alert history
  public getAlertHistory(): AlertInstance[] {
    return [...this.alertHistory];
  }

  // Clear alert history
  public clearAlertHistory(): void {
    this.alertHistory = [];
    this.saveToStorage();
  }

  // Reset to default rules
  public resetToDefaults(): void {
    this.rules = [...DEFAULT_ALERT_RULES];
    this.settings = DEFAULT_ALERT_SETTINGS;
    this.saveToStorage();
  }
}

// Singleton instance
export const alertEngine = new AlertEngine();