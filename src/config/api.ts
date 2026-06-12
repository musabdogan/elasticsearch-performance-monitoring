/**
 * Elasticsearch configuration for the Chrome extension.
 * Direct API calls without proxy (Chrome extension handles CORS via host_permissions).
 */
export const apiConfig = {
  pollIntervalMs: 10000,
  /** Interval for alert-only fetch (separate from metrics). Fetches all APIs needed for alerts. */
  alertIntervalMs: 60000,
  requestTimeoutMs: 30000,
  /** Max attempts for a single request when it times out (1 initial + 2 retries = 3 total). */
  requestMaxAttempts: 3,
  healthCheckTimeoutMs: 3000,
  /** Interval for background health check when cluster is selected (ElasticVue-style). */
  healthCheckIntervalMs: 30000,
  /** Max parallel HTTP requests per cluster (global governor). */
  clusterMaxConcurrentRequests: 4,
  /** Minimum spacing between identical requests (same method+URL) when not using AbortSignal. */
  clusterRequestCooldownMs: 300,
  endpoints: {
    // Performance monitoring endpoints (filter_path reduces response size)
    nodeStats: '/_nodes/stats/indices,os,jvm,fs?filter_path=nodes.*.name,nodes.*.host,nodes.*.ip,nodes.*.roles,nodes.*.indices.indexing.index_total,nodes.*.indices.indexing.index_time_in_millis,nodes.*.indices.search.query_total,nodes.*.indices.search.query_time_in_millis,nodes.*.os.cpu.percent,nodes.*.jvm.mem.heap_used_in_bytes,nodes.*.jvm.mem.heap_max_in_bytes,nodes.*.fs.total.total_in_bytes,nodes.*.fs.total.available_in_bytes',
    indexStats: '/_stats?filter_path=indices.*.primaries.indexing.index_total,indices.*.primaries.indexing.index_time_in_millis,indices.*.primaries.indexing.index_failed,indices.*.primaries.segments.count,indices.*.primaries.merges.current,indices.*.total.search.query_total,indices.*.total.search.query_time_in_millis,indices.*.primaries.store.size_in_bytes,indices.*.total.store.size_in_bytes',
    indices: '/_cat/indices?v&format=json&h=index,health,pri,rep,pri.store.size,store.size,docs.count&s=index',

    // Indices tab: catalog (health, status), aliases, data streams
    indicesCatalog: '/_cat/indices?v&format=json&h=index,health,pri,rep,docs.count,docs.deleted,store.size,pri.store.size,creation.date.string,indexing.index_failed&s=creation.date.string',
    catAliases: '/_cat/aliases?v&format=json',
    dataStreams: '/_data_stream',
    /** Lightweight node roles lookup for tier mapping (hot/warm/cold/frozen). */
    nodesRoles: '/_nodes?filter_path=nodes.*.name,nodes.*.roles',
    /** Cluster-wide cat shards with bytes=b for accurate store aggregation. */
    catShardsBytes: '/_cat/shards?format=json&bytes=b&h=index,state,store,node',

    // Indices tab: index details (GET /{index}), ILM, resolve, field usage, mappings
    // Some environments reject GET /_ilm/explain; this path is broadly accepted.
    ilmExplain: '/_all/_ilm/explain',
    fieldUsageStats: '/_field_usage_stats',
    allMappings: '/_all/_mapping',

    // Templates tab
    indexTemplate: '/_index_template',
    legacyTemplate: '/_template',

    // Cluster info endpoints
    clusterHealth: '/_cluster/health?filter_path=cluster_name,cluster_uuid,status,number_of_nodes,active_shards,active_primary_shards',
    clusterHealthFull: '/_cluster/health?filter_path=cluster_name,status,number_of_nodes,number_of_data_nodes,active_shards,active_primary_shards,relocating_shards,initializing_shards,unassigned_shards,delayed_unassigned_shards,number_of_pending_tasks,task_max_waiting_in_queue_millis,active_shards_percent_as_number',
    clusterStats: '/_cluster/stats',
    catShards: '/_cat/shards?v&format=json&h=index,shard,prirep,state,unassigned.reason,node&s=state,index',
    catAllocation: '/_cat/allocation?v&format=json&h=shards,disk.indices,disk.used,disk.avail,disk.total,disk.percent,host,ip,node&s=shards:desc',
    catPendingTasks: '/_cat/pending_tasks?v&format=json',
    catRecoveryActive: '/_cat/recovery?v&format=json&h=i,s,t,ty,st,source_node,target_node,f,fp,b,bp,translog_ops_percent&s=ty:desc,index,bp:desc&active_only=true',
    catNodesExtended: '/_cat/nodes?v&format=json&h=ip,id,name,version,heap.percent,heap.current,heap.max,ram.percent,ram.current,ram.max,node.role,master,cpu,load_1m,load_5m,load_15m,disk.used_percent,disk.used,disk.total,shards,uptime&full_id=true',
    catNodeAttrs: '/_cat/nodeattrs?v&format=json',
    catThreadPool: '/_cat/thread_pool?v&format=json',
    nodesStatsExtended: '/_nodes/stats/transport,http,breaker,fs,indices?filter_path=nodes.*.name,nodes.*.transport,nodes.*.http,nodes.*.breakers,nodes.*.fs,nodes.*.indices.indexing',
    /** Health API (ES 8.x+). Default verbose output (includes details/diagnosis). Requires monitor cluster privilege. */
    healthReport: '/_health_report',
    nodes: '/_cat/nodes?v&format=json&h=node.role,name,ip,version&s=node.role,ip',
    /** Cluster settings (for read_only block detection). */
    clusterSettings: '/_cluster/settings?include_defaults=false'
  }
} as const;

export const apiHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/json'
};

