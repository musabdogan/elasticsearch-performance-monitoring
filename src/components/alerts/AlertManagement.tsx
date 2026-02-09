import { memo, useState, useEffect } from 'react';
import { 
  X,
  Settings,
  RotateCcw,
  Bell,
  Volume2,
  VolumeX,
  Save,
  Shield,
  Check
} from 'lucide-react';
import AlertItem from './AlertItem';
import type { 
  AlertInstance, 
  AlertSettings,
  AlertRule
} from '../../types/alerts';
import { ALERT_COLORS } from '../../config/alerts';

interface AlertManagementProps {
  isOpen: boolean;
  onClose: () => void;
  history: AlertInstance[];
  settings: AlertSettings;
  rules?: AlertRule[];
  alerts?: AlertInstance[];
  clusterName?: string;
  onUpdateSettings?: (updates: Partial<AlertSettings>) => void;
  onUpdateRule?: (ruleId: string, updates: Partial<AlertRule>) => void;
  onResetToDefaults?: () => void;
  isPanel?: boolean; // New prop for panel mode
}

type TabType = 'alerts' | 'settings' | 'rules';

function formatCondition(condition: string): string {
  const map: Record<string, string> = {
    greater_than: '>',
    less_than: '<',
    equals: '=',
    not_equals: '≠'
  };
  return map[condition] ?? condition;
}

function formatThreshold(rule: AlertRule): string {
  if (rule.unit === 'status') return '(status check)';
  if (rule.unit === 'bytes' && typeof rule.threshold === 'number' && rule.threshold >= 1024 ** 3) {
    return `${(rule.threshold / (1024 ** 3)).toFixed(0)} GB`;
  }
  if (rule.unit === 'bytes') return `${rule.threshold} bytes`;
  return `${rule.threshold} ${rule.unit}`;
}

const AlertManagement = memo<AlertManagementProps>(({
  isOpen,
  onClose,
  settings,
  history,
  rules = [],
  clusterName,
  onUpdateSettings,
  onUpdateRule,
  onResetToDefaults,
  isPanel = false
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('alerts');
  const [tempSettings, setTempSettings] = useState<AlertSettings>(settings);

  // ESC tuşu ile modal/panel kapatma
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSaveSettings = () => {
    if (onUpdateSettings) {
      onUpdateSettings(tempSettings);
    }
  };


  const tabs = [
    { id: 'alerts' as TabType, label: 'Active Alerts', icon: Bell },
    { id: 'rules' as TabType, label: 'Rules', icon: Shield },
    { id: 'settings' as TabType, label: 'Settings', icon: Settings }
  ];

  const renderTabContent = () => {
    const paddingClass = isPanel ? 'p-3' : 'p-6';
    const spacingClass = isPanel ? 'space-y-3' : 'space-y-4';
    const textSizeClass = isPanel ? 'text-base' : 'text-lg';
    
    // Single list: cluster-filtered, one alert per rule (longest duration wins)
    const filteredByCluster = clusterName 
      ? history.filter(alert => alert.clusterName === clusterName)
      : history;
    const byRule = new Map<string, typeof history[0]>();
    for (const alert of filteredByCluster) {
      const key = alert.ruleId;
      const existing = byRule.get(key);
      if (!existing) {
        byRule.set(key, alert);
      } else {
        const existingStart = existing.firstTriggeredAt || existing.triggeredAt;
        const currentStart = alert.firstTriggeredAt || alert.triggeredAt;
        if (currentStart < existingStart) byRule.set(key, alert);
      }
    }
    const sortedAlerts = Array.from(byRule.values()).sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime();
    });
    const activeCount = sortedAlerts.filter(a => a.status === 'active').length;
    
    switch (activeTab) {
      case 'alerts':
        return (
          <div className={`${paddingClass} ${spacingClass} overflow-y-auto h-full`}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className={`${textSizeClass} font-medium text-gray-900 dark:text-gray-100`}>
                  Alerts {activeCount > 0 ? `(${activeCount} active)` : ''}
                </h3>
                {clusterName && (
                  <p className={`${isPanel ? 'text-xs' : 'text-sm'} text-gray-500 dark:text-gray-400`}>
                    Cluster: {clusterName}
                  </p>
                )}
              </div>
            </div>

            <div className={spacingClass}>
              {sortedAlerts.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
                  </div>
                  <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">All Clear!</h4>
                  <p className={`${isPanel ? 'text-xs' : 'text-sm'} text-gray-500 dark:text-gray-400`}>
                    No active alerts at the moment. Your Elasticsearch cluster is running smoothly.
                  </p>
                </div>
              ) : (
                sortedAlerts.slice(0, 50).map(alert => (
                  <AlertItem key={alert.id} alert={alert} compact={isPanel} />
                ))
              )}
            </div>
          </div>
        );

      case 'rules':
        return (
          <div className={`${paddingClass} ${spacingClass} overflow-y-auto h-full`}>
            <h3 className={`${textSizeClass} font-medium text-gray-900 dark:text-gray-100 mb-3`}>
              Alert Rules & Thresholds
            </h3>
            <p className={`${isPanel ? 'text-xs' : 'text-sm'} text-gray-500 dark:text-gray-400 mb-4`}>
              Predefined rules and their thresholds. Alerts trigger when conditions are met.
            </p>
            <div className="space-y-2">
              {rules.map((rule) => {
                const colors = ALERT_COLORS[rule.severity];
                return (
                  <div
                    key={rule.id}
                    className={`rounded-lg border-l-4 ${colors.border} ${colors.bg} p-3 shadow-sm transition-opacity ${!rule.enabled ? 'opacity-70' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className={`font-medium text-sm ${colors.text}`}>
                          {rule.name}
                        </p>
                        <p className={`text-xs ${colors.textSecondary} mt-0.5`}>
                          {rule.description}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs">
                          <span className={`px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} font-medium capitalize`}>
                            {rule.severity}
                          </span>
                          <span className="text-gray-500 dark:text-gray-400 capitalize">
                            {rule.category}
                          </span>
                          <span className="text-gray-600 dark:text-gray-300 font-medium">
                            {formatCondition(rule.condition)} {formatThreshold(rule)}
                          </span>
                          {!rule.enabled && (
                            <span className="text-gray-400 dark:text-gray-500 italic">Disabled</span>
                          )}
                        </div>
                      </div>
                      {onUpdateRule && (
                        <button
                          type="button"
                          onClick={() => onUpdateRule(rule.id, { enabled: !rule.enabled })}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                            rule.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                          title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                          aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              rule.enabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      
      case 'settings':
        return (
          <div className={`${paddingClass} ${spacingClass} overflow-y-auto h-full`}>
            <div className={spacingClass}>
              <h3 className={`${textSizeClass} font-medium text-gray-900 dark:text-gray-100`}>
                General Settings
              </h3>
              
              {/* Enable/Disable Alerts */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-gray-100">Enable Alerts</h4>
                  <p className={`${isPanel ? 'text-xs' : 'text-sm'} text-gray-500 dark:text-gray-400`}>
                    Turn on/off the entire alert system
                  </p>
                </div>
                <button
                  onClick={() => setTempSettings(prev => ({ ...prev, enabled: !prev.enabled }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    tempSettings.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      tempSettings.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Browser Notifications */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex items-center gap-3">
                  <Bell className="h-5 w-5 text-gray-400" />
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-gray-100">Browser Notifications</h4>
                    <p className={`${isPanel ? 'text-xs' : 'text-sm'} text-gray-500 dark:text-gray-400`}>
                      Show browser notifications for critical alerts
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setTempSettings(prev => ({ ...prev, browserNotifications: !prev.browserNotifications }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    tempSettings.browserNotifications ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      tempSettings.browserNotifications ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Sound Alerts */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex items-center gap-3">
                  {tempSettings.soundAlerts ? <Volume2 className="h-5 w-5 text-gray-400" /> : <VolumeX className="h-5 w-5 text-gray-400" />}
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-gray-100">Sound Alerts</h4>
                    <p className={`${isPanel ? 'text-xs' : 'text-sm'} text-gray-500 dark:text-gray-400`}>
                      Play sound for critical alerts
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setTempSettings(prev => ({ ...prev, soundAlerts: !prev.soundAlerts }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    tempSettings.soundAlerts ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      tempSettings.soundAlerts ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleSaveSettings}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Save className="h-4 w-4" />
                Save Settings
              </button>
              <button
                onClick={onResetToDefaults}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <RotateCcw className="h-4 w-4" />
                Reset to Defaults
              </button>
            </div>
          </div>
        );
      
      default:
        return (
          <div className={paddingClass}>
            <p className={`${isPanel ? 'text-xs' : 'text-sm'} text-gray-500 dark:text-gray-400`}>
              This tab content will be implemented soon.
            </p>
          </div>
        );
    }
  };

  // Panel mode - no modal wrapper
  if (isPanel) {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Alert Management
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 flex-shrink-0 overflow-x-auto">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {renderTabContent()}
        </div>
      </div>
    );
  }

  // Modal mode
  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Alert Management
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
});

AlertManagement.displayName = 'AlertManagement';

export default AlertManagement;