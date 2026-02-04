import { memo } from 'react';

interface ProgressBarProps {
  /** Percentage value (0-100) */
  percent: number;
  /** Additional CSS classes for the wrapper */
  className?: string;
  /** Additional CSS classes for the filled bar */
  barClassName?: string;
  /** Color variant based on percentage thresholds */
  colorByThreshold?: boolean;
}

/**
 * Horizontal progress bar component.
 * Optionally colors the bar based on percentage thresholds:
 * - Green: 0-70%
 * - Yellow: 70-85%
 * - Red: 85-100%
 */
const ProgressBar = memo<ProgressBarProps>(({
  percent,
  className = '',
  barClassName = '',
  colorByThreshold = true
}) => {
  // Clamp percent to 0-100
  const clampedPercent = Math.max(0, Math.min(100, percent));

  // Determine bar color based on threshold
  const getBarColor = () => {
    if (!colorByThreshold) {
      return 'bg-blue-500 dark:bg-blue-400';
    }
    if (clampedPercent >= 85) {
      return 'bg-red-500 dark:bg-red-400';
    }
    if (clampedPercent >= 70) {
      return 'bg-yellow-500 dark:bg-yellow-400';
    }
    return 'bg-green-500 dark:bg-green-400';
  };

  return (
    <div
      className={`h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden ${className}`}
    >
      <div
        className={`h-full rounded-full transition-all duration-300 ${getBarColor()} ${barClassName}`}
        style={{ width: `${clampedPercent}%` }}
      />
    </div>
  );
});

ProgressBar.displayName = 'ProgressBar';

export default ProgressBar;
