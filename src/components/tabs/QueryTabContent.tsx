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
  needsTimeFieldBounds,
  pickDefaultTimeField,
  resolveTimeSearchResolution,
  resolveChartFilterRange,
  isAllTimePreset,
  isChartTimeFilterActive,
  isSearchResultsPreset,
  buildResultsHistogramCacheKey,
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
  simpleBodyToAdvancedJson,
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
  const [mode, setMode] = useState<QueryMode>('simple');
  const [hydrated, setHydrated] = useState(false);
  const [fieldUsageSummary, setFieldUsageSummary] = useState<FieldUsageSummary | null>(null);
  const [fieldUsageForPattern, setFieldUsageForPattern] = useState<string | null>(null);
  const [indexDetails, setIndexDetails] = useState<IndexDetailsResponse | null>(null);
  const [indexDetailsLoading, setIndexDetailsLoading] = useState(false);
  const [autoColumns, setAutoColumns] = useState(() => readAutoColumnsEnabled());
  const [timeFieldBounds, setTimeFieldBounds] = useState<TimeFieldBounds | null>(null);
  const [timeFieldBoundsLoading, setTimeFieldBoundsLoading] = useState(false);
  const persistTimerRef = useRef<number | null>(null);
  const pendingColumnsResetRef = useRef(false);
  const timePresetRef = useRef<string>('search');
  const allBoundsSearchKeyRef = useRef('');

  useEffect(() => {
    if (!clusterLabel) return;
    const saved = readQueryState(clusterLabel);
    setIndexPattern(normalizeQueryIndexPattern(saved?.indexPattern ?? ''));
    if (saved?.mode) setMode(saved.mode);
    setHydrated(true);
  }, [clusterLabel]);

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

  const effectiveIndexPattern = useMemo(
    () => normalizeQueryIndexPattern(indexPattern),
    [indexPattern]
  );

  const needsIndexMetadata = !isAllIndicesQueryPattern(effectiveIndexPattern);

  const activeFieldUsage = useMemo(
    () => (fieldUsageForPattern === effectiveIndexPattern ? fieldUsageSummary : null),
    [fieldUsageForPattern, effectiveIndexPattern, fieldUsageSummary]
  );

  useEffect(() => {
    if (prefillIndex?.trim()) {
      pendingColumnsResetRef.current = true;
      setFieldUsageSummary(null);
      setFieldUsageForPattern(null);
      setIndexPattern(prefillIndex.trim());
      onPrefillConsumed?.();
    }
  }, [prefillIndex, onPrefillConsumed]);

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
    const idx = effectiveIndexPattern;
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
  }, [activeCluster, effectiveIndexPattern, needsIndexMetadata]);

  const fieldMetadataReady =
    !needsIndexMetadata ||
    (!indexDetailsLoading &&
      fieldUsageForPattern === effectiveIndexPattern &&
      (fieldUsageSummary != null || indexDetails != null));

  const timeHistogram = useQueryTimeHistogramState({
    indexPattern: effectiveIndexPattern,
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
      !timeHistogram.isReadyForSearch
    ) {
      setTimeFieldBounds(null);
      setTimeFieldBoundsLoading(false);
      return;
    }

    if (!boundsRequired) {
      setTimeFieldBounds(null);
      setTimeFieldBoundsLoading(false);
      return;
    }

    setTimeFieldBoundsLoading(true);
    const controller = new AbortController();
    const field = timeHistogram.selectedTimeField;
    const idx = effectiveIndexPattern;

    fetchTimeFieldBounds(activeCluster, idx, field, controller.signal)
      .then((bounds) => {
        if (controller.signal.aborted) return;
        setTimeFieldBounds(bounds);
      })
      .catch(() => {
        if (!controller.signal.aborted) setTimeFieldBounds(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setTimeFieldBoundsLoading(false);
      });

    return () => controller.abort();
  }, [
    activeCluster,
    effectiveIndexPattern,
    timeHistogram.visible,
    timeHistogram.selectedTimeField,
    timeHistogram.isReadyForSearch,
    boundsRequired
  ]);

  const timeFieldFormat = useMemo(() => {
    if (!indexDetails || !timeHistogram.selectedTimeField) return null;
    return getDateFieldFormatFromMappings(indexDetails, timeHistogram.selectedTimeField);
  }, [indexDetails, timeHistogram.selectedTimeField]);

  const timeSearchContextRef = useRef<{
    timeField: string;
    timeFieldFormat: string | null;
    resolution: ReturnType<typeof resolveTimeSearchResolution>;
  } | null>(null);

  timeSearchContextRef.current =
    timeHistogram.visible &&
    !timeHistogram.collapsed &&
    timeHistogram.selectedTimeField &&
    timeHistogram.timeRangeForSearch
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

  const autoRunWhenReady =
    !timeHistogram.visible ||
    !fieldMetadataReady ||
    (timeHistogram.collapsed
      ? true
      : timeHistogram.isReadyForSearch && (!boundsRequired || !timeFieldBoundsLoading));

  const autoDefaultTimeField = useMemo(() => {
    if (!timeHistogram.visible) return null;
    if (needsIndexMetadata && !fieldMetadataReady) return null;
    return pickDefaultTimeField(timeHistogram.dateFields);
  }, [timeHistogram.visible, timeHistogram.dateFields, needsIndexMetadata, fieldMetadataReady]);

  /** Chart-selected time field drives default sort/columns; falls back to mapping default. */
  const sortTimeField = useMemo(() => {
    if (!timeHistogram.visible) return null;
    if (needsIndexMetadata && !fieldMetadataReady) return null;
    return timeHistogram.selectedTimeField || autoDefaultTimeField;
  }, [
    timeHistogram.visible,
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

  const savedState = clusterLabel && hydrated ? readQueryState(clusterLabel) : null;

  const search = useDocumentSearch(activeCluster, effectiveIndexPattern, hydrated, {
    mode,
    simpleQuery: savedState?.simpleQuery,
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

  useEffect(() => {
    onRefreshStateChange?.(search.loading);
  }, [search.loading, onRefreshStateChange]);

  useEffect(() => {
    const onRefresh = () => search.refresh();
    window.addEventListener('refreshSearch', onRefresh);
    return () => window.removeEventListener('refreshSearch', onRefresh);
  }, [search.refresh]);

  const showIndexColumn = useMemo(
    () =>
      shouldShowIndexColumn(search.hits, effectiveIndexPattern) ||
      /[*?,]/.test(effectiveIndexPattern),
    [search.hits, effectiveIndexPattern]
  );

  const scopeKey = columnScopeKey(clusterLabel, effectiveIndexPattern);

  /** Latch page hits for field sidebar only after _search completes (same render as reset). */
  const hitsForDiscoveryRef = useRef<{ pattern: string; revision: number; hits: SearchHit[] }>({
    pattern: effectiveIndexPattern,
    revision: -1,
    hits: []
  });

  if (hitsForDiscoveryRef.current.pattern !== effectiveIndexPattern) {
    hitsForDiscoveryRef.current = { pattern: effectiveIndexPattern, revision: -1, hits: [] };
  }

  if (!search.loading && search.initialized) {
    if (hitsForDiscoveryRef.current.revision !== search.searchRevision) {
      hitsForDiscoveryRef.current = {
        pattern: effectiveIndexPattern,
        revision: search.searchRevision,
        hits: search.hits
      };
    }
  }

  const hitsForFieldDiscovery =
    hitsForDiscoveryRef.current.pattern === effectiveIndexPattern
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
  }, [effectiveIndexPattern, autoColumns]);

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
    effectiveIndexPattern,
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
      indexPattern: effectiveIndexPattern,
      mode,
      simpleQuery: search.query,
      advancedBody: search.advancedBody,
      size: search.size,
      from: search.from,
      sort: search.sort
    });
  }, [clusterLabel, effectiveIndexPattern, mode, search.query, search.advancedBody, search.size, search.from, search.sort]);

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

  const handleIndexPatternChange = useCallback((value: string) => {
    const nextPattern = normalizeQueryIndexPattern(value);
    if (nextPattern === normalizeQueryIndexPattern(indexPatternRef.current)) return;
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
  }, []);

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
      if (timeHistogram.visible && !timeHistogram.collapsed && timeField) {
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
      void search.runSearch({ mode, from: 0 });
    },
    [
      timeHistogram.handleBrushSelect,
      timeHistogram.visible,
      timeHistogram.collapsed,
      timeHistogram.selectedTimeField,
      timeHistogram.timePreset,
      timeFieldFormat,
      timeFieldBounds,
      search.runSearch,
      mode
    ]
  );

  const runChartPresetSearch = useCallback(
    (preset: TimeRangePreset) => {
      const timeField = timeHistogram.selectedTimeField;
      if (!timeField || !timeHistogram.visible || timeHistogram.collapsed) return;

      const range = resolveChartFilterRange(preset, timeField, null);
      timeSearchContextRef.current = {
        timeField,
        timeFieldFormat,
        resolution: resolveTimeSearchResolution(preset, range, timeFieldBounds, false)
      };

      timePresetRef.current = preset;
      if (isAllTimePreset(preset)) {
        allBoundsSearchKeyRef.current = '';
      }
      pendingColumnsResetRef.current = true;
      void search.runSearch({ mode, from: 0 });
    },
    [
      timeHistogram.selectedTimeField,
      timeHistogram.visible,
      timeHistogram.collapsed,
      timeFieldFormat,
      timeFieldBounds,
      search.runSearch,
      mode
    ]
  );

  const handleHistogramBrushClear = useCallback(() => {
    timeHistogram.clearBrushRange();
    runChartPresetSearch(timeHistogram.timePreset);
  }, [timeHistogram.clearBrushRange, timeHistogram.timePreset, runChartPresetSearch]);

  const handleTimePresetChange = useCallback(
    (preset: TimeRangePreset) => {
      const hadBrush = timeHistogram.brushRange != null;
      timeHistogram.setTimePreset(preset);
      if (hadBrush) {
        runChartPresetSearch(preset);
      }
    },
    [timeHistogram.brushRange, timeHistogram.setTimePreset, runChartPresetSearch]
  );

  const expandSearchPendingRef = useRef(false);
  const chartCollapsedRef = useRef(timeHistogram.collapsed);
  const resultsHistogramCacheKeyRef = useRef<string | null>(null);

  const buildHistogramCacheKey = useCallback(() => {
    return buildResultsHistogramCacheKey({
      indexPattern: effectiveIndexPattern,
      timeField: timeHistogram.selectedTimeField,
      mode,
      query: search.query,
      advancedBody: search.advancedBody,
      searchRevision: search.searchRevision
    });
  }, [
    effectiveIndexPattern,
    timeHistogram.selectedTimeField,
    mode,
    search.query,
    search.advancedBody,
    search.searchRevision
  ]);

  useEffect(() => {
    resultsHistogramCacheKeyRef.current = null;
  }, [effectiveIndexPattern]);

  useEffect(() => {
    if (search.histogramBuckets.length === 0) {
      resultsHistogramCacheKeyRef.current = null;
      return;
    }
    if (timeHistogram.collapsed) return;
    if (!isSearchResultsPreset(timeHistogram.timePreset) || timeHistogram.brushRange) return;
    resultsHistogramCacheKeyRef.current = buildHistogramCacheKey();
  }, [
    search.histogramBuckets.length,
    search.searchRevision,
    timeHistogram.collapsed,
    timeHistogram.timePreset,
    timeHistogram.brushRange,
    buildHistogramCacheKey
  ]);

  const handleTimeChartCollapsedChange = useCallback(
    (nextCollapsed: boolean) => {
      timeHistogram.setCollapsed(nextCollapsed);
    },
    [timeHistogram.setCollapsed]
  );

  useEffect(() => {
    if (!search.initialized) {
      chartCollapsedRef.current = timeHistogram.collapsed;
      return;
    }
    if (chartCollapsedRef.current === timeHistogram.collapsed) return;
    chartCollapsedRef.current = timeHistogram.collapsed;

    if (timeHistogram.collapsed) {
      expandSearchPendingRef.current = false;
      if (isChartTimeFilterActive(timeHistogram.timePreset, timeHistogram.brushRange)) {
        pendingColumnsResetRef.current = true;
        void search.runSearch({ mode, from: 0 });
      }
      return;
    }

    expandSearchPendingRef.current = true;
    const filterActive = isChartTimeFilterActive(timeHistogram.timePreset, timeHistogram.brushRange);
    const canReuseHistogram =
      !filterActive &&
      search.histogramBuckets.length > 0 &&
      resultsHistogramCacheKeyRef.current === buildHistogramCacheKey();

    if (canReuseHistogram) {
      expandSearchPendingRef.current = false;
      return;
    }

    const needsBounds = needsTimeFieldBounds(timeHistogram.timePreset, timeHistogram.brushRange);
    if (!needsBounds || !timeFieldBoundsLoading) {
      expandSearchPendingRef.current = false;
      pendingColumnsResetRef.current = true;
      void search.runSearch({ mode, from: 0 });
    }
  }, [
    search.initialized,
    search.runSearch,
    search.histogramBuckets.length,
    search.searchRevision,
    buildHistogramCacheKey,
    mode,
    timeHistogram.collapsed,
    timeHistogram.timePreset,
    timeHistogram.brushRange,
    timeFieldBoundsLoading
  ]);

  useEffect(() => {
    if (!expandSearchPendingRef.current || !search.initialized) return;
    if (timeHistogram.collapsed || !timeHistogram.visible) return;
    if (timeFieldBoundsLoading) return;

    const filterActive = isChartTimeFilterActive(timeHistogram.timePreset, timeHistogram.brushRange);
    const canReuseHistogram =
      !filterActive &&
      search.histogramBuckets.length > 0 &&
      resultsHistogramCacheKeyRef.current === buildHistogramCacheKey();

    expandSearchPendingRef.current = false;
    if (canReuseHistogram) return;

    pendingColumnsResetRef.current = true;
    void search.runSearch({ mode, from: 0 });
  }, [
    search.initialized,
    search.runSearch,
    search.histogramBuckets.length,
    search.searchRevision,
    buildHistogramCacheKey,
    mode,
    timeHistogram.collapsed,
    timeHistogram.visible,
    timeHistogram.timePreset,
    timeHistogram.brushRange,
    timeFieldBoundsLoading
  ]);

  const runSearchRef = useRef(search.runSearch);
  runSearchRef.current = search.runSearch;

  useEffect(() => {
    if (!timeHistogram.visible || timeHistogram.collapsed || !search.initialized) return;
    const presetKey = timeHistogram.timePreset;
    if (timePresetRef.current === presetKey) return;

    timePresetRef.current = presetKey;

    if (isAllTimePreset(presetKey)) {
      allBoundsSearchKeyRef.current = '';
      return;
    }

    if (isSearchResultsPreset(presetKey)) {
      pendingColumnsResetRef.current = true;
      void runSearchRef.current({ mode, from: 0 });
      return;
    }

    if (needsTimeFieldBounds(presetKey, timeHistogram.brushRange) && timeFieldBoundsLoading) return;

    pendingColumnsResetRef.current = true;
    void runSearchRef.current({ mode, from: 0 });
  }, [
    timeHistogram.timePreset,
    timeHistogram.visible,
    timeHistogram.collapsed,
    timeHistogram.brushRange,
    search.initialized,
    mode,
    timeFieldBoundsLoading
  ]);

  const autoTimeFieldRef = useRef('');
  useEffect(() => {
    autoTimeFieldRef.current = '';
  }, [effectiveIndexPattern]);

  useEffect(() => {
    if (!search.initialized || !timeHistogram.visible || timeHistogram.collapsed) return;
    if (!timeHistogram.selectedTimeField) return;

    const boundsNeeded = needsTimeFieldBounds(timeHistogram.timePreset, timeHistogram.brushRange);
    if (boundsNeeded && timeFieldBoundsLoading) return;

    if (autoTimeFieldRef.current === timeHistogram.selectedTimeField) return;

    const previousField = autoTimeFieldRef.current;
    autoTimeFieldRef.current = timeHistogram.selectedTimeField;

    if (!previousField) return;

    resultsHistogramCacheKeyRef.current = null;
    void search.runSearch({ mode, from: 0 });
  }, [
    search.initialized,
    search.runSearch,
    mode,
    timeHistogram.visible,
    timeHistogram.collapsed,
    timeHistogram.timePreset,
    timeHistogram.brushRange,
    timeHistogram.selectedTimeField,
    timeFieldBoundsLoading
  ]);

  useEffect(() => {
    allBoundsSearchKeyRef.current = '';
  }, [effectiveIndexPattern]);

  useEffect(() => {
    if (!search.initialized || timeHistogram.collapsed || !timeHistogram.visible) return;
    if (!isAllTimePreset(timeHistogram.timePreset)) return;
    if (timeFieldBoundsLoading) return;
    if (timeFieldBounds?.minMs == null || timeFieldBounds?.maxMs == null) return;

    const key = `${effectiveIndexPattern}:${timeHistogram.selectedTimeField}:${timeFieldBounds.minMs}:${timeFieldBounds.maxMs}`;
    if (allBoundsSearchKeyRef.current === key) return;
    allBoundsSearchKeyRef.current = key;
    pendingColumnsResetRef.current = true;
    void search.runSearch({ mode, from: 0 });
  }, [
    search.initialized,
    search.runSearch,
    mode,
    effectiveIndexPattern,
    timeHistogram.collapsed,
    timeHistogram.visible,
    timeHistogram.timePreset,
    timeHistogram.selectedTimeField,
    timeFieldBounds,
    timeFieldBoundsLoading
  ]);

  const requestUrl = useMemo(() => {
    if (!activeCluster) return '';
    const base = activeCluster.baseUrl.replace(/\/$/, '');
    return `${base}/${effectiveIndexPattern}/_search`;
  }, [activeCluster, effectiveIndexPattern]);

  const curl = useMemo(() => {
    if (!activeCluster || !search.lastRequestBody) return '';
    return buildSearchCurl(activeCluster.baseUrl, effectiveIndexPattern, search.lastRequestBody, activeCluster);
  }, [activeCluster, effectiveIndexPattern, search.lastRequestBody]);

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
            onClick={() => search.refresh()}
            disabled={search.loading}
            className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${search.loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>
      <div className="tab-section-body flex min-h-0 flex-1 flex-col">
        <div className="tab-section-scroll-fill space-y-3">
          <QueryDiscoverBar
            indexPattern={indexPattern}
            onIndexPatternChange={handleIndexPatternChange}
            patternOptions={patternOptions}
            onIndexPickerOpen={loadDataStreams}
            mode={mode}
            onModeChange={handleModeChange}
            query={search.query}
            onQueryChange={search.setQuery}
            onSearch={handleSearch}
            loading={search.loading}
          />

          {timeHistogram.visible && timeHistogram.selectedTimeField ? (
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
              loading={search.loading}
              fieldsLoading={timeHistogram.fieldsLoading}
              error={search.histogramError}
              onBrushApply={handleHistogramBrushApply}
              onBrushClear={handleHistogramBrushClear}
            />
          ) : null}

          <DocumentSearchWorkspace
              cluster={activeCluster}
              indexLabel={effectiveIndexPattern}
              displayIndexName={effectiveIndexPattern}
              hits={search.hits}
              from={search.from}
              queryKey={`${effectiveIndexPattern}:${mode}:${search.query}:${search.advancedBody}:${search.from}:${sortDisplayField ?? ''}:${sortOrder ?? ''}`}
              total={search.total}
              totalIsLowerBound={search.totalIsLowerBound}
              took={search.took}
              page={search.page}
              totalPages={search.totalPages}
              loading={search.loading}
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
                        disabled={search.loading}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSearch}
                          disabled={search.loading}
                          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {search.loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
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
