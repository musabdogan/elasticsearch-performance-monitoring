import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useMonitoring } from '@/context/MonitoringProvider';
import { DocumentSearchWorkspace } from '@/components/query/DocumentSearchWorkspace';
import { QueryDiscoverIndexColumn, QueryDiscoverSearchRow } from '@/components/query/QueryDiscoverBar';
import { QueryTimeHistogram } from '@/components/query/QueryTimeHistogram';
import type { QueryPatternOption } from '@/components/query/QueryIndexPatternPicker';
import { QueryAdvancedEditor, QueryRequestPreview } from '@/components/query/QueryAdvancedEditor';
import { useDocumentSearch, type TimeSearchContext } from '@/hooks/useDocumentSearch';
import { useDocumentColumns } from '@/hooks/useDocumentColumns';
import { useFieldTopValues } from '@/hooks/useFieldTopValues';
import { useQueryTimeHistogramState } from '@/hooks/useQueryTimeHistogram';
import { getDataStreams, getFieldUsageStats, getIndexDetails } from '@/services/elasticsearch';
import type { FieldUsageStatsResponse, IndexDetailsResponse, SearchHit } from '@/types/api';
import type { DiscoverFilter } from '@/types/discover';
import { parseFieldUsageIndexDetailed, type FieldUsageSummary } from '@/utils/indexDetailHelpers';
import { readQueryState, writeQueryState } from '@/utils/queryPersistence';
import { createDiscoverFilter, filtersEqual } from '@/utils/discoverFilters';
import { resolveFieldAggField } from '@/utils/fieldMappingTypes';
import {
  displayFieldForSortField,
  getDefaultColumnsFromFieldUsage,
  readAutoColumnsEnabled,
  resolveDefaultDocumentSort,
  resolveElasticsearchSortField,
  sanitizeDocumentSort,
  writeAutoColumnsEnabled
} from '@/utils/indexDataTable';
import {
  advanceChartProbeStep,
  buildNoTimestampChartDataMessage,
  buildSelectTimestampFieldMessage,
  CHART_PROBE_TIME_FIELD,
  fetchTimeFieldBounds,
  getDateFieldFormatFromMappings,
  hasStandardChartTimeField,
  hasValidTimeFieldBounds,
  needsTimeFieldBounds,
  pickDefaultTimeField,
  resolveStandardChartTimeField,
  resolveExpandedChartTimeSearchContext,
  mergeChartTimeFieldOptions,
  isAllTimePreset,
  DEFAULT_CHART_PRESET,
  DEFAULT_TIME_PRESET,
  timeChartRangeHasData,
  type ChartProbePreset,
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

function columnScopeKey(clusterLabel: string, indexPattern: string, timeField?: string | null): string {
  const base = `${clusterLabel}:${indexPattern}`;
  if (timeField) return `${base}\0tf:${timeField}`;
  return base;
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
  const { activeCluster, activeClusterConnectionKey, snapshot } = useMonitoring();
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
  const [timeChartEmptyFieldWarning, setTimeChartEmptyFieldWarning] = useState<string | null>(null);
  const [chartProbing, setChartProbing] = useState(false);
  const persistTimerRef = useRef<number | null>(null);
  const pendingColumnsResetRef = useRef(false);
  const timePresetRef = useRef<string>(DEFAULT_TIME_PRESET);
  const allBoundsSearchKeyRef = useRef('');
  const isFirstQueryVisitRef = useRef(true);
  const skipIndexPatternSearchRef = useRef(true);
  const indexPatternChangeSourceRef = useRef<'user' | null>(null);
  const pendingPatternSearchRef = useRef(false);
  const [documentSearchQueued, setDocumentSearchQueued] = useState(false);
  const [discoverFilters, setDiscoverFilters] = useState<DiscoverFilter[]>([]);
  const discoverFiltersRef = useRef<DiscoverFilter[]>([]);
  discoverFiltersRef.current = discoverFilters;
  const boundsRequestIdRef = useRef(0);
  const chartProbeRef = useRef<{
    presetStep: ChartProbePreset;
    lastHandledRevision: number;
    active: boolean;
  } | null>(null);
  const probeDisplayLatchRef = useRef<{ hits: SearchHit[]; total: number | null } | null>(null);
  const pendingManualTimeFieldRef = useRef<string | null>(null);
  /** User explicitly picked a time field from the chart dropdown (not auto-default on open). */
  const userChoseTimeFieldRef = useRef(false);
  const pendingChartOpenProbeRef = useRef(false);
  const chartFilterAppliedRef = useRef(false);
  /** Failover waits until searchRevision advances past this (avoids stale match_all hits). */
  const pendingChartSearchRef = useRef<{
    preset: TimeRangePreset;
    brushRange: TimeRangeFilter | null;
  } | null>(null);
  const applyChartSearchRef = useRef<
    (preset: TimeRangePreset, bounds: TimeFieldBounds | null, brushRange?: TimeRangeFilter | null) => void
  >(() => {});
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
    setDiscoverFilters([]);
    prevSearchIndexPatternRef.current = '';
    chartFilterAppliedRef.current = false;
    pendingChartSearchRef.current = null;
    chartProbeRef.current = null;
    probeDisplayLatchRef.current = null;
    setChartProbing(false);
    setTimeChartEmptyFieldWarning(null);
    pendingManualTimeFieldRef.current = null;
  }, [clusterLabel]);

  useEffect(() => {
    if (!clusterLabel) return;
    const saved = readQueryState(clusterLabel);
    const normalized = normalizeQueryIndexPattern(saved?.indexPattern ?? '');
    setIndexPattern(normalized);
    setSearchIndexPattern(normalized);
    if (saved?.mode) setMode(saved.mode);
    if (saved?.discoverFilters?.length) setDiscoverFilters(saved.discoverFilters);
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
  }, [activeClusterConnectionKey]);

  const loadDataStreams = useCallback(() => {
    if (!activeCluster || dataStreamsLoadStateRef.current !== 'idle') return;

    dataStreamsLoadStateRef.current = 'loading';

    void getDataStreams(activeCluster)
      .then((res) => {
        const names = (res.data_streams ?? [])
          .map((ds) => ds.name)
          .filter(Boolean);
        setDataStreamNames(sortIndexNamesDotLast(names));
      })
      .catch(() => {
        setDataStreamNames([]);
      })
      .finally(() => {
        dataStreamsLoadStateRef.current = 'done';
      });
  }, [activeCluster, activeClusterConnectionKey]);

  const patternOptions = useMemo<QueryPatternOption[]>(() => {
    const dataStreamSet = new Set(dataStreamNames);
    const options: QueryPatternOption[] = [
      { value: ALL_INDICES_PATTERN, label: 'All indices (*)', kind: 'pattern' }
    ];
    for (const name of sortIndexNamesDotLast(indexOptions.filter((n) => !dataStreamSet.has(n)))) {
      options.push({ value: name, label: name, kind: 'index' });
    }
    for (const name of sortIndexNamesDotLast(dataStreamNames)) {
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
  }, [activeClusterConnectionKey, searchIndexPattern, needsIndexMetadata]);

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
    if (!boundsRequired) {
      setTimeFieldBounds(null);
      setTimeFieldBoundsLoading(false);
      setTimeFieldUsable(false);
      return;
    }

    if (
      !activeCluster ||
      !timeHistogram.visible ||
      !timeHistogram.selectedTimeField ||
      !timeHistogram.isReadyForSearch ||
      timeHistogram.collapsed
    ) {
      return;
    }

    const field = timeHistogram.selectedTimeField;
    const idx = searchIndexPattern;
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
          pendingChartSearchRef.current = null;
          if (chartProbeRef.current?.active) {
            chartProbeRef.current = null;
            setChartProbing(false);
          }
          setTimeChartEmptyFieldWarning(
            buildNoTimestampChartDataMessage(field, timeHistogram.timePreset)
          );
        } else {
          setTimeChartEmptyFieldWarning(null);
        }
      })
      .catch(() => {
        if (controller.signal.aborted || requestId !== boundsRequestIdRef.current) return;
        setTimeFieldBounds(null);
        setTimeFieldUsable(false);
        pendingChartSearchRef.current = null;
      })
      .finally(() => {
        if (requestId === boundsRequestIdRef.current) {
          setTimeFieldBoundsLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    activeClusterConnectionKey,
    searchIndexPattern,
    boundsRequired,
    timeHistogram.visible,
    timeHistogram.selectedTimeField,
    timeHistogram.isReadyForSearch,
    timeHistogram.collapsed
  ]);

  useEffect(() => {
    chartProbeRef.current = null;
    probeDisplayLatchRef.current = null;
    setChartProbing(false);
    chartFilterAppliedRef.current = false;
    pendingChartSearchRef.current = null;
    setTimeChartEmptyFieldWarning(null);
    setDocumentSearchQueued(false);
    setDiscoverFilters([]);
    pendingManualTimeFieldRef.current = null;
    userChoseTimeFieldRef.current = false;
    pendingChartOpenProbeRef.current = false;
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
      timeChartEmptyFieldWarning != null ||
      (boundsRequired ? timeFieldUsable || timeFieldBoundsLoading : true));

  const getTimeSearchContext = useCallback((): TimeSearchContext | null => {
    if (timeHistogram.collapsed || !timeHistogram.selectedTimeField) return null;
    return resolveExpandedChartTimeSearchContext(
      timeHistogram.timePreset,
      timeHistogram.selectedTimeField,
      timeHistogram.brushRange,
      timeFieldBounds,
      timeFieldFormat
    );
  }, [
    timeHistogram.collapsed,
    timeHistogram.selectedTimeField,
    timeHistogram.timePreset,
    timeHistogram.brushRange,
    timeFieldBounds,
    timeFieldFormat
  ]);

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
  const getDiscoverFilters = useCallback(() => discoverFiltersRef.current, []);

  const mappingsForPattern = useMemo(
    () => mappingsResponseForPattern(searchIndexPattern, indexDetails),
    [searchIndexPattern, indexDetails]
  );

  const getTopValuesTimeRange = useCallback(() => {
    const ctx = getTimeSearchContext();
    if (ctx?.resolution.mode === 'filter') {
      return ctx.resolution.range;
    }
    return null;
  }, [getTimeSearchContext]);

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
    getTimeSearchContext,
    getDiscoverFilters
  });

  const buildContextSearchBody = useCallback(
    () => search.buildContextSearchBody(),
    [search.buildContextSearchBody]
  );

  const getTopValuesRequireFieldExists = useCallback(
    () => timeHistogram.collapsed,
    [timeHistogram.collapsed]
  );

  const fieldTopValues = useFieldTopValues({
    cluster: activeCluster,
    indexPattern: searchIndexPattern,
    enabled: hydrated,
    buildBaseSearchBody: buildContextSearchBody,
    mappings: mappingsForPattern,
    getTimeRange: getTopValuesTimeRange,
    getRequireFieldExists: getTopValuesRequireFieldExists
  });

  runSearchRef.current = search.runSearch;

  const applyChartSearch = useCallback(
    (
      preset: TimeRangePreset,
      bounds: TimeFieldBounds | null,
      brushRange: TimeRangeFilter | null = null
    ) => {
      const timeField = timeHistogram.selectedTimeField;
      if (!timeField || timeHistogram.collapsed) return;

      if (isAllTimePreset(preset) && !hasValidTimeFieldBounds(bounds)) {
        pendingChartSearchRef.current = { preset, brushRange };
        return;
      }

      pendingChartSearchRef.current = null;

      timePresetRef.current = preset;
      if (isAllTimePreset(preset) && bounds?.minMs != null && bounds?.maxMs != null) {
        allBoundsSearchKeyRef.current = `${searchIndexPattern}:${timeField}:${bounds.minMs}:${bounds.maxMs}`;
      } else if (isAllTimePreset(preset)) {
        allBoundsSearchKeyRef.current = '';
      }
      pendingColumnsResetRef.current = !chartProbeRef.current?.active;
      chartFilterAppliedRef.current = true;
      const sort = resolveDefaultDocumentSort(timeField, activeFieldUsage);
      void search.runSearch({
        mode,
        from: 0,
        ...(sort.length ? { sort } : {})
      });
    },
    [
      timeHistogram.selectedTimeField,
      timeHistogram.collapsed,
      search.runSearch,
      mode,
      searchIndexPattern,
      activeFieldUsage
    ]
  );

  applyChartSearchRef.current = applyChartSearch;

  /** Run queued chart searches after expand or when bounds land for All. */
  useEffect(() => {
    if (timeHistogram.collapsed || !timeHistogram.selectedTimeField) return;

    const pending = pendingChartSearchRef.current;
    if (!pending) return;

    if (isAllTimePreset(pending.preset)) {
      if (timeFieldBoundsLoading || !hasValidTimeFieldBounds(timeFieldBounds)) return;
    }

    pendingChartSearchRef.current = null;
    applyChartSearch(pending.preset, timeFieldBounds, pending.brushRange);
  }, [
    timeHistogram.collapsed,
    timeHistogram.selectedTimeField,
    timeFieldBounds,
    timeFieldBoundsLoading,
    timeHistogram.timePreset,
    applyChartSearch
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
  }, [hydrated, activeClusterConnectionKey, needsIndexMetadata, fieldMetadataReady]);

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
  }, [hydrated, activeClusterConnectionKey, searchIndexPattern, needsIndexMetadata, queueDocumentSearch]);

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

  /** Column defaults need the latest completed search hits (not latched sidebar snapshot). */
  const hitsForColumnDefaults =
    !search.loading && search.initialized ? search.hits : hitsForFieldDiscovery;

  const scopeKey = columnScopeKey(
    clusterLabel,
    searchIndexPattern,
    timeChartSearchActive ? timeHistogram.selectedTimeField : null
  );

  const columns = useDocumentColumns(
    scopeKey,
    hitsForColumnDefaults,
    activeFieldUsage,
    false,
    fieldMetadataReady,
    sortTimeField,
    autoColumns,
    false
  );

  const chartDateFields = useMemo(() => {
    const merged = mergeChartTimeFieldOptions(
      timeHistogram.dateFields,
      columns.availableFields,
      mappingsForPattern
    );
    const selected = timeHistogram.selectedTimeField;
    if (selected && !merged.includes(selected)) {
      return [...merged, selected].sort((a, b) => a.localeCompare(b));
    }
    return merged;
  }, [
    timeHistogram.dateFields,
    timeHistogram.selectedTimeField,
    columns.availableFields,
    mappingsForPattern
  ]);

  const cancelChartProbe = useCallback((options?: { clearLatch?: boolean }) => {
    chartProbeRef.current = null;
    if (options?.clearLatch !== false) {
      probeDisplayLatchRef.current = null;
    }
    setChartProbing(false);
  }, []);

  const runChartProbeStep = useCallback(
    (preset: ChartProbePreset) => {
      setTimeChartEmptyFieldWarning(null);
      timeHistogram.setTimePreset(preset);
      chartFilterAppliedRef.current = true;

      if (isAllTimePreset(preset) && !hasValidTimeFieldBounds(timeFieldBounds)) {
        pendingChartSearchRef.current = { preset, brushRange: null };
        return;
      }

      pendingChartSearchRef.current = null;
      const sort = resolveDefaultDocumentSort(
        timeHistogram.selectedTimeField || CHART_PROBE_TIME_FIELD,
        activeFieldUsage
      );
      void search.runSearch({
        mode,
        from: 0,
        ...(sort.length ? { sort } : {})
      });
    },
    [
      mode,
      search.runSearch,
      activeFieldUsage,
      timeFieldBounds,
      timeHistogram.setTimePreset,
      timeHistogram.selectedTimeField
    ]
  );

  const beginChartOpenProbe = useCallback(() => {
    const standardTimeField = resolveStandardChartTimeField(timeHistogram.dateFields);

    if (!standardTimeField) {
      userChoseTimeFieldRef.current = false;
      const fallback = pickDefaultTimeField(timeHistogram.dateFields);
      if (!fallback) {
        setTimeChartEmptyFieldWarning(buildSelectTimestampFieldMessage());
        return;
      }
      setTimeChartEmptyFieldWarning(buildSelectTimestampFieldMessage());
      timeHistogram.setSelectedTimeField(fallback);
    } else {
      setTimeChartEmptyFieldWarning(null);
      userChoseTimeFieldRef.current = false;
      timeHistogram.setSelectedTimeField(standardTimeField);
    }

    probeDisplayLatchRef.current = {
      hits: search.hits,
      total: search.total
    };
    setChartProbing(true);
    chartProbeRef.current = {
      presetStep: '15m',
      lastHandledRevision: search.searchRevision,
      active: true
    };
    pendingChartSearchRef.current = { preset: DEFAULT_CHART_PRESET, brushRange: null };
    timeHistogram.setTimePreset(DEFAULT_CHART_PRESET);
    timeHistogram.clearBrushRange();
    chartFilterAppliedRef.current = true;
  }, [
    timeHistogram.dateFields,
    timeHistogram.setSelectedTimeField,
    timeHistogram.setTimePreset,
    timeHistogram.clearBrushRange,
    search.hits,
    search.total,
    search.searchRevision
  ]);

  /** After each probe search: 15m → 24h → 30d → 1y → all on @timestamp. */
  useEffect(() => {
    const probe = chartProbeRef.current;
    if (!probe?.active) return;
    if (timeHistogram.collapsed || search.loading || !search.initialized) return;
    if (search.searchRevision <= probe.lastHandledRevision) return;
    if (search.error) {
      cancelChartProbe();
      return;
    }

    const hasData = timeChartRangeHasData(
      search.histogramBuckets,
      search.total,
      search.hits.length
    );
    const step = advanceChartProbeStep({
      presetStep: probe.presetStep,
      hasData
    });

    probe.lastHandledRevision = search.searchRevision;

    if (step.action === 'success') {
      cancelChartProbe({ clearLatch: true });
      setTimeChartEmptyFieldWarning(null);
      return;
    }

    if (step.action === 'exhausted') {
      cancelChartProbe({ clearLatch: true });
      setTimeChartEmptyFieldWarning(
        buildNoTimestampChartDataMessage(
          timeHistogram.selectedTimeField || CHART_PROBE_TIME_FIELD,
          timeHistogram.timePreset
        )
      );
      return;
    }

    probe.presetStep = step.preset;
    runChartProbeStep(step.preset);
  }, [
    timeHistogram.collapsed,
    search.loading,
    search.initialized,
    search.searchRevision,
    search.error,
    search.histogramBuckets,
    search.total,
    search.hits.length,
    cancelChartProbe,
    runChartProbeStep
  ]);

  /** Sync chart empty warning after each completed search (preset change, field change, probe). */
  useEffect(() => {
    if (timeHistogram.collapsed || search.loading || !search.initialized) return;
    if (chartProbing) return;

    const hasData = timeChartRangeHasData(
      search.histogramBuckets,
      search.total,
      search.hits.length
    );

    if (hasData) {
      setTimeChartEmptyFieldWarning(null);
      return;
    }

    const indexLacksStandardField = !hasStandardChartTimeField(timeHistogram.dateFields);
    const selectedIsStandard = hasStandardChartTimeField([timeHistogram.selectedTimeField]);

    if (indexLacksStandardField && !selectedIsStandard && !userChoseTimeFieldRef.current) {
      setTimeChartEmptyFieldWarning(buildSelectTimestampFieldMessage());
    }
  }, [
    timeHistogram.collapsed,
    timeHistogram.selectedTimeField,
    timeHistogram.dateFields,
    search.loading,
    search.initialized,
    search.searchRevision,
    search.histogramBuckets,
    search.total,
    search.hits.length,
    chartProbing
  ]);

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
    if (!search.initialized || search.loading) return false;
    const usageDefaults = Boolean(getDefaultColumnsFromFieldUsage(activeFieldUsage)?.length);
    if (usageDefaults) return true;
    return search.hits.length > 0;
  }, [
    needsIndexMetadata,
    fieldMetadataReady,
    activeFieldUsage,
    search.loading,
    search.initialized,
    search.hits.length
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

  const handleAddDiscoverFilter = useCallback(
    (field: string, aggField: string, value: string | number | boolean, negate: boolean) => {
      const next = createDiscoverFilter(field, aggField, value, negate);
      setDiscoverFilters((prev) => {
        const withoutDup = prev.filter((f) => !filtersEqual(f, next));
        return [...withoutDup, next];
      });
      pendingColumnsResetRef.current = true;
      void search.runSearch({ mode, from: 0 });
    },
    [search.runSearch, mode]
  );

  const handleRemoveDiscoverFilter = useCallback(
    (id: string) => {
      setDiscoverFilters((prev) => prev.filter((f) => f.id !== id));
      void search.runSearch({ mode, from: 0 });
    },
    [search.runSearch, mode]
  );

  const handleClearDiscoverFilters = useCallback(() => {
    setDiscoverFilters([]);
    void search.runSearch({ mode, from: 0 });
  }, [search.runSearch, mode]);

  const handleOpenDiscoverField = useCallback(
    (field: string) => {
      const aggField = resolveFieldAggField(field, activeFieldUsage, mappingsForPattern);
      fieldTopValues.openField(field, aggField);
    },
    [activeFieldUsage, mappingsForPattern, fieldTopValues.openField]
  );

  const persistState = useCallback(() => {
    if (!clusterLabel) return;
    writeQueryState(clusterLabel, {
      indexPattern: searchIndexPattern,
      mode,
      simpleQuery: search.query,
      advancedBody: search.advancedBody,
      size: search.size,
      from: search.from,
      sort: search.sort,
      discoverFilters
    });
  }, [
    clusterLabel,
    searchIndexPattern,
    mode,
    search.query,
    search.advancedBody,
    search.size,
    search.from,
    search.sort,
    discoverFilters
  ]);

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
      applyChartSearch(timeHistogram.timePreset, timeFieldBounds, range);
    },
    [
      timeHistogram.handleBrushSelect,
      timeHistogram.timePreset,
      timeFieldBounds,
      applyChartSearch
    ]
  );

  const runExpandedChartSearch = useCallback(
    (preset: TimeRangePreset, brushRange: TimeRangeFilter | null = null) => {
      if (isAllTimePreset(preset) && !hasValidTimeFieldBounds(timeFieldBounds)) {
        pendingChartSearchRef.current = { preset, brushRange };
        return;
      }
      applyChartSearch(preset, timeFieldBounds, brushRange);
    },
    [timeFieldBounds, applyChartSearch]
  );

  const handleHistogramBrushClear = useCallback(() => {
    timeHistogram.clearBrushRange();
    runExpandedChartSearch(timeHistogram.timePreset, null);
  }, [timeHistogram.clearBrushRange, timeHistogram.timePreset, runExpandedChartSearch]);

  const handleTimePresetChange = useCallback(
    (preset: TimeRangePreset) => {
      cancelChartProbe();
      timeHistogram.setTimePreset(preset);
      runExpandedChartSearch(preset, timeHistogram.brushRange);
    },
    [cancelChartProbe, timeHistogram.setTimePreset, timeHistogram.brushRange, runExpandedChartSearch]
  );

  const handleTimeFieldChange = useCallback(
    (field: string) => {
      if (!field || field === timeHistogram.selectedTimeField) return;

      cancelChartProbe();
      setTimeChartEmptyFieldWarning(null);
      userChoseTimeFieldRef.current = true;
      timeHistogram.clearBrushRange();
      pendingManualTimeFieldRef.current = field;
      timeHistogram.setSelectedTimeField(field);
      fieldTopValues.close();
      pendingColumnsResetRef.current = true;
      allBoundsSearchKeyRef.current = '';

      if (!isAllTimePreset(timeHistogram.timePreset)) {
        setTimeFieldBounds(null);
        setTimeFieldUsable(false);
      }

      if (!hasStandardChartTimeField(timeHistogram.dateFields)) {
        probeDisplayLatchRef.current = {
          hits: search.hits,
          total: search.total
        };
        setChartProbing(true);
        chartProbeRef.current = {
          presetStep: '15m',
          lastHandledRevision: search.searchRevision,
          active: true
        };
        timeHistogram.setTimePreset('15m');
        pendingChartSearchRef.current = { preset: DEFAULT_CHART_PRESET, brushRange: null };
        pendingManualTimeFieldRef.current = null;
        chartFilterAppliedRef.current = true;
      }

      hitsForDiscoveryRef.current = {
        pattern: searchIndexPattern,
        revision: -1,
        hits: []
      };
    },
    [
      cancelChartProbe,
      timeHistogram.selectedTimeField,
      timeHistogram.dateFields,
      timeHistogram.clearBrushRange,
      timeHistogram.setSelectedTimeField,
      timeHistogram.setTimePreset,
      timeHistogram.timePreset,
      fieldTopValues.close,
      searchIndexPattern,
      search.hits,
      search.total,
      search.searchRevision
    ]
  );

  /** Manual time-field change: re-search, reset sort/columns/chart like a fresh default field. */
  useEffect(() => {
    const pendingField = pendingManualTimeFieldRef.current;
    if (!pendingField || pendingField !== timeHistogram.selectedTimeField) return;
    if (!search.initialized) return;
    if (chartProbeRef.current?.active) {
      pendingManualTimeFieldRef.current = null;
      return;
    }

    const boundsNeeded = needsTimeFieldBounds(timeHistogram.timePreset, timeHistogram.brushRange);
    if (boundsNeeded && timeFieldBoundsLoading) return;
    if (boundsNeeded && !hasValidTimeFieldBounds(timeFieldBounds)) return;

    pendingManualTimeFieldRef.current = null;

    const nextSort = timeHistogram.collapsed
      ? undefined
      : resolveDefaultDocumentSort(pendingField, activeFieldUsage);

    pendingColumnsResetRef.current = true;
    chartFilterAppliedRef.current = !timeHistogram.collapsed;

    void search.runSearch({
      mode,
      from: 0,
      ...(nextSort?.length ? { sort: nextSort } : {})
    });
  }, [
    timeHistogram.selectedTimeField,
    timeHistogram.collapsed,
    timeHistogram.timePreset,
    timeHistogram.brushRange,
    search.initialized,
    timeFieldBoundsLoading,
    timeFieldBounds,
    activeFieldUsage,
    mode,
    search.runSearch
  ]);

  const handleTimeChartCollapsedChange = useCallback(
    (nextCollapsed: boolean) => {
      if (nextCollapsed) {
        pendingChartSearchRef.current = null;
        pendingChartOpenProbeRef.current = false;
        cancelChartProbe();
        userChoseTimeFieldRef.current = false;
        setTimeChartEmptyFieldWarning(null);
        timeHistogram.setCollapsed(true);
        if (chartFilterAppliedRef.current) {
          chartFilterAppliedRef.current = false;
          pendingColumnsResetRef.current = true;
          void runSearchRef.current?.({ mode: modeRef.current, from: 0 });
        }
        return;
      }

      if (!timeHistogram.visible) {
        pendingChartOpenProbeRef.current = true;
        timeHistogram.setCollapsed(false);
        return;
      }

      beginChartOpenProbe();
      timeHistogram.setCollapsed(false);
    },
    [
      cancelChartProbe,
      beginChartOpenProbe,
      timeHistogram.visible,
      timeHistogram.setCollapsed
    ]
  );

  /** Start open probe once mapping/date fields are ready (chart may open before metadata loads). */
  useEffect(() => {
    if (!pendingChartOpenProbeRef.current) return;
    if (timeHistogram.collapsed || !timeHistogram.visible || !timeHistogram.isReadyForSearch) return;
    if (chartProbeRef.current?.active) {
      pendingChartOpenProbeRef.current = false;
      return;
    }
    pendingChartOpenProbeRef.current = false;
    beginChartOpenProbe();
  }, [
    timeHistogram.collapsed,
    timeHistogram.visible,
    timeHistogram.isReadyForSearch,
    timeHistogram.dateFields,
    beginChartOpenProbe
  ]);

  useEffect(() => {
    allBoundsSearchKeyRef.current = '';
  }, [searchIndexPattern]);

  const requestUrl = useMemo(() => {
    if (!activeCluster) return '';
    const base = activeCluster.baseUrl.replace(/\/$/, '');
    return `${base}/${searchIndexPattern}/_search`;
  }, [activeClusterConnectionKey, searchIndexPattern]);

  const curl = useMemo(() => {
    if (!activeCluster || !search.lastRequestBody) return '';
    return buildSearchCurl(activeCluster.baseUrl, searchIndexPattern, search.lastRequestBody, activeCluster);
  }, [activeClusterConnectionKey, searchIndexPattern, search.lastRequestBody]);

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

  const probeDisplayLatch = probeDisplayLatchRef.current;
  const documentHits =
    chartProbing && probeDisplayLatch ? probeDisplayLatch.hits : search.hits;
  const documentTotal =
    chartProbing && probeDisplayLatch ? probeDisplayLatch.total : search.total;
  const documentLoading = queryBusy && !chartProbing;
  const chartHistogramLoading = chartProbing ? search.loading : queryBusy;

  const chartRangeHasData = useMemo(
    () => timeChartRangeHasData(search.histogramBuckets, search.total, search.hits.length),
    [search.histogramBuckets, search.total, search.hits.length]
  );

  if (!activeCluster) {
    return (
      <div className="rounded-lg border border-gray-300 bg-white p-8 text-center text-sm text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
        Select a cluster to use Query.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="tab-section-scroll-fill tab-section-scroll-flush flex min-h-0 flex-1 flex-col overflow-hidden">
          <DocumentSearchWorkspace
              cluster={activeCluster}
              discoverToolbar={{
                indexColumn: (
                  <QueryDiscoverIndexColumn
                    indexPattern={indexPattern}
                    indexPickerDisplayLabel={isIndexSelectionPending ? searchIndexPattern : undefined}
                    onIndexPatternCommit={handleIndexPatternCommit}
                    patternOptions={patternOptions}
                    onIndexPickerOpen={loadDataStreams}
                  />
                ),
                searchRow: (
                  <QueryDiscoverSearchRow
                    searchIndexPattern={searchIndexPattern}
                    mode={mode}
                    onModeChange={handleModeChange}
                    query={search.query}
                    onQueryChange={search.setQuery}
                    onSearch={handleSearch}
                    loading={documentLoading}
                  />
                )
              }}
              indexLabel={searchIndexPattern}
              displayIndexName={searchIndexPattern}
              hits={documentHits}
              from={search.from}
              queryKey={`${searchIndexPattern}:${mode}:${search.query}:${search.advancedBody}:${search.from}:${sortDisplayField ?? ''}:${sortOrder ?? ''}:${discoverFilters.map((f) => f.id).join(',')}`}
              total={documentTotal}
              totalIsLowerBound={search.totalIsLowerBound}
              took={search.took}
              page={search.page}
              totalPages={search.totalPages}
              loading={documentLoading}
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
              fieldsPanelVariant="discover"
              discoverHits={hitsForFieldDiscovery}
              fieldUsageSummary={activeFieldUsage}
              mappings={mappingsForPattern}
              discoverFilters={discoverFilters}
              topValuesField={fieldTopValues.activeField}
              topValuesAggField={fieldTopValues.aggField}
              topValuesResult={fieldTopValues.result}
              topValuesLoading={fieldTopValues.loading}
              topValuesError={fieldTopValues.error}
              onOpenDiscoverField={handleOpenDiscoverField}
              onCloseTopValues={fieldTopValues.close}
              onAddDiscoverFilter={handleAddDiscoverFilter}
              onRemoveDiscoverFilter={handleRemoveDiscoverFilter}
              onClearDiscoverFilters={handleClearDiscoverFilters}
              timeChart={
                showTimeChart ? (
                  <QueryTimeHistogram
                    collapsed={timeHistogram.collapsed}
                    onCollapsedChange={handleTimeChartCollapsedChange}
                    timePreset={timeHistogram.timePreset}
                    onPresetChange={handleTimePresetChange}
                    dateFields={chartDateFields}
                    selectedTimeField={timeHistogram.selectedTimeField}
                    onTimeFieldChange={handleTimeFieldChange}
                    activeRange={timeHistogram.activeFilterRange}
                    brushRange={timeHistogram.brushRange}
                    timeFieldBounds={timeFieldBounds}
                    boundsLoading={boundsRequired && !timeHistogram.collapsed && timeFieldBoundsLoading}
                    buckets={search.histogramBuckets}
                    loading={chartHistogramLoading}
                    fieldsLoading={timeHistogram.fieldsLoading}
                    error={search.histogramError}
                    onBrushApply={handleHistogramBrushApply}
                    onBrushClear={handleHistogramBrushClear}
                    emptyTimeFieldWarning={timeChartEmptyFieldWarning}
                    rangeHasData={chartRangeHasData}
                    probeActive={chartProbing}
                  />
                ) : undefined
              }
              searchSection={
                mode === 'advanced' ? (
                  <div className="space-y-2">
                    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 dark:border-gray-700 dark:bg-gray-900/20">
                      <QueryAdvancedEditor
                        value={search.advancedBody}
                        onChange={search.setAdvancedBody}
                        error={search.jsonError}
                        disabled={documentLoading}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSearch}
                          disabled={documentLoading}
                          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {documentLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
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
  );
}
