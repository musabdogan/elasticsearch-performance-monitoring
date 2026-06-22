/** Build ES search body for index document browse (Elasticvue-style query_string). */
export function buildIndexSearchBody(
  query: string,
  size: number,
  from: number,
  sort: string[] = []
): Record<string, unknown> {
  const trimmed = query.trim();
  const useMatchAll = !trimmed || trimmed === '*';

  const body: Record<string, unknown> = {
    size: Math.max(1, Math.min(size, DOCUMENT_SEARCH_MAX_SIZE)),
    from: Math.max(0, from),
    sort: sort.length > 0 ? sort : []
  };

  if (useMatchAll) {
    body.query = { match_all: {} };
  } else {
    body.query = { query_string: { query: trimmed } };
  }

  return body;
}

export function normalizeSearchTotal(
  total: number | { value: number; relation?: 'eq' | 'gte' } | undefined
): number | null {
  return parseSearchTotal(total).value;
}

export function parseSearchTotal(
  total: number | { value: number; relation?: 'eq' | 'gte' } | undefined
): { value: number | null; isLowerBound: boolean } {
  if (total == null) return { value: null, isLowerBound: false };
  if (typeof total === 'number') {
    if (total < 0) return { value: null, isLowerBound: false };
    return { value: total, isLowerBound: false };
  }
  const value = typeof total.value === 'number' && total.value >= 0 ? total.value : null;
  return { value, isLowerBound: total.relation === 'gte' };
}

function formatCompactCount(value: number): string {
  if (value >= 10_000) return '10k';
  if (value >= 1_000) {
    const k = value / 1_000;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return Intl.NumberFormat('en-US').format(value);
}

/** Human-readable hit count for the Documents header. */
export function formatDocumentTotalLabel(
  value: number | null,
  isLowerBound: boolean
): string {
  if (value == null) return '—';
  if (isLowerBound) return `${formatCompactCount(value)}+`;
  return Intl.NumberFormat('en-US').format(value);
}

export function formatDocumentPreview(source: Record<string, unknown> | undefined, maxLen = 120): string {
  if (!source || typeof source !== 'object') return '—';
  try {
    const text = JSON.stringify(source);
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}…`;
  } catch {
    return '—';
  }
}

export const INDEX_SEARCH_MAX_RESULT_WINDOW = 10_000;

export const DOCUMENT_SEARCH_MAX_SIZE = 10_000;

export const DOCUMENT_PAGE_SIZE_OPTIONS = [
  { value: 10, label: '10' },
  { value: 100, label: '100' },
  { value: 1000, label: '1k' },
  { value: 10_000, label: '10k' }
] as const;

export function formatDocumentPageSizeTopLabel(size: number): string {
  const match = DOCUMENT_PAGE_SIZE_OPTIONS.find((option) => option.value === size);
  return match ? `Top ${match.label}` : `Top ${size}`;
}

export const INDEX_DATA_QUERY_EXAMPLES: Array<{ query: string; description: string }> = [
  { query: '*', description: 'Get all documents' },
  { query: 'server error', description: 'Documents containing server or error in any field' },
  { query: '_id:1', description: 'Documents where _id is 1' },
  { query: 'full_name:"Musab Dogan"', description: 'Exact match on full_name including whitespace' },
  { query: 'first_name:(John OR Ali)', description: 'first_name is John or Ali' },
  { query: 'age:>25', description: 'age field greater than 25' }
];
