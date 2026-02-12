import { apiConfig, apiHeaders } from '@/config/api';
import type {
  ClusterHealth,
  IndexInfo,
  IndexStats,
  NodeInfo,
  NodeStats,
  PerformanceMetrics
} from '@/types/api';
import type { ClusterConnection } from '@/types/app';

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
 * Pass abortSignal to cancel when e.g. cluster changes.
 */
async function request<T>(
  endpoint: EndpointKey,
  cluster: ClusterConnection,
  attempt = 1,
  abortSignal?: AbortSignal | null
): Promise<T> {
  const url = `${cluster.baseUrl}${apiConfig.endpoints[endpoint]}`;
  const headers = buildHeaders(cluster);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), apiConfig.requestTimeoutMs);
    if (abortSignal) {
      if (abortSignal.aborted) {
        clearTimeout(timeout);
        throw new DOMException('Aborted', 'AbortError');
      }
      abortSignal.addEventListener('abort', () => {
        clearTimeout(timeout);
        controller.abort();
      });
    }
    
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
    if (attempt < 2 && !(error instanceof Error && error.name === 'AbortError')) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      return request<T>(endpoint, cluster, attempt + 1, abortSignal);
    }
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw error;
      }
      if (error.message.toLowerCase().includes('fetch') || 
          error.message.toLowerCase().includes('network')) {
        throw new Error('Network error');
      }
    }
    throw error;
  }
}

export async function getClusterHealth(cluster: ClusterConnection, signal?: AbortSignal | null): Promise<ClusterHealth> {
  return request<ClusterHealth>('clusterHealth', cluster, 1, signal);
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
      signal: AbortSignal.timeout(apiConfig.healthCheckTimeoutMs) // 1 second timeout for health check
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

export async function getNodes(cluster: ClusterConnection, signal?: AbortSignal | null): Promise<NodeInfo[]> {
  const catNodesData = await request<
    Array<{
      'node.role': string;
      name: string;
      ip?: string;
      version?: string;
      uptime?: string;
      'attr.data'?: string;
    }>
  >('nodes', cluster, 1, signal);

  return catNodesData.map((row) => {
    const nodeInfo: NodeInfo = {
      nodeRole: row['node.role'],
      name: row.name,
      ip: row.ip,
      version: row.version ?? '',
      uptime: row.uptime ?? ''
    };

    const dataAttr = row['attr.data'];
    if (dataAttr) {
      const tier = dataAttr.toLowerCase();
      if (['hot', 'warm', 'cold', 'frozen'].includes(tier)) {
        nodeInfo.tier = tier;
      } else if (tier === 'data') {
        nodeInfo.tier = 'data';
      }
    }

    if (!nodeInfo.tier) {
      const role = row['node.role'].toLowerCase();
      if (role.includes('d') || role.includes('data')) {
        nodeInfo.tier = 'data';
      }
    }

    return nodeInfo;
  });
}

// Performance monitoring functions
export async function getNodeStats(cluster: ClusterConnection, signal?: AbortSignal | null): Promise<NodeStats> {
  return request<NodeStats>('nodeStats', cluster, 1, signal);
}

export async function getIndices(cluster: ClusterConnection, signal?: AbortSignal | null): Promise<IndexInfo[]> {
  const data = await request<
    Array<{
      index: string;
      pri: string;
      rep: string;
      'pri.store.size': string;
      'store.size': string;
      'docs.count': string;
    }>
  >('indices', cluster, 1, signal);

  return data.map((row) => ({
    index: row.index,
    pri: row.pri,
    rep: row.rep,
    'pri.store.size': row['pri.store.size'],
    'store.size': row['store.size'],
    'docs.count': row['docs.count']
  }));
}

export async function getIndexStats(cluster: ClusterConnection, signal?: AbortSignal | null): Promise<IndexStats> {
  return request<IndexStats>('indexStats', cluster, 1, signal);
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


