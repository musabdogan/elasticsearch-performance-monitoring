import { memo, useState, useEffect } from 'react';
import { 
  X, 
  Settings,
  RotateCcw,
  Bell,
  Volume2,
  VolumeX,
  Save,
  Check,
  Trash2
} from 'lucide-react';
import AlertItem from './AlertItem';
import type { 
  AlertInstance, 
  AlertSettings
} from '../../types/alerts';

interface AlertManagementProps {
  isOpen: boolean;
  onClose: () => void;
  history: AlertInstance[];
  settings: AlertSettings;
  alerts?: AlertInstance[];
  clusterName?: string;
  onUpdateSettings?: (updates: Partial<AlertSettings>) => void;
  onResetToDefaults?: () => void;
  onAcknowledge?: (alertId: string) => void;
  onSnooze?: (alertId: string, minutes: number) => void;
  onDismiss?: (alertId: string) => void;
  onClearHistory?: () => void;
  isPanel?: boolean; // New prop for panel mode
}

type TabType = 'alerts' | 'settings';

const AlertManagement = memo<AlertManagementProps>(({
  isOpen,
  onClose,
  settings,
  history,
  alerts = [],
  clusterName,
  onUpdateSettings,
  onResetToDefaults,
  onAcknowledge,
  onSnooze,
  onDismiss,
  onClearHistory,
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
    { id: 'settings' as TabType, label: 'Settings', icon: Settings }
  ];

  const renderTabContent = () => {
    const paddingClass = isPanel ? 'p-3' : 'p-6';
    const spacingClass = isPanel ? 'space-y-3' : 'space-y-4';
    const textSizeClass = isPanel ? 'text-base' : 'text-lg';
    
    // Filter alerts and history by cluster
    const filteredAlerts = clusterName 
      ? alerts.filter(alert => alert.clusterName === clusterName)
      : alerts;
    
    const filteredHistory = clusterName 
      ? history.filter(alert => alert.clusterName === clusterName)
      : history;
    
    switch (activeTab) {
      case 'alerts':
        return (
          <div className={`${paddingClass} ${spacingClass} overflow-y-auto h-full`}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className={`${textSizeClass} font-medium text-gray-900 dark:text-gray-100`}>
                  Active Alerts ({filteredAlerts.length})
                </h3>
                {clusterName && (
                  <p className={`${isPanel ? 'text-xs' : 'text-sm'} text-gray-500 dark:text-gray-400`}>
                    Cluster: {clusterName}
                  </p>
                )}
              </div>
              {filteredAlerts.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => filteredAlerts.forEach(alert => onAcknowledge?.(alert.id))}
                    className={`flex items-center gap-2 px-3 py-1.5 ${isPanel ? 'text-xs' : 'text-sm'} bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors`}
                  >
                    <Check className="h-4 w-4" />
                    Acknowledge All
                  </button>
                  <button
                    onClick={() => filteredAlerts.forEach(alert => onDismiss?.(alert.id))}
                    className={`flex items-center gap-2 px-3 py-1.5 ${isPanel ? 'text-xs' : 'text-sm'} border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors`}
                  >
                    <X className="h-4 w-4" />
                    Dismiss All
                  </button>
                </div>
              )}
            </div>

            <div className={spacingClass}>
              {filteredAlerts.length === 0 ? (
                <div>
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
                    </div>
                    <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">All Clear!</h4>
                    <p className={`${isPanel ? 'text-xs' : 'text-sm'} text-gray-500 dark:text-gray-400`}>
                      No active alerts at the moment. Your Elasticsearch cluster is running smoothly.
                    </p>
                  </div>
                  
                  {/* Show history if available */}
                  {filteredHistory.length > 0 && (
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h4 className={`${textSizeClass} font-medium text-gray-900 dark:text-gray-100`}>
                            Alert History ({filteredHistory.length})
                          </h4>
                          {clusterName && (
                            <p className={`${isPanel ? 'text-xs' : 'text-sm'} text-gray-500 dark:text-gray-400`}>
                              Cluster: {clusterName}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={onClearHistory}
                          className={`flex items-center gap-2 px-3 py-1.5 ${isPanel ? 'text-xs' : 'text-sm'} border border-red-300 dark:border-red-600 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors`}
                        >
                          <Trash2 className="h-4 w-4" />
                          Clear History
                        </button>
                      </div>
                      
                      <div className="space-y-3">
                        {filteredHistory.slice(0, 50).map(alert => (
                          <AlertItem
                            key={alert.id}
                            alert={alert}
                            compact={true}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                filteredAlerts.map(alert => (
                  <AlertItem
                    key={alert.id}
                    alert={alert}
                    onAcknowledge={onAcknowledge}
                    onSnooze={onSnooze}
                    onDismiss={onDismiss}
                    compact={isPanel}
                  />
                ))
              )}
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

              {/* Auto Acknowledge */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-gray-100">Auto Acknowledge Resolved</h4>
                  <p className={`${isPanel ? 'text-xs' : 'text-sm'} text-gray-500 dark:text-gray-400`}>
                    Automatically acknowledge alerts when they are resolved
                  </p>
                </div>
                <button
                  onClick={() => setTempSettings(prev => ({ ...prev, autoAcknowledgeResolved: !prev.autoAcknowledgeResolved }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    tempSettings.autoAcknowledgeResolved ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      tempSettings.autoAcknowledgeResolved ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* History Retention */}
              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">History Retention</h4>
                <p className={`${isPanel ? 'text-xs' : 'text-sm'} text-gray-500 dark:text-gray-400 mb-3`}>
                  Determines how many days alert history will be kept. After this period, old alerts are automatically deleted and cleaned from localStorage.
                </p>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={tempSettings.maxHistoryDays}
                  onChange={(e) => setTempSettings(prev => ({ ...prev, maxHistoryDays: parseInt(e.target.value) || 30 }))}
                  className="w-20 px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
                <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">days</span>
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