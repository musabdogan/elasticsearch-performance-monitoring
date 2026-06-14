import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import {
  brushSelectionToTimeRange,
  formatTimeRangeLabel,
  resolveSelectedBucketKeys,
  TIME_RANGE_PRESETS,
  isSearchResultsPreset,
  type HistogramBucket,
  type TimeRangeFilter,
  type TimeRangePreset,
  type TimeFieldBounds
} from '@/utils/queryTimeHistogram';

type QueryTimeHistogramProps = {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  timePreset: TimeRangePreset;
  onPresetChange: (preset: TimeRangePreset) => void;
  dateFields: string[];
  selectedTimeField: string;
  onTimeFieldChange: (field: string) => void;
  activeRange: TimeRangeFilter;
  brushRange: TimeRangeFilter | null;
  timeFieldBounds?: TimeFieldBounds | null;
  boundsLoading?: boolean;
  buckets: HistogramBucket[];
  loading: boolean;
  fieldsLoading: boolean;
  error: string | null;
  onBrushApply: (range: TimeRangeFilter) => void;
  onBrushClear: () => void;
};

const CHART_HEIGHT = 140;
const CHART_MARGIN = { top: 12, right: 12, left: 0, bottom: 36 };
const Y_AXIS_WIDTH = 56;
const BAR_FILL = '#3b82f6';
const BAR_FILL_SELECTED = '#1d4ed8';

function formatDocCountTick(value: number): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const scaled = value / 1_000_000;
    return abs >= 10_000_000 ? `${Math.round(scaled)}M` : `${scaled.toFixed(1)}M`;
  }
  if (abs >= 1000) {
    const scaled = value / 1000;
    return abs >= 10_000 ? `${Math.round(scaled)}k` : `${scaled.toFixed(1)}k`;
  }
  return String(Math.round(value));
}

function DocCountYAxisTick({
  x,
  y,
  payload
}: {
  x?: number;
  y?: number;
  payload?: { value?: number };
}) {
  if (x == null || y == null || payload?.value == null) return null;
  const label = formatDocCountTick(payload.value);
  if (!label) return null;

  const fontSize = 10;
  const padX = 4;
  const padY = 2;
  const approxCharWidth = 5.8;
  const textWidth = label.length * approxCharWidth;
  const boxWidth = textWidth + padX * 2;
  const boxHeight = fontSize + padY * 2;
  const gapFromPlot = 10;

  return (
    <g transform={`translate(${x},${y})`} pointerEvents="none">
      <rect
        x={-(boxWidth + gapFromPlot)}
        y={-boxHeight / 2}
        width={boxWidth}
        height={boxHeight}
        rx={2}
        className="fill-white stroke-gray-100 dark:fill-gray-900 dark:stroke-gray-800"
        strokeWidth={0.5}
      />
      <text
        x={-(gapFromPlot + padX)}
        y={0}
        dy="0.32em"
        textAnchor="end"
        fill="#9ca3af"
        fontSize={fontSize}
      >
        {label}
      </text>
    </g>
  );
}

function resolveHistogramXTicks(keys: number[]): number[] {
  if (keys.length <= 8) return keys;
  const target = 6;
  const step = Math.max(1, Math.floor(keys.length / target));
  const ticks: number[] = [];
  for (let i = 0; i < keys.length; i += step) ticks.push(keys[i]);
  const last = keys[keys.length - 1];
  if (ticks[ticks.length - 1] !== last) ticks.push(last);
  return ticks;
}

function HistogramTooltip({
  active,
  payload
}: {
  active?: boolean;
  payload?: Array<{ payload?: HistogramBucket }>;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const bucket = payload[0].payload;
  return (
    <div className="rounded border border-gray-200 bg-white px-2 py-1 text-xs shadow dark:border-gray-600 dark:bg-gray-800">
      <div className="text-gray-500 dark:text-gray-400">{bucket.label}</div>
      <div className="font-medium text-gray-900 dark:text-gray-100">{bucket.docCount.toLocaleString()} docs</div>
    </div>
  );
}

export const QueryTimeHistogram = memo(function QueryTimeHistogram({
  collapsed,
  onCollapsedChange,
  timePreset,
  onPresetChange,
  dateFields,
  selectedTimeField,
  onTimeFieldChange,
  activeRange,
  brushRange,
  timeFieldBounds,
  boundsLoading = false,
  buckets,
  loading,
  fieldsLoading,
  error,
  onBrushApply,
  onBrushClear
}: QueryTimeHistogramProps) {
  const [refAreaLeft, setRefAreaLeft] = useState<number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<number | null>(null);
  const selectingRef = useRef(false);

  const chartBusy = loading || boundsLoading || fieldsLoading;

  const chartData = useMemo(
    () => buckets.map((b) => ({ ...b, keyLabel: b.label || String(b.key) })),
    [buckets]
  );

  const xAxisTicks = useMemo(
    () => resolveHistogramXTicks(chartData.map((bucket) => bucket.key)),
    [chartData]
  );

  const selectedBucketKeys = useMemo(
    () => (brushRange ? resolveSelectedBucketKeys(buckets, brushRange) : new Set<number>()),
    [brushRange, buckets]
  );

  const resetSelection = useCallback(() => {
    setRefAreaLeft(null);
    setRefAreaRight(null);
    selectingRef.current = false;
  }, []);

  const handleMouseDown = useCallback(
    (state: { activeLabel?: string | number } | undefined) => {
      if (!state?.activeLabel) return;
      const key = Number(state.activeLabel);
      if (!Number.isFinite(key)) return;
      selectingRef.current = true;
      setRefAreaLeft(key);
      setRefAreaRight(key);
    },
    []
  );

  const handleMouseMove = useCallback(
    (state: { activeLabel?: string | number } | undefined) => {
      if (!selectingRef.current || refAreaLeft == null || !state?.activeLabel) return;
      const key = Number(state.activeLabel);
      if (!Number.isFinite(key)) return;
      setRefAreaRight(key);
    },
    [refAreaLeft]
  );

  const handleMouseUp = useCallback(() => {
    if (!selectingRef.current || refAreaLeft == null || refAreaRight == null) {
      resetSelection();
      return;
    }
    const range = brushSelectionToTimeRange(buckets, refAreaLeft, refAreaRight, selectedTimeField);
    onBrushApply(range);
    resetSelection();
  }, [refAreaLeft, refAreaRight, buckets, selectedTimeField, onBrushApply, resetSelection]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/40">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-2 py-1.5 dark:border-gray-700">
        <button
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          Time chart
        </button>

        {collapsed ? (
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            No time filter — expand to enable
          </span>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => onPresetChange('search')}
                className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                  isSearchResultsPreset(timePreset) && !brushRange
                    ? 'bg-blue-600 text-white dark:bg-blue-500'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                Results
              </button>
              {TIME_RANGE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onPresetChange(preset.id)}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                    timePreset === preset.id && !brushRange
                      ? 'bg-blue-600 text-white dark:bg-blue-500'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {brushRange ? (
                <span
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-0.5 pl-2 pr-1 text-[11px] text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200"
                  title={formatTimeRangeLabel(brushRange)}
                >
                  <span className="truncate">{formatTimeRangeLabel(brushRange)}</span>
                  <button
                    type="button"
                    onClick={onBrushClear}
                    className="rounded-full p-0.5 text-blue-600 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/60"
                    aria-label="Remove time range filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ) : (
                <span
                  className="hidden text-[11px] text-gray-500 dark:text-gray-400 sm:inline"
                  title={formatTimeRangeLabel(activeRange, timePreset, timeFieldBounds)}
                >
                  {formatTimeRangeLabel(activeRange, timePreset, timeFieldBounds)}
                </span>
              )}
              {dateFields.length > 1 ? (
                <select
                  value={selectedTimeField}
                  onChange={(e) => onTimeFieldChange(e.target.value)}
                  className="max-w-[180px] rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  aria-label="Time field"
                >
                  {dateFields.map((field) => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] text-gray-500 dark:text-gray-400">{selectedTimeField}</span>
              )}
              {(loading || fieldsLoading) && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
            </div>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="overflow-visible px-2 pb-2 pt-2">
          {error ? (
            <div className="flex h-24 items-center justify-center text-xs text-amber-700 dark:text-amber-300">
              {error}
            </div>
          ) : chartData.length === 0 && !chartBusy ? (
            <div className="flex h-24 items-center justify-center text-xs text-gray-500 dark:text-gray-400">
              No time data for the selected range.
            </div>
          ) : chartData.length === 0 && chartBusy ? (
            <div className="flex h-24 items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading time range…
            </div>
          ) : (
            <div
              className="w-full select-none overflow-visible [&_.recharts-bar-rectangle]:cursor-pointer"
              style={{ height: CHART_HEIGHT }}
              onMouseLeave={handleMouseUp}
            >
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart
                  data={chartData}
                  margin={CHART_MARGIN}
                  barCategoryGap="12%"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-gray-200 dark:stroke-gray-700" />
                  <XAxis
                    dataKey="key"
                    type="number"
                    scale="linear"
                    domain={['dataMin', 'dataMax']}
                    ticks={xAxisTicks}
                    tickFormatter={(value) => {
                      const bucket = chartData.find((b) => b.key === value);
                      return bucket?.keyLabel ?? '';
                    }}
                    minTickGap={32}
                    height={32}
                    tickMargin={10}
                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <Tooltip content={<HistogramTooltip />} cursor={{ fill: 'rgba(59, 130, 246, 0.12)' }} />
                  <Bar
                    dataKey="docCount"
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                    maxBarSize={48}
                  >
                    {chartData.map((entry) => (
                      <Cell
                        key={entry.key}
                        fill={selectedBucketKeys.has(entry.key) ? BAR_FILL_SELECTED : BAR_FILL}
                      />
                    ))}
                  </Bar>
                  <YAxis
                    width={Y_AXIS_WIDTH}
                    tick={<DocCountYAxisTick />}
                    tickCount={4}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                    domain={[0, (max: number) => (max <= 0 ? 1 : Math.ceil(max * 1.08))]}
                  />
                  {refAreaLeft != null && refAreaRight != null ? (
                    <ReferenceArea
                      x1={Math.min(refAreaLeft, refAreaRight)}
                      x2={Math.max(refAreaLeft, refAreaRight)}
                      strokeOpacity={0.4}
                      fill="#3b82f6"
                      fillOpacity={0.25}
                    />
                  ) : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">
            Click a bar or drag on the chart to filter by time range.
          </p>
        </div>
      )}
    </div>
  );
});
