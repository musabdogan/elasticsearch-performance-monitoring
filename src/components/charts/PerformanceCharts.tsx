import { memo } from 'react';
import PerformanceChart from './PerformanceChart';
import type { ChartDataPoint } from '@/types/api';

interface PerformanceChartsProps {
  data: ChartDataPoint[];
}

const PerformanceCharts = memo<PerformanceChartsProps>(({ data }) => {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        <div className="text-center">
          <div className="text-sm">Collecting performance data...</div>
          <div className="text-xs mt-1">Charts will appear after a few updates</div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <PerformanceChart
        data={data}
        dataKey="indexingRate"
        title="Indexing Rate"
        color="#10b981"
        unit="/sec"
      />
      <PerformanceChart
        data={data}
        dataKey="searchRate"
        title="Search Rate"
        color="#06b6d4"
        unit="/sec"
      />
      <PerformanceChart
        data={data}
        dataKey="indexLatency"
        title="Index Latency"
        color="#f59e0b"
        unit="ms"
      />
      <PerformanceChart
        data={data}
        dataKey="searchLatency"
        title="Search Latency"
        color="#ef4444"
        unit="ms"
      />
    </div>
  );
});

PerformanceCharts.displayName = 'PerformanceCharts';

export default PerformanceCharts;
