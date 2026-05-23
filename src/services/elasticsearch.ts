import { apiConfig, apiHeaders } from '@/config/api';
import type {
  AllocationExplainResponse,
  CatAliasRow,
  CatAllocationRow,
  CatIndexRow,
  CatNodeAttrsRow,
  CatNodeExtendedRow,
  CatPendingTaskRow,
  CatRecoveryRow,
  CatShardRow,
  CatThreadPoolRow,
  ClusterHealth,
  ClusterSettingsResponse,
  ClusterStats,
  DataStreamsResponse,
  FieldUsageStatsResponse,
  HealthReportResponse,
  IlmExplainResponse,
  IlmPolicyResponse,
  IndexDetailsResponse,
  IndexInfo,
  IndexStats,
  IndexTemplateListResponse,
  LegacyTemplateListResponse,
  NodesRolesResponse,
  NodeInfo,
  NodeStats,
  NodesStatsExtendedResponse,
  PerformanceMetrics,
  SearchResponse,
  SingleIndexStatsResponse,
  SnapshotAllResponse,
  SnapshotReposResponse,
  SnapshotRepositoryVerifyResponse,
  SnapshotStatusResponse
} from '@/types/api';
import type { ClusterConnection } from '@/types/app';
import { clusterKeyFromBaseUrl, runClusterGovernedFetch } from '@/utils/clusterRequestGovernor';

type EndpointKey = keyof typeof apiConfig.endpoints;

/**
 * Build request headers with optional Basic Auth or API Key.
 * Backward compatible: if authType is missing, use basic when username/password exist, else apiKey when apiKey exists.
 */
function buildHeaders(cluster: ClusterConnection): HeadersInit {
  const headers: HeadersInit = { ...apiHeaders };

  const authType = cluster.authType ?? (cluster.apiKey?.trim() ? 'apiKey' : 'basic');

  if (authType === 'apiKey' && cluster.apiKey?.trim()) {
    headers['Authorization'] = `ApiKey ${cluster.apiKey.trim()}`;
  } else if ((authType === 'basic' || !authType) && cluster.username && cluster.password) {
    const credentials = btoa(`${cluster.username}:${cluster.password}`);
    headers['Authorization'] = `Basic ${credentials}`;
  }

  return headers;
}

const REQUEST_TIMED_OUT_MESSAGE = 'Request timed out';

/** Connection refused / Failed to fetch — fail immediately, do not wait for timeout retries. */
function isImmediateNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === 'AbortError') return false;
  return e instanceof TypeError || /failed to fetch|network error/i.test(e.message);
}

/** User-facing message for timeout/network errors (ElasticVue-style). Use when cluster URI is known. */
export function getNetworkErrorMessage(clusterBaseUrl: string): string {
  const uri = clusterBaseUrl.replace(/\/$/, '');
  return `Network error, cannot access your cluster. Cluster uri: ${uri}`;
}

type FetchOptions = { method?: 'GET' | 'POST'; body?: string; timeoutMs?: number };

/**
 * Global fetch with timeout and retry on timeout only.
 * - Timeout: after requestTimeoutMs we abort; retry up to requestMaxAttempts (3) times, then throw "Request timed out".
 * - User abort (external signal): no retry, throw AbortError.
 * - With cluster: all calls go through cluster request governor (concurrency; dedupe + cooldown when no AbortSignal).
 * Used by request() and snapshot helpers so all APIs get the same behavior.
 */
async function fetchWithTimeoutAndRetry(
  url: string,
  headers: HeadersInit,
  externalSignal?: AbortSignal | null,
  options: FetchOptions = {},
  cluster?: ClusterConnection
): Promise<Response> {
  const { method = 'GET', body } = options;
  const timeoutMs = options.timeoutMs ?? apiConfig.requestTimeoutMs;
  const maxAttempts = apiConfig.requestMaxAttempts;

  const run = async (): Promise<Response> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let abortedDueToTimeout = false;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        abortedDueToTimeout = true;
        controller.abort();
      }, timeoutMs);

      if (externalSignal?.aborted) {
        clearTimeout(timeoutId);
        throw new DOMException('Aborted', 'AbortError');
      }
      if (externalSignal) {
        externalSignal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          controller.abort();
        });
      }

      try {
        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
      } catch (e) {
        clearTimeout(timeoutId);
        if (isImmediateNetworkError(e)) {
          throw new Error('Network error');
        }
        if (e instanceof Error && e.name === 'AbortError') {
          if (abortedDueToTimeout && attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 500 * attempt));
            continue;
          }
          if (abortedDueToTimeout) {
            throw new Error(REQUEST_TIMED_OUT_MESSAGE);
          }
        }
        throw e;
      }
    }

    throw new Error(REQUEST_TIMED_OUT_MESSAGE);
  };

  if (!cluster) {
    return run();
  }
  const clusterKey = clusterKeyFromBaseUrl(cluster.baseUrl);
  return runClusterGovernedFetch(clusterKey, url, method, run, externalSignal);
}

/**
 * Make a direct request to Elasticsearch cluster.
 * Uses fetchWithTimeoutAndRetry (3 attempts on timeout), then parses JSON.
 */
async function request<T>(
  endpoint: EndpointKey,
  cluster: ClusterConnection,
  abortSignal?: AbortSignal | null
): Promise<T> {
  const path = apiConfig.endpoints[endpoint];
  const url = `${cluster.baseUrl.replace(/\/$/, '')}${path}`;
  const headers = buildHeaders(cluster);

  const response = await fetchWithTimeoutAndRetry(url, headers, abortSignal, {}, cluster);

  if (!response.ok) {
    throw new Error(`Elasticsearch ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data as T;
}

export async function getClusterHealth(cluster: ClusterConnection, signal?: AbortSignal | null): Promise<ClusterHealth> {
  return request<ClusterHealth>('clusterHealth', cluster, signal);
}

/** Cluster health with full fields (pending tasks, unassigned shards, etc.) for alerts. */
export async function getClusterHealthFull(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<ClusterHealth> {
  return request<ClusterHealth>('clusterHealthFull', cluster, signal);
}

/** GET _cluster/settings for read_only block detection. Returns null on error. */
export async function getClusterSettings(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<ClusterSettingsResponse | null> {
  try {
    return await request<ClusterSettingsResponse>('clusterSettings', cluster, signal);
  } catch {
    return null;
  }
}

/**
 * Simple health check to verify cluster connectivity.
 * On network error, returns clusterUri so the UI can show a clickable link and SSL hint.
 */
export async function checkClusterHealth(
  cluster: ClusterConnection
): Promise<{ success: boolean; health?: ClusterHealth; error?: string; clusterUri?: string }> {
  try {
    const url = `${cluster.baseUrl.replace(/\/$/, '')}${apiConfig.endpoints.clusterHealth}`;
    const headers = buildHeaders(cluster);

    const response = await fetchWithTimeoutAndRetry(
      url,
      headers,
      null,
      { timeoutMs: apiConfig.healthCheckTimeoutMs },
      cluster
    );

    if (response.ok) {
      const health = (await response.json()) as ClusterHealth;
      return { success: true, health };
    }

    return {
      success: false,
      error: `Elasticsearch ${response.status} ${response.statusText}`
    };
  } catch {
    return {
      success: false,
      error: 'Network error, cannot access your cluster.',
      clusterUri: cluster.baseUrl
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
  >('nodes', cluster, signal);

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
  return request<NodeStats>('nodeStats', cluster, signal);
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
  >('indices', cluster, signal);

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
  return request<IndexStats>('indexStats', cluster, signal);
}

/**
 * Lightweight stats for a single index: indexing & search totals only.
 * Uses primaries for indexing and total (all shards) for search.
 */
export async function getIndexStatsForIndex(
  cluster: ClusterConnection,
  index: string,
  signal?: AbortSignal | null
): Promise<SingleIndexStatsResponse | null> {
  const base = cluster.baseUrl.replace(/\/$/, '');
  const path = `/${encodeURIComponent(index)}/_stats`;
  const filter =
    'filter_path=indices.*.primaries.indexing.index_total,indices.*.primaries.indexing.index_time_in_millis,indices.*.total.search.query_total,indices.*.total.search.query_time_in_millis&metric=indexing,search';
  const url = `${base}${path}?${filter}`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(url, headers, signal, {}, cluster);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Index stats ${response.status} ${response.statusText}`);
  return (await response.json()) as SingleIndexStatsResponse;
}

/**
 * Shards tab: Shard-level indexing/search counters for a single index.
 * We prefer index-scoped _stats (level=shards) to avoid long URLs and 400/414 errors from _nodes/stats filter_path.
 */
export async function getIndexShardStatsForIndex(
  cluster: ClusterConnection,
  index: string,
  signal?: AbortSignal | null
): Promise<unknown | null> {
  const base = cluster.baseUrl.replace(/\/$/, '');
  const path = `/${encodeURIComponent(index)}/_stats`;
  const filter =
    'level=shards&metric=indexing,search&filter_path=indices.*.shards.*.*.routing,indices.*.shards.*.*.indexing,indices.*.shards.*.*.search';
  const url = `${base}${path}?${filter}`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(url, headers, signal, {}, cluster);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Index shard stats ${response.status} ${response.statusText}`);
  return (await response.json()) as unknown;
}

/**
 * Shards tab: Shard-level indexing/search counters for ALL indices.
 * Single request, same philosophy as Index Statistics: compute across the whole cluster.
 *
 * Note: This can be a large response on very big clusters; we use filter_path to keep it reasonable.
 */
export async function getNodesStatsShardsAll(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<unknown | null> {
  const base = cluster.baseUrl.replace(/\/$/, '');
  const path = '/_nodes/stats/indices';
  const filterPath = [
    'nodes.*.name',
    // indices.shards.{index}.{shard} is typically an array of shard copies (routing + stats).
    // Use 2 wildcards (index + shard) and then object fields.
    'nodes.*.indices.shards.*.*.routing.primary',
    'nodes.*.indices.shards.*.*.indexing.index_total',
    'nodes.*.indices.shards.*.*.indexing.index_time_in_millis',
    'nodes.*.indices.shards.*.*.search.query_total',
    'nodes.*.indices.shards.*.*.search.query_time_in_millis'
  ].join(',');
  const qs = new URLSearchParams({
    level: 'shards',
    metric: 'indexing,search',
    filter_path: filterPath
  });
  const url = `${base}${path}?${qs.toString()}`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(url, headers, signal, {}, cluster);
  if (response.status === 400 || response.status === 404) return null;
  if (!response.ok) throw new Error(`Nodes stats shards ${response.status} ${response.statusText}`);
  return (await response.json()) as unknown;
}

// Tab-specific endpoints (Cluster, Nodes, Snapshots)
export async function getClusterStats(cluster: ClusterConnection, signal?: AbortSignal | null): Promise<ClusterStats> {
  return request<ClusterStats>('clusterStats', cluster, signal);
}

export async function getCatShards(cluster: ClusterConnection, signal?: AbortSignal | null): Promise<CatShardRow[]> {
  const data = await request<CatShardRow[]>('catShards', cluster, signal);
  return Array.isArray(data) ? data : [];
}

/**
 * GET _cat/shards (cluster-wide) for index placement analysis.
 * Includes shard placement details and sorts by largest shard first.
 */
export async function getCatShardsPlacement(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<CatShardRow[]> {
  const base = cluster.baseUrl.replace(/\/$/, '');
  const url = `${base}/_cat/shards?v&format=json&h=index,shard,prirep,state,docs,store,ip,node,unassigned.for,unassigned.details&s=store:desc`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(url, headers, signal, {}, cluster);
  if (!response.ok) throw new Error(`Cat shards ${response.status} ${response.statusText}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/** GET _cat/shards/{index} — shard allocation per index (shard, prirep, state, node). */
export async function getCatShardsForIndex(
  cluster: ClusterConnection,
  index: string,
  signal?: AbortSignal | null
): Promise<CatShardRow[]> {
  const base = cluster.baseUrl.replace(/\/$/, '');
  const url = `${base}/_cat/shards/${encodeURIComponent(index)}?v&format=json&h=index,shard,prirep,state,docs,store,ip,node&s=store:desc,shard,prirep`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(url, headers, signal, {}, cluster);
  if (!response.ok) throw new Error(`Shards for index ${response.status} ${response.statusText}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

export async function getCatPendingTasks(cluster: ClusterConnection, signal?: AbortSignal | null): Promise<CatPendingTaskRow[]> {
  const data = await request<CatPendingTaskRow[]>('catPendingTasks', cluster, signal);
  return Array.isArray(data) ? data : [];
}

export async function getCatRecoveryActive(cluster: ClusterConnection, signal?: AbortSignal | null): Promise<CatRecoveryRow[]> {
  const data = await request<CatRecoveryRow[]>('catRecoveryActive', cluster, signal);
  return Array.isArray(data) ? data : [];
}

/**
 * GET _cluster/allocation/explain for a single shard.
 * Uses POST body:
 * {
 *   "index": "<index_name>",
 *   "shard": 0,
 *   "primary": false
 * }
 */
export async function getShardAllocationExplain(
  cluster: ClusterConnection,
  params: { index: string; shard: number; primary: boolean },
  signal?: AbortSignal | null
): Promise<AllocationExplainResponse> {
  const base = cluster.baseUrl.replace(/\/$/, '');
  const url = `${base}/_cluster/allocation/explain`;
  const headers: HeadersInit = {
    ...buildHeaders(cluster),
    'Content-Type': 'application/json'
  };
  const body = JSON.stringify({
    index: params.index,
    shard: params.shard,
    primary: params.primary
  });

  const response = await fetchWithTimeoutAndRetry(url, headers, signal, { method: 'POST', body }, cluster);
  if (!response.ok) {
    throw new Error(`Allocation explain ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as AllocationExplainResponse;
}

/**
 * GET _health_report (ES 8.x+). Returns null on error or if ES < 8 (400).
 * @param skipRef When provided and 400 is received, sets skipRef.current = true so caller can skip future calls for this cluster.
 */
export async function getHealthReport(
  cluster: ClusterConnection,
  signal?: AbortSignal | null,
  skipRef?: { current: boolean }
): Promise<HealthReportResponse | null> {
  if (skipRef?.current) return null;
  try {
    return await request<HealthReportResponse>('healthReport', cluster, signal);
  } catch (err) {
    if (err instanceof Error && err.message.includes('400')) {
      skipRef && (skipRef.current = true);
    }
    return null;
  }
}

export async function getCatNodesExtended(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<CatNodeExtendedRow[]> {
  const data = await request<CatNodeExtendedRow[]>('catNodesExtended', cluster, signal);
  return Array.isArray(data) ? data : [];
}

/** GET _cat/allocation — node-level shard and disk allocation stats. */
export async function getCatAllocation(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<CatAllocationRow[]> {
  const data = await request<CatAllocationRow[]>('catAllocation', cluster, signal);
  return Array.isArray(data) ? data : [];
}

/** GET _cat/nodeattrs — node attributes (e.g. rack, zone). Returns one row per (node, attr). */
export async function getCatNodeAttrs(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<CatNodeAttrsRow[]> {
  try {
    const data = await request<CatNodeAttrsRow[]>('catNodeAttrs', cluster, signal);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function getCatThreadPool(cluster: ClusterConnection, signal?: AbortSignal | null): Promise<CatThreadPoolRow[]> {
  const data = await request<CatThreadPoolRow[]>('catThreadPool', cluster, signal);
  return Array.isArray(data) ? data : [];
}

export async function getNodesStatsExtended(cluster: ClusterConnection, signal?: AbortSignal | null): Promise<NodesStatsExtendedResponse | null> {
  try {
    return await request<NodesStatsExtendedResponse>('nodesStatsExtended', cluster, signal);
  } catch {
    return null;
  }
}

/** GET _snapshot — list repository names. OpenSearch/ES compatible. */
export async function getSnapshotRepositories(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<string[]> {
  const url = `${cluster.baseUrl.replace(/\/$/, '')}/_snapshot`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(url, headers, signal, {}, cluster);
  if (!response.ok) throw new Error(`Snapshot repos ${response.status} ${response.statusText}`);
  const data = (await response.json()) as SnapshotReposResponse;
  if (Array.isArray(data.repositories)) {
    return data.repositories.map((r) => r.name).filter(Boolean);
  }
  return Object.keys(data).filter((k) => typeof data[k] === 'object' && data[k] !== null && !Array.isArray(data[k]));
}

/** Options for GET _snapshot/{repo}/_all — e.g. size=1&order=desc for alert (last snapshot only). */
export type GetSnapshotAllOptions = { size?: number; order?: 'asc' | 'desc' };

/** GET _snapshot/{repo}/_all — list snapshots in a repository. OpenSearch/ES compatible. */
export async function getSnapshotAll(
  cluster: ClusterConnection,
  repoName: string,
  signal?: AbortSignal | null,
  options?: GetSnapshotAllOptions
): Promise<SnapshotAllResponse> {
  let path = `/_snapshot/${encodeURIComponent(repoName)}/_all`;
  if (options?.size != null || options?.order) {
    const params = new URLSearchParams();
    if (options.size != null) params.set('size', String(options.size));
    if (options.order) params.set('order', options.order);
    path += '?' + params.toString();
  }
  const url = `${cluster.baseUrl.replace(/\/$/, '')}${path}`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(url, headers, signal, {}, cluster);
  if (!response.ok) throw new Error(`Snapshots ${response.status} ${response.statusText}`);
  return (await response.json()) as SnapshotAllResponse;
}

/** GET _snapshot/_all/_all — list snapshots from all repositories in a single request. ES 7.14+. */
export async function getSnapshotAllFromAllRepos(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<SnapshotAllResponse> {
  const url = `${cluster.baseUrl.replace(/\/$/, '')}/_snapshot/_all/_all?include_repository=true`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(url, headers, signal, {}, cluster);
  if (!response.ok) throw new Error(`Snapshots ${response.status} ${response.statusText}`);
  return (await response.json()) as SnapshotAllResponse;
}

/** GET _snapshot/{repo}/{snapshot}/_status — detailed shard-level snapshot progress/failures. */
export async function getSnapshotStatus(
  cluster: ClusterConnection,
  repoName: string,
  snapshotName: string,
  signal?: AbortSignal | null
): Promise<SnapshotStatusResponse> {
  const base = cluster.baseUrl.replace(/\/$/, '');
  const filterPath = new URLSearchParams({
    filter_path: [
      'snapshots.snapshot',
      'snapshots.repository',
      'snapshots.state',
      'snapshots.include_global_state',
      'snapshots.shards_stats',
      'snapshots.stats.start_time_in_millis',
      'snapshots.stats.time_in_millis',
      'snapshots.stats.incremental.file_count',
      'snapshots.stats.incremental.size_in_bytes',
      'snapshots.stats.processed.file_count',
      'snapshots.stats.processed.size_in_bytes',
      'snapshots.stats.total.file_count',
      'snapshots.stats.total.size_in_bytes',
      'snapshots.indices.*.shards_stats',
      'snapshots.indices.*.shards.*.stage',
      'snapshots.indices.*.shards.*.reason'
    ].join(',')
  });
  const url = `${base}/_snapshot/${encodeURIComponent(repoName)}/${encodeURIComponent(snapshotName)}/_status?${filterPath.toString()}`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(url, headers, signal, {}, cluster);
  if (!response.ok) throw new Error(`Snapshot status ${response.status} ${response.statusText}`);
  return (await response.json()) as SnapshotStatusResponse;
}

/** POST _snapshot/{repo}/_verify — verifies repository access across nodes. */
export async function getSnapshotRepositoryVerify(
  cluster: ClusterConnection,
  repoName: string,
  signal?: AbortSignal | null
): Promise<SnapshotRepositoryVerifyResponse> {
  const base = cluster.baseUrl.replace(/\/$/, '');
  const url = `${base}/_snapshot/${encodeURIComponent(repoName)}/_verify`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(url, headers, signal, { method: 'POST' }, cluster);
  if (!response.ok) {
    let reason = '';
    try {
      const err = (await response.json()) as {
        error?: { reason?: string; root_cause?: Array<{ reason?: string }> };
      };
      reason = err.error?.reason ?? err.error?.root_cause?.[0]?.reason ?? '';
    } catch {
      // ignore parse errors and fall back to generic message
    }
    throw new Error(reason || `Snapshot repository verify ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as SnapshotRepositoryVerifyResponse;
}

// ——— Indices tab ———
// Use full index response (aliases + mappings + settings) with human-readable values.
// This keeps mappings/settings.index available while also exposing aliases and other metadata.
const INDEX_DETAILS_FILTER = 'human';

/** GET /{index} — mapping and settings for an index. Caller should handle 403/404. */
export async function getIndexDetails(
  cluster: ClusterConnection,
  index: string,
  signal?: AbortSignal | null
): Promise<IndexDetailsResponse> {
  const base = cluster.baseUrl.replace(/\/$/, '');
  const url = `${base}/${encodeURIComponent(index)}?${INDEX_DETAILS_FILTER}`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(url, headers, signal, {}, cluster);
  if (!response.ok) throw new Error(`Index details ${response.status} ${response.statusText}`);
  return (await response.json()) as IndexDetailsResponse;
}

/** GET _ilm/explain — optional index pattern. For a specific index use /{index}/_ilm/explain; for * or all use /_ilm/explain (no query); for other wildcards use ?index=pattern. When skipRef provided and 400 received, sets skipRef.current = true to skip future calls. */
export async function getIlmExplain(
  cluster: ClusterConnection,
  indexPattern?: string,
  signal?: AbortSignal | null,
  skipRef?: { current: boolean }
): Promise<IlmExplainResponse> {
  if (skipRef?.current) return { indices: {} };
  const base = cluster.baseUrl.replace(/\/$/, '');
  const hasWildcard = indexPattern && /[*?]/.test(indexPattern);
  const isAll = !indexPattern || indexPattern === '*';
  const path =
    indexPattern && !hasWildcard
      ? `/${indexPattern}/_ilm/explain`
      : apiConfig.endpoints.ilmExplain + (!isAll ? `?index=${encodeURIComponent(indexPattern!)}` : '');
  const url = `${base}${path}`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(url, headers, signal, {}, cluster);

  if (response.status === 400) {
    skipRef && (skipRef.current = true);
    throw new Error(`ILM explain 400 Bad Request`);
  }
  if (!response.ok) throw new Error(`ILM explain ${response.status} ${response.statusText}`);
  return (await response.json()) as IlmExplainResponse;
}

/** GET _ilm/policy/{policy} — policy definition. Used to read delete phase min_age (retention). */
export async function getIlmPolicy(
  cluster: ClusterConnection,
  policyName: string,
  signal?: AbortSignal | null
): Promise<IlmPolicyResponse | null> {
  const base = cluster.baseUrl.replace(/\/$/, '');
  const url = `${base}/_ilm/policy/${encodeURIComponent(policyName)}`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(url, headers, signal, {}, cluster);
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) return null;
  return (await response.json()) as IlmPolicyResponse;
}

/** GET _all/_mapping — mappings for all indices. Used to count total fields per index. */
export async function getAllMappings(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<Record<string, { mappings?: { properties?: Record<string, unknown> } }>> {
  try {
    const data = await request<Record<string, { mappings?: { properties?: Record<string, unknown> } }>>(
      'allMappings',
      cluster,
      signal
    );
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/** GET _field_usage_stats — optional index. For a specific index use /{index}/_field_usage_stats; otherwise /_field_usage_stats. ES 7.15+. Returns null on 400/404. */
export async function getFieldUsageStats(
  cluster: ClusterConnection,
  index?: string,
  signal?: AbortSignal | null
): Promise<FieldUsageStatsResponse | null> {
  const base = cluster.baseUrl.replace(/\/$/, '');
  const path = index ? `/${index}/_field_usage_stats` : apiConfig.endpoints.fieldUsageStats;
  const url = `${base}${path}`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(url, headers, signal, {}, cluster);
  if (response.status === 400 || response.status === 404) return null;
  if (!response.ok) throw new Error(`Field usage stats ${response.status} ${response.statusText}`);
  return (await response.json()) as FieldUsageStatsResponse;
}

/** _cat/indices with health and status (Indices tab catalog). */
export async function getIndicesCatalog(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<CatIndexRow[]> {
  const data = await request<CatIndexRow[]>('indicesCatalog', cluster, signal);
  return Array.isArray(data) ? data : [];
}

/** _cat/aliases. */
export async function getCatAliases(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<CatAliasRow[]> {
  const data = await request<CatAliasRow[]>('catAliases', cluster, signal);
  return Array.isArray(data) ? data : [];
}

/** GET _data_stream. */
export async function getDataStreams(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<DataStreamsResponse> {
  return request<DataStreamsResponse>('dataStreams', cluster, signal);
}

/** GET /_nodes?filter_path=nodes.*.name,nodes.*.roles — used for tier mapping in Data streams view. */
export async function getNodesRoles(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<NodesRolesResponse> {
  return request<NodesRolesResponse>('nodesRoles', cluster, signal);
}

/** GET /_cat/shards?bytes=b... — used for accurate per-tier store aggregation. */
export async function getCatShardsBytes(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<CatShardRow[]> {
  const data = await request<CatShardRow[]>('catShardsBytes', cluster, signal);
  return Array.isArray(data) ? data : [];
}

/**
 * Shards tab: Fetch shard-level indexing/search counters for a limited set of indices.
 * Uses _nodes/stats/indices with level=shards so we can compute delta rates per shard.
 *
 * IMPORTANT: We scope by indices via filter_path to keep payload manageable.
 */
// Note: previous _nodes/stats shard-level implementation removed because it produced long URLs and request storms.

// ——— Templates tab ———

/** GET _index_template — composable index templates (ES 7.9+). */
export async function getIndexTemplates(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<IndexTemplateListResponse> {
  return request<IndexTemplateListResponse>('indexTemplate', cluster, signal);
}

/** GET _template — legacy index templates. */
export async function getLegacyTemplates(
  cluster: ClusterConnection,
  signal?: AbortSignal | null
): Promise<LegacyTemplateListResponse> {
  return request<LegacyTemplateListResponse>('legacyTemplate', cluster, signal);
}

/** POST /{indexPattern}/_search */
export async function searchIndexDocuments(
  cluster: ClusterConnection,
  indexPattern: string,
  body: Record<string, unknown>,
  signal?: AbortSignal | null
): Promise<SearchResponse> {
  const base = cluster.baseUrl.replace(/\/$/, '');
  const path = `/${(indexPattern || '*').trim() || '*'}/_search`;
  const url = `${base}${path}`;
  const headers = buildHeaders(cluster);
  const response = await fetchWithTimeoutAndRetry(
    url,
    headers,
    signal,
    { method: 'POST', body: JSON.stringify(body) },
    cluster
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Search ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
  }
  return (await response.json()) as SearchResponse;
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


