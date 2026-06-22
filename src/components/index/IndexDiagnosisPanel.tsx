import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Ban, Check, Copy, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { useNestedEscapeClose } from '@/hooks/useNestedEscapeClose';
import {
  cancelSearchTask,
  getSearchTasks
} from '@/services/elasticsearch';
import type { ClusterConnection } from '@/types/app';
import type { ParsedSearchTask } from '@/types/diagnosis';
import { DataTable } from '@/components/data/DataTable';
import {
  describeActiveTaskIssue,
  describeActiveTaskIssueDetail,
  dominantPatternFromTasks,
  extractSearchQueryPreview,
  filterTasksByIndex,
  getPatternHint,
  getPatternLabel,
  hasKnownSlowPattern,
  parseTasksResponse
} from '@/utils/searchDiagnosis';

export interface IndexDiagnosisPanelProps {
  indexName: string;
  /** Alias names that resolve to this concrete index (e.g. recipients → recipient-2). */
  indexAliases?: string[];
  activeCluster: ClusterConnection;
  isClusterUnreachable: boolean;
  isActive: boolean;
}

const REFRESH_MAX_ATTEMPTS = 3;
const REFRESH_RETRY_DELAY_MS = 3000;

function sleepMs(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

const LATENCY_RED_THRESHOLD_SEC = 1;

function formatRuntime(sec: number): string {
  if (sec >= 60) return `${(sec / 60).toFixed(1)}m`;
  if (sec >= 1) return `${sec.toFixed(1)}s`;
  return `${(sec * 1000).toFixed(0)}ms`;
}

/** >1s red; <100ms and 100ms–1s both white (fast / acceptable). */
function latencyValueClass(sec: number): string {
  if (sec > LATENCY_RED_THRESHOLD_SEC) {
    return '!text-rose-600 dark:!text-rose-400 font-semibold';
  }
  return '!text-gray-900 dark:!text-gray-100';
}

function isRunningSearchSlow(sec: number): boolean {
  return sec > LATENCY_RED_THRESHOLD_SEC;
}

function KpiTile({
  label,
  value,
  sub,
  highlightRed
}: {
  label: string;
  value: string;
  sub?: string;
  highlightRed?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800/60">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          highlightRed
            ? 'text-rose-600 dark:text-rose-400'
            : 'text-gray-900 dark:text-gray-100'
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-gray-500 dark:text-gray-400">{sub}</div>}
    </div>
  );
}

export function IndexDiagnosisPanel({
  indexName,
  indexAliases = [],
  activeCluster,
  isClusterUnreachable,
  isActive
}: IndexDiagnosisPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ranOnce, setRanOnce] = useState(false);
  const [allTasks, setAllTasks] = useState<ParsedSearchTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<ParsedSearchTask | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const activeTasks = useMemo(
    () => filterTasksByIndex(allTasks, indexName, indexAliases),
    [allTasks, indexName, indexAliases]
  );

  const aliasHint =
    indexAliases.length > 0
      ? `alias${indexAliases.length > 1 ? 'es' : ''}: ${indexAliases.join(', ')}`
      : null;

  const runDiagnosis = useCallback(async () => {
    if (!activeCluster || isClusterUnreachable) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      for (let attempt = 1; attempt <= REFRESH_MAX_ATTEMPTS; attempt++) {
        if (controller.signal.aborted) return;

        const tasksRaw = await getSearchTasks(activeCluster, controller.signal);
        const parsed = parseTasksResponse(tasksRaw);
        setAllTasks(parsed);
        const indexTasks = filterTasksByIndex(parsed, indexName, indexAliases);
        setRanOnce(true);

        if (indexTasks.length > 0) break;
        if (attempt < REFRESH_MAX_ATTEMPTS) {
          await sleepMs(REFRESH_RETRY_DELAY_MS, controller.signal);
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Diagnosis failed');
    } finally {
      setLoading(false);
    }
  }, [activeCluster, isClusterUnreachable, indexName, indexAliases]);

  useEffect(() => {
    if (!isActive || ranOnce) return;
    void runDiagnosis();
  }, [isActive, ranOnce, runDiagnosis]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    setRanOnce(false);
    setAllTasks([]);
    setError(null);
    setSelectedTask(null);
  }, [indexName]);

  const dominantPattern = dominantPatternFromTasks(activeTasks);

  const sortedActiveTasks = useMemo(
    () => [...activeTasks].sort((a, b) => b.runningSec - a.runningSec),
    [activeTasks]
  );

  const slowSearchCount = useMemo(
    () => activeTasks.filter((t) => isRunningSearchSlow(t.runningSec)).length,
    [activeTasks]
  );

  const slowestTask = sortedActiveTasks[0] ?? null;

  const showWhatsSlowColumn = useMemo(
    () => activeTasks.some(hasKnownSlowPattern),
    [activeTasks]
  );

  const activeQueryColumns = useMemo((): Array<{
    key: string;
    header: string;
    align?: 'left' | 'center' | 'right';
    sortable?: boolean;
    render: (r: ParsedSearchTask) => ReactNode;
  }> => {
    const columns: Array<{
      key: string;
      header: string;
      align?: 'left' | 'center' | 'right';
      sortable?: boolean;
      render: (r: ParsedSearchTask) => ReactNode;
    }> = [
      {
        key: 'shardIndices',
        header: 'Index',
        render: (r: ParsedSearchTask) => (
          <span
            className="font-mono text-xs text-gray-800 dark:text-gray-200 truncate max-w-[120px] block"
            title={r.shardIndices.length ? r.shardIndices.join(', ') : r.index}
          >
            {r.shardIndices.length > 0 ? r.shardIndices.join(', ') : r.index}
          </span>
        )
      },
      {
        key: 'index',
        header: 'Alias',
        render: (r: ParsedSearchTask) => (
          <span
            className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate max-w-[120px] block"
            title={r.index}
          >
            {r.index}
          </span>
        )
      },
      {
        key: 'runningSec',
        header: 'Search latency',
        sortable: true,
        align: 'right',
        render: (r: ParsedSearchTask) => (
          <span className={`font-mono tab-content-value ${latencyValueClass(r.runningSec)}`}>
            {formatRuntime(r.runningSec)}
          </span>
        )
      }
    ];

    if (showWhatsSlowColumn) {
      columns.push({
        key: 'issue',
        header: "What's slow",
        render: (r: ParsedSearchTask) => {
          if (!hasKnownSlowPattern(r)) {
            return <span className="text-xs text-gray-400">—</span>;
          }
          const label = getPatternLabel(r.pattern);
          const detail = describeActiveTaskIssueDetail(r);
          return (
            <span
              className="inline-flex max-w-[160px] rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium leading-snug text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
              title={detail ?? undefined}
            >
              {label}
            </span>
          );
        }
      });
    }

    columns.push(
      {
        key: 'queryPreview',
        header: 'Query value',
        render: (r: ParsedSearchTask) => {
          const preview = extractSearchQueryPreview(r.queryJson, r.queryRaw);
          return (
            <span
              className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate max-w-[120px] block"
              title={preview ?? undefined}
            >
              {preview ?? '—'}
            </span>
          );
        }
      },
      {
        key: 'childQueryCount',
        header: 'Shards',
        align: 'right',
        render: (r: ParsedSearchTask) => (
          <span className="font-mono tab-content-value text-xs">{r.childQueryCount || '—'}</span>
        )
      },
      {
        key: 'taskId',
        header: '',
        align: 'right',
        render: (r: ParsedSearchTask) => (
          <button
            type="button"
            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
            onClick={() => setSelectedTask(r)}
          >
            View query
          </button>
        )
      }
    );

    return columns;
  }, [showWhatsSlowColumn]);

  const activeQueriesSection = (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/60">
        <div>
          <h4 className="text-xs font-semibold text-gray-900 dark:text-gray-100">
            Active queries on this index
          </h4>
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            Sorted by search latency — slowest first
            {aliasHint ? ` · includes queries via ${aliasHint}` : ''}
          </p>
        </div>
        {activeTasks.length === 0 ? (
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">None</span>
        ) : (
          <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
            {activeTasks.length} running
          </span>
        )}
      </div>

      {activeTasks.length === 0 ? (
        <div className="px-3 py-4 text-sm text-gray-600 dark:text-gray-400">
          Nothing running on <span className="font-mono">{indexName}</span>
          {aliasHint ? <> (including {aliasHint})</> : null} right now.
          Press Refresh while traffic is active to check again.
        </div>
      ) : (
        <DataTable
          data={sortedActiveTasks}
          columns={activeQueryColumns}
          emptyMessage="No active searches"
          dense
          defaultSortColumn="runningSec"
          defaultSortDirection="desc"
        />
      )}
    </div>
  );

  const queryDisplay = useMemo(() => {
    if (!selectedTask) return '';
    if (selectedTask.queryJson != null) {
      return JSON.stringify(selectedTask.queryJson, null, 2);
    }
    return selectedTask.queryRaw ?? selectedTask.description;
  }, [selectedTask]);

  const closeQueryDetails = useCallback(() => setSelectedTask(null), []);
  useNestedEscapeClose(selectedTask != null, closeQueryDetails);

  const handleCancelTask = async () => {
    if (!selectedTask || !activeCluster) return;
    if (!window.confirm('Cancel this search task? The client may see an error.')) return;
    setCancelling(true);
    try {
      await cancelSearchTask(activeCluster, selectedTask.taskId);
      toast.success('Task cancelled');
      setSelectedTask(null);
      void runDiagnosis();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            What&apos;s slowing searches?
          </h3>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            Running searches on this index — sorted by latency.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runDiagnosis()}
          disabled={loading || isClusterUnreachable}
          className="inline-flex shrink-0 items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30">
          {error}
        </div>
      )}

      {loading && !ranOnce && <p className="text-sm text-gray-500">Loading…</p>}

      {ranOnce && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <KpiTile
              label="Slowest search"
              value={slowestTask ? formatRuntime(slowestTask.runningSec) : '—'}
              sub={slowestTask ? 'longest running now' : 'none running'}
              highlightRed={slowestTask != null && isRunningSearchSlow(slowestTask.runningSec)}
            />
            <KpiTile
              label="Active searches"
              value={String(activeTasks.length)}
              sub="running now"
            />
            <KpiTile
              label="Slow searches"
              value={String(slowSearchCount)}
              sub={activeTasks.length > 0 ? `of ${activeTasks.length} running` : 'none running'}
            />
          </div>

          {activeQueriesSection}

          {dominantPattern && dominantPattern !== 'UNKNOWN' && activeTasks.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
              <span className="font-semibold">Fix to try: </span>
              {getPatternHint(dominantPattern)}
            </div>
          )}
        </>
      )}

      {selectedTask && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-3"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelectedTask(null);
          }}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900 flex flex-col"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-gray-200 px-4 py-3 dark:border-slate-700">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Query details</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {describeActiveTaskIssue(selectedTask) ? (
                    <>
                      {describeActiveTaskIssue(selectedTask)} ·{' '}
                    </>
                  ) : null}
                  search latency {formatRuntime(selectedTask.runningSec)}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedTask(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3 text-sm">
              {hasKnownSlowPattern(selectedTask) && (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {describeActiveTaskIssueDetail(selectedTask)}
                </p>
              )}
              {selectedTask.traceId && (
                <div className="text-xs">
                  <span className="text-gray-500">Trace ID: </span>
                  <span className="font-mono break-all">{selectedTask.traceId}</span>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Query JSON</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-blue-600"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(queryDisplay);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      } catch {
                        toast.error('Copy failed');
                      }
                    }}
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    Copy
                  </button>
                </div>
                <pre className="max-h-64 overflow-auto rounded bg-gray-100 p-2 text-[11px] dark:bg-gray-800">
                  {queryDisplay}
                </pre>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-slate-700">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/30 disabled:opacity-50"
                disabled={cancelling}
                onClick={() => void handleCancelTask()}
              >
                <Ban className="h-3.5 w-3.5" />
                Cancel search
              </button>
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600"
                onClick={() => setSelectedTask(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
