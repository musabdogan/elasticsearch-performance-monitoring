import type { ClusterConnection, CreateClusterInput } from '@/types/app';

export type BackupSource = 'elasticvue' | 'epm';

export const EPM_BACKUP_SOURCE = 'elasticsearch-performance-monitoring';

const MULTILINE_TEXT_RE = /\r?\n/;

export type EpmBackupFile = {
  version: string;
  source: typeof EPM_BACKUP_SOURCE;
  exportedAt: string;
  clusters: ClusterConnection[];
};

type ElasticVueAuthData = {
  username?: string;
  password?: string;
  apiKey?: string;
  encoded?: string;
};

type ElasticVueCluster = {
  name?: string;
  clusterName?: string;
  uri?: string;
  uuid?: string;
  auth?: {
    authType?: string;
    authData?: ElasticVueAuthData;
  };
  username?: string;
  password?: string;
  apiKey?: string;
};

type ElasticVueBackup = {
  version?: string;
  store?: {
    connection?: {
      clusters?: ElasticVueCluster[];
      activeClusterIndex?: number;
    };
  };
};

export function sanitizeClusterInput(input: CreateClusterInput): ClusterConnection | null {
  const sanitizedBaseUrlRaw = input.baseUrl?.trim().replace(/\/$/, '') ?? '';
  if (!sanitizedBaseUrlRaw) return null;

  const sanitizedBaseUrl = /^https?:\/\//i.test(sanitizedBaseUrlRaw)
    ? sanitizedBaseUrlRaw
    : `http://${sanitizedBaseUrlRaw}`;
  const label = (input.label || sanitizedBaseUrl).trim();
  if (!label) return null;

  const authType =
    input.authType ??
    (input.apiKey?.trim() ? 'apiKey' : input.username && input.password ? 'basic' : 'none');

  return {
    label,
    baseUrl: sanitizedBaseUrl,
    authType,
    username: input.username?.trim() || '',
    password: input.password?.trim() || '',
    apiKey: input.apiKey?.trim() || '',
    cluster_name: input.cluster_name,
    cluster_uuid: input.cluster_uuid,
    category: input.category
  };
}

function mapElasticVueAuth(cluster: ElasticVueCluster): Pick<CreateClusterInput, 'authType' | 'username' | 'password' | 'apiKey'> {
  const auth = cluster.auth;
  if (auth?.authType === 'basicAuth' && auth.authData) {
    return {
      authType: 'basic',
      username: auth.authData.username ?? '',
      password: auth.authData.password ?? ''
    };
  }
  if (auth?.authType === 'apiKey' && auth.authData) {
    return {
      authType: 'apiKey',
      apiKey: auth.authData.apiKey ?? auth.authData.encoded ?? ''
    };
  }
  if (cluster.username || cluster.password) {
    return {
      authType: 'basic',
      username: cluster.username ?? '',
      password: cluster.password ?? ''
    };
  }
  if (cluster.apiKey?.trim()) {
    return { authType: 'apiKey', apiKey: cluster.apiKey.trim() };
  }
  return { authType: 'none' };
}

function elasticVueClusterToInput(cluster: ElasticVueCluster): CreateClusterInput | null {
  const uri = cluster.uri?.trim();
  if (!uri) return null;

  const auth = mapElasticVueAuth(cluster);
  return {
    label: (cluster.name || cluster.clusterName || uri).trim(),
    baseUrl: uri,
    ...auth,
    cluster_name: cluster.clusterName,
    cluster_uuid: cluster.uuid
  };
}

export function parseElasticVueBackup(json: unknown): CreateClusterInput[] {
  const data = json as ElasticVueBackup;
  const list = data?.store?.connection?.clusters;
  if (!Array.isArray(list)) return [];

  return list
    .map(elasticVueClusterToInput)
    .filter((item): item is CreateClusterInput => item != null);
}

function isEpmMetaLine(obj: Record<string, unknown>): boolean {
  return obj.source === EPM_BACKUP_SOURCE && !obj.baseUrl && !Array.isArray(obj.clusters);
}

function clustersFromObjects(objects: unknown[]): ClusterConnection[] {
  return objects
    .map((item) => sanitizeClusterInput(item as CreateClusterInput))
    .filter((item): item is ClusterConnection => item != null);
}

export function parseEpmBackup(json: unknown): CreateClusterInput[] {
  if (Array.isArray(json)) {
    return clustersFromObjects(json);
  }

  const root = json as Record<string, unknown>;
  const clusters = root.clusters;
  if (!Array.isArray(clusters)) return [];

  return clustersFromObjects(clusters);
}

export function parseEpmBackupText(text: string): CreateClusterInput[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (MULTILINE_TEXT_RE.test(trimmed)) {
    const lines = trimmed.split(MULTILINE_TEXT_RE).map((line) => line.trim()).filter(Boolean);
    const clusterObjects: unknown[] = [];

    for (const line of lines) {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (isEpmMetaLine(obj)) continue;
      if (Array.isArray(obj.clusters)) {
        return clustersFromObjects(obj.clusters);
      }
      if (obj.label || obj.baseUrl) {
        clusterObjects.push(obj);
      }
    }

    return clustersFromObjects(clusterObjects);
  }

  return parseEpmBackup(JSON.parse(trimmed));
}

export function detectBackupSource(json: unknown): BackupSource | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;

  if (root.source === EPM_BACKUP_SOURCE) return 'epm';
  if (Array.isArray(root.clusters) && !root.store) return 'epm';

  const store = root.store as ElasticVueBackup['store'] | undefined;
  if (store?.connection?.clusters && Array.isArray(store.connection.clusters)) {
    return 'elasticvue';
  }

  if (Array.isArray(json)) return 'epm';
  return null;
}

function detectBackupSourceFromText(text: string): BackupSource | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (MULTILINE_TEXT_RE.test(trimmed)) {
    const firstLine = trimmed.split(MULTILINE_TEXT_RE).find((line) => line.trim());
    if (!firstLine) return null;
    try {
      const first = JSON.parse(firstLine) as Record<string, unknown>;
      if (first.source === EPM_BACKUP_SOURCE) return 'epm';
      if (first.label || first.baseUrl) return 'epm';
      return detectBackupSource(first);
    } catch {
      return null;
    }
  }

  try {
    return detectBackupSource(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

export function parseBackupFile(json: unknown, preferredSource?: BackupSource): {
  source: BackupSource | null;
  clusters: ClusterConnection[];
  error: string | null;
} {
  let source = detectBackupSource(json);
  if (!source && preferredSource) source = preferredSource;

  if (!source) {
    return { source: null, clusters: [], error: 'Unrecognized backup format. Choose Elasticvue or Elasticsearch Performance Monitoring.' };
  }

  const inputs = source === 'elasticvue' ? parseElasticVueBackup(json) : parseEpmBackup(json);
  const clusters = clustersFromObjects(inputs);

  if (clusters.length === 0) {
    return { source, clusters: [], error: 'No cluster connections found in this backup file.' };
  }

  return { source, clusters, error: null };
}

export function parseBackupText(text: string, preferredSource?: BackupSource): {
  source: BackupSource | null;
  clusters: ClusterConnection[];
  error: string | null;
} {
  try {
    let source = detectBackupSourceFromText(text);
    if (!source && preferredSource) source = preferredSource;

    if (!source) {
      return { source: null, clusters: [], error: 'Unrecognized backup format. Choose Elasticvue or Elasticsearch Performance Monitoring.' };
    }

    const inputs =
      source === 'elasticvue'
        ? parseElasticVueBackup(JSON.parse(text.trim()))
        : parseEpmBackupText(text);
    const clusters = clustersFromObjects(inputs);

    if (clusters.length === 0) {
      return { source, clusters: [], error: 'No cluster connections found in this backup file.' };
    }

    return { source, clusters, error: null };
  } catch {
    return { source: null, clusters: [], error: 'Could not read the file. Ensure it is valid JSON or NDJSON.' };
  }
}

export function buildEpmBackup(clusters: ClusterConnection[]): EpmBackupFile {
  return {
    version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0',
    source: EPM_BACKUP_SOURCE,
    exportedAt: new Date().toISOString(),
    clusters
  };
}

export function buildEpmBackupNdjson(clusters: ClusterConnection[]): string {
  const meta = {
    version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0',
    source: EPM_BACKUP_SOURCE,
    exportedAt: new Date().toISOString()
  };
  return [JSON.stringify(meta), ...clusters.map((cluster) => JSON.stringify(cluster))].join('\n') + '\n';
}

export function epmBackupFilename(date = new Date()): string {
  return `searchali_cluster_backup_${date.toISOString().slice(0, 10)}.json`;
}

export function downloadEpmBackup(clusters: ClusterConnection[]): void {
  const content = buildEpmBackupNdjson(clusters);
  const blob = new Blob([content], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = epmBackupFilename();
  anchor.click();
  URL.revokeObjectURL(url);
}
