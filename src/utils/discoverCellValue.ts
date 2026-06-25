import type { SearchHit } from '@/types/api';
import { formatSourceCellValue, getHitColumnValue, getSourceValueByPath } from '@/utils/indexDataTable';

export type DiscoverCellValue = {
  display: string;
  copyText: string;
  filterValue: string | number | boolean | null;
};

export function getDiscoverCellValue(
  hit: SearchHit,
  field: string,
  indexName: string
): DiscoverCellValue {
  if (field.startsWith('_')) {
    const raw = getHitColumnValue(hit, field, indexName, 10_000);
    const display = getHitColumnValue(hit, field, indexName) || '—';
    if (!raw) {
      return { display, copyText: '', filterValue: null };
    }
    return { display, copyText: raw, filterValue: raw };
  }

  const source = (hit._source ?? {}) as Record<string, unknown>;
  const raw = getSourceValueByPath(source, field);

  if (raw == null) {
    return { display: '—', copyText: '', filterValue: null };
  }

  if (typeof raw === 'boolean' || typeof raw === 'number') {
    const text = String(raw);
    return { display: text, copyText: text, filterValue: raw };
  }

  if (typeof raw === 'string') {
    const display = formatSourceCellValue(raw) || '—';
    return { display, copyText: raw, filterValue: raw };
  }

  try {
    const text = JSON.stringify(raw);
    return {
      display: formatSourceCellValue(raw) || '—',
      copyText: text,
      filterValue: null
    };
  } catch {
    return { display: '—', copyText: '', filterValue: null };
  }
}
