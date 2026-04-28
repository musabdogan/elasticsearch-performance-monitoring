import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useMonitoring } from '@/context/MonitoringProvider';
import { ClusterSelector } from '@/components/layout/ClusterSelector';
import { Bell, Home, RefreshCw } from 'lucide-react';

export type MainTab =
  | 'indexing-search'
  | 'cluster'
  | 'nodes'
  | 'indices'
  | 'templates'
  | 'snapshots';

const TAB_LABELS: Record<MainTab, string> = {
  'indexing-search': 'Indexing & Search',
  'cluster': 'Cluster',
  'nodes': 'Nodes',
  'indices': 'Indices',
  'templates': 'Templates',
  'snapshots': 'Snapshots'
};

export interface PageHeaderProps {
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Tabs shown in header (top right); when set, tab bar is rendered */
  mainTab?: MainTab;
  onTabChange?: (tab: MainTab) => void;
  onOpenAlerts?: () => void;
  onOpenWelcome?: () => void;
  /** Badge shows total active alert count; when 0, badge is hidden */
  alertCount?: number;
  /** Critical alert count for red badge styling */
  criticalCount?: number;
}

export function PageHeader({ onRefresh, refreshing = false, mainTab, onTabChange, onOpenAlerts, onOpenWelcome, alertCount = 0, criticalCount = 0 }: PageHeaderProps) {
  const { activeCluster } = useMonitoring();
  const isIndexingSearchTab = mainTab === 'indexing-search';
  // Disable when auto-refresh tab or when any refresh (global or tab-specific) is in progress
  const refreshDisabled = isIndexingSearchTab || refreshing;
  const refreshTitle = isIndexingSearchTab
    ? 'Refresh is automatic on this tab to keep rate calculations accurate'
    : 'Refresh cluster data';

  const criticalAlerts = criticalCount;

  return (
    <header className="flex-shrink-0 border-b border-gray-200 bg-white px-3 py-1.5 shadow-sm transition-colors duration-300 dark:border-gray-700 dark:bg-gray-800">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Brand anchor - far left (standard nav pattern) */}
          <img
            src="/icons/searchali_logo.png"
            alt="Searchali"
            className="h-5 w-auto flex-shrink-0"
          />
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-600" aria-hidden />
          {/* Home */}
          {onOpenWelcome && (
            <button
              onClick={onOpenWelcome}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors"
              title="Home"
            >
              <Home className="h-5 w-5" />
            </button>
          )}
          {/* Clusters */}
          <div data-tour="cluster-selector">
            <ClusterSelector />
          </div>
        </div>
        <div className="flex items-center justify-center min-w-0 px-2">
          <h1
            className="font-semibold text-gray-900 dark:text-gray-100 text-center whitespace-nowrap"
            style={{ fontSize: 'clamp(0.625rem, 1.5vw + 0.5rem, 0.875rem)' }}
          >
            Elasticsearch Performance Monitoring
          </h1>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 justify-end pr-6">
          {/* Tabs */}
          {mainTab != null && onTabChange && (
            <div className="flex gap-0 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden mr-1">
              {(
                [
                  'indexing-search',
                  'cluster',
                  'nodes',
                  'indices',
                  'templates',
                  'snapshots'
                ] as const
              ).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => onTabChange(tab)}
                  data-tour={tab === 'indices' ? 'tab-indices' : tab === 'snapshots' ? 'tab-snapshots' : undefined}
                  className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    mainTab === tab
                      ? 'bg-blue-600 text-white dark:bg-blue-500'
                      : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
            </div>
          )}
          {/* Global Refresh - disabled on Indexing & Search tab (to keep rate calculations accurate) */}
          {activeCluster && onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshDisabled}
              title={refreshTitle}
              data-tour="refresh"
              className="flex items-center gap-1 p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="text-xs sr-only">Refresh</span>
            </button>
          )}
          {/* Alert Button */}
          {activeCluster && onOpenAlerts && (
            <button
              onClick={onOpenAlerts}
              className={`relative p-2 rounded-lg transition-colors ${
                alertCount > 0
                  ? criticalAlerts > 0
                    ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
                    : 'text-yellow-600 hover:bg-yellow-50 dark:text-yellow-400 dark:hover:bg-yellow-900/20'
                  : 'text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-gray-700'
              }`}
              title={`${alertCount} active alerts`}
            >
              <Bell className={`h-5 w-5 ${criticalAlerts > 0 ? 'animate-pulse' : ''}`} />
              {alertCount > 0 && (
                <span className={`absolute -top-1 -right-1 h-4 w-4 rounded-full text-xs font-bold text-white flex items-center justify-center ${
                  criticalAlerts > 0 ? 'bg-red-500' : 'bg-yellow-500'
                }`}>
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </button>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

