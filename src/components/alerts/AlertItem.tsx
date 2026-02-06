import { memo } from 'react';
import { 
  AlertTriangle, 
  AlertCircle, 
  Info, 
  X, 
  Check, 
  Clock,
  Server,
  Zap,
  Gauge,
  Database
} from 'lucide-react';
import type { AlertInstance } from '../../types/alerts';
import { ALERT_COLORS, ALERT_CATEGORY_ICONS } from '../../config/alerts';

interface AlertItemProps {
  alert: AlertInstance;
  onAcknowledge?: (alertId: string) => void;
  onSnooze?: (alertId: string, minutes: number) => void;
  onDismiss?: (alertId: string) => void;
  compact?: boolean;
}

const AlertItem = memo<AlertItemProps>(({ 
  alert, 
  onAcknowledge, 
  onSnooze, 
  onDismiss, 
  compact = false 
}) => {
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
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const formatValue = (value: number | string, unit: string) => {
    if (typeof value === 'string') return value;
    
    // Handle byte values
    if (unit === 'bytes') {
      const gb = value / (1024 * 1024 * 1024);
      return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }
    
    // Handle milliseconds
    if (unit === 'ms' && value >= 1000) {
      return `${(value / 1000).toFixed(1)} s`;
    }
    
    // Handle large numbers
    if (typeof value === 'number' && value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    }
    
    return `${value}${unit}`;
  };

  if (compact) {
    return (
      <div className={`flex items-center gap-2 p-2 rounded-lg border-l-4 ${colors.border} ${colors.bg} transition-all duration-200 hover:shadow-sm`}>
        <div className={`${colors.icon} flex-shrink-0`}>
          {getSeverityIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${colors.text} truncate`}>
            {alert.ruleName}
          </p>
          <p className={`text-xs ${colors.textSecondary} truncate`}>
            {formatValue(alert.currentValue, alert.unit)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {onAcknowledge && (
            <button
              onClick={() => onAcknowledge(alert.id)}
              className={`p-1 rounded hover:bg-white/20 ${colors.icon} transition-colors`}
              title="Acknowledge"
            >
              <Check className="h-3 w-3" />
            </button>
          )}
          {onDismiss && (
            <button
              onClick={() => onDismiss(alert.id)}
              className={`p-1 rounded hover:bg-white/20 ${colors.icon} transition-colors`}
              title="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border-l-4 ${colors.border} ${colors.bg} p-4 shadow-sm transition-all duration-200 hover:shadow-md`}>
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
              <span className={`text-xs ${colors.textSecondary}`}>
                {formatTimestamp(alert.triggeredAt)}
              </span>
            </div>
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {onSnooze && (
            <button
              onClick={() => onSnooze(alert.id, 30)}
              className={`p-1.5 rounded-md hover:bg-white/20 ${colors.icon} transition-colors`}
              title="Snooze for 30 minutes"
            >
              <Clock className="h-3.5 w-3.5" />
            </button>
          )}
          {onAcknowledge && (
            <button
              onClick={() => onAcknowledge(alert.id)}
              className={`p-1.5 rounded-md hover:bg-white/20 ${colors.icon} transition-colors`}
              title="Acknowledge"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          )}
          {onDismiss && (
            <button
              onClick={() => onDismiss(alert.id)}
              className={`p-1.5 rounded-md hover:bg-white/20 ${colors.icon} transition-colors`}
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
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
        
        {/* Status Badge */}
        <div className={`px-2 py-1 rounded-full text-xs font-medium ${colors.badge} text-white`}>
          {alert.status.charAt(0).toUpperCase() + alert.status.slice(1)}
        </div>
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