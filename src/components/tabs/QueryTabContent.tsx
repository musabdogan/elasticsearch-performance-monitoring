import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useMonitoring } from '@/context/MonitoringProvider';
import { DocumentSearchWorkspace } from '@/components/query/DocumentSearchWorkspace';
import { QueryDiscoverBar } from '@/components/query/QueryDiscoverBar';
import type { QueryPatternOption } from '@/components/query/QueryIndexPatternPicker';
import { QueryAdvancedEditor, QueryRequestPreview } from '@/components/query/QueryAdvancedEditor';
import { useDocumentSearch } from '@/hooks/useDocumentSearch';
import { useDocumentColumns } from '@/hooks/useDocumentColumns';
import { getDataStreams, getFieldUsageStats, getIndexDetails } from '@/services/elasticsearch';
import type { FieldUsageStatsResponse } from '@/types/api';
import { parseFieldUsageIndexDetailed, type FieldUsageSummary } from '@/utils/indexDetailHelpers';
import { readQueryState, writeQueryState } from '@/utils/queryPersistence';
import {
  ALL_INDICES_PATTERN,
  buildSearchCurl,
  extractSimpleQueryFromBody,
  normalizeQueryIndexPattern,
  simpleBodyToAdvancedJson,
  type QueryMode
} from '@/utils/querySearch';
import { shouldShowIndexColumn } from '@/utils/indexDataTable';
import { sortIndexNamesDotLast } from '@/utils/indexNameSort';

function isConcreteIndexPattern(pattern: string): boolean {
  const p = pattern.trim();
  if (!p || p === '*' || p === '_all') return false;
  return !/[*,?]/.test(p) && !p.includes(',');
}

function columnScopeKey(clusterLabel: string, indexPattern: string): string {
  return `${clusterLabel}:${indexPattern}`;
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
  const [indexPattern, setIndexPattern] = useState(ALL_INDICES_PATTERN);
  const [mode, setMode] = useState<QueryMode>('simple');
  const [hydrated, setHydrated] = useState(false);
  const [fieldUsageSummary, setFieldUsageSummary] = useState<FieldUsageSummary | null>(null);
  const persistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!clusterLabel) return;
    const saved = readQueryState(clusterLabel);
    setIndexPattern(normalizeQueryIndexPattern(saved?.indexPattern ?? ''));
    if (saved?.mode) setMode(saved.mode);
    setHydrated(true);
  }, [clusterLabel]);

  useEffect(() => {
    if (!activeCluster) {
      setDataStreamNames([]);
      return;
    }
    const controller = new AbortController();
    getDataStreams(activeCluster, controller.signal)
      .then((res) => {
        const names = (res.data_streams ?? [])
          .map((ds) => ds.name)
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        setDataStreamNames(names);
      })
      .catch(() => setDataStreamNames([]));
    return () => controller.abort();
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

  useEffect(() => {
    if (prefillIndex?.trim()) {
      setIndexPattern(prefillIndex.trim());
      onPrefillConsumed?.();
    }
  }, [prefillIndex, onPrefillConsumed]);

  const savedState = clusterLabel && hydrated ? readQueryState(clusterLabel) : null;

  const search = useDocumentSearch(activeCluster, effectiveIndexPattern, hydrated, {
    mode,
    simpleQuery: savedState?.simpleQuery,
    advancedBody: savedState?.advancedBody,
    sort: savedState?.sort,
    initialFrom: savedState?.from,
    initialSize: savedState?.size,
    autoRun: hydrated
  });

  useEffect(() => {
    onRefreshStateChange?.(search.loading);
  }, [search.loading, onRefreshStateChange]);

  useEffect(() => {
    const onRefresh = () => search.refresh();
    window.addEventListener('refreshSearch', onRefresh);
    return () => window.removeEventListener('refreshSearch', onRefresh);
  }, [search.refresh]);

  useEffect(() => {
    if (!activeCluster || !isConcreteIndexPattern(effectiveIndexPattern)) {
      setFieldUsageSummary(null);
      return;
    }
    const controller = new AbortController();
    const idx = effectiveIndexPattern;
    Promise.all([
      getFieldUsageStats(activeCluster, idx, controller.signal).catch(() => null),
      getIndexDetails(activeCluster, idx, controller.signal).catch(() => null)
    ]).then(([usage, details]) => {
      const entry = details?.[idx] as { mappings?: { properties?: Record<string, unknown> } } | undefined;
      const mappings: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null =
        entry?.mappings ? { [idx]: { mappings: entry.mappings } } : null;
      setFieldUsageSummary(
        parseFieldUsageIndexDetailed(idx, usage as FieldUsageStatsResponse | null, mappings)
      );
    });
    return () => controller.abort();
  }, [activeCluster, effectiveIndexPattern]);

  const showIndexColumn = useMemo(
    () =>
      shouldShowIndexColumn(search.hits, effectiveIndexPattern) ||
      /[*?,]/.test(effectiveIndexPattern),
    [search.hits, effectiveIndexPattern]
  );

  const scopeKey = columnScopeKey(clusterLabel, effectiveIndexPattern);
  const columns = useDocumentColumns(scopeKey, search.hits, fieldUsageSummary, showIndexColumn);

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

  const handleIndexPatternChange = useCallback((value: string) => {
    setIndexPattern(normalizeQueryIndexPattern(value));
  }, []);

  const handleSearch = () => {
    void search.runSearch({ mode, from: 0 });
  };

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
            mode={mode}
            onModeChange={handleModeChange}
            query={search.query}
            onQueryChange={search.setQuery}
            onSearch={handleSearch}
            loading={search.loading}
          />

          <DocumentSearchWorkspace
              cluster={activeCluster}
              indexLabel={effectiveIndexPattern}
              displayIndexName={effectiveIndexPattern}
              hits={search.hits}
              from={search.from}
              queryKey={`${mode}:${search.query}:${search.advancedBody}:${search.from}`}
              total={search.total}
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
              setDropTargetIndex={columns.setDropTargetIndex}
              toggleColumn={columns.toggleColumn}
              removeColumn={columns.removeColumn}
              handleColumnDrop={columns.handleColumnDrop}
              handleDropAtEnd={columns.handleDropAtEnd}
              resetToDefault={columns.resetToDefault}
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
