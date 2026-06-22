import { buildIndexSearchBody, DOCUMENT_SEARCH_MAX_SIZE } from '@/utils/indexSearchQuery';

export type QueryMode = 'simple' | 'advanced';

export type SortRule = {
  field: string;
  order: 'asc' | 'desc';
};

export const DEFAULT_SIMPLE_QUERY = '';
export const DEFAULT_SIZE = 10;
/** Wildcard pattern matching all indices when no pattern is set. */
export const ALL_INDICES_PATTERN = '*';

export function pickIndexWithMostDocuments(
  indices: Array<{ index?: string; 'docs.count'?: string }> | undefined
): string | null {
  if (!indices?.length) return null;
  let best: { name: string; count: number } | null = null;
  for (const row of indices) {
    const name = row.index?.trim();
    if (!name) continue;
    const count = parseInt(String(row['docs.count'] ?? '').replace(/,/g, ''), 10);
    if (!Number.isFinite(count)) continue;
    if (!best || count > best.count) best = { name, count };
  }
  return best?.name ?? null;
}

export function normalizeQueryIndexPattern(pattern: string): string {
  const trimmed = pattern.trim();
  return trimmed || ALL_INDICES_PATTERN;
}

/** True when the pattern is the cluster-wide all-indices selector. */
export function isAllIndicesQueryPattern(pattern: string): boolean {
  const p = normalizeQueryIndexPattern(pattern);
  return p === ALL_INDICES_PATTERN || p === '_all';
}

/** True when the pattern targets one index/data stream (no *, ?, or comma). */
export function isConcreteIndexPattern(pattern: string): boolean {
  const p = normalizeQueryIndexPattern(pattern);
  if (isAllIndicesQueryPattern(p)) return false;
  return !/[*,?]/.test(p) && !p.includes(',');
}

/**
 * Filter index names in the Query picker — plain text uses substring match;
 * patterns with * or ? use Elasticsearch-style wildcards (anchored to full name).
 */
export function matchesQueryIndexFilter(indexName: string, filter: string): boolean {
  const name = indexName.trim();
  const q = filter.trim();
  if (!q) return true;
  if (!name) return false;

  if (!q.includes('*') && !q.includes('?')) {
    const nameLower = name.toLowerCase();
    const qLower = q.toLowerCase();
    if (nameLower.includes(qLower)) return true;
    // Prefix typing: "consent" matches "consents", "consents-v2", etc.
    if (nameLower.startsWith(qLower) || qLower.startsWith(nameLower)) return true;
    return false;
  }

  let regexSource = '^';
  for (const ch of q) {
    if (ch === '*') regexSource += '.*';
    else if (ch === '?') regexSource += '.';
    else regexSource += ch.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  regexSource += '$';

  try {
    return new RegExp(regexSource, 'i').test(name);
  } catch {
    return name.toLowerCase().includes(q.toLowerCase());
  }
}

export function buildSortClause(rules: SortRule[]): unknown[] {
  return rules
    .filter((r) => r.field.trim())
    .map((r) => {
      const field = r.field.trim();
      if (field === '_score' || field === '_doc') {
        return { [field]: { order: r.order } };
      }
      return { [field]: { order: r.order } };
    });
}

export function buildSimpleSearchBody(
  query: string,
  size: number,
  from: number,
  sort: SortRule[] = []
): Record<string, unknown> {
  const body = buildIndexSearchBody(query, size, from, []);
  const sortClause = buildSortClause(sort);
  if (sortClause.length > 0) body.sort = sortClause;
  return body;
}

export function buildAdvancedSearchBody(
  jsonText: string,
  size: number,
  from: number,
  sort: SortRule[] = []
): { body: Record<string, unknown> | null; error: string | null } {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { body: null, error: 'Advanced query must be a JSON object.' };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid JSON';
    return { body: null, error: msg };
  }

  const body = { ...parsed };
  body.size = Math.max(1, Math.min(size, DOCUMENT_SEARCH_MAX_SIZE));
  body.from = Math.max(0, from);
  const sortClause = buildSortClause(sort);
  if (sortClause.length > 0) body.sort = sortClause;
  return { body, error: null };
}

export function simpleBodyToAdvancedJson(
  query: string,
  size: number,
  from: number,
  sort: SortRule[] = []
): string {
  return JSON.stringify(buildSimpleSearchBody(query, size, from, sort), null, 2);
}

export function extractSimpleQueryFromBody(body: Record<string, unknown>): string | null {
  const query = body.query;
  if (!query || typeof query !== 'object') return null;
  const qs = (query as Record<string, unknown>).query_string;
  if (qs && typeof qs === 'object') {
    const q = (qs as Record<string, unknown>).query;
    if (typeof q === 'string') return q;
  }
  if ('match_all' in (query as Record<string, unknown>)) return '';
  return null;
}

export function buildSearchCurl(
  baseUrl: string,
  indexPattern: string,
  body: Record<string, unknown>,
  cluster: { username?: string; password?: string; apiKey?: string; authType?: string }
): string {
  const base = baseUrl.replace(/\/$/, '');
  const path = `/${encodeURIComponent(indexPattern.trim() || '*').replace(/%2C/g, ',')}/_search`;
  const url = `${base}${path}`;
  const bodyStr = JSON.stringify(body, null, 2);
  const authType = cluster.authType ?? (cluster.apiKey?.trim() ? 'apiKey' : cluster.username ? 'basic' : 'none');
  if (authType === 'apiKey' && cluster.apiKey?.trim()) {
    return `curl -X POST "${url}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: ApiKey ${cluster.apiKey.trim()}" \\
  -d '${bodyStr.replace(/'/g, "'\\''")}'`;
  }
  const user = cluster.username?.trim() || 'elastic';
  return `curl -u "${user}:YOUR_PASSWORD" -X POST "${url}" \\
  -H "Content-Type: application/json" \\
  -d '${bodyStr.replace(/'/g, "'\\''")}'`;
}
