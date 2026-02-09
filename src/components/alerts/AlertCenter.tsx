import { memo, useState, useMemo } from 'react';
import { 
  Bell, 
  Settings, 
  ChevronDown, 
  ChevronUp, 
  Filter,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info
} from 'lucide-react';
import AlertItem from './AlertItem';
import type { AlertInstance, AlertSeverity } from '../../types/alerts';
import { ALERT_COLORS } from '../../config/alerts';

interface AlertCenterProps {
  alerts: AlertInstance[];
  onOpenManagement?: () => void;
  className?: string;
}

type FilterType = 'all' | AlertSeverity;

const AlertCenter = memo<AlertCenterProps>(({ 
  alerts, 
  onOpenManagement,
  className = '' 
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Filter alerts based on active filter
  const filteredAlerts = useMemo(() => {
    if (activeFilter === 'all') return alerts;
    return alerts.filter(alert => alert.severity === activeFilter);
  }, [alerts, activeFilter]);

  // Group alerts by severity for stats
  const alertStats = useMemo(() => {
    const stats = { critical: 0, warning: 0, info: 0 };
    alerts.forEach(alert => {
      stats[alert.severity]++;
    });
    return stats;
  }, [alerts]);

  const totalAlerts = alerts.length;
  const hasAlerts = totalAlerts > 0;

  const getFilterIcon = (severity: AlertSeverity) => {
    switch (severity) {
      case 'critical':
        return <AlertTriangle className="h-3.5 w-3.5" />;
      case 'warning':
        return <AlertCircle className="h-3.5 w-3.5" />;
      case 'info':
        return <Info className="h-3.5 w-3.5" />;
    }
  };

  return (
    <div className={`fixed right-4 top-16 bottom-20 w-80 z-50 flex flex-col ${className}`}>
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-t-lg border-x border-t border-gray-200 dark:border-gray-700 px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Bell className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              {hasAlerts && (
                <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center font-medium">
                  {totalAlerts > 9 ? '9+' : totalAlerts}
                </div>
              )}
            </div>
            <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100">
              Alerts
            </h3>
            {hasAlerts && (
              <div className="flex items-center gap-1">
                {alertStats.critical > 0 && (
                  <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full font-medium">
                    {alertStats.critical}
                  </span>
                )}
                {alertStats.warning > 0 && (
                  <span className="bg-yellow-500 text-white text-xs px-1.5 py-0.5 rounded-full font-medium">
                    {alertStats.warning}
                  </span>
                )}
                {alertStats.info > 0 && (
                  <span className="bg-blue-500 text-white text-xs px-1.5 py-0.5 rounded-full font-medium">
                    {alertStats.info}
                  </span>
                )}
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-1">
            {/* Filter Button */}
            {hasAlerts && (
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`p-1.5 rounded-md transition-colors ${
                  showFilters 
                    ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' 
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                title="Filter alerts"
              >
                <Filter className="h-4 w-4" />
              </button>
            )}
            
            {/* Settings Button */}
            {onOpenManagement && (
              <button
                onClick={onOpenManagement}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="Alert settings"
              >
                <Settings className="h-4 w-4" />
              </button>
            )}
            
            {/* Expand/Collapse Button */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Filters */}
        {showFilters && hasAlerts && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setActiveFilter('all')}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeFilter === 'all'
                    ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                All ({totalAlerts})
              </button>
              
              {(['critical', 'warning', 'info'] as AlertSeverity[]).map(severity => {
                const count = alertStats[severity];
                if (count === 0) return null;
                
                const colors = ALERT_COLORS[severity];
                return (
                  <button
                    key={severity}
                    onClick={() => setActiveFilter(severity)}
                    className={`px-2 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                      activeFilter === severity
                        ? `${colors.badge} text-white`
                        : `text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700`
                    }`}
                  >
                    {getFilterIcon(severity)}
                    {severity.charAt(0).toUpperCase() + severity.slice(1)} ({count})
                  </button>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {/* Alert List */}
      {isExpanded && (
        <div className="flex-1 bg-white dark:bg-gray-800 border-x border-gray-200 dark:border-gray-700 overflow-hidden">
          {!hasAlerts ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-3">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <h4 className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-1">
                All Clear!
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                No active alerts at the moment
              </p>
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mb-3">
                <Filter className="h-6 w-6 text-gray-400" />
              </div>
              <h4 className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-1">
                No Matching Alerts
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Try adjusting your filter criteria
              </p>
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-2 space-y-2">
              {filteredAlerts.map(alert => (
                <AlertItem key={alert.id} alert={alert} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="bg-gray-50 dark:bg-gray-700 rounded-b-lg border border-gray-200 dark:border-gray-700 px-4 py-2">
        {isExpanded ? (
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>
              {filteredAlerts.length} of {totalAlerts} alerts
            </span>
            <span>
              Last updated: {new Date().toLocaleTimeString()}
            </span>
          </div>
        ) : (
          <div className="text-center">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {totalAlerts} alert{totalAlerts !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

AlertCenter.displayName = 'AlertCenter';

export default AlertCenter;