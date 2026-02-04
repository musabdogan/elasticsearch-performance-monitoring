import { memo } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import type { ChartDataPoint } from '@/types/api';

interface SparklineChartProps {
  data: ChartDataPoint[];
  dataKey: keyof ChartDataPoint;
  color: string;
  height?: number;
}

const SparklineChart = memo<SparklineChartProps>(({
  data,
  dataKey,
  color,
  height = 40
}) => {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          activeDot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
});

SparklineChart.displayName = 'SparklineChart';

export default SparklineChart;
