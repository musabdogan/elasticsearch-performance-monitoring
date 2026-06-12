import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { SearchAliWordmark } from '@/components/brand/SearchAliWordmark';
import { useMonitoring } from '@/context/MonitoringProvider';
import { ClusterSelector } from '@/components/layout/ClusterSelector';
import { Bell, Home, RefreshCw } from 'lucide-react';

export type MainTab =
  | 'indexing-search'
  | 'cluster'
  | 'nodes'
  | 'indices'
  | 'search'
  | 'shards'
  | 'templates'
  | 'snapshots';

const TAB_LABELS: Record<MainTab, string> = {
  'indexing-search': 'Indexing & Search',
  cluster: 'Cluster',
  nodes: 'Nodes',
  indices: 'Indices',
  search: 'Query',
  shards: 'Shards',
  templates: 'Templates',
  snapshots: 'Snapshots'
};

const TAB_ORDER: MainTab[] = [
  'indexing-search',
  'cluster',
  'nodes',
  'indices',
  'shards',
  'templates',
  'search',
  'snapshots'
];

export interface PageHeaderProps {
  onRefresh?: () => void;
  refreshing?: boolean;
  mainTab?: MainTab;
  onTabChange?: (tab: MainTab) => void;
  onOpenAlerts?: () => void;
  onOpenWelcome?: () => void;
  alertCount?: number;
  criticalCount?: number;
}

export function PageHeader({
  onRefresh,
  refreshing = false,
  mainTab,
  onTabChange,
  onOpenAlerts,
  onOpenWelcome,
  alertCount = 0,
  criticalCount = 0
}: PageHeaderProps) {
  const { activeCluster } = useMonitoring();
  const isIndexingSearchTab = mainTab === 'indexing-search';
  const isShardsTab = mainTab === 'shards';
  const refreshDisabled = isIndexingSearchTab || isShardsTab || refreshing;
  const refreshTitle =
    isIndexingSearchTab || isShardsTab
      ? 'Refresh is automatic on this tab to keep rate calculations accurate'
      : 'Refresh cluster data';

  const showTabs = mainTab != null && onTabChange;

  return (
    <header className="relative flex-shrink-0 border-b border-slate-200 bg-white px-3 py-2 shadow-sm transition-colors duration-300 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex min-w-0 items-center gap-2 pr-[7.25rem]">
        <div className="flex shrink-0 items-center gap-2">
          <SearchAliWordmark heightClass="h-8" />
          <div className="h-6 w-px bg-gray-200 dark:bg-gray-600" aria-hidden />
          {onOpenWelcome && (
            <button
              onClick={onOpenWelcome}
              className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              title="Home"
            >
              <Home className="h-5 w-5" />
            </button>
          )}
          <div data-tour="cluster-selector">
            <ClusterSelector />
          </div>
        </div>

        {showTabs && (
          <div className="min-w-0 flex-1 overflow-x-auto">
            <div className="flex w-max min-w-full justify-center gap-1 px-1">
              {TAB_ORDER.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => onTabChange(tab)}
                  data-tour={
                    tab === 'indices'
                      ? 'tab-indices'
                      : tab === 'snapshots'
                        ? 'tab-snapshots'
                        : tab === 'search'
                          ? 'tab-query'
                          : undefined
                  }
                  className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    mainTab === tab
                      ? 'bg-blue-600 text-white dark:bg-blue-500'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 rounded-lg bg-white pl-1 dark:bg-gray-800">
          {activeCluster && onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshDisabled}
              title={refreshTitle}
              data-tour="refresh"
              className="flex items-center gap-1 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="sr-only">Refresh</span>
            </button>
          )}
          {activeCluster && onOpenAlerts && (
            <button
              onClick={onOpenAlerts}
              className={`relative rounded-lg p-2 transition-colors ${
                alertCount > 0
                  ? criticalCount > 0
                    ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
                    : 'text-yellow-600 hover:bg-yellow-50 dark:text-yellow-400 dark:hover:bg-yellow-900/20'
                  : 'text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-gray-700'
              }`}
              title={`${alertCount} active alerts`}
            >
              <Bell className={`h-5 w-5 ${criticalCount > 0 ? 'animate-pulse' : ''}`} />
              {alertCount > 0 && (
                <span
                  className={`absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-xs font-bold text-white ${
                    criticalCount > 0 ? 'bg-red-500' : 'bg-yellow-500'
                  }`}
                >
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </button>
          )}
          <ThemeToggle />
      </div>
    </header>
  );
}
