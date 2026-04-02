import type { ClusterStatus } from '@/types/api';

export function formatNumber(value: number): string {
  return Intl.NumberFormat('en-US').format(value);
}

/**
 * Format large document count as rounded short string (e.g. "28.3 million", "1.2 billion")
 */
export function formatDocumentCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '—';
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)} billion`;
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)} million`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)} thousand`;
  return count.toString();
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
  const match = size.toLowerCase().replace(/\s/g, '').match(/^([\d.]+)([kmgt]?b)$/);
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

/**
 * Format alert value for display (e.g. latency 1177.55 ms → "1.2 s", 0.20048 ops/sec → "0.2 ops/sec")
 */
export function formatAlertValue(value: number | string, unit: string): string {
  if (typeof value === 'string') return value;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (unit === 'ms' && n >= 1000) {
    return `${(n / 1000).toFixed(1)} s`;
  }
  if (unit === '%') return `${Math.round(n)}%`;
  // Rate (ops/sec, /sec): human-friendly decimals instead of raw float
  if (unit === 'ops/sec' || unit === '/sec') {
    const decimals = n < 1 ? 2 : n < 10 ? 1 : 0;
    const formatted = n.toFixed(decimals).replace(/\.?0+$/, '');
    return `${formatted} ${unit}`;
  }
  return `${value} ${unit}`;
}

/** Format ISO date for alert "Opened at" / "Closed at" (e.g. "21 Feb 2026, 01:00 PM"). */
export function formatAlertOpenedAt(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Format an ISO timestamp as relative time (e.g. "Just now", "2 min ago", "1 hour ago").
 * Used for "Last updated" / data freshness in the UI.
 */
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  if (!Number.isFinite(date.getTime())) return isoString;
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec} sec ago`;
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHour < 24) return `${diffHour} hr ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
}

/**
 * Format a date as relative age (e.g. "3 days old", "2 weeks old", "5 months old", "1 year old").
 * Accepts ISO date string or epoch ms. Returns "—" if invalid.
 */
export function formatAgeOld(isoOrEpoch: string | number | null | undefined): string {
  if (isoOrEpoch == null || isoOrEpoch === '') return '—';
  const date = typeof isoOrEpoch === 'number' ? new Date(isoOrEpoch) : new Date(String(isoOrEpoch));
  if (!Number.isFinite(date.getTime())) return '—';
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return '—';
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day old';
  if (diffDays < 7) return `${diffDays} days old`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks === 1) return '1 week old';
  if (diffDays < 31) return `${diffWeeks} weeks old`;
  const diffMonths = Math.floor(diffDays / 30.44);
  if (diffMonths === 1) return '1 month old';
  if (diffDays < 365) return `${diffMonths} months old`;
  const diffYears = Math.floor(diffDays / 365.25);
  if (diffYears === 1) return '1 year old';
  return `${diffYears} years old`;
}

/** Format duration between two ISO timestamps (e.g. "10 minutes", "2 hours"). If endIso omitted, use now. */
export function formatAlertDuration(startIso: string, endIso?: string): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'less than 1 minute';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''}`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
  return `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
}

