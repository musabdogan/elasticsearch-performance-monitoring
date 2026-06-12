import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClusterConnection } from '@/types/app';
import type { SearchHit, SearchResponse } from '@/types/api';
import { searchIndexDocuments } from '@/services/elasticsearch';
import {
  INDEX_SEARCH_MAX_RESULT_WINDOW,
  normalizeSearchTotal
} from '@/utils/indexSearchQuery';
import {
  buildAdvancedSearchBody,
  buildSimpleSearchBody,
  DEFAULT_SIMPLE_QUERY,
  DEFAULT_SIZE,
  type QueryMode,
  type SortRule
} from '@/utils/querySearch';

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
  }
) {
  const mode = options?.mode ?? 'simple';
  const [query, setQuery] = useState(options?.simpleQuery ?? DEFAULT_SIMPLE_QUERY);
  const [advancedBody, setAdvancedBody] = useState(options?.advancedBody ?? '');
  const [sort, setSort] = useState<SortRule[]>(options?.sort ?? []);
  const [size, setSize] = useState(options?.initialSize ?? DEFAULT_SIZE);
  const [from, setFrom] = useState(options?.initialFrom ?? 0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [took, setTook] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [lastRequestBody, setLastRequestBody] = useState<Record<string, unknown> | null>(null);

  const abortRef = useRef<AbortController | null>(null);
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

  const reset = useCallback(() => {
    setQuery(DEFAULT_SIMPLE_QUERY);
    setAdvancedBody('');
    setSort([]);
    setSize(DEFAULT_SIZE);
    setFrom(0);
    setHits([]);
    setTotal(null);
    setTook(null);
    setError(null);
    setJsonError(null);
    setForbidden(false);
    setInitialized(false);
    setLastRequestBody(null);
  }, []);

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
      nextSort: SortRule[]
    ): { body: Record<string, unknown> | null; jsonError: string | null } => {
      if (nextMode === 'advanced') {
        const trimmed = nextAdvanced.trim();
        if (!trimmed) {
          return {
            body: buildSimpleSearchBody(DEFAULT_SIMPLE_QUERY, nextSize, nextFrom, nextSort),
            jsonError: null
          };
        }
        const result = buildAdvancedSearchBody(trimmed, nextSize, nextFrom, nextSort);
        return { body: result.body, jsonError: result.error };
      }
      return {
        body: buildSimpleSearchBody(nextQuery, nextSize, nextFrom, nextSort),
        jsonError: null
      };
    },
    []
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
      const nextSort = opts?.sort ?? sortRef.current;

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

      try {
        const res: SearchResponse = await searchIndexDocuments(
          cluster,
          indexPattern,
          body,
          controller.signal
        );
        if (controller.signal.aborted) return;

        setHits(res.hits?.hits ?? []);
        setTotal(normalizeSearchTotal(res.hits?.total));
        setTook(typeof res.took === 'number' ? res.took : null);
        setQuery(nextQuery);
        setAdvancedBody(nextAdvanced);
        setFrom(nextFrom);
        setSize(nextSize);
        setSort(nextSort);
        setLastRequestBody(body);
        setInitialized(true);
      } catch (e) {
        if (controller.signal.aborted) return;
        const msg = e instanceof Error ? e.message : 'Search failed';
        if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) {
          setForbidden(true);
          setError(null);
        } else {
          setError(msg);
        }
        setHits([]);
        setInitialized(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [cluster, indexPattern, enabled, buildBody]
  );

  useEffect(() => {
    if (!enabled || !cluster || !indexPattern.trim()) return;
    if (initialized) return;
    if (options?.autoRun === false) return;
    void runSearch({
      query: options?.simpleQuery ?? queryRef.current,
      advancedBody: options?.advancedBody,
      from: options?.initialFrom ?? 0,
      size: options?.initialSize ?? DEFAULT_SIZE,
      sort: options?.sort ?? [],
      mode: options?.mode ?? 'simple'
    });
  }, [enabled, cluster, indexPattern, initialized, runSearch, options?.autoRun, options?.simpleQuery, options?.advancedBody, options?.initialFrom, options?.initialSize, options?.sort, options?.mode]);

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

  return {
    query,
    setQuery,
    advancedBody,
    setAdvancedBody,
    sort,
    setSort,
    size,
    hits,
    total,
    took,
    loading,
    error,
    jsonError,
    forbidden,
    from,
    page,
    totalPages,
    canPrev,
    canNext,
    lastRequestBody,
    search,
    goPrev,
    goNext,
    changeSize,
    runSearch,
    refresh: () => void runSearch()
  };
}
