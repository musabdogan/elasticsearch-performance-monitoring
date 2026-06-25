import type { SearchHit } from '@/types/api';
import { formatSourceCellValue } from '@/utils/indexDataTable';

export type DiscoverDocumentFieldRow = {
  field: string;
  value: string;
  raw: unknown;
};

function formatFieldValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return formatSourceCellValue(value, 2000) || String(value);
}

function flattenSource(
  value: unknown,
  prefix: string,
  rows: DiscoverDocumentFieldRow[]
): void {
  if (value == null) {
    rows.push({ field: prefix, value: '', raw: value });
    return;
  }

  if (Array.isArray(value)) {
    rows.push({ field: prefix, value: formatFieldValue(value), raw: value });
    return;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      rows.push({ field: prefix, value: '{}', raw: value });
      return;
    }
    for (const key of keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      const path = prefix ? `${prefix}.${key}` : key;
      flattenSource(obj[key], path, rows);
    }
    return;
  }

  rows.push({ field: prefix, value: formatFieldValue(value), raw: value });
}

export function flattenHitDocumentFields(hit: SearchHit, indexName: string): DiscoverDocumentFieldRow[] {
  const rows: DiscoverDocumentFieldRow[] = [];

  if (hit._id != null) {
    rows.push({ field: '_id', value: String(hit._id), raw: hit._id });
  }
  if (hit._index != null) {
    rows.push({ field: '_index', value: String(hit._index), raw: hit._index });
  } else if (indexName) {
    rows.push({ field: '_index', value: indexName, raw: indexName });
  }

  const source = hit._source;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const topKeys = Object.keys(source as Record<string, unknown>).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    for (const key of topKeys) {
      flattenSource((source as Record<string, unknown>)[key], key, rows);
    }
  }

  return rows;
}

export function filterDocumentFieldRows(
  rows: DiscoverDocumentFieldRow[],
  query: string
): DiscoverDocumentFieldRow[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;

  const terms = normalized.split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    const fieldHaystack = row.field.toLowerCase();
    const valueHaystack = row.value.toLowerCase();
    return terms.every(
      (term) => fieldHaystack.includes(term) || valueHaystack.includes(term)
    );
  });
}
