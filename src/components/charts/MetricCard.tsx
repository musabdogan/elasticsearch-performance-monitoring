import { memo } from 'react';
import SparklineChart from './SparklineChart';
import type { ChartDataPoint } from '@/types/api';

interface MetricCardProps {
  title: string;
  value: number;
  unit: string;
  data: ChartDataPoint[];
  dataKey: keyof ChartDataPoint;
  color: string;
  icon?: React.ReactNode;
}

const MetricCard = memo<MetricCardProps>(({
  title,
  value,
  unit,
  data,
  dataKey,
  color,
  icon
}) => {
  const formatValue = (val: number) => {
    if (dataKey.includes('Rate')) {
      return val.toFixed(1);
    }
    if (dataKey.includes('Latency')) {
      // Convert to seconds if >= 1000ms
      if (val >= 1000) {
        return (val / 1000).toFixed(2);
      }
      return val.toFixed(2);
    }
    return val.toLocaleString();
  };

  const getUnit = () => {
    if (dataKey.includes('Latency') && value >= 1000) {
      return 's'; // seconds
    }
    return unit; // original unit (ms or /sec)
  };

  const getTrend = () => {
    if (data.length < 2) return null;

    const recent = data.slice(-5);
    const first = recent[0]?.[dataKey] as number;
    const last = recent[recent.length - 1]?.[dataKey] as number;

    if (!first || !last) return null;

    const change = ((last - first) / first) * 100;
    const isPositive = change > 0;

    return {
      value: Math.abs(change),
      isPositive,
      direction: isPositive ? 'up' : 'down'
    };
  };

  const trend = getTrend();

  return (
    <div className="rounded-md bg-gradient-to-br from-white to-gray-50 p-2 shadow dark:from-gray-800 dark:to-gray-900/50 dark:border dark:border-gray-700">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          {icon && <div className="text-gray-600 dark:text-gray-400 shrink-0">{icon}</div>}
          <h3 className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 truncate">
            {title}
          </h3>
        </div>
        {trend && (
          <div className={`flex items-center gap-0.5 text-[11px] shrink-0 ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
            <span>{trend.isPositive ? '↑' : '↓'}</span>
            <span>{trend.value.toFixed(1)}%</span>
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-1">
        <div className="min-w-0">
          <div className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-baseline gap-1 flex-wrap">
            <span>{formatValue(value)}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">{getUnit()}</span>
          </div>
        </div>
        <div className="w-12 h-6 shrink-0">
          <SparklineChart
            data={data}
            dataKey={dataKey}
            color={color}
            height={24}
          />
        </div>
      </div>
    </div>
  );
});

MetricCard.displayName = 'MetricCard';

export default MetricCard;
