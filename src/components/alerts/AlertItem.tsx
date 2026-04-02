import { memo } from 'react';
import { 
  AlertTriangle, 
  AlertCircle, 
  Info, 
  Clock,
  Server,
  Zap,
  Gauge,
  Database,
  Check
} from 'lucide-react';
import type { AlertInstance } from '../../types/alerts';
import { ALERT_COLORS, ALERT_CATEGORY_ICONS } from '../../config/alerts';

interface AlertItemProps {
  alert: AlertInstance;
  compact?: boolean;
  onClick?: (alert: AlertInstance) => void;
}

const AlertItem = memo<AlertItemProps>(({ alert, compact = false, onClick }) => {
  const colors = ALERT_COLORS[alert.severity];
  
  const getSeverityIcon = () => {
    switch (alert.severity) {
      case 'critical':
        return <AlertTriangle className="h-4 w-4" />;
      case 'warning':
        return <AlertCircle className="h-4 w-4" />;
      case 'info':
        return <Info className="h-4 w-4" />;
    }
  };

  const getCategoryIcon = () => {
    const iconName = ALERT_CATEGORY_ICONS[alert.category as keyof typeof ALERT_CATEGORY_ICONS];
    switch (iconName) {
      case 'Server':
        return <Server className="h-3.5 w-3.5" />;
      case 'Zap':
        return <Zap className="h-3.5 w-3.5" />;
      case 'Gauge':
        return <Gauge className="h-3.5 w-3.5" />;
      case 'Database':
        return <Database className="h-3.5 w-3.5" />;
      default:
        return <AlertCircle className="h-3.5 w-3.5" />;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    // Show relative time for recent alerts
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    
    // Show full ISO8601 human-readable format for older alerts
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  const formatDuration = (firstTriggeredAt: string) => {
    const startDate = new Date(firstTriggeredAt);
    const now = new Date();
    const diffMs = now.getTime() - startDate.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins < 1) return 'active for <1 minute';
    if (diffMins < 60) return `active for ${diffMins} minute${diffMins > 1 ? 's' : ''}`;
    if (diffMins < 1440) {
      const hours = Math.floor(diffMins / 60);
      return `active for ${hours} hour${hours > 1 ? 's' : ''}`;
    }
    const days = Math.floor(diffMins / 1440);
    return `active for ${days} day${days > 1 ? 's' : ''}`;
  };

  const formatValue = (value: number | string, unit: string) => {
    if (typeof value === 'string') return value;
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    
    // Percent: show as integer (e.g. 81.65... => 82%)
    if (unit === '%') {
      return `${Math.round(n)}%`;
    }
    
    // Handle byte values
    if (unit === 'bytes') {
      const gb = n / (1024 * 1024 * 1024);
      return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
    }
    
    // Handle milliseconds
    if (unit === 'ms' && n >= 1000) {
      return `${(n / 1000).toFixed(1)} s`;
    }
    
    // Rate (ops/sec, /sec): human-friendly, avoid long decimals (e.g. 0.20048… → "0.2 ops/sec")
    if (unit === 'ops/sec' || unit === '/sec') {
      const decimals = n < 1 ? 2 : n < 10 ? 1 : 0;
      const formatted = n.toFixed(decimals).replace(/\.?0+$/, '');
      return `${formatted} ${unit}`;
    }
    
    // Handle large numbers
    if (typeof value === 'number' && n >= 1000000) {
      return `${(n / 1000000).toFixed(1)}M`;
    }
    
    return `${value} ${unit}`;
  };

  const wrapperClass = `flex items-center gap-2 p-2 rounded-lg border-l-4 ${colors.border} ${colors.bg} transition-all duration-200 ${onClick ? 'cursor-pointer hover:shadow-sm' : 'hover:shadow-sm'}`;

  if (compact) {
    return (
      <div
        className={wrapperClass}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick ? () => onClick(alert) : undefined}
        onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick(alert) : undefined}
      >
        <div className={`${colors.icon} flex-shrink-0`}>
          {getSeverityIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${colors.text} truncate`}>
            {alert.ruleName}
          </p>
          <div className="flex items-center gap-2">
            <p className={`text-xs ${colors.textSecondary} truncate`}>
              {formatValue(alert.currentValue, alert.unit)}
            </p>
            <div className="flex items-center gap-2 text-xs">
              {alert.count && alert.count > 1 && (
                <span className={`${colors.textSecondary} font-medium`}>
                  x{alert.count}
                </span>
              )}
              <span className={`${colors.textSecondary} flex items-center gap-1`}>
                <Clock className="h-3 w-3" />
                {alert.firstTriggeredAt && alert.status === 'active' 
                  ? formatDuration(alert.firstTriggeredAt)
                  : formatTimestamp(alert.triggeredAt)
                }
              </span>
            </div>
          </div>
        </div>
        {alert.status === 'resolved' && (
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Solved
          </span>
        )}
      </div>
    );
  }

  const fullWrapperClass = `rounded-lg border-l-4 ${colors.border} ${colors.bg} p-4 shadow-sm transition-all duration-200 ${onClick ? 'cursor-pointer hover:shadow-md' : 'hover:shadow-md'}`;

  return (
    <div
      className={fullWrapperClass}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick ? () => onClick(alert) : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick(alert) : undefined}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className={`${colors.icon} flex-shrink-0`}>
            {getSeverityIcon()}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className={`font-semibold text-sm ${colors.text} truncate`}>
              {alert.ruleName}
            </h4>
            <div className="flex items-center gap-2 mt-0.5">
              <div className={`${colors.textSecondary} flex items-center gap-1`}>
                {getCategoryIcon()}
                <span className="text-xs capitalize">{alert.category}</span>
              </div>
              {alert.count && alert.count > 1 && (
                <span className={`text-xs ${colors.textSecondary} font-medium`}>
                  x{alert.count}
                </span>
              )}
              <span className={`text-xs ${colors.textSecondary} flex items-center gap-1`}>
                <Clock className="h-3 w-3" />
                {alert.firstTriggeredAt && alert.status === 'active' 
                  ? formatDuration(alert.firstTriggeredAt)
                  : formatTimestamp(alert.triggeredAt)
                }
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className={`text-sm ${colors.textSecondary} mb-3 leading-relaxed`}>
        {alert.description}
      </p>

      {/* Metrics */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <span className={`text-xs ${colors.textSecondary} block`}>Current Value</span>
            <span className={`font-mono text-sm font-semibold ${colors.text}`}>
              {formatValue(alert.currentValue, alert.unit)}
            </span>
          </div>
          <div>
            <span className={`text-xs ${colors.textSecondary} block`}>Threshold</span>
            <span className={`font-mono text-sm ${colors.textSecondary}`}>
              {formatValue(alert.threshold, alert.unit)}
            </span>
          </div>
        </div>
        
        {/* Status: Solved (green tick) or Active badge */}
        {alert.status === 'resolved' ? (
          <span className="flex shrink-0 items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Solved
          </span>
        ) : (
          <div className={`px-2 py-1 rounded-full text-xs font-medium ${colors.badge} text-white`}>
            Active
          </div>
        )}
      </div>

      {/* Additional Info for Node/Index specific alerts */}
      {(alert.nodeId || alert.indexName) && (
        <div className={`mt-2 pt-2 border-t border-current/20`}>
          <div className="flex items-center gap-2">
            {alert.nodeId && (
              <span className={`text-xs ${colors.textSecondary}`}>
                Node: <span className="font-mono">{alert.nodeId}</span>
              </span>
            )}
            {alert.indexName && (
              <span className={`text-xs ${colors.textSecondary}`}>
                Index: <span className="font-mono">{alert.indexName}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

AlertItem.displayName = 'AlertItem';

export default AlertItem;