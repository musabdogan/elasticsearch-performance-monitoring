import type { FieldTopValueBucket, FieldTopValuesResult } from '@/types/discover';
import {
  histogramIntervalToEsFields,
  resolveHistogramInterval,
  type HistogramInterval,
  type TimeRangeFilter
} from '@/utils/queryTimeHistogram';
import { isDateMappingField } from '@/utils/fieldMappingTypes';

const DEFAULT_TERMS_SIZE = 10;

/** Matches Kibana Discover field stats sampler (shard_size per shard). */
export const FIELD_TOP_VALUES_SAMPLER_SHARD_SIZE = 5000;

function buildInnerTopValuesAgg(
  field: string,
  aggField: string,
  mappings?: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null,
  timeRange?: TimeRangeFilter | null,
  termsSize = DEFAULT_TERMS_SIZE
): Record<string, unknown> {
  if (isDateMappingField(field, mappings)) {
    const range =
      timeRange?.field === field && timeRange.gte && timeRange.lte
        ? timeRange
        : { field, gte: '', lte: '' };
    const interval: HistogramInterval =
      timeRange?.gte && timeRange?.lte ? resolveHistogramInterval(timeRange) : { kind: 'calendar_interval', value: '1d' };
    return {
      top_values: {
        date_histogram: {
          field: aggField,
          min_doc_count: 0,
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          ...histogramIntervalToEsFields(interval),
          ...(range.gte && range.lte
            ? {
                extended_bounds: {
                  min: range.gte,
                  max: range.lte
                }
              }
            : {})
        }
      }
    };
  }

  return {
    top_values: {
      terms: {
        field: aggField,
        size: termsSize,
        order: { _count: 'desc' }
      }
    },
    field_cardinality: {
      cardinality: { field: aggField }
    }
  };
}

export function buildFieldTopValuesAggs(
  field: string,
  aggField: string,
  mappings?: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null,
  timeRange?: TimeRangeFilter | null,
  termsSize = DEFAULT_TERMS_SIZE
): Record<string, unknown> {
  return {
    sample: {
      sampler: { shard_size: FIELD_TOP_VALUES_SAMPLER_SHARD_SIZE },
      aggs: buildInnerTopValuesAgg(field, aggField, mappings, timeRange, termsSize)
    }
  };
}

type SampleAggResponse = {
  doc_count?: number;
  top_values?: { buckets?: Array<{ key?: unknown; key_as_string?: string; doc_count?: number }> };
  field_cardinality?: { value?: number };
};

function extractQueryClause(body: Record<string, unknown>): Record<string, unknown> | null {
  const query = body.query;
  if (!query || typeof query !== 'object' || Array.isArray(query)) return null;
  return query as Record<string, unknown>;
}

/**
 * When the time chart is collapsed, scope top-values sampling to documents that
 * actually contain the field (Kibana-style field stats context).
 */
export function mergeFieldExistsIntoBody(
  body: Record<string, unknown>,
  aggField: string
): Record<string, unknown> {
  const existsFilter = { exists: { field: aggField } };
  const next = { ...body };
  const existingQuery = extractQueryClause(next);

  if (!existingQuery) {
    next.query = existsFilter;
    return next;
  }

  if ('bool' in existingQuery && existingQuery.bool && typeof existingQuery.bool === 'object') {
    const bool = { ...(existingQuery.bool as Record<string, unknown>) };
    const filters = Array.isArray(bool.filter) ? [...bool.filter] : bool.filter ? [bool.filter] : [];
    filters.push(existsFilter);
    bool.filter = filters;
    next.query = { bool };
    return next;
  }

  if ('match_all' in existingQuery) {
    next.query = existsFilter;
    return next;
  }

  next.query = {
    bool: {
      must: [existingQuery],
      filter: [existsFilter]
    }
  };
  return next;
}

export function buildFieldTopValuesSearchBody(
  baseBody: Record<string, unknown>,
  field: string,
  aggField: string,
  mappings?: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null,
  timeRange?: TimeRangeFilter | null,
  options?: { requireFieldExists?: boolean }
): Record<string, unknown> {
  const { size: _size, from: _from, sort: _sort, aggs: _aggs, ...rest } = baseBody;
  let body: Record<string, unknown> = {
    ...rest,
    size: 0,
    track_total_hits: false,
    aggs: buildFieldTopValuesAggs(field, aggField, mappings, timeRange)
  };

  if (options?.requireFieldExists) {
    body = mergeFieldExistsIntoBody(body, aggField);
  }

  return body;
}

export function parseFieldTopValuesResponse(
  response: Record<string, unknown>,
  field: string,
  mappings?: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null
): FieldTopValuesResult {
  const aggs = response.aggregations as Record<string, unknown> | undefined;
  const sampleAgg = aggs?.sample as SampleAggResponse | undefined;
  const sampleSize = sampleAgg?.doc_count ?? 0;
  const topAgg = sampleAgg?.top_values;
  const cardAgg = sampleAgg?.field_cardinality;

  const isDate = isDateMappingField(field, mappings);
  const buckets: FieldTopValueBucket[] = (topAgg?.buckets ?? []).map((b) => {
    const key = isDate
      ? String(b.key_as_string ?? b.key ?? '')
      : String(b.key ?? '');
    const docCount = b.doc_count ?? 0;
    const percent = sampleSize > 0 ? (docCount / sampleSize) * 100 : 0;
    return { key, docCount, percent };
  });

  return {
    kind: isDate ? 'date_histogram' : 'terms',
    field,
    sampleSize,
    distinctCount: typeof cardAgg?.value === 'number' ? cardAgg.value : null,
    buckets
  };
}
