import { apiConfig, apiHeaders } from '@/config/api';
import type {
  CatAllocationRow,
  CatHealthRow,
  ClusterHealth,
  ClusterSettings,
  IndexInfo,
  IndexStats,
  NodeInfo,
  NodeStats,
  PerformanceMetrics,
  RecoveryRow
} from '@/types/api';
import type { ClusterConnection } from '@/types/app';
import { calculateUpgradeOrder } from '@/utils/upgradeOrder';
import { getHighestVersion } from '@/utils/version';

type EndpointKey = keyof typeof apiConfig.endpoints;

/**
 * Build request headers with optional Basic Auth
 */
function buildHeaders(cluster: ClusterConnection): HeadersInit {
  const headers: HeadersInit = { ...apiHeaders };
  
  if (cluster.username && cluster.password) {
    const credentials = btoa(`${cluster.username}:${cluster.password}`);
    headers['Authorization'] = `Basic ${credentials}`;
  }
  
  return headers;
}

/**
 * Make a direct request to Elasticsearch cluster.
 * Chrome extension's host_permissions handles CORS.
 */
async function request<T>(
  endpoint: EndpointKey,
  cluster: ClusterConnection,
  attempt = 1
): Promise<T> {
  const url = `${cluster.baseUrl}${apiConfig.endpoints[endpoint]}`;
  const headers = buildHeaders(cluster);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), apiConfig.requestTimeoutMs);
    
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`Elasticsearch ${response.status} ${response.statusText}`);
    }
    
    return await response.json() as T;
  } catch (error) {
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      return request<T>(endpoint, cluster, attempt + 1);
    }
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      if (error.message.toLowerCase().includes('fetch') || 
          error.message.toLowerCase().includes('network')) {
        throw new Error('Network error');
      }
    }
    throw error;
  }
}

/**
 * Make a POST/PUT request to Elasticsearch
 */
async function requestWithBody<T>(
  path: string,
  cluster: ClusterConnection,
  method: 'POST' | 'PUT' = 'POST',
  body?: unknown
): Promise<T> {
  const url = `${cluster.baseUrl}${path}`;
  const headers = buildHeaders(cluster);
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), apiConfig.requestTimeoutMs);
  
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`Elasticsearch ${response.status} ${response.statusText}`);
    }
    
    return await response.json() as T;
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

export async function getAllocation(cluster: ClusterConnection): Promise<CatAllocationRow[]> {
  const data = await request<
    Array<{
      shards: string | number;
      'disk.avail': string;
      node: string;
      ip?: string;
    }>
  >('allocation', cluster);
  
  return data.map((row) => ({
    shards: typeof row.shards === 'string' ? parseInt(row.shards, 10) : row.shards,
    diskAvail: row['disk.avail'] || 'N/A',
    node: row.node,
    ip: row.ip
  }));
}

export async function getRecovery(cluster: ClusterConnection): Promise<RecoveryRow[]> {
  const data = await request<
    Array<{
      index: string;
      shard: string;
      time: string;
      source_node: string;
      target_node: string;
      target: string;
      fp: string;
      bp: string;
      stage: string;
      translog: string;
      bytes_percent: string;
    }>
  >('recovery', cluster);
  
  return data.map((row) => ({
    index: row.index,
    shard: row.shard,
    time: row.time,
    sourceNode: row.source_node,
    targetNode: row.target_node,
    target: row.target || row.target_node || '',
    filesPercent: row.fp || '0%',
    bytesPercent: row.bytes_percent || row.bp || '0%',
    stage: row.stage,
    translog: row.translog
  }));
}

export async function getClusterHealth(cluster: ClusterConnection): Promise<ClusterHealth> {
  return request<ClusterHealth>('clusterHealth', cluster);
}

/**
 * Simple health check to verify cluster connectivity
 */
export async function checkClusterHealth(
  cluster: ClusterConnection
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `${cluster.baseUrl}${apiConfig.endpoints.clusterHealth}`;
    const headers = buildHeaders(cluster);
    
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(3000) // 3 second timeout for health check
    });
    
    if (response.ok) {
      return { success: true };
    }
    
    return {
      success: false,
      error: `Elasticsearch ${response.status} ${response.statusText}`
    };
  } catch {
    return {
      success: false,
      error: `Network error, cannot access your cluster. Cluster uri: ${cluster.baseUrl}`
    };
  }
}

export async function getNodes(cluster: ClusterConnection): Promise<NodeInfo[]> {
  const catNodesData = await request<
    Array<{
      'node.role': string;
      name: string;
      ip?: string;
      version: string;
      uptime: string;
      'attr.data'?: string;
    }>
  >('nodes', cluster);
  
  const versions = catNodesData.map((row) => row.version).filter(Boolean);
  const highestVersion = getHighestVersion(versions);
  
  return catNodesData.map((row) => {
    const nodeInfo: NodeInfo = {
      nodeRole: row['node.role'],
      name: row.name,
      ip: row.ip,
      version: row.version,
      uptime: row.uptime
    };
    
    // Extract tier from attr.data
    // attr.data can be: hot, warm, cold, frozen, or data (if no tier)
    const dataAttr = row['attr.data'];
    if (dataAttr) {
      // Check if it's a tier (hot, warm, cold, frozen) or just "data"
      const tier = dataAttr.toLowerCase();
      if (['hot', 'warm', 'cold', 'frozen'].includes(tier)) {
        nodeInfo.tier = tier;
      } else if (tier === 'data') {
        // If it's just "data", check node role for tier hint
        // Data nodes without explicit tier are typically "data"
        nodeInfo.tier = 'data';
      }
    }
    
    // If no tier found, check node role
    if (!nodeInfo.tier) {
      const role = row['node.role'].toLowerCase();
      if (role.includes('d') || role.includes('data')) {
        nodeInfo.tier = 'data';
      }
    }
    
    nodeInfo.upgradeOrder = calculateUpgradeOrder(nodeInfo, highestVersion);
    
    return nodeInfo;
  });
}

export async function getClusterSettings(cluster: ClusterConnection): Promise<ClusterSettings> {
  return request<ClusterSettings>('clusterSettings', cluster);
}

export async function getCatHealth(cluster: ClusterConnection): Promise<CatHealthRow[]> {
  return request<CatHealthRow[]>('catHealth', cluster);
}

export async function flushCluster(cluster: ClusterConnection): Promise<{ flushed: boolean }> {
  await requestWithBody(apiConfig.endpoints.flush, cluster, 'POST');
  return { flushed: true };
}

export async function disableShardAllocation(cluster: ClusterConnection): Promise<void> {
  await requestWithBody('/_cluster/settings', cluster, 'PUT', {
    persistent: {
      'cluster.routing.allocation.enable': 'primaries'
    }
  });
}

export async function stopShardRebalance(cluster: ClusterConnection): Promise<void> {
  await requestWithBody('/_cluster/settings', cluster, 'PUT', {
    persistent: {
      'cluster.routing.rebalance.enable': 'none'
    }
  });
}

export async function enableShardAllocation(cluster: ClusterConnection): Promise<void> {
  await requestWithBody('/_cluster/settings', cluster, 'PUT', {
    persistent: {
      'cluster.routing.allocation.enable': 'all'
    }
  });
}

export async function enableShardRebalance(cluster: ClusterConnection): Promise<void> {
  await requestWithBody('/_cluster/settings', cluster, 'PUT', {
    persistent: {
      'cluster.routing.rebalance.enable': 'all'
    }
  });
}

// Performance monitoring functions
export async function getNodeStats(cluster: ClusterConnection): Promise<NodeStats> {
  // In Elasticsearch 8.x, both indexing and search stats come from indices endpoint
  return request<NodeStats>('nodeStats', cluster);
}

export async function getIndices(cluster: ClusterConnection): Promise<IndexInfo[]> {
  const data = await request<
    Array<{
      index: string;
      pri: string;
      rep: string;
      'pri.store.size': string;
      'store.size': string;
      'docs.count': string;
    }>
  >('indices', cluster);

  return data.map((row) => ({
    index: row.index,
    pri: row.pri,
    rep: row.rep,
    'pri.store.size': row['pri.store.size'],
    'store.size': row['store.size'],
    'docs.count': row['docs.count']
  }));
}

export async function getIndexStats(cluster: ClusterConnection): Promise<IndexStats> {
  return request<IndexStats>('indexStats', cluster);
}

/**
 * Calculate performance metrics from node stats
 */
export function calculatePerformanceMetrics(nodeStats: NodeStats): PerformanceMetrics {
  let totalIndexingOps = 0;
  let totalIndexTimeMs = 0;
  let totalSearchOps = 0;
  let totalSearchTimeMs = 0;

  // Aggregate stats from all nodes
  Object.values(nodeStats.nodes).forEach((node) => {
    totalIndexingOps += node.indices.indexing.index_total;
    totalIndexTimeMs += node.indices.indexing.index_time_in_millis;
    totalSearchOps += node.indices.search.query_total;
    totalSearchTimeMs += node.indices.search.query_time_in_millis;
  });

  return {
    indexingRate: 0, // Will be calculated by tracker based on history
    searchRate: 0,   // Will be calculated by tracker based on history
    indexLatency: totalIndexingOps > 0 ? totalIndexTimeMs / totalIndexingOps : 0,
    searchLatency: totalSearchOps > 0 ? totalSearchTimeMs / totalSearchOps : 0
  };
}

export async function updateRecoverySetting(
  cluster: ClusterConnection,
  value: number
): Promise<void> {
  await requestWithBody('/_cluster/settings', cluster, 'PUT', {
    transient: {
      'cluster.routing.allocation.node_initial_primaries_recoveries': value
    }
  });
}

