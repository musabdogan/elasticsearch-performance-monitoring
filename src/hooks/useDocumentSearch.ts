import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClusterConnection } from '@/types/app';
import type { SearchHit, SearchResponse } from '@/types/api';
import { searchIndexDocuments } from '@/services/elasticsearch';
import {
  INDEX_SEARCH_MAX_RESULT_WINDOW,
  parseSearchTotal
} from '@/utils/indexSearchQuery';
import {
  applyTrackTotalHitsPolicy,
  buildAdvancedSearchBody,
  buildSimpleSearchBody,
  DEFAULT_SIMPLE_QUERY,
  DEFAULT_SIZE,
  type QueryMode,
  type SortRule
} from '@/utils/querySearch';
import {
  applyMatchNoneQuery,
  applyTimeRangeToSearchBody,
  mergeHistogramIntoSearchBody,
  parseHistogramAggregationResponse,
  resolveHistogramInterval,
  type HistogramBucket,
  type TimeRangeFilter,
  type TimeRangeResolution
} from '@/utils/queryTimeHistogram';

export type TimeSearchContext = {
  timeField: string;
  timeFieldFormat?: string | null;
  resolution: TimeRangeResolution;
};

export type HistogramSearchConfig = {
  timeField: string;
  range: TimeRangeFilter;
};

export function useDocumentSearch(
  cluster: ClusterConnection | null,
  indexPattern: string,
  enabled: boolean,
  options?: {
    mode?: QueryMode;
    simpleQuery?: string;
    advancedBody?: string;
    sort?: SortRule[];
    initialFrom?: number;
    initialSize?: number;
    autoRun?: boolean;
    getTimeRange?: () => TimeRangeFilter | null;
    getHistogramConfig?: () => HistogramSearchConfig | null;
    getTimeSearchContext?: () => TimeSearchContext | null;
    /** When sort is empty, use this for search requests (e.g. primary timestamp desc). */
    defaultSort?: SortRule[];
    /** Validates sort fields against the current index before each search. */
    sanitizeSort?: (sort: SortRule[]) => SortRule[];
    /** When false, defers the initial auto-run until histogram metadata is ready. */
    autoRunWhenReady?: boolean;
  }
) {
  const mode = options?.mode ?? 'simple';
  const initialSort =
    options?.sort?.length ? options.sort : (options?.defaultSort ?? []);
  const [query, setQuery] = useState(options?.simpleQuery ?? DEFAULT_SIMPLE_QUERY);
  const [advancedBody, setAdvancedBody] = useState(options?.advancedBody ?? '');
  const [sort, setSort] = useState<SortRule[]>(initialSort);
  const [size, setSize] = useState(options?.initialSize ?? DEFAULT_SIZE);
  const [from, setFrom] = useState(options?.initialFrom ?? 0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hitsIndexPattern, setHitsIndexPattern] = useState(indexPattern);
  const [total, setTotal] = useState<number | null>(null);
  const [totalIsLowerBound, setTotalIsLowerBound] = useState(false);
  const [took, setTook] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [lastRequestBody, setLastRequestBody] = useState<Record<string, unknown> | null>(null);
  const [searchRevision, setSearchRevision] = useState(0);
  const [histogramBuckets, setHistogramBuckets] = useState<HistogramBucket[]>([]);
  const [histogramError, setHistogramError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const runSearchRef = useRef<
    ((opts?: {
      query?: string;
      advancedBody?: string;
      from?: number;
      size?: number;
      sort?: SortRule[];
      mode?: QueryMode;
    }) => Promise<void>) | null
  >(null);
  const initialAutoRunKeyRef = useRef<string | null>(null);
  const defaultSortRef = useRef(options?.defaultSort ?? []);
  const queryRef = useRef(query);
  const advancedBodyRef = useRef(advancedBody);
  const sortRef = useRef(sort);
  const fromRef = useRef(from);
  const sizeRef = useRef(size);
  const modeRef = useRef(mode);

  queryRef.current = query;
  advancedBodyRef.current = advancedBody;
  sortRef.current = sort;
  fromRef.current = from;
  sizeRef.current = size;
  modeRef.current = mode;
  defaultSortRef.current = options?.defaultSort ?? [];

  const resolveEffectiveSort = useCallback((explicit?: SortRule[]): SortRule[] => {
    if (explicit !== undefined) return explicit;
    if (sortRef.current.length > 0) return sortRef.current;
    return defaultSortRef.current;
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setQuery(DEFAULT_SIMPLE_QUERY);
    setAdvancedBody('');
    setSort([]);
    setSize(DEFAULT_SIZE);
    setFrom(0);
    setHits([]);
    setHitsIndexPattern(indexPattern);
    setTotal(null);
    setTotalIsLowerBound(false);
    setTook(null);
    setError(null);
    setJsonError(null);
    setForbidden(false);
    setInitialized(false);
    setLastRequestBody(null);
    setHistogramBuckets([]);
    setHistogramError(null);
    initialAutoRunKeyRef.current = null;
  }, [indexPattern]);

  useEffect(() => {
    reset();
  }, [indexPattern, reset]);

  const buildBody = useCallback(
    (
      nextMode: QueryMode,
      nextQuery: string,
      nextAdvanced: string,
      nextFrom: number,
      nextSize: number,
      nextSort: SortRule[],
      applyTimeRange = true,
      includeHistogram = true
    ): { body: Record<string, unknown> | null; jsonError: string | null } => {
      let body: Record<string, unknown> | null = null;
      let jsonError: string | null = null;

      if (nextMode === 'advanced') {
        const trimmed = nextAdvanced.trim();
        if (!trimmed) {
          body = buildSimpleSearchBody(DEFAULT_SIMPLE_QUERY, nextSize, nextFrom, nextSort);
        } else {
          const result = buildAdvancedSearchBody(trimmed, nextSize, nextFrom, nextSort);
          body = result.body;
          jsonError = result.error;
        }
      } else {
        body = buildSimpleSearchBody(nextQuery, nextSize, nextFrom, nextSort);
      }

      if (!body) return { body: null, jsonError };

      const timeContext = options?.getTimeSearchContext?.() ?? null;

      if (timeContext) {
        const { resolution, timeField, timeFieldFormat } = timeContext;
        if (resolution.mode === 'none') {
          body = applyMatchNoneQuery(body);
        } else if (resolution.mode === 'filter') {
          body = applyTimeRangeToSearchBody(body, resolution.range, nextMode, nextQuery, timeFieldFormat);
        }

        if (includeHistogram) {
          if (resolution.mode === 'histogram-only') {
            body = mergeHistogramIntoSearchBody(
              body,
              timeField,
              { field: timeField, gte: '', lte: '' },
              resolution.histogramInterval,
              timeFieldFormat
            );
          } else if (resolution.mode === 'filter' && resolution.histogramRange) {
            const interval = resolveHistogramInterval(resolution.histogramRange);
            body = mergeHistogramIntoSearchBody(
              body,
              timeField,
              resolution.histogramRange,
              interval,
              timeFieldFormat
            );
          }
        }
      } else if (applyTimeRange) {
        const timeRange = options?.getTimeRange?.() ?? null;
        if (timeRange?.field) {
          body = applyTimeRangeToSearchBody(body, timeRange, nextMode, nextQuery);
        }

        if (includeHistogram) {
          const histConfig = options?.getHistogramConfig?.() ?? null;
          if (histConfig?.timeField && histConfig.range.field) {
            const interval = resolveHistogramInterval(histConfig.range);
            body = mergeHistogramIntoSearchBody(body, histConfig.timeField, histConfig.range, interval);
          }
        }
      }

      body = applyTrackTotalHitsPolicy(body, indexPattern);

      return { body, jsonError };
    },
    [indexPattern, options?.getTimeRange, options?.getHistogramConfig, options?.getTimeSearchContext]
  );

  const buildBaseSearchBody = useCallback(
    (opts?: {
      from?: number;
      size?: number;
      mode?: QueryMode;
      query?: string;
      advancedBody?: string;
      sort?: SortRule[];
    }) => {
      const { body } = buildBody(
        opts?.mode ?? modeRef.current,
        opts?.query ?? queryRef.current,
        opts?.advancedBody ?? advancedBodyRef.current,
        opts?.from ?? fromRef.current,
        opts?.size ?? sizeRef.current,
        opts?.sort ?? sortRef.current,
        false,
        false
      );
      return body;
    },
    [buildBody]
  );

  const runSearch = useCallback(
    async (opts?: {
      query?: string;
      advancedBody?: string;
      from?: number;
      size?: number;
      sort?: SortRule[];
      mode?: QueryMode;
    }) => {
      if (!cluster || !indexPattern.trim() || !enabled) return;

      const nextMode = opts?.mode ?? modeRef.current;
      const nextQuery = opts?.query ?? queryRef.current;
      const nextAdvanced = opts?.advancedBody ?? advancedBodyRef.current;
      const nextFrom = opts?.from ?? fromRef.current;
      const nextSize = opts?.size ?? sizeRef.current;
      const nextSort = options?.sanitizeSort
        ? options.sanitizeSort(resolveEffectiveSort(opts?.sort))
        : resolveEffectiveSort(opts?.sort);

      const { body, jsonError: parseErr } = buildBody(
        nextMode,
        nextQuery,
        nextAdvanced,
        nextFrom,
        nextSize,
        nextSort
      );

      if (!body) {
        setJsonError(parseErr);
        setError(parseErr);
        setInitialized(true);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      setJsonError(null);
      setForbidden(false);
      setHistogramError(null);

      const hasHistogram = Boolean(body.aggs);

      try {
        const res: SearchResponse = await searchIndexDocuments(
          cluster,
          indexPattern,
          body,
          controller.signal
        );
        if (controller.signal.aborted) return;

        const parsedTotal = parseSearchTotal(res.hits?.total);
        setHits(res.hits?.hits ?? []);
        setHitsIndexPattern(indexPattern);
        setTotal(parsedTotal.value);
        setTotalIsLowerBound(parsedTotal.isLowerBound);
        setTook(typeof res.took === 'number' ? res.took : null);
        setQuery(nextQuery);
        setAdvancedBody(nextAdvanced);
        setFrom(nextFrom);
        setSize(nextSize);
        setSort(nextSort);
        setLastRequestBody(body);
        setSearchRevision((rev) => rev + 1);

        if (hasHistogram) {
          setHistogramBuckets(
            parseHistogramAggregationResponse(res as unknown as Record<string, unknown>)
          );
        } else {
          setHistogramBuckets([]);
        }

        setInitialized(true);
      } catch (e) {
        if (controller.signal.aborted) return;
        const msg = e instanceof Error ? e.message : 'Search failed';
        if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) {
          setForbidden(true);
          setError(null);
        } else {
          setError(msg);
          if (hasHistogram) setHistogramError(msg);
        }
        setHits([]);
        setHitsIndexPattern(indexPattern);
        setHistogramBuckets([]);
        setInitialized(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [cluster, indexPattern, enabled, buildBody, resolveEffectiveSort, options?.sanitizeSort]
  );

  runSearchRef.current = runSearch;

  useEffect(() => {
    if (!enabled || !cluster || !indexPattern.trim()) return;
    if (options?.autoRun === false) return;
    if (options?.autoRunWhenReady === false) return;

    const autoRunKey = `${cluster.label ?? cluster.baseUrl}:${indexPattern}`;
    if (initialAutoRunKeyRef.current === autoRunKey) return;
    initialAutoRunKeyRef.current = autoRunKey;

    void runSearchRef.current?.({
      query: options?.simpleQuery ?? queryRef.current,
      advancedBody: options?.advancedBody,
      from: options?.initialFrom ?? 0,
      size: options?.initialSize ?? DEFAULT_SIZE,
      mode: options?.mode ?? 'simple'
    });
  }, [
    enabled,
    cluster,
    indexPattern,
    options?.autoRun,
    options?.simpleQuery,
    options?.advancedBody,
    options?.initialFrom,
    options?.initialSize,
    options?.sort,
    options?.defaultSort,
    options?.mode,
    options?.autoRunWhenReady
  ]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const page = Math.floor(from / Math.max(1, size)) + 1;
  const totalPages =
    total != null ? Math.max(1, Math.ceil(Math.min(total, INDEX_SEARCH_MAX_RESULT_WINDOW) / Math.max(1, size))) : null;
  const canPrev = from > 0;
  const canNext =
    hits.length >= size &&
    from + size < INDEX_SEARCH_MAX_RESULT_WINDOW &&
    (total == null || from + size < total);

  const search = useCallback(
    (nextQuery?: string) => {
      void runSearch({ query: nextQuery ?? queryRef.current, from: 0, size: sizeRef.current });
    },
    [runSearch]
  );

  const goPrev = useCallback(() => {
    if (fromRef.current <= 0) return;
    void runSearch({ from: Math.max(0, fromRef.current - sizeRef.current) });
  }, [runSearch]);

  const goNext = useCallback(() => {
    void runSearch({ from: fromRef.current + sizeRef.current });
  }, [runSearch]);

  const changeSize = useCallback(
    (nextSize: number) => {
      void runSearch({ from: 0, size: nextSize });
    },
    [runSearch]
  );

  const effectiveHits = hitsIndexPattern === indexPattern ? hits : [];

  return {
    query,
    setQuery,
    advancedBody,
    setAdvancedBody,
    sort,
    setSort,
    size,
    hits: effectiveHits,
    total,
    totalIsLowerBound,
    took,
    loading,
    error,
    jsonError,
    forbidden,
    from,
    initialized,
    page,
    totalPages,
    canPrev,
    canNext,
    lastRequestBody,
    searchRevision,
    histogramBuckets,
    histogramError,
    buildBaseSearchBody,
    search,
    goPrev,
    goNext,
    changeSize,
    runSearch,
    refresh: () => void runSearch()
  };
}
