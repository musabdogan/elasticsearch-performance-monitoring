/**
 * Elasticsearch configuration for the Chrome extension.
 * Direct API calls without proxy (Chrome extension handles CORS via host_permissions).
 */
export const apiConfig = {
  pollIntervalMs: 10000,
  requestTimeoutMs: 10000, // Increased to 10 seconds
  healthCheckTimeoutMs: 1000, // 1 second for reload/health check
  endpoints: {
    // Performance monitoring endpoints (filter_path reduces response size)
    nodeStats: '/_nodes/stats/indices,os,jvm,fs?filter_path=nodes.*.name,nodes.*.host,nodes.*.ip,nodes.*.roles,nodes.*.indices.indexing.index_total,nodes.*.indices.indexing.index_time_in_millis,nodes.*.indices.search.query_total,nodes.*.indices.search.query_time_in_millis,nodes.*.os.cpu.percent,nodes.*.jvm.mem.heap_used_in_bytes,nodes.*.jvm.mem.heap_max_in_bytes,nodes.*.fs.total.total_in_bytes,nodes.*.fs.total.available_in_bytes',
    indexStats: '/_stats?filter_path=indices.*.primaries.indexing.index_total,indices.*.primaries.indexing.index_time_in_millis,indices.*.total.search.query_total,indices.*.total.search.query_time_in_millis,indices.*.primaries.store.size_in_bytes,indices.*.total.store.size_in_bytes',
    indices: '/_cat/indices?v&format=json&h=index,pri,rep,pri.store.size,store.size,docs.count&s=index',

    // Cluster info endpoints
    clusterHealth: '/_cluster/health?filter_path=cluster_name,status,number_of_nodes,active_shards',
    nodes: '/_cat/nodes?v&format=json&h=node.role,name,ip&s=node.role,ip',
    
    // Utility endpoints (still used by some functions)
    recovery: '/_cat/recovery?v&format=json&h=index,shard,time,source_node,target_node,target,fp,bp,stage,translog,bytes_percent&s=ty:desc,index,bp:desc&active_only',
    clusterSettings: '/_cluster/settings?flat_settings',
    flush: '/_flush'
  }
} as const;

export const apiHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/json'
};

