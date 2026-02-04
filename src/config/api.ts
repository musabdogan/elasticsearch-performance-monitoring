/**
 * Elasticsearch configuration for the Chrome extension.
 * Direct API calls without proxy (Chrome extension handles CORS via host_permissions).
 */
export const apiConfig = {
  pollIntervalMs: 10000,
  requestTimeoutMs: 8000,
  endpoints: {
    // Performance monitoring endpoints
    nodeStats: '/_nodes/stats/indices,os,jvm,process,fs?format=json',
    indexStats: '/_stats?format=json',
    indices: '/_cat/indices?v&format=json&h=index,pri,rep,pri.store.size,store.size,docs.count&s=index',

    // Cluster info endpoints
    clusterHealth: '/_cluster/health',
    nodes: '/_cat/nodes?v&format=json&h=node.role,name,version,uptime,ip,attr.data&s=node.role,ip',
    allocation: '/_cat/allocation?v&format=json&h=shards,disk.avail,node,ip&s=ip',
    recovery: '/_cat/recovery?v&format=json&h=index,shard,time,source_node,target_node,target,fp,bp,stage,translog,bytes_percent&s=ty:desc,index,bp:desc&active_only',

    // Utility endpoints
    clusterSettings: '/_cluster/settings?flat_settings',
    catHealth: '/_cat/health?v&format=json',
    flush: '/_flush'
  }
} as const;

export const apiHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/json'
};

