import type { FieldUsageStatsResponse, IndexDetailsResponse } from '@/types/api';

export interface FieldUsageSummary {
  totalFields: number;
  usedFields: number;
  unusedFields: number;
  mostUsedFieldName: string | null;
  fieldList?: Array<{ name: string; usage: number; usageTypes: string[] }>;
  unusedFieldNames?: string[];
  hasUsageData: boolean;
}

export const FIELD_USAGE_TYPE_LABELS: Record<string, string> = {
  search: 'Search',
  aggregation_sort: 'Sort & Agg',
  range_query: 'Range query',
  stored: 'Stored',
  scoring: 'Scoring',
  term_vectors: 'Term vectors',
  vector_search: 'Vector search'
};

type MappingsResponse = Record<string, { mappings?: { properties?: Record<string, unknown> } }>;

export type MappingSummary = {
  totalFields: number;
  typeCounts: Record<string, number>;
  distinctTypeCount: number;
  textFieldCount: number;
  keywordFieldCount: number;
  analyzerNames: string[];
  searchAnalyzerNames: string[];
  definedAnalyzerNames: string[];
};

export function healthToBadgeClass(health: string | undefined): string {
  if (health === 'green') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (health === 'yellow') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  if (health === 'red') return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
  return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
}

export function parseCatByteSizeToBytes(value: string | undefined): number {
  if (!value) return 0;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return 0;
  const m = raw.match(/^([\d.]+)\s*([kmgtp]?b)?$/i);
  if (!m) return 0;
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return 0;
  const unit = (m[2] ?? 'b').toLowerCase();
  const pow = unit === 'kb' ? 1 : unit === 'mb' ? 2 : unit === 'gb' ? 3 : unit === 'tb' ? 4 : unit === 'pb' ? 5 : 0;
  return num * Math.pow(1024, pow);
}

export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function countLeafFieldsFromMapping(props: Record<string, unknown> | undefined, prefix = ''): number {
  if (!props || typeof props !== 'object') return 0;
  let count = 0;
  for (const [key, value] of Object.entries(props)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (v.properties) {
      count += countLeafFieldsFromMapping(v.properties as Record<string, unknown>, fullPath);
    } else if (v.fields) {
      if (v.type) count += 1;
      for (const sub of Object.values(v.fields as Record<string, unknown>)) {
        const s = sub as Record<string, unknown>;
        if (s?.properties && typeof s.properties === 'object') {
          count += countLeafFieldsFromMapping(s.properties as Record<string, unknown>, `${fullPath}.${key}`);
        } else {
          count += 1;
        }
      }
    } else if (v.type) {
      count += 1;
    }
  }
  return count;
}

function getLeafFieldNamesFromMapping(props: Record<string, unknown> | undefined, prefix = ''): string[] {
  if (!props || typeof props !== 'object') return [];
  const names: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (v.properties) {
      names.push(...getLeafFieldNamesFromMapping(v.properties as Record<string, unknown>, fullPath));
    } else if (v.fields) {
      if (v.type) names.push(fullPath);
      for (const [fk, fv] of Object.entries(v.fields as Record<string, unknown>)) {
        const f = fv as Record<string, unknown>;
        if (f?.properties && typeof f.properties === 'object') {
          names.push(...getLeafFieldNamesFromMapping(f.properties as Record<string, unknown>, `${fullPath}.${fk}`));
        } else {
          names.push(`${fullPath}.${fk}`);
        }
      }
    } else if (v.type) {
      names.push(fullPath);
    }
  }
  return names;
}

function getFieldUsageTypes(data: Record<string, unknown>): string[] {
  const types: string[] = [];
  const inv = data.inverted_index as Record<string, unknown> | undefined;
  const terms = typeof inv?.terms === 'number' ? inv.terms : parseInt(String(inv?.terms ?? 0), 10) || 0;
  const postings = typeof inv?.postings === 'number' ? inv.postings : parseInt(String(inv?.postings ?? 0), 10) || 0;
  if (terms > 0 || postings > 0) types.push('search');
  const docValues = typeof data.doc_values === 'number' ? data.doc_values : parseInt(String(data.doc_values ?? 0), 10) || 0;
  if (docValues > 0) types.push('aggregation_sort');
  const points = typeof data.points === 'number' ? data.points : parseInt(String(data.points ?? 0), 10) || 0;
  if (points > 0) types.push('range_query');
  const stored = typeof data.stored_fields === 'number' ? data.stored_fields : parseInt(String(data.stored_fields ?? 0), 10) || 0;
  if (stored > 0) types.push('stored');
  const norms = typeof data.norms === 'number' ? data.norms : parseInt(String(data.norms ?? 0), 10) || 0;
  if (norms > 0) types.push('scoring');
  const termVectors = typeof data.term_vectors === 'number' ? data.term_vectors : parseInt(String(data.term_vectors ?? 0), 10) || 0;
  if (termVectors > 0) types.push('term_vectors');
  const knnVectors = typeof data.knn_vectors === 'number' ? data.knn_vectors : parseInt(String(data.knn_vectors ?? 0), 10) || 0;
  if (knnVectors > 0) types.push('vector_search');
  return types;
}

function collectMappingStatsFromField(
  fieldDefRaw: unknown,
  out: {
    typeCounts: Record<string, number>;
    analyzerNames: Set<string>;
    searchAnalyzerNames: Set<string>;
  }
): void {
  if (!fieldDefRaw || typeof fieldDefRaw !== 'object') return;
  const fieldDef = fieldDefRaw as Record<string, unknown>;
  if (typeof fieldDef.type === 'string' && fieldDef.type.trim()) {
    const fieldType = fieldDef.type.trim();
    out.typeCounts[fieldType] = (out.typeCounts[fieldType] ?? 0) + 1;
  }
  if (typeof fieldDef.analyzer === 'string' && fieldDef.analyzer.trim()) {
    out.analyzerNames.add(fieldDef.analyzer.trim());
  }
  if (typeof fieldDef.search_analyzer === 'string' && fieldDef.search_analyzer.trim()) {
    out.searchAnalyzerNames.add(fieldDef.search_analyzer.trim());
  }
  const properties = fieldDef.properties;
  if (properties && typeof properties === 'object') {
    for (const value of Object.values(properties as Record<string, unknown>)) {
      collectMappingStatsFromField(value, out);
    }
  }
  const multiFields = fieldDef.fields;
  if (multiFields && typeof multiFields === 'object') {
    for (const value of Object.values(multiFields as Record<string, unknown>)) {
      collectMappingStatsFromField(value, out);
    }
  }
}

export function buildMappingSummary(
  indexName: string,
  indexDetails: IndexDetailsResponse | null
): MappingSummary | null {
  if (!indexName || !indexDetails?.[indexName]) return null;
  const detailEntry = indexDetails[indexName] as {
    mappings?: { properties?: Record<string, unknown> };
    settings?: { index?: { analysis?: { analyzer?: Record<string, unknown> } } };
  };
  const rootProps = detailEntry?.mappings?.properties;
  if (!rootProps || typeof rootProps !== 'object') return null;
  const collected = {
    typeCounts: {} as Record<string, number>,
    analyzerNames: new Set<string>(),
    searchAnalyzerNames: new Set<string>()
  };
  for (const value of Object.values(rootProps)) {
    collectMappingStatsFromField(value, collected);
  }
  const definedAnalyzerNames = Object.keys(detailEntry?.settings?.index?.analysis?.analyzer ?? {}).sort((a, b) =>
    a.localeCompare(b)
  );
  const totalFields = Object.values(collected.typeCounts).reduce((sum, count) => sum + count, 0);
  return {
    totalFields,
    typeCounts: collected.typeCounts,
    distinctTypeCount: Object.keys(collected.typeCounts).length,
    textFieldCount: collected.typeCounts.text ?? 0,
    keywordFieldCount: collected.typeCounts.keyword ?? 0,
    analyzerNames: Array.from(collected.analyzerNames).sort((a, b) => a.localeCompare(b)),
    searchAnalyzerNames: Array.from(collected.searchAnalyzerNames).sort((a, b) => a.localeCompare(b)),
    definedAnalyzerNames
  };
}

export function parseFieldUsageIndexDetailed(
  indexName: string,
  fieldUsageResponse: FieldUsageStatsResponse | null,
  mappingsResponse: MappingsResponse | null
): FieldUsageSummary {
  const mappingProps = mappingsResponse?.[indexName]?.mappings?.properties;
  const mappingLeafFieldNames = mappingProps ? getLeafFieldNamesFromMapping(mappingProps) : [];
  const totalFieldsFromMapping = mappingProps != null ? countLeafFieldsFromMapping(mappingProps) : 0;
  const indexData = fieldUsageResponse?.[indexName] as { shards?: unknown[] } | undefined;
  const shards = indexData?.shards;
  let usedFields = 0;
  let mostUsedFieldName: string | null = null;
  let maxUsage = 0;
  const allFieldNames = new Set<string>();
  const fieldUsageMax: Record<string, number> = {};
  const fieldUsageTypesMap: Record<string, Set<string>> = {};

  if (Array.isArray(shards)) {
    for (const shard of shards) {
      const stats = (shard as { stats?: { fields?: Record<string, Record<string, unknown>> } }).stats;
      const fields = stats?.fields;
      if (!fields || typeof fields !== 'object') continue;
      for (const [fieldName, fieldData] of Object.entries(fields)) {
        allFieldNames.add(fieldName);
        const data = fieldData as Record<string, unknown>;
        const any = typeof data.any === 'number' ? data.any : parseInt(String(data.any ?? 0), 10) || 0;
        if (any > (fieldUsageMax[fieldName] ?? 0)) fieldUsageMax[fieldName] = any;
        const types = getFieldUsageTypes(data);
        if (!fieldUsageTypesMap[fieldName]) fieldUsageTypesMap[fieldName] = new Set();
        types.forEach((t) => fieldUsageTypesMap[fieldName].add(t));
      }
    }
    for (const fn of [...allFieldNames].filter((name) => !name.startsWith('_'))) {
      const usage = fieldUsageMax[fn] ?? 0;
      if (usage > 0) usedFields++;
      if (usage > maxUsage) {
        maxUsage = usage;
        mostUsedFieldName = fn;
      }
    }
  }

  const userFieldNamesFromUsage = [...allFieldNames].filter((name) => !name.startsWith('_'));
  const totalFields = totalFieldsFromMapping > 0 ? totalFieldsFromMapping : userFieldNamesFromUsage.length;
  const listFieldNames =
    mappingLeafFieldNames.length > 0
      ? mappingLeafFieldNames.filter((name) => !name.startsWith('_'))
      : userFieldNamesFromUsage;
  const fieldList: Array<{ name: string; usage: number; usageTypes: string[] }> = [];
  for (const fn of listFieldNames) {
    fieldList.push({
      name: fn,
      usage: fieldUsageMax[fn] ?? 0,
      usageTypes: Array.from(fieldUsageTypesMap[fn] ?? [])
    });
  }
  fieldList.sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name));

  let unusedFieldNames: string[] | undefined;
  if (mappingProps) {
    unusedFieldNames = mappingLeafFieldNames
      .filter((name) => !name.startsWith('_') && (fieldUsageMax[name] ?? 0) === 0)
      .sort((a, b) => a.localeCompare(b));
  } else {
    unusedFieldNames = fieldList.filter((f) => f.usage === 0).map((f) => f.name).sort((a, b) => a.localeCompare(b));
  }

  const hasUsageData = Array.isArray(shards) && shards.length > 0;
  return {
    totalFields,
    usedFields,
    unusedFields: Math.max(0, totalFields - usedFields),
    mostUsedFieldName,
    fieldList,
    unusedFieldNames,
    hasUsageData
  };
}

export function buildOverviewRowFromShards(
  indexName: string,
  indexShards: Array<{ prirep?: string; state?: string; store?: string; docs?: string | number }>
) {
  const priCount = indexShards.filter((s) => s.prirep === 'p').length;
  const repCount = indexShards.filter((s) => s.prirep === 'r').length;
  const repFactor = priCount > 0 ? Math.max(0, Math.round(repCount / priCount)) : 0;
  const totalStoreBytes = indexShards.reduce((sum, s) => sum + parseCatByteSizeToBytes(s.store), 0);
  const primaryStoreBytes = indexShards
    .filter((s) => s.prirep === 'p')
    .reduce((sum, s) => sum + parseCatByteSizeToBytes(s.store), 0);
  const primaryDocs = indexShards
    .filter((s) => s.prirep === 'p')
    .reduce((sum, s) => sum + (parseInt(String(s.docs ?? '0'), 10) || 0), 0);
  const hasPrimaryIssue = indexShards.some((s) => s.prirep === 'p' && s.state !== 'STARTED');
  const hasReplicaIssue = indexShards.some((s) => s.prirep !== 'p' && s.state !== 'STARTED');
  const health = hasPrimaryIssue ? 'red' : hasReplicaIssue ? 'yellow' : 'green';

  return {
    index: indexName,
    health,
    pri: String(priCount),
    rep: String(repFactor),
    'store.size': totalStoreBytes > 0 ? formatBytesCompact(totalStoreBytes).replace(' ', '').toLowerCase() : '—',
    'pri.store.size': primaryStoreBytes > 0 ? formatBytesCompact(primaryStoreBytes).replace(' ', '').toLowerCase() : '—',
    'docs.count': String(primaryDocs),
    'docs.deleted': '—' as string
  };
}
