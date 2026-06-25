import type { DiscoverFilter } from '@/types/discover';

function extractQueryClause(body: Record<string, unknown>): Record<string, unknown> | null {
  const query = body.query;
  if (!query || typeof query !== 'object' || Array.isArray(query)) return null;
  return query as Record<string, unknown>;
}

function buildMatchPhraseClause(filter: DiscoverFilter): Record<string, unknown> {
  const value =
    typeof filter.value === 'string' ? filter.value : filter.value;
  return { match_phrase: { [filter.aggField]: value } };
}

export function createDiscoverFilter(
  field: string,
  aggField: string,
  value: string | number | boolean,
  negate = false
): DiscoverFilter {
  const id = `${field}:${String(value)}:${negate ? 'not' : 'is'}`;
  return { id, field, aggField, value, negate: negate || undefined };
}

export function filtersEqual(a: DiscoverFilter, b: DiscoverFilter): boolean {
  return (
    a.field === b.field &&
    a.aggField === b.aggField &&
    String(a.value) === String(b.value) &&
    Boolean(a.negate) === Boolean(b.negate)
  );
}

export function mergeDiscoverFiltersIntoBody(
  body: Record<string, unknown>,
  filters: DiscoverFilter[]
): Record<string, unknown> {
  if (filters.length === 0) return body;

  const next = { ...body };
  const positive = filters.filter((f) => !f.negate).map(buildMatchPhraseClause);
  const negative = filters.filter((f) => f.negate).map(buildMatchPhraseClause);

  const existingQuery = extractQueryClause(next);

  if (!existingQuery) {
    next.query = {
      bool: {
        ...(positive.length > 0 ? { filter: positive } : {}),
        ...(negative.length > 0 ? { must_not: negative } : {})
      }
    };
    return next;
  }

  if ('bool' in existingQuery && existingQuery.bool && typeof existingQuery.bool === 'object') {
    const bool = { ...(existingQuery.bool as Record<string, unknown>) };
    const existingFilter = Array.isArray(bool.filter)
      ? [...bool.filter]
      : bool.filter
        ? [bool.filter]
        : [];
    const existingMustNot = Array.isArray(bool.must_not)
      ? [...bool.must_not]
      : bool.must_not
        ? [bool.must_not]
        : [];

    bool.filter = [...existingFilter, ...positive];
    bool.must_not = [...existingMustNot, ...negative];
    next.query = { bool };
    return next;
  }

  next.query = {
    bool: {
      must: [existingQuery],
      ...(positive.length > 0 ? { filter: positive } : {}),
      ...(negative.length > 0 ? { must_not: negative } : {})
    }
  };
  return next;
}

export function formatDiscoverFilterLabel(filter: DiscoverFilter): string {
  const value =
    typeof filter.value === 'string' ? `"${filter.value}"` : String(filter.value);
  return `${filter.field}: ${value}`;
}
