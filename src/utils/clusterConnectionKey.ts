import type { ClusterConnection } from '@/types/app';

/** Stable identity for ES connection (label + URL + auth). Ignores cluster_name/uuid metadata. */
export function getClusterConnectionKey(cluster: ClusterConnection | null | undefined): string {
  if (!cluster) return '';
  const authType = cluster.authType ?? (cluster.apiKey?.trim() ? 'apiKey' : cluster.username && cluster.password ? 'basic' : 'none');
  return [
    cluster.label,
    cluster.baseUrl.replace(/\/$/, ''),
    authType,
    cluster.username ?? '',
    cluster.password ?? '',
    cluster.apiKey ?? ''
  ].join('\0');
}
