/** Elasticsearch health status colors (Kibana / Elastic Stack convention). */
export function healthToDotClass(health?: string): string {
  const h = health?.toLowerCase();
  if (h === 'green') return 'bg-emerald-500';
  if (h === 'yellow') return 'bg-amber-500';
  if (h === 'red') return 'bg-red-500';
  return 'bg-gray-400 dark:bg-gray-500';
}

export function formatHealthLabel(health?: string): string {
  if (!health) return 'Unknown';
  const h = health.toLowerCase();
  if (h === 'green' || h === 'yellow' || h === 'red') {
    return h.charAt(0).toUpperCase() + h.slice(1);
  }
  return health;
}
