import { useMemo, useState } from 'react';
import { Activity, Clock, TrendingUp, Zap } from 'lucide-react';
import { useMonitoring } from '@/context/MonitoringProvider';
import MetricCard from '@/components/charts/MetricCard';
import IndexTable from '@/components/data/IndexTable';
import NodeTable from '@/components/data/NodeTable';
import { InfoPopup } from '@/components/ui/InfoPopup';
import { formatRelativeTime } from '@/utils/format';
import type { OpenIndexDetailsFn } from '@/types/indexDetail';

const INDEXING_POLL_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
  { label: '60s', value: 60000 }
];

interface IndexingSearchTabContentProps {
  onOpenIndexDetails: OpenIndexDetailsFn;
  onOpenIndexDiagnosis?: (indexName: string, searchLatencyMs: number) => void;
  onOpenNodeDetails?: (nodeName: string) => void;
}

export function IndexingSearchTabContent({
  onOpenIndexDetails,
  onOpenIndexDiagnosis,
  onOpenNodeDetails
}: IndexingSearchTabContentProps) {
  const {
    snapshot,
    prevSnapshot,
    performanceMetrics,
    pollInterval,
    setPollInterval,
    lastUpdated,
    loading,
    isClusterUnreachable
  } = useMonitoring();
  const [clusterStatsInfoOpen, setClusterStatsInfoOpen] = useState(false);

  const performanceData = useMemo(() => {
    if (!snapshot) return null;
    return {
      metrics: performanceMetrics,
      indices: snapshot.indices
    };
  }, [snapshot, performanceMetrics]);

  if (isClusterUnreachable) {
    return null;
  }

  if (!snapshot || !performanceData) {
    if (!loading) {
      return null;
    }
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-gray-300 bg-white p-8 dark:bg-gray-800 dark:border-gray-600">
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading cluster data…</p>
      </div>
    );
  }

  return (
    <>
      <section className="rounded-lg border border-gray-300 bg-white shadow dark:bg-gray-800 dark:border-gray-600 flex-shrink-0">
        <div className="flex items-stretch gap-2 p-2">
          <div className="flex items-center gap-2 shrink-0 pr-2 border-r border-gray-200 dark:border-gray-600">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Cluster Statistics</h2>
            <InfoPopup
              title="Cluster Statistics"
              modalTitle="Cluster Statistics - API & Calculations"
              open={clusterStatsInfoOpen}
              onOpen={() => setClusterStatsInfoOpen(true)}
              onClose={() => setClusterStatsInfoOpen(false)}
            >
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">API Endpoint</h3>
                  <code className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">/_nodes/stats/indices</code>
                  <p className="mt-1">Aggregates indexing and search statistics from all cluster nodes.</p>
                </div>
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">Metrics</h3>
                  <ul className="text-xs space-y-1 list-disc list-inside">
                    <li><strong>Indexing Rate</strong> — indexing operations per second (index_total delta over time).</li>
                    <li><strong>Search Rate</strong> — search queries per second (query_total delta over time).</li>
                    <li><strong>Index Latency</strong> — average time per indexing op (index_time_in_millis / index_total).</li>
                    <li><strong>Search Latency</strong> — average time per search query (query_time_in_millis / query_total).</li>
                  </ul>
                </div>
              </div>
            </InfoPopup>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 flex-1 min-w-0">
            <MetricCard title="Indexing Rate" value={performanceData.metrics.indexingRate} unit="/sec" data={[]} dataKey="indexingRate" color="#10b981" icon={<TrendingUp className="h-3.5 w-3.5" />} />
            <MetricCard title="Search Rate" value={performanceData.metrics.searchRate} unit="/sec" data={[]} dataKey="searchRate" color="#06b6d4" icon={<Activity className="h-3.5 w-3.5" />} />
            <MetricCard title="Index Latency" value={performanceData.metrics.indexLatency} unit="ms" data={[]} dataKey="indexLatency" color="#f59e0b" icon={<Clock className="h-3.5 w-3.5" />} />
            <MetricCard title="Search Latency" value={performanceData.metrics.searchLatency} unit="ms" data={[]} dataKey="searchLatency" color="#ef4444" icon={<Zap className="h-3.5 w-3.5" />} />
          </div>
          <div className="flex items-center gap-2 shrink-0 pl-2 border-l border-gray-200 dark:border-gray-600">
            <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
              <span>Interval:</span>
              <select
                className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                value={pollInterval}
                onChange={(e) => setPollInterval(Number(e.target.value))}
              >
                {INDEXING_POLL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            {lastUpdated && (
              <span
                className="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap"
                title={`Updated at ${new Date(lastUpdated).toLocaleTimeString('en-US')}`}
              >
                Updated {formatRelativeTime(lastUpdated)}
              </span>
            )}
          </div>
        </div>
      </section>
      <section className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <IndexTable
            variant="panel"
            data={performanceData.indices}
            indexStats={snapshot.indexStats}
            prevIndexStats={prevSnapshot?.indexStats}
            fetchedAt={snapshot.fetchedAt}
            prevFetchedAt={prevSnapshot?.fetchedAt}
            pollIntervalMs={pollInterval}
            onOpenIndexDetails={onOpenIndexDetails}
            onOpenIndexDiagnosis={onOpenIndexDiagnosis}
          />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {snapshot.nodeStats && (
            <NodeTable
              variant="panel"
              nodeStats={snapshot.nodeStats}
              nodes={snapshot.nodes}
              onOpenNodeDetails={onOpenNodeDetails}
            />
          )}
        </div>
      </section>
    </>
  );
}
