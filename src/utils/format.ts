import type { ClusterStatus } from '@/types/api';

export function formatNumber(value: number): string {
  return Intl.NumberFormat('en-US').format(value);
}

/**
 * Format bytes to human-readable string (B, KB, MB, GB, TB)
 */
export function formatBytes(bytes: number | string): string {
  const n = typeof bytes === 'number' ? bytes : parseInt(String(bytes), 10) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function statusToColor(status: ClusterStatus): string {
  switch (status) {
    case 'green':
      return 'bg-emerald-500 text-white border-emerald-600 dark:bg-emerald-600 dark:border-emerald-500';
    case 'yellow':
      return 'bg-amber-500 text-white border-amber-600 dark:bg-amber-600 dark:border-amber-500';
    case 'red':
      return 'bg-red-600 text-white border-red-700 dark:bg-red-700 dark:border-red-600';
    default:
      return 'bg-gray-500 text-white border-gray-600 dark:bg-gray-600 dark:border-gray-500';
  }
}

/**
 * Parse uptime string (e.g., "1.5d", "2h", "30m") to seconds for sorting
 */
export function parseUptimeToSeconds(uptime: string | null | undefined): number {
  if (!uptime) return 0;
  const match = uptime.match(/^([\d.]+)([smhd])$/);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multipliers[unit] || 1);
}

/**
 * Parse disk size string (e.g., "50gb", "100mb") to bytes for sorting
 */
export function parseDiskSizeToBytes(size: string | null | undefined): number {
  if (!size || size === 'N/A') return 0;
  const match = size.toLowerCase().match(/^([\d.]+)([kmgt]?b)$/);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].charAt(0);
  const multipliers: Record<string, number> = { 
    b: 1, 
    k: 1024, 
    m: 1024 * 1024, 
    g: 1024 * 1024 * 1024, 
    t: 1024 * 1024 * 1024 * 1024 
  };
  return value * (multipliers[unit] || 1);
}

/**
 * Parse percentage string (e.g., "50%", "100%") to number for sorting
 */
export function parsePercentage(percent: string | null | undefined): number {
  if (!percent) return 0;
  const match = percent.match(/^([\d.]+)%?$/);
  if (!match) return 0;
  return parseFloat(match[1]);
}

