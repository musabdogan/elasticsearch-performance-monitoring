export type AuthType = 'none' | 'basic' | 'apiKey';

/** Optional category for quick filtering; each cluster can have at most one. */
export type ClusterCategory = 'production' | 'staging' | 'dev' | 'region' | 'other';

export interface ClusterConnection {
  label: string;
  baseUrl: string;
  /** Auth method: none, basic (username/password), or apiKey (encoded API key). */
  authType?: AuthType;
  username?: string;
  password?: string;
  /** Encoded API key (base64 of id:api_key). Used when authType is 'apiKey'. */
  apiKey?: string;
  /** Cluster name from ES; stored so it can be shown without waiting for health. */
  cluster_name?: string;
  /** Immutable cluster id from ES; stored so it can be shown without waiting for health. */
  cluster_uuid?: string;
  /** Optional category icon for quick filtering (production, staging, dev, region). */
  category?: ClusterCategory;
}

export interface CreateClusterInput {
  label: string;
  baseUrl: string;
  authType?: AuthType;
  username?: string;
  password?: string;
  apiKey?: string;
  cluster_name?: string;
  cluster_uuid?: string;
  category?: ClusterCategory;
}

