import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useMonitoring } from '@/context/MonitoringProvider';
import { DocumentSearchWorkspace } from '@/components/query/DocumentSearchWorkspace';
import { QueryDiscoverBar } from '@/components/query/QueryDiscoverBar';
import { QueryTimeHistogram } from '@/components/query/QueryTimeHistogram';
import type { QueryPatternOption } from '@/components/query/QueryIndexPatternPicker';
import { QueryAdvancedEditor, QueryRequestPreview } from '@/components/query/QueryAdvancedEditor';
import { useDocumentSearch } from '@/hooks/useDocumentSearch';
import { useDocumentColumns } from '@/hooks/useDocumentColumns';
import { useQueryTimeHistogramState } from '@/hooks/useQueryTimeHistogram';
import { getDataStreams, getFieldUsageStats, getIndexDetails } from '@/services/elasticsearch';
import type { FieldUsageStatsResponse, IndexDetailsResponse, SearchHit } from '@/types/api';
import { parseFieldUsageIndexDetailed, type FieldUsageSummary } from '@/utils/indexDetailHelpers';
import { readQueryState, writeQueryState } from '@/utils/queryPersistence';
import {
  displayFieldForSortField,
  getDefaultColumnsFromFieldUsage,
  readAutoColumnsEnabled,
  resolveDefaultDocumentSort,
  resolveElasticsearchSortField,
  sanitizeDocumentSort,
  shouldShowIndexColumn,
  writeAutoColumnsEnabled
} from '@/utils/indexDataTable';
import {
  fetchTimeFieldBounds,
  getDateFieldFormatFromMappings,
  hasValidTimeFieldBounds,
  needsTimeFieldBounds,
  pickDefaultTimeField,
  resolveTimeSearchResolution,
  resolveChartFilterRange,
  isAllTimePreset,
  DEFAULT_CHART_PRESET,
  DEFAULT_TIME_PRESET,
  timeChartRangeHasData,
  type TimeFieldBounds,
  type TimeRangeFilter,
  type TimeRangePreset
} from '@/utils/queryTimeHistogram';
import {
  ALL_INDICES_PATTERN,
  buildSearchCurl,
  extractSimpleQueryFromBody,
  isAllIndicesQueryPattern,
  isConcreteIndexPattern,
  normalizeQueryIndexPattern,
  pickIndexWithMostDocuments,
  simpleBodyToAdvancedJson,
  DEFAULT_SIMPLE_QUERY,
  type QueryMode,
  type SortRule
} from '@/utils/querySearch';

import { sortIndexNamesDotLast } from '@/utils/indexNameSort';

function columnScopeKey(clusterLabel: string, indexPattern: string): string {
  return `${clusterLabel}:${indexPattern}`;
}

function mappingsResponseForPattern(
  indexPattern: string,
  details: IndexDetailsResponse | null
): Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null {
  if (!details) return null;

  const direct = details[indexPattern]?.mappings?.properties as Record<string, unknown> | undefined;
  if (direct) {
    return { [indexPattern]: { mappings: { properties: direct } } };
  }

  const mergedProps: Record<string, unknown> = {};
  for (const entry of Object.values(details)) {
    const props = entry?.mappings?.properties;
    if (props && typeof props === 'object') {
      Object.assign(mergedProps, props);
    }
  }
  if (Object.keys(mergedProps).length === 0) return null;
  return { [indexPattern]: { mappings: { properties: mergedProps } } };
}

type QueryTabContentProps = {
  onRefreshStateChange?: (loading: boolean) => void;
  prefillIndex?: string | null;
  onPrefillConsumed?: () => void;
};

export function QueryTabContent({
  onRefreshStateChange,
  prefillIndex,
  onPrefillConsumed
}: QueryTabContentProps = {}) {
  const { activeCluster, snapshot } = useMonitoring();
  const clusterLabel = activeCluster?.label ?? '';

  const indexOptions = useMemo(() => {
    const names = (snapshot?.indices ?? [])
      .map((row) => row.index ?? '')
      .filter(Boolean);
    return sortIndexNamesDotLast(names);
  }, [snapshot?.indices]);

  const [dataStreamNames, setDataStreamNames] = useState<string[]>([]);
  const dataStreamsLoadStateRef = useRef<'idle' | 'loading' | 'done'>('idle');
  const [indexPattern, setIndexPattern] = useState(ALL_INDICES_PATTERN);
  const [searchIndexPattern, setSearchIndexPattern] = useState(ALL_INDICES_PATTERN);
  const isIndexSelectionPending = indexPattern.trim() === '';
  const [mode, setMode] = useState<QueryMode>('simple');
  const [hydrated, setHydrated] = useState(false);
  const [fieldUsageSummary, setFieldUsageSummary] = useState<FieldUsageSummary | null>(null);
  const [fieldUsageForPattern, setFieldUsageForPattern] = useState<string | null>(null);
  const [indexDetails, setIndexDetails] = useState<IndexDetailsResponse | null>(null);
  const [indexDetailsLoading, setIndexDetailsLoading] = useState(false);
  const [autoColumns, setAutoColumns] = useState(() => readAutoColumnsEnabled());
  const [timeFieldBounds, setTimeFieldBounds] = useState<TimeFieldBounds | null>(null);
  const [timeFieldBoundsLoading, setTimeFieldBoundsLoading] = useState(false);
  const [timeFieldUsable, setTimeFieldUsable] = useState(false);
  const persistTimerRef = useRef<number | null>(null);
  const pendingColumnsResetRef = useRef(false);
  const timePresetRef = useRef<string>(DEFAULT_TIME_PRESET);
  const allBoundsSearchKeyRef = useRef('');
  const isFirstQueryVisitRef = useRef(true);
  const skipIndexPatternSearchRef = useRef(true);
  const indexPatternChangeSourceRef = useRef<'user' | null>(null);
  const pendingPatternSearchRef = useRef(false);
  const [documentSearchQueued, setDocumentSearchQueued] = useState(false);
  const boundsRequestIdRef = useRef(0);
  const chartExpandTriggeredRef = useRef(false);
  const chartExpandProbeRef = useRef(false);
  const chartFilterAppliedRef = useRef(false);
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
  const modeRef = useRef(mode);
  const prevSearchIndexPatternRef = useRef(searchIndexPattern);
  modeRef.current = mode;

  const queueDocumentSearch = useCallback(() => {
    pendingPatternSearchRef.current = true;
    setDocumentSearchQueued(true);
  }, []);

  useEffect(() => {
    skipIndexPatternSearchRef.current = true;
    pendingPatternSearchRef.current = false;
    setDocumentSearchQueued(false);
    prevSearchIndexPatternRef.current = '';
    chartExpandTriggeredRef.current = false;
    chartFilterAppliedRef.current = false;
  }, [clusterLabel]);

  useEffect(() => {
    if (!clusterLabel) return;
    const saved = readQueryState(clusterLabel);
    const normalized = normalizeQueryIndexPattern(saved?.indexPattern ?? '');
    setIndexPattern(normalized);
    setSearchIndexPattern(normalized);
    if (saved?.mode) setMode(saved.mode);
    isFirstQueryVisitRef.current = saved == null;
    setHydrated(true);
  }, [clusterLabel]);

  useEffect(() => {
    if (!hydrated || !clusterLabel || prefillIndex?.trim() || !isFirstQueryVisitRef.current) return;

    const topIndex = pickIndexWithMostDocuments(snapshot?.indices);
    if (!topIndex) return;
    if (!isAllIndicesQueryPattern(searchIndexPattern)) return;

    isFirstQueryVisitRef.current = false;
    pendingColumnsResetRef.current = true;
    queueDocumentSearch();
    setIndexPattern(topIndex);
    setSearchIndexPattern(topIndex);
  }, [hydrated, clusterLabel, snapshot?.indices, prefillIndex, searchIndexPattern, queueDocumentSearch]);

  useEffect(() => {
    dataStreamsLoadStateRef.current = 'idle';
    setDataStreamNames([]);
  }, [activeCluster]);

  const loadDataStreams = useCallback(() => {
    if (!activeCluster || dataStreamsLoadStateRef.current !== 'idle') return;

    dataStreamsLoadStateRef.current = 'loading';

    void getDataStreams(activeCluster)
      .then((res) => {
        const names = (res.data_streams ?? [])
          .map((ds) => ds.name)
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        setDataStreamNames(names);
      })
      .catch(() => {
        setDataStreamNames([]);
      })
      .finally(() => {
        dataStreamsLoadStateRef.current = 'done';
      });
  }, [activeCluster]);

  const patternOptions = useMemo<QueryPatternOption[]>(() => {
    const dataStreamSet = new Set(dataStreamNames);
    const options: QueryPatternOption[] = [
      { value: ALL_INDICES_PATTERN, label: 'All indices (*)', kind: 'pattern' }
    ];
    for (const name of indexOptions) {
      if (!dataStreamSet.has(name)) {
        options.push({ value: name, label: name, kind: 'index' });
      }
    }
    for (const name of dataStreamNames) {
      options.push({ value: name, label: name, kind: 'data_stream' });
    }
    return options;
  }, [indexOptions, dataStreamNames]);

  const needsIndexMetadata = !isAllIndicesQueryPattern(searchIndexPattern);

  const activeFieldUsage = useMemo(
    () => (fieldUsageForPattern === searchIndexPattern ? fieldUsageSummary : null),
    [fieldUsageForPattern, searchIndexPattern, fieldUsageSummary]
  );

  useEffect(() => {
    if (prefillIndex?.trim()) {
      pendingColumnsResetRef.current = true;
      queueDocumentSearch();
      setFieldUsageSummary(null);
      setFieldUsageForPattern(null);
      setIndexPattern(prefillIndex.trim());
      setSearchIndexPattern(prefillIndex.trim());
      onPrefillConsumed?.();
    }
  }, [prefillIndex, onPrefillConsumed, queueDocumentSearch]);

  useEffect(() => {
    if (!activeCluster || !needsIndexMetadata) {
      setFieldUsageSummary(null);
      setFieldUsageForPattern(null);
      setIndexDetails(null);
      setIndexDetailsLoading(false);
      return;
    }

    setFieldUsageSummary(null);
    setFieldUsageForPattern(null);
    setIndexDetails(null);
    setIndexDetailsLoading(true);

    const controller = new AbortController();
    const idx = searchIndexPattern;
    const fetchUsage = isConcreteIndexPattern(idx)
      ? getFieldUsageStats(activeCluster, idx, controller.signal).catch(() => null)
      : Promise.resolve(null);

    Promise.all([fetchUsage, getIndexDetails(activeCluster, idx, controller.signal).catch(() => null)])
      .then(([usage, details]) => {
        if (controller.signal.aborted) return;
        setIndexDetails(details ?? null);

        const mappings = mappingsResponseForPattern(idx, details ?? null);
        if (mappings || usage) {
          setFieldUsageSummary(
            parseFieldUsageIndexDetailed(idx, usage as FieldUsageStatsResponse | null, mappings)
          );
          setFieldUsageForPattern(idx);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIndexDetailsLoading(false);
      });

    return () => controller.abort();
  }, [activeCluster, searchIndexPattern, needsIndexMetadata]);

  const fieldMetadataReady =
    !needsIndexMetadata ||
    (!indexDetailsLoading &&
      fieldUsageForPattern === searchIndexPattern &&
      (fieldUsageSummary != null || indexDetails != null));

  /** Index metadata fetch (field usage + mapping) before first _search. */
  const metadataLoading = needsIndexMetadata && !fieldMetadataReady;

  const timeHistogram = useQueryTimeHistogramState({
    indexPattern: searchIndexPattern,
    enabled: hydrated,
    indexDetails,
    indexDetailsLoading
  });

  const boundsRequired = useMemo(
    () =>
      timeHistogram.visible &&
      !timeHistogram.collapsed &&
      needsTimeFieldBounds(timeHistogram.timePreset, timeHistogram.brushRange),
    [timeHistogram.visible, timeHistogram.collapsed, timeHistogram.timePreset, timeHistogram.brushRange]
  );

  useEffect(() => {
    if (
      !activeCluster ||
      !timeHistogram.visible ||
      !timeHistogram.selectedTimeField ||
      !timeHistogram.isReadyForSearch ||
      timeHistogram.collapsed
    ) {
      setTimeFieldBounds(null);
      setTimeFieldBoundsLoading(false);
      setTimeFieldUsable(false);
      chartExpandTriggeredRef.current = false;
      return;
    }

    const field = timeHistogram.selectedTimeField;
    const idx = searchIndexPattern;
    const capturedIndexDetails = indexDetails;
    const capturedPreset = timeHistogram.timePreset;
    const needsBounds = needsTimeFieldBounds(capturedPreset, timeHistogram.brushRange);

    const runExpandSearch = (bounds: TimeFieldBounds | null) => {
      if (!chartExpandTriggeredRef.current) return;
      chartExpandTriggeredRef.current = false;
      const fmt = capturedIndexDetails
        ? getDateFieldFormatFromMappings(capturedIndexDetails, field)
        : null;
      const range = resolveChartFilterRange(capturedPreset, field, null);
      timeSearchContextRef.current = {
        timeField: field,
        timeFieldFormat: fmt,
        resolution: resolveTimeSearchResolution(capturedPreset, range, bounds, false)
      };
      pendingColumnsResetRef.current = true;
      void runSearchRef.current?.({ mode: modeRef.current, from: 0 });
    };

    if (!needsBounds) {
      setTimeFieldBoundsLoading(false);
      setTimeFieldUsable(true);
      runExpandSearch(null);
      return;
    }

    const requestId = ++boundsRequestIdRef.current;
    setTimeFieldBoundsLoading(true);
    const controller = new AbortController();

    fetchTimeFieldBounds(activeCluster, idx, field, controller.signal)
      .then((bounds) => {
        if (controller.signal.aborted || requestId !== boundsRequestIdRef.current) return;
        const usable = hasValidTimeFieldBounds(bounds);
        setTimeFieldUsable(usable);
        setTimeFieldBounds(usable ? bounds : null);

        if (!usable) {
          chartExpandTriggeredRef.current = false;
          chartExpandProbeRef.current = false;
          timeHistogram.setCollapsed(true);
          return;
        }

        runExpandSearch(bounds);
      })
      .catch(() => {
        if (controller.signal.aborted || requestId !== boundsRequestIdRef.current) return;
        setTimeFieldBounds(null);
        setTimeFieldUsable(false);
        chartExpandTriggeredRef.current = false;
        chartExpandProbeRef.current = false;
        timeHistogram.setCollapsed(true);
      })
      .finally(() => {
        if (requestId === boundsRequestIdRef.current) {
          setTimeFieldBoundsLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    activeCluster,
    searchIndexPattern,
    timeHistogram.visible,
    timeHistogram.selectedTimeField,
    timeHistogram.isReadyForSearch,
    timeHistogram.collapsed,
    timeHistogram.timePreset,
    timeHistogram.brushRange,
    indexDetails,
    timeHistogram.setCollapsed
  ]);

  useEffect(() => {
    chartExpandTriggeredRef.current = false;
    chartExpandProbeRef.current = false;
    chartFilterAppliedRef.current = false;
    setDocumentSearchQueued(false);
  }, [searchIndexPattern]);

  const timeFieldFormat = useMemo(() => {
    if (!indexDetails || !timeHistogram.selectedTimeField) return null;
    return getDateFieldFormatFromMappings(indexDetails, timeHistogram.selectedTimeField);
  }, [indexDetails, timeHistogram.selectedTimeField]);

  const timeChartAvailable =
    timeHistogram.visible && Boolean(timeHistogram.selectedTimeField);

  /** Chart affects search (filter, histogram, sort) only when expanded with valid bounds. */
  const timeChartSearchActive =
    timeChartAvailable &&
    !timeHistogram.collapsed &&
    (boundsRequired ? timeFieldUsable : Boolean(timeHistogram.selectedTimeField));

  const showTimeChart =
    timeChartAvailable &&
    (timeHistogram.collapsed ||
      (boundsRequired ? timeFieldUsable || timeFieldBoundsLoading : true));

  const timeSearchContextRef = useRef<{
    timeField: string;
    timeFieldFormat: string | null;
    resolution: ReturnType<typeof resolveTimeSearchResolution>;
  } | null>(null);

  timeSearchContextRef.current =
    timeChartSearchActive && timeHistogram.timeRangeForSearch
      ? {
          timeField: timeHistogram.selectedTimeField,
          timeFieldFormat,
          resolution: resolveTimeSearchResolution(
            timeHistogram.timePreset,
            timeHistogram.timeRangeForSearch,
            timeFieldBounds,
            timeHistogram.brushRange != null
          )
        }
      : null;

  const getTimeSearchContext = useCallback(() => timeSearchContextRef.current, []);

  const autoRunWhenReady = useMemo(() => {
    if (needsIndexMetadata && !fieldMetadataReady) return false;
    if (!timeHistogram.visible || timeHistogram.collapsed) return true;
    if (!timeHistogram.isReadyForSearch) return false;
    if (boundsRequired && timeFieldBoundsLoading) return false;
    return true;
  }, [
    needsIndexMetadata,
    fieldMetadataReady,
    timeHistogram.visible,
    timeHistogram.collapsed,
    timeHistogram.isReadyForSearch,
    boundsRequired,
    timeFieldBoundsLoading
  ]);

  const autoDefaultTimeField = useMemo(() => {
    if (!timeChartSearchActive) return null;
    return pickDefaultTimeField(timeHistogram.dateFields);
  }, [timeChartSearchActive, timeHistogram.dateFields]);

  /** Expanded chart time field drives sort; collapsed uses field-usage defaults only. */
  const sortTimeField = useMemo(() => {
    if (timeChartSearchActive) {
      return timeHistogram.selectedTimeField || autoDefaultTimeField;
    }
    if (needsIndexMetadata && !fieldMetadataReady) return null;
    return null;
  }, [
    timeChartSearchActive,
    timeHistogram.selectedTimeField,
    autoDefaultTimeField,
    needsIndexMetadata,
    fieldMetadataReady
  ]);

  const defaultSort = useMemo(
    () => resolveDefaultDocumentSort(sortTimeField, activeFieldUsage),
    [sortTimeField, activeFieldUsage]
  );

  const sanitizeSearchSort = useCallback(
    (sort: SortRule[]) =>
      sanitizeDocumentSort(sort, sortTimeField, activeFieldUsage, {
        staleDefaultTimeField: autoDefaultTimeField
      }),
    [sortTimeField, autoDefaultTimeField, activeFieldUsage]
  );

  const savedState = useMemo(
    () => (clusterLabel && hydrated ? readQueryState(clusterLabel) : null),
    [clusterLabel, hydrated]
  );
  const initialSimpleQuery =
    savedState?.simpleQuery === '*' ? '' : (savedState?.simpleQuery ?? DEFAULT_SIMPLE_QUERY);

  const search = useDocumentSearch(activeCluster, searchIndexPattern, hydrated, {
    mode,
    simpleQuery: initialSimpleQuery,
    advancedBody: savedState?.advancedBody,
    sort: savedState?.sort?.length ? savedState.sort : undefined,
    defaultSort,
    initialFrom: savedState?.from,
    initialSize: savedState?.size,
    autoRun: hydrated,
    autoRunWhenReady,
    sanitizeSort: sanitizeSearchSort,
    getTimeSearchContext
  });

  runSearchRef.current = search.runSearch;

  /** After expand probe on 15m, fall back to All when the window has no documents. */
  useEffect(() => {
    if (!chartExpandProbeRef.current) return;
    if (timeHistogram.collapsed || search.loading || !search.initialized) return;
    if (timeHistogram.timePreset !== DEFAULT_TIME_PRESET) return;
    if (search.error) {
      chartExpandProbeRef.current = false;
      return;
    }

    if (timeChartRangeHasData(search.histogramBuckets, search.total, search.hits.length)) {
      chartExpandProbeRef.current = false;
      return;
    }

    chartExpandProbeRef.current = false;
    chartExpandTriggeredRef.current = true;
    timeHistogram.setTimePreset('all');
  }, [
    timeHistogram.collapsed,
    timeHistogram.timePreset,
    timeHistogram.setTimePreset,
    search.loading,
    search.initialized,
    search.error,
    search.histogramBuckets,
    search.total,
    search.hits.length
  ]);

  /** Unified busy: metadata wait, queued search, and in-flight _search feel identical in the UI. */
  const queryBusy = search.loading || metadataLoading || documentSearchQueued;

  useEffect(() => {
    if (search.loading) setDocumentSearchQueued(false);
  }, [search.loading]);

  useEffect(() => {
    onRefreshStateChange?.(queryBusy);
  }, [queryBusy, onRefreshStateChange]);

  useEffect(() => {
    const onRefresh = () => search.refresh();
    window.addEventListener('refreshSearch', onRefresh);
    return () => window.removeEventListener('refreshSearch', onRefresh);
  }, [search.refresh]);

  useEffect(() => {
    if (!pendingPatternSearchRef.current) return;
    if (!hydrated || !activeCluster) return;
    if (needsIndexMetadata && !fieldMetadataReady) return;

    pendingPatternSearchRef.current = false;
    pendingColumnsResetRef.current = true;
    void runSearchRef.current?.({ mode: modeRef.current, from: 0 });
  }, [hydrated, activeCluster, needsIndexMetadata, fieldMetadataReady]);

  useEffect(() => {
    if (!hydrated || !activeCluster) return;

    if (skipIndexPatternSearchRef.current) {
      skipIndexPatternSearchRef.current = false;
      prevSearchIndexPatternRef.current = searchIndexPattern;
      return;
    }
    if (indexPatternChangeSourceRef.current === 'user') {
      indexPatternChangeSourceRef.current = null;
      prevSearchIndexPatternRef.current = searchIndexPattern;
      return;
    }

    if (prevSearchIndexPatternRef.current === searchIndexPattern) return;
    prevSearchIndexPatternRef.current = searchIndexPattern;

    pendingColumnsResetRef.current = true;
    if (needsIndexMetadata && !isAllIndicesQueryPattern(searchIndexPattern)) {
      queueDocumentSearch();
      return;
    }
    void runSearchRef.current?.({ mode: modeRef.current, from: 0 });
  }, [hydrated, activeCluster, searchIndexPattern, needsIndexMetadata, queueDocumentSearch]);

  const showIndexColumn = useMemo(
    () =>
      shouldShowIndexColumn(search.hits, searchIndexPattern) ||
      /[*?,]/.test(searchIndexPattern),
    [search.hits, searchIndexPattern]
  );

  const scopeKey = columnScopeKey(clusterLabel, searchIndexPattern);

  /** Latch page hits for field sidebar only after _search completes (same render as reset). */
  const hitsForDiscoveryRef = useRef<{ pattern: string; revision: number; hits: SearchHit[] }>({
    pattern: searchIndexPattern,
    revision: -1,
    hits: []
  });

  if (hitsForDiscoveryRef.current.pattern !== searchIndexPattern) {
    hitsForDiscoveryRef.current = { pattern: searchIndexPattern, revision: -1, hits: [] };
  }

  if (!search.loading && search.initialized) {
    if (hitsForDiscoveryRef.current.revision !== search.searchRevision) {
      hitsForDiscoveryRef.current = {
        pattern: searchIndexPattern,
        revision: search.searchRevision,
        hits: search.hits
      };
    }
  }

  const hitsForFieldDiscovery =
    hitsForDiscoveryRef.current.pattern === searchIndexPattern
      ? hitsForDiscoveryRef.current.hits
      : [];

  const columns = useDocumentColumns(
    scopeKey,
    hitsForFieldDiscovery,
    activeFieldUsage,
    showIndexColumn,
    fieldMetadataReady,
    sortTimeField,
    autoColumns
  );

  const handleAutoColumnsChange = useCallback(
    (enabled: boolean) => {
      setAutoColumns(enabled);
      writeAutoColumnsEnabled(enabled);
      if (enabled) {
        columns.resetToDefault();
      }
    },
    [columns.resetToDefault]
  );

  useEffect(() => {
    if (autoColumns) {
      pendingColumnsResetRef.current = true;
    }
  }, [searchIndexPattern, autoColumns]);

  const columnsReadyForReset = useMemo(() => {
    if (needsIndexMetadata && !fieldMetadataReady) return false;
    const usageDefaults = Boolean(getDefaultColumnsFromFieldUsage(activeFieldUsage)?.length);
    if (usageDefaults) return true;
    return !search.loading && search.initialized;
  }, [
    needsIndexMetadata,
    fieldMetadataReady,
    activeFieldUsage,
    search.loading,
    search.initialized
  ]);

  useEffect(() => {
    if (!pendingColumnsResetRef.current) return;
    if (!columnsReadyForReset) return;
    if (!autoColumns) {
      pendingColumnsResetRef.current = false;
      return;
    }

    pendingColumnsResetRef.current = false;
    columns.resetToDefault();
  }, [
    searchIndexPattern,
    activeFieldUsage,
    search.searchRevision,
    columnsReadyForReset,
    autoColumns,
    columns.resetToDefault
  ]);

  const handleSearch = () => {
    pendingColumnsResetRef.current = true;
    void search.runSearch({ mode, from: 0 });
  };

  const persistState = useCallback(() => {
    if (!clusterLabel) return;
    writeQueryState(clusterLabel, {
      indexPattern: searchIndexPattern,
      mode,
      simpleQuery: search.query,
      advancedBody: search.advancedBody,
      size: search.size,
      from: search.from,
      sort: search.sort
    });
  }, [clusterLabel, searchIndexPattern, mode, search.query, search.advancedBody, search.size, search.from, search.sort]);

  useEffect(() => {
    if (!hydrated) return;
    if (persistTimerRef.current != null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(persistState, 300);
    return () => {
      if (persistTimerRef.current != null) window.clearTimeout(persistTimerRef.current);
    };
  }, [hydrated, persistState]);

  const handleModeChange = (next: QueryMode) => {
    if (next === mode) return;
    if (next === 'advanced') {
      const json = search.advancedBody.trim()
        ? search.advancedBody
        : simpleBodyToAdvancedJson(search.query, search.size, search.from, search.sort);
      search.setAdvancedBody(json);
    } else if (search.advancedBody.trim()) {
      try {
        const parsed = JSON.parse(search.advancedBody) as Record<string, unknown>;
        const extracted = extractSimpleQueryFromBody(parsed);
        if (extracted != null) search.setQuery(extracted);
      } catch {
        // keep current simple query
      }
    }
    setMode(next);
  };

  const indexPatternRef = useRef(indexPattern);
  indexPatternRef.current = indexPattern;

  const applyIndexPattern = useCallback(
    (raw: string) => {
      if (raw.trim() === '') {
        setIndexPattern('');
        return;
      }

      const wasPending = indexPatternRef.current.trim() === '';
      const nextPattern = normalizeQueryIndexPattern(raw);
      const uiCurrent = wasPending ? '' : normalizeQueryIndexPattern(indexPatternRef.current);
      const patternChanged = nextPattern !== uiCurrent;

      if (patternChanged) {
        indexPatternChangeSourceRef.current = 'user';
        pendingColumnsResetRef.current = true;
        setFieldUsageSummary(null);
        setFieldUsageForPattern(null);
        setIndexDetails(null);
        if (!isAllIndicesQueryPattern(nextPattern)) {
          setIndexDetailsLoading(true);
        } else {
          setIndexDetailsLoading(false);
        }
        setIndexPattern(nextPattern);
        setSearchIndexPattern(nextPattern);
        if (isAllIndicesQueryPattern(nextPattern)) {
          void search.runSearch({ mode, from: 0 });
        } else {
          queueDocumentSearch();
        }
        return;
      }

      pendingColumnsResetRef.current = true;
      void search.runSearch({ mode, from: 0 });
    },
    [mode, search.runSearch, queueDocumentSearch]
  );

  const handleIndexPatternCommit = applyIndexPattern;

  const handleColumnSort = useCallback(
    (field: string) => {
      const esField = resolveElasticsearchSortField(field, activeFieldUsage);
      const current = search.sort[0];
      const order: 'asc' | 'desc' =
        current?.field === esField ? (current.order === 'asc' ? 'desc' : 'asc') : 'asc';
      void search.runSearch({ mode, from: 0, sort: [{ field: esField, order }] });
    },
    [search.runSearch, search.sort, mode, activeFieldUsage]
  );

  const sortDisplayField = displayFieldForSortField(search.sort[0]?.field);
  const sortOrder = search.sort[0]?.order ?? null;

  const handleHistogramBrushApply = useCallback(
    (range: TimeRangeFilter) => {
      timeHistogram.handleBrushSelect(range);

      const timeField = timeHistogram.selectedTimeField;
      if (timeChartSearchActive && timeField) {
        timeSearchContextRef.current = {
          timeField,
          timeFieldFormat,
          resolution: resolveTimeSearchResolution(
            timeHistogram.timePreset,
            range,
            timeFieldBounds,
            true
          )
        };
      }

      pendingColumnsResetRef.current = true;
      chartFilterAppliedRef.current = true;
      void search.runSearch({ mode, from: 0 });
    },
    [
      timeHistogram.handleBrushSelect,
      timeChartSearchActive,
      timeHistogram.selectedTimeField,
      timeHistogram.timePreset,
      timeFieldFormat,
      timeFieldBounds,
      search.runSearch,
      mode
    ]
  );

  const runExpandedChartSearch = useCallback(
    (preset: TimeRangePreset, brushRange: TimeRangeFilter | null = null) => {
      const timeField = timeHistogram.selectedTimeField;
      if (!timeField || timeHistogram.collapsed) return;
      if (needsTimeFieldBounds(preset, brushRange) && !timeFieldUsable) return;

      const range = resolveChartFilterRange(preset, timeField, brushRange);
      timeSearchContextRef.current = {
        timeField,
        timeFieldFormat,
        resolution: resolveTimeSearchResolution(
          preset,
          range,
          timeFieldBounds,
          brushRange != null
        )
      };

      timePresetRef.current = preset;
      if (isAllTimePreset(preset)) {
        if (timeFieldBounds?.minMs != null && timeFieldBounds?.maxMs != null) {
          allBoundsSearchKeyRef.current = `${searchIndexPattern}:${timeField}:${timeFieldBounds.minMs}:${timeFieldBounds.maxMs}`;
        } else {
          allBoundsSearchKeyRef.current = '';
        }
      }
      pendingColumnsResetRef.current = true;
      chartFilterAppliedRef.current = true;
      void search.runSearch({ mode, from: 0 });
    },
    [
      timeHistogram.selectedTimeField,
      timeHistogram.collapsed,
      timeFieldUsable,
      timeFieldFormat,
      timeFieldBounds,
      search.runSearch,
      mode,
      searchIndexPattern
    ]
  );

  const handleHistogramBrushClear = useCallback(() => {
    timeHistogram.clearBrushRange();
    runExpandedChartSearch(timeHistogram.timePreset, null);
  }, [timeHistogram.clearBrushRange, timeHistogram.timePreset, runExpandedChartSearch]);

  const handleTimePresetChange = useCallback(
    (preset: TimeRangePreset) => {
      timeHistogram.setTimePreset(preset);
      runExpandedChartSearch(preset, timeHistogram.brushRange);
    },
    [timeHistogram.setTimePreset, timeHistogram.brushRange, runExpandedChartSearch]
  );

  const handleTimeChartCollapsedChange = useCallback(
    (nextCollapsed: boolean) => {
      if (nextCollapsed) {
        chartExpandTriggeredRef.current = false;
        timeHistogram.setCollapsed(true);
        if (chartFilterAppliedRef.current) {
          chartFilterAppliedRef.current = false;
          pendingColumnsResetRef.current = true;
          void runSearchRef.current?.({ mode: modeRef.current, from: 0 });
        }
        return;
      }

      // Mark that expand triggered — bounds fetch or relative preset path will fire the search.
      chartExpandTriggeredRef.current = true;
      chartExpandProbeRef.current = true;
      timeHistogram.setTimePreset(DEFAULT_CHART_PRESET);
      timeHistogram.clearBrushRange();
      timeHistogram.setCollapsed(false);
    },
    [timeHistogram.setCollapsed, timeHistogram.setTimePreset, timeHistogram.clearBrushRange]
  );

  const autoTimeFieldRef = useRef('');
  useEffect(() => {
    autoTimeFieldRef.current = '';
  }, [searchIndexPattern]);

  useEffect(() => {
    if (!search.initialized || timeHistogram.collapsed || !timeChartAvailable) return;
    if (!timeHistogram.selectedTimeField) return;

    const boundsNeeded = needsTimeFieldBounds(timeHistogram.timePreset, timeHistogram.brushRange);
    if (boundsNeeded && timeFieldBoundsLoading) return;

    if (autoTimeFieldRef.current === timeHistogram.selectedTimeField) return;

    const previousField = autoTimeFieldRef.current;
    autoTimeFieldRef.current = timeHistogram.selectedTimeField;

    if (!previousField) return;

    pendingColumnsResetRef.current = true;
    void runSearchRef.current?.({ mode: modeRef.current, from: 0 });
  }, [
    search.initialized,
    timeChartAvailable,
    timeHistogram.collapsed,
    timeHistogram.timePreset,
    timeHistogram.brushRange,
    timeHistogram.selectedTimeField,
    timeFieldBoundsLoading
  ]);

  useEffect(() => {
    allBoundsSearchKeyRef.current = '';
  }, [searchIndexPattern]);

  const requestUrl = useMemo(() => {
    if (!activeCluster) return '';
    const base = activeCluster.baseUrl.replace(/\/$/, '');
    return `${base}/${searchIndexPattern}/_search`;
  }, [activeCluster, searchIndexPattern]);

  const curl = useMemo(() => {
    if (!activeCluster || !search.lastRequestBody) return '';
    return buildSearchCurl(activeCluster.baseUrl, searchIndexPattern, search.lastRequestBody, activeCluster);
  }, [activeCluster, searchIndexPattern, search.lastRequestBody]);

  const pagination = useMemo(
    () => ({
      size: search.size,
      onSizeChange: search.changeSize,
      canPrev: search.canPrev,
      canNext: search.canNext,
      onPrev: search.goPrev,
      onNext: search.goNext
    }),
    [search.size, search.changeSize, search.canPrev, search.canNext, search.goPrev, search.goNext]
  );

  if (!activeCluster) {
    return (
      <div className="rounded-lg border border-gray-300 bg-white p-8 text-center text-sm text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
        Select a cluster to use Query.
      </div>
    );
  }

  return (
    <section className="tab-section-card flex min-h-0 flex-1 flex-col">
      <div className="tab-section-header tab-section-header-split">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Query</h2>
        <div className="tab-section-inline-tools">
          <button
            type="button"
            onClick={() => {
              search.refresh();
            }}
            disabled={queryBusy}
            className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${queryBusy ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>
      <div className="tab-section-body flex min-h-0 flex-1 flex-col">
        <div className="tab-section-scroll-fill space-y-3">
          <QueryDiscoverBar
            indexPattern={indexPattern}
            searchIndexPattern={searchIndexPattern}
            indexPickerDisplayLabel={isIndexSelectionPending ? searchIndexPattern : undefined}
            onIndexPatternCommit={handleIndexPatternCommit}
            patternOptions={patternOptions}
            onIndexPickerOpen={loadDataStreams}
            mode={mode}
            onModeChange={handleModeChange}
            query={search.query}
            onQueryChange={search.setQuery}
            onSearch={handleSearch}
            loading={queryBusy}
          />

          {showTimeChart ? (
            <QueryTimeHistogram
              collapsed={timeHistogram.collapsed}
              onCollapsedChange={handleTimeChartCollapsedChange}
              timePreset={timeHistogram.timePreset}
              onPresetChange={handleTimePresetChange}
              dateFields={timeHistogram.dateFields}
              selectedTimeField={timeHistogram.selectedTimeField}
              onTimeFieldChange={timeHistogram.setSelectedTimeField}
              activeRange={timeHistogram.activeFilterRange}
              brushRange={timeHistogram.brushRange}
              timeFieldBounds={timeFieldBounds}
              boundsLoading={boundsRequired && timeFieldBoundsLoading}
              buckets={search.histogramBuckets}
              loading={queryBusy}
              fieldsLoading={timeHistogram.fieldsLoading}
              error={search.histogramError}
              onBrushApply={handleHistogramBrushApply}
              onBrushClear={handleHistogramBrushClear}
            />
          ) : null}

          <DocumentSearchWorkspace
              cluster={activeCluster}
              indexLabel={searchIndexPattern}
              displayIndexName={searchIndexPattern}
              hits={search.hits}
              from={search.from}
              queryKey={`${searchIndexPattern}:${mode}:${search.query}:${search.advancedBody}:${search.from}:${sortDisplayField ?? ''}:${sortOrder ?? ''}`}
              total={search.total}
              totalIsLowerBound={search.totalIsLowerBound}
              took={search.took}
              page={search.page}
              totalPages={search.totalPages}
              loading={queryBusy}
              error={search.error}
              forbidden={search.forbidden}
              pagination={pagination}
              availableFields={columns.availableFields}
              selectedColumns={columns.selectedColumns}
              dropTargetIndex={columns.dropTargetIndex}
              defaultsFromFieldUsage={columns.defaultsFromFieldUsage}
              autoColumns={autoColumns}
              onAutoColumnsChange={handleAutoColumnsChange}
              setDropTargetIndex={columns.setDropTargetIndex}
              toggleColumn={columns.toggleColumn}
              removeColumn={columns.removeColumn}
              handleColumnDrop={columns.handleColumnDrop}
              handleDropAtEnd={columns.handleDropAtEnd}
              resetToDefault={columns.resetToDefault}
              sortField={sortDisplayField}
              sortOrder={sortOrder}
              onColumnSort={handleColumnSort}
              tableMaxHeight="max-h-[50vh]"
              searchSection={
                mode === 'advanced' ? (
                  <div className="space-y-2">
                    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 dark:border-gray-700 dark:bg-gray-900/20">
                      <QueryAdvancedEditor
                        value={search.advancedBody}
                        onChange={search.setAdvancedBody}
                        error={search.jsonError}
                        disabled={queryBusy}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSearch}
                          disabled={queryBusy}
                          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {queryBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                          Search
                        </button>
                      </div>
                    </div>
                    <QueryRequestPreview url={requestUrl} body={search.lastRequestBody} curl={curl} />
                  </div>
                ) : undefined
              }
            />
        </div>
      </div>
    </section>
  );
}
