import type { SearchHit } from '@/types/api';
import type { FieldUsageSummary } from '@/utils/indexDetailHelpers';

export const DEFAULT_VISIBLE_FIELD_COUNT = 8;
export const META_FIELD_ID = '_id';
export const META_FIELD_INDEX = '_index';
const COLUMN_STORAGE_PREFIX = 'es-monitor-data-cols:';

export function formatSourceCellValue(value: unknown, maxLen = 96): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') {
    return value.length > maxLen ? `${value.slice(0, maxLen)}…` : value;
  }
  try {
    const text = JSON.stringify(value);
    return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
  } catch {
    return '—';
  }
}

function collectFieldCounts(hits: SearchHit[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const hit of hits) {
    const source = hit._source;
    if (!source || typeof source !== 'object') continue;
    for (const key of Object.keys(source as Record<string, unknown>)) {
      if (key.startsWith('_')) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function sortFieldsByFrequency(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}

function sortFieldNames(fields: string[]): string[] {
  return [...fields].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );
}

/** All top-level _source keys on the current page, ordered by frequency (defaults only). */
export function getAvailableSourceFields(hits: SearchHit[]): string[] {
  return sortFieldsByFrequency(collectFieldCounts(hits));
}

export function isMetaDataField(field: string): boolean {
  return field === META_FIELD_ID || field === META_FIELD_INDEX;
}

export function getHitColumnValue(hit: SearchHit, field: string, indexName: string, maxLen?: number): string {
  if (field === META_FIELD_ID) return hit._id ?? '';
  if (field === META_FIELD_INDEX) return hit._index ?? indexName;
  const source = (hit._source ?? {}) as Record<string, unknown>;
  return formatSourceCellValue(source[field], maxLen) || '';
}

function prependMetaFields(fields: string[], includeIndex = false): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const name of [META_FIELD_ID, ...(includeIndex ? [META_FIELD_INDEX] : [])]) {
    if (!seen.has(name)) {
      seen.add(name);
      merged.push(name);
    }
  }
  for (const name of fields) {
    if (!seen.has(name) && !isMetaDataField(name)) {
      seen.add(name);
      merged.push(name);
    }
  }
  return merged;
}

/** Default columns from field_usage_stats (most-used fields first). */
export function getDefaultColumnsFromFieldUsage(
  summary: FieldUsageSummary | null | undefined,
  maxCols = DEFAULT_VISIBLE_FIELD_COUNT
): string[] | null {
  if (!summary?.hasUsageData || !summary.fieldList?.length) return null;
  const columns = summary.fieldList
    .filter((field) => field.usage > 0 && !field.name.startsWith('_'))
    .sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name))
    .slice(0, maxCols)
    .map((field) => field.name);
  return columns.length > 0 ? columns : null;
}

/** Sidebar fields: union of mapping, page hits, and meta fields — sorted A→Z. */
export function mergeAvailableSourceFields(
  hits: SearchHit[],
  summary?: FieldUsageSummary | null,
  includeIndexField = false
): string[] {
  const names = new Set<string>([META_FIELD_ID]);
  if (includeIndexField) names.add(META_FIELD_INDEX);

  for (const field of summary?.fieldList ?? []) {
    if (!field.name.startsWith('_')) names.add(field.name);
  }

  for (const hit of hits) {
    const source = hit._source;
    if (!source || typeof source !== 'object') continue;
    for (const key of Object.keys(source as Record<string, unknown>)) {
      if (!key.startsWith('_')) names.add(key);
    }
  }

  return sortFieldNames([...names]);
}

export function columnsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((col, i) => col === b[i]);
}

/** Default visible columns: top N fields by frequency on the current page. */
export function getDefaultVisibleColumns(
  hits: SearchHit[],
  maxCols = DEFAULT_VISIBLE_FIELD_COUNT
): string[] {
  return sortFieldsByFrequency(collectFieldCounts(hits)).slice(0, maxCols);
}

/** Resolve default columns: _id first, then field usage or page frequency. */
export function resolveDefaultDataColumns(
  hits: SearchHit[],
  summary?: FieldUsageSummary | null,
  maxCols = DEFAULT_VISIBLE_FIELD_COUNT
): string[] {
  const sourceMax = Math.max(1, maxCols - 1);
  const sourceCols =
    getDefaultColumnsFromFieldUsage(summary, sourceMax) ??
    getDefaultVisibleColumns(hits, sourceMax);
  return prependMetaFields(sourceCols, false);
}

export function shouldShowIndexColumn(hits: SearchHit[], indexName: string): boolean {
  if (hits.length === 0) return false;
  return hits.some((hit) => (hit._index ?? indexName) !== indexName);
}

export function readStoredColumns(indexName: string): string[] | null {
  try {
    const raw = sessionStorage.getItem(`${COLUMN_STORAGE_PREFIX}${indexName}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return null;
  }
}

export function writeStoredColumns(indexName: string, columns: string[]): void {
  try {
    sessionStorage.setItem(`${COLUMN_STORAGE_PREFIX}${indexName}`, JSON.stringify(columns));
  } catch {
    // ignore quota / private mode
  }
}

export function reorderColumns(columns: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return columns;
  const next = [...columns];
  const [moved] = next.splice(fromIndex, 1);
  if (moved == null) return columns;
  next.splice(toIndex, 0, moved);
  return next;
}

export function insertColumn(columns: string[], field: string, atIndex: number): string[] {
  const without = columns.filter((col) => col !== field);
  const index = Math.max(0, Math.min(atIndex, without.length));
  const next = [...without];
  next.splice(index, 0, field);
  return next;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadIndexDataCsv(
  hits: SearchHit[],
  columns: string[],
  indexName: string,
  page: number
): void {
  const headers = columns.length > 0 ? columns : [META_FIELD_ID];
  const lines = [
    headers.join(','),
    ...hits.map((hit) =>
      headers.map((col) => csvEscape(getHitColumnValue(hit, col, indexName, 50_000))).join(',')
    )
  ];
  const safeName = indexName.replace(/[^\w.-]+/g, '_');
  downloadBlob(`${safeName}-page${page}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
}

export function downloadIndexDataJson(
  hits: SearchHit[],
  columns: string[],
  indexName: string,
  page: number
): void {
  const keys = columns.length > 0 ? columns : [META_FIELD_ID];
  const rows = hits.map((hit) => {
    const row: Record<string, string> = {};
    for (const col of keys) {
      row[col] = getHitColumnValue(hit, col, indexName, 50_000);
    }
    return row;
  });
  const safeName = indexName.replace(/[^\w.-]+/g, '_');
  downloadBlob(`${safeName}-page${page}.json`, JSON.stringify(rows, null, 2), 'application/json');
}
