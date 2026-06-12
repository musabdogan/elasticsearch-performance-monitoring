/**
 * Progress bar for 0–100% values.
 * Colors: green ≤70%, yellow &gt;70–80%, red &gt;80%.
 */
export function ProgressBar({
  value,
  max = 100,
  showLabel = true,
  compact = false,
  labelPosition = 'right',
  rightLabel,
  variant = 'default',
  className = ''
}: {
  value: number | null;
  max?: number;
  showLabel?: boolean;
  /** Compact: for cluster summary cards (darker track, smaller label) */
  compact?: boolean;
  /** Label above bar (e.g. in Nodes table) or to the right */
  labelPosition?: 'right' | 'top';
  /** Optional right-aligned text above bar (e.g. "4.5gb/6gb") when labelPosition="top" */
  rightLabel?: string;
  /** Use lighter track on colored cards (cluster summary) for better contrast */
  variant?: 'default' | 'card';
  className?: string;
}) {
  if (value == null) return <span className="text-gray-400 text-xs">—</span>;
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const barColor =
    pct > 80 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-600 dark:bg-emerald-500';
  const trackClass = variant === 'card' ? 'bg-slate-200 dark:bg-white/25' : 'bg-gray-500/80';

  if (compact) {
    return (
      <div className={`flex items-center gap-2 w-full min-w-0 ${className}`}>
        <div className={`flex-1 min-w-0 h-2 rounded overflow-hidden ${trackClass}`}>
          <div
            className={`h-full rounded transition-all duration-300 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {showLabel && (
          <span className="text-[10px] font-bold tabular-nums text-white shrink-0">
            {value.toFixed(0)}%
          </span>
        )}
      </div>
    );
  }

  if (labelPosition === 'top') {
    return (
      <div className={`flex flex-col gap-0.5 w-full min-w-[72px] tab-content-value ${className}`}>
        {(showLabel || rightLabel) && (
          <div className="flex justify-between items-baseline gap-1 min-w-0">
            {showLabel && (
              <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-300 shrink-0">
                {value.toFixed(0)}%
              </span>
            )}
            {rightLabel && (
              <span className="tabular-nums text-gray-500 dark:text-gray-400 text-right truncate">
                {rightLabel}
              </span>
            )}
          </div>
        )}
        <div className="w-full h-2 rounded overflow-hidden bg-gray-200 dark:bg-gray-600">
          <div
            className={`h-full rounded transition-all duration-300 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 w-full min-w-[72px] ${className}`}>
      <div className="flex-1 min-w-0 h-2 rounded overflow-hidden bg-gray-200 dark:bg-gray-600">
        <div
          className={`h-full rounded transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs tabular-nums w-7 text-right shrink-0 text-gray-700 dark:text-gray-300">
          {value.toFixed(0)}%
        </span>
      )}
    </div>
  );
}
