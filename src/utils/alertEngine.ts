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
      // Merge: add any DEFAULT_ALERT_RULES not present in stored rules (for new installs + upgrades)
      for (const defaultRule of DEFAULT_ALERT_RULES) {
        if (!rules.some((r) => r.id === defaultRule.id)) {
          rules.push(defaultRule);
        }
      }
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

      // Restore active alerts from history (survives extension popup close/reopen).
      // Only restore alerts triggered in the last 24h to avoid showing stale counts (e.g. 9+ from old unresolved alerts).
      const restoreCutoff = Date.now() - 24 * 60 * 60 * 1000;
      const activeFromHistory = history.filter(
        (a) => a.status === 'active' && new Date(a.triggeredAt).getTime() > restoreCutoff
      );
      const byRuleCluster = new Map<string, AlertInstance>();
      for (const alert of activeFromHistory) {
        const key = `${alert.ruleId}:${alert.clusterName ?? ''}`;
        const existing = byRuleCluster.get(key);
        if (!existing || new Date(alert.triggeredAt) > new Date(existing.triggeredAt)) {
          byRuleCluster.set(key, alert);
        }
      }
      for (const alert of byRuleCluster.values()) {
        this.activeAlerts.set(alert.id, alert);
      }

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

      if (path === 'snapshots.successfulCountLast24h') {
        const snapshots = data.snapshots;
        if (!snapshots || !Array.isArray(snapshots)) return null;
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const successfulInLast24h = snapshots.filter(s => {
          const state = (s.state ?? '').toUpperCase();
          if (state !== 'SUCCESS') return false;
          const startTime = s.start_time;
          if (!startTime) return false;
          const ms = new Date(startTime).getTime();
          return Number.isFinite(ms) && ms >= oneDayAgo;
        });
        return successfulInLast24h.length;
      }

      // Explicit handling for cluster health status (metricPath: health.status) — normalize to lowercase so RED/Red/red all trigger
      if (path === 'health.status') {
        const status = data.health?.status;
        if (status == null) return null;
        return String(status).toLowerCase();
      }

      if (path === 'clusterSettings.readOnlyBlocked') {
        const settings = data.clusterSettings;
        if (!settings) return null;
        const getBlock = (src: Record<string, unknown> | undefined): boolean => {
          if (!src?.cluster || typeof src.cluster !== 'object') return false;
          const cluster = src.cluster as Record<string, unknown>;
          const blocks = cluster.blocks;
          if (!blocks || typeof blocks !== 'object') return false;
          const b = blocks as Record<string, unknown>;
          const ro = b.read_only; const road = b.read_only_allow_delete;
          return ro === true || ro === 'true' || road === true || road === 'true';
        };
        const blocked = getBlock(settings.persistent as Record<string, unknown>) || getBlock(settings.transient as Record<string, unknown>);
        return blocked ? 'blocked' : 'unblocked';
      }

      if (path === 'healthReport.diskStatusDegraded') {
        const hr = data.healthReport;
        if (!hr?.indicators || typeof hr.indicators !== 'object') return null;
        const disk = hr.indicators.disk;
        if (!disk || typeof disk !== 'object') return null;
        const status = (disk.status ?? '').toLowerCase();
        if (status === 'yellow' || status === 'red') return status;
        return status === 'green' ? 'green' : null;
      }

      if (path === 'healthReport.ilmStatusDegraded') {
        const hr = data.healthReport;
        if (!hr?.indicators || typeof hr.indicators !== 'object') return null;
        const ilm = hr.indicators.ilm;
        if (!ilm || typeof ilm !== 'object') return null;
        const status = (ilm.status ?? '').toLowerCase();
        if (status === 'yellow' || status === 'red') return status;
        return status === 'green' ? 'green' : null;
      }

      if (path === 'indices.countWithoutReplicas') {
        const indices = data.indices;
        if (!indices || !Array.isArray(indices)) return null;
        const systemPrefixes = ['.', '.ds-'];
        const isSystemIndex = (name: string) => systemPrefixes.some(p => name.startsWith(p));
        const replicaCount = (idx: { rep?: string | number }) => Number(String(idx.rep ?? '').trim()) || 0;
        const withoutReplicas = indices.filter(idx => {
          if (isSystemIndex(idx.index)) return false;
          return replicaCount(idx) === 0;
        });
        return withoutReplicas.length;
      }

      // Index-level stats from _stats (indexing failures, segments, merges)
      if (path === 'indices.indexingFailedTotal') {
        const stats = data.indexStats?.indices;
        if (!stats || typeof stats !== 'object') return 0;
        let total = 0;
        for (const idx of Object.values(stats)) {
          const failed = idx.primaries?.indexing?.index_failed;
          if (typeof failed === 'number') total += failed;
        }
        return total;
      }

      if (path === 'indices.maxSegmentCount') {
        const stats = data.indexStats?.indices;
        if (!stats || typeof stats !== 'object') return 0;
        let max = 0;
        for (const idx of Object.values(stats)) {
          const count = idx.primaries?.segments?.count;
          if (typeof count === 'number' && count > max) max = count;
        }
        return max;
      }

      if (path === 'indices.mergeCurrentMax') {
        const stats = data.indexStats?.indices;
        if (!stats || typeof stats !== 'object') return 0;
        let max = 0;
        for (const idx of Object.values(stats)) {
          const current = idx.primaries?.merges?.current;
          if (typeof current === 'number' && current > max) max = current;
        }
        return max;
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

    // Handle string comparisons (for cluster status, disk health report, cluster blocks)
    if (typeof currentValue === 'string') {
      if (rule.id === 'cluster-read-only-blocked') {
        return currentValue === 'blocked';
      }
      if (rule.id === 'disk-watermark-health-report') {
        return currentValue === 'yellow' || currentValue === 'red';
      }
      if (rule.id === 'ilm-errors') {
        return currentValue === 'yellow' || currentValue === 'red';
      }
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

  /** Get index names that have no replicas (for indices-without-replicas alert). */
  private getIndicesWithoutReplicas(data: MonitoringSnapshot): string[] {
    const indices = data.indices;
    if (!indices || !Array.isArray(indices)) return [];
    const systemPrefixes = ['.', '.ds-'];
    const isSystemIndex = (name: string) => systemPrefixes.some(p => name.startsWith(p));
    const replicaCount = (idx: { rep?: string | number }) => Number(String(idx.rep ?? '').trim()) || 0;
    return indices
      .filter(idx => !isSystemIndex(idx.index) && replicaCount(idx) === 0)
      .map(idx => idx.index);
  }

  /** Get index names that have shards larger than thresholdBytes (for large-shard-size alert). */
  private getIndicesWithLargeShards(data: MonitoringSnapshot, thresholdBytes: number): string[] {
    const indices = data.indices;
    if (!indices || !Array.isArray(indices) || !Number.isFinite(thresholdBytes)) return [];
    return indices
      .filter(idx => {
        const primarySizeBytes = parseDiskSizeToBytes(idx['pri.store.size']) ?? 0;
        const priCount = parseInt(idx.pri, 10) || 1;
        const avgShardBytes = priCount > 0 ? primarySizeBytes / priCount : 0;
        return avgShardBytes > thresholdBytes;
      })
      .map(idx => idx.index);
  }

  /** Get index names that have indexing failures (index_failed > 0). */
  private getIndicesWithIndexingFailures(data: MonitoringSnapshot): string[] {
    const stats = data.indexStats?.indices;
    if (!stats || typeof stats !== 'object') return [];
    return Object.entries(stats)
      .filter(([, idx]) => (idx.primaries?.indexing?.index_failed ?? 0) > 0)
      .map(([name]) => name);
  }

  /** Get index names that have segment count above threshold (for high-segment-count alert). */
  private getIndicesWithHighSegmentCount(data: MonitoringSnapshot, threshold: number): string[] {
    const stats = data.indexStats?.indices;
    if (!stats || typeof stats !== 'object' || !Number.isFinite(threshold)) return [];
    return Object.entries(stats)
      .filter(([, idx]) => (idx.primaries?.segments?.count ?? 0) > threshold)
      .map(([name]) => name);
  }

  // Create alert instance from rule
  private createAlertInstance(
    rule: AlertRule,
    currentValue: number | string,
    clusterName?: string,
    affectedResources?: string[]
  ): AlertInstance {
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
      clusterName,
      affectedResources
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
      const existingAlert = Array.from(this.activeAlerts.values()).find(
        (alert) =>
          alert.ruleId === rule.id &&
          (clusterName == null || alert.clusterName === clusterName)
      );

      if (conditionMet) {
        if (existingAlert) {
          // Condition still true: keep alert active and update value
          const currentValue = this.extractMetricValue(data, rule.metricPath);
          if (currentValue !== null) {
            existingAlert.currentValue = currentValue;
            if (rule.id === 'indices-without-replicas') {
              existingAlert.affectedResources = this.getIndicesWithoutReplicas(data);
            }
            if (rule.id === 'large-shard-size') {
              const thresholdBytes = typeof rule.threshold === 'number' ? rule.threshold : 50 * 1024 * 1024 * 1024;
              existingAlert.affectedResources = this.getIndicesWithLargeShards(data, thresholdBytes);
            }
            if (rule.id === 'indexing-failures') {
              existingAlert.affectedResources = this.getIndicesWithIndexingFailures(data);
            }
            if (rule.id === 'high-segment-count') {
              const segThreshold = typeof rule.threshold === 'number' ? rule.threshold : 500;
              existingAlert.affectedResources = this.getIndicesWithHighSegmentCount(data, segThreshold);
            }
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
                const affectedResources = rule.id === 'indices-without-replicas'
                  ? this.getIndicesWithoutReplicas(data)
                  : rule.id === 'large-shard-size'
                    ? this.getIndicesWithLargeShards(data, typeof rule.threshold === 'number' ? rule.threshold : 50 * 1024 * 1024 * 1024)
                    : rule.id === 'indexing-failures'
                      ? this.getIndicesWithIndexingFailures(data)
                      : rule.id === 'high-segment-count'
                        ? this.getIndicesWithHighSegmentCount(data, typeof rule.threshold === 'number' ? rule.threshold : 500)
                        : undefined;
                const alertInstance = this.createAlertInstance(rule, currentValue, clusterName, affectedResources);
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
        // Condition is no longer met - only resolve when we have data (avoid resolving when data is missing, e.g. healthReport)
        const currentValue = this.extractMetricValue(data, rule.metricPath);
        if (currentValue !== null && currentValue !== undefined) {
          this.alertConditionStartTime.delete(rule.id);
          const activeAlert = Array.from(this.activeAlerts.values()).find(
            (alert) =>
              alert.ruleId === rule.id &&
              alert.status === 'active' &&
              (clusterName == null || alert.clusterName === clusterName)
          );
          if (activeAlert) {
            const resolvedAt = new Date().toISOString();
            const updated = { ...activeAlert, status: 'resolved' as const, resolvedAt };
            this.activeAlerts.set(activeAlert.id, updated);
            const historyIndex = this.alertHistory.findIndex((a) => a.id === activeAlert.id);
            if (historyIndex >= 0) this.alertHistory[historyIndex] = updated;
          }
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
        index: activeAlerts.filter(a => a.category === 'index').length,
        snapshot: activeAlerts.filter(a => a.category === 'snapshot').length
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