import { useMonitoring } from '@/context/MonitoringProvider';

type SearchTabContentProps = {
  onRefreshStateChange?: (loading: boolean) => void;
};

export function SearchTabContent({ onRefreshStateChange }: SearchTabContentProps = {}) {
  const { activeCluster } = useMonitoring();
  void onRefreshStateChange;

  if (!activeCluster) {
    return (
      <div className="rounded-lg border border-gray-300 bg-white p-8 text-center text-sm text-gray-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400">
        Select a cluster to use Search.
      </div>
    );
  }

  return (
    <section className="tab-section-card">
      <div className="tab-section-header">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Search</h2>
      </div>
      <div className="tab-section-body">
        <div className="flex min-h-[220px] items-center justify-center">
          <span className="text-sm text-gray-700 dark:text-gray-300">Coming soon...</span>
        </div>
      </div>
    </section>
  );
}

