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
    size: Math.max(1, Math.min(size, 100)),
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
  if (total == null) return null;
  if (typeof total === 'number') return total;
  return typeof total.value === 'number' ? total.value : null;
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

export const INDEX_DATA_QUERY_EXAMPLES: Array<{ query: string; description: string }> = [
  { query: '*', description: 'Get all documents' },
  { query: 'server error', description: 'Documents containing server or error in any field' },
  { query: '_id:1', description: 'Documents where _id is 1' },
  { query: 'full_name:"Musab Dogan"', description: 'Exact match on full_name including whitespace' },
  { query: 'first_name:(John OR Ali)', description: 'first_name is John or Ali' },
  { query: 'age:>25', description: 'age field greater than 25' }
];
