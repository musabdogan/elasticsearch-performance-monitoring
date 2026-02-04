import { memo } from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import type { ChartDataPoint } from '@/types/api';

interface PerformanceChartProps {
  data: ChartDataPoint[];
  dataKey: keyof ChartDataPoint;
  title: string;
  color: string;
  unit: string;
  height?: number;
}

const PerformanceChart = memo<PerformanceChartProps>(({
  data,
  dataKey,
  title,
  color,
  unit,
  height = 120
}) => {
  // Format tooltip values
  const formatValue = (value: number) => {
    if (dataKey.includes('Rate')) {
      return `${value.toFixed(1)} ${unit}`;
    }
    return `${value.toFixed(2)} ${unit}`;
  };

  // Format X-axis labels (show time)
  const formatXAxisLabel = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="flex flex-col">
      <h4 className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
        {title}
      </h4>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatXAxisLabel}
            tick={{ fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            labelFormatter={(timestamp) => new Date(timestamp).toLocaleTimeString()}
            formatter={(value: number) => [formatValue(value), title]}
            contentStyle={{
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px'
            }}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: color }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

PerformanceChart.displayName = 'PerformanceChart';

export default PerformanceChart;
