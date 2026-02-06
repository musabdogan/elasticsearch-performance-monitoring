import type { 
  AlertRule, 
  AlertInstance, 
  AlertStats,
  AlertSettings 
} from '../types/alerts';
import type { MonitoringSnapshot } from '../types/api';
import { DEFAULT_ALERT_RULES, DEFAULT_ALERT_SETTINGS, ALERT_STORAGE_KEYS } from '../config/alerts';

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
      this.rules = storedRules ? JSON.parse(storedRules) : [...DEFAULT_ALERT_RULES];

      // Load settings
      const storedSettings = localStorage.getItem(ALERT_STORAGE_KEYS.SETTINGS);
      this.settings = storedSettings ? JSON.parse(storedSettings) : DEFAULT_ALERT_SETTINGS;

      // Load history
      const storedHistory = localStorage.getItem(ALERT_STORAGE_KEYS.HISTORY);
      this.alertHistory = storedHistory ? JSON.parse(storedHistory) : [];

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
      const pathParts = path.split('.');
      let value: any = data;
      
      for (const part of pathParts) {
        if (value && typeof value === 'object' && part in value) {
          value = value[part];
        } else {
          return null;
        }
      }

      // Handle special cases for derived metrics
      if (path === 'indices.maxShardSize') {
        // Calculate max shard size from indices data
        if (data.indices && Array.isArray(data.indices)) {
          const maxSize = Math.max(...data.indices.map(index => {
            const primarySize = parseFloat(index['pri.store.size']) || 0;
            const priCount = parseInt(index.pri, 10) || 1;
            return primarySize / priCount; // Average shard size
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

      return value;
    } catch (error) {
      console.error(`Failed to extract metric value for path: ${path}`, error);
      return null;
    }
  }

  // Evaluate a single alert rule
  private evaluateRule(rule: AlertRule, data: MonitoringSnapshot): boolean {
    if (!rule.enabled) return false;

    const currentValue = this.extractMetricValue(data, rule.metricPath);
    if (currentValue === null || currentValue === undefined) return false;

    // Check cooldown
    const lastEvaluation = this.lastEvaluationTime.get(rule.id);
    const now = Date.now();
    if (lastEvaluation && (now - lastEvaluation) < (rule.cooldownMinutes * 60 * 1000)) {
      return false;
    }

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
        return numericValue === rule.threshold;
      case 'not_equals':
        return numericValue !== rule.threshold;
      default:
        return false;
    }
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
      if (this.evaluateRule(rule, data)) {
        // Check if this alert is already active
        const existingAlert = Array.from(this.activeAlerts.values())
          .find(alert => alert.ruleId === rule.id && alert.status === 'active');

        if (!existingAlert) {
          // Check if we have started tracking this condition
          const conditionStartTime = this.alertConditionStartTime.get(rule.id);
          
          if (!conditionStartTime) {
            // First time this condition is met, start tracking
            this.alertConditionStartTime.set(rule.id, now);
          } else {
            // Check if enough time has passed (30 seconds)
            const timeSinceConditionStart = now - conditionStartTime;
            
            if (timeSinceConditionStart >= this.ALERT_DELAY_MS) {
              // Condition has been true for 30+ seconds, create alert
              const currentValue = this.extractMetricValue(data, rule.metricPath);
              if (currentValue !== null) {
                const alertInstance = this.createAlertInstance(rule, currentValue, clusterName);
                this.activeAlerts.set(alertInstance.id, alertInstance);
                this.alertHistory.unshift(alertInstance);
                newAlerts.push(alertInstance);
                
                // Update last evaluation time
                this.lastEvaluationTime.set(rule.id, now);
                
                // Clear the condition start time since alert is now created
                this.alertConditionStartTime.delete(rule.id);

                // Send browser notification for critical alerts
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
        
        // Check if we should resolve any active alerts for this rule
        const activeAlert = Array.from(this.activeAlerts.values())
          .find(alert => alert.ruleId === rule.id && alert.status === 'active');

        if (activeAlert) {
          activeAlert.status = 'resolved';
          activeAlert.resolvedAt = new Date().toISOString();
          
          // Auto-acknowledge if setting is enabled
          if (this.settings.autoAcknowledgeResolved) {
            activeAlert.status = 'acknowledged';
            activeAlert.acknowledgedAt = activeAlert.resolvedAt;
          }
        }
      }
    }

    // Clean up old resolved alerts from active alerts map
    for (const [id, alert] of this.activeAlerts.entries()) {
      if (alert.status === 'resolved' || alert.status === 'acknowledged') {
        this.activeAlerts.delete(id);
      }
    }

    this.saveToStorage();
    return newAlerts;
  }

  // Send browser notification
  private sendBrowserNotification(alert: AlertInstance): void {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      new Notification(`Elasticsearch Alert: ${alert.ruleName}`, {
        body: `${alert.description}\nCurrent: ${alert.currentValue}${alert.unit}`,
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
      acknowledged: allAlerts.filter(a => a.status === 'acknowledged').length,
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

  // Acknowledge alert
  public acknowledgeAlert(alertId: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert && alert.status === 'active') {
      alert.status = 'acknowledged';
      alert.acknowledgedAt = new Date().toISOString();
      this.saveToStorage();
    }
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