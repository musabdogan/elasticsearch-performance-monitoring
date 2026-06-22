import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useMonitoring } from '@/context/MonitoringProvider';
import { getSearchTasks } from '@/services/elasticsearch';
import type { DiagnosisNavigation } from '@/types/diagnosis';
import type { ParsedSearchTask } from '@/types/diagnosis';
import { DataTable } from '@/components/data/DataTable';
import Pagination from '@/components/data/Pagination';
import { InfoPopup } from '@/components/ui/InfoPopup';
import { TabSectionExpandTrigger } from '@/components/ui/TabSectionExpandTrigger';
import { getNetworkErrorMessage } from '@/services/elasticsearch';
import {
  getPatternLabel,
  extractSearchQueryPreview,
  parseTasksResponse,
  summarizeActiveSearches
} from '@/utils/searchDiagnosis';
import { RefreshCw, Search, X, Copy, Check } from 'lucide-react';
import { matchesParsedTermsInAnyText, parseSearchTerms } from '@/utils/search';

function HeaderCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
      {count} active
    </span>
  );
}

function formatRuntime(sec: number): string {
  if (sec >= 60) return `${(sec / 60).toFixed(1)}m`;
  if (sec >= 1) return `${sec.toFixed(1)}s`;
  return `${(sec * 1000).toFixed(0)}ms`;
}

function patternBadgeClass(pattern: ParsedSearchTask['pattern']): string {
  if (pattern === 'SCRIPTED_METRIC_AGG') return 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200';
  if (pattern === 'LARGE_TERMS_FILTER' || pattern === 'OVERSIZED_TERMS_AGG') {
    return 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200';
  }
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
}

export interface ActiveSearchesSectionProps {
  diagnosisNav?: DiagnosisNavigation | null;
  onDiagnosisNavConsumed?: () => void;
  onOpenIndexDiagnosis?: (indexName: string) => void;
}

export function ActiveSearchesSection({
  diagnosisNav,
  onDiagnosisNavConsumed,
  onOpenIndexDiagnosis
}: ActiveSearchesSectionProps) {
  const { activeCluster, isClusterUnreachable } = useMonitoring();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ParsedSearchTask[]>([]);
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [indexFilter, setIndexFilter] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<ParsedSearchTask | null>(null);
  const [copied, setCopied] = useState(false);
  const fetchedOnExpandRef = useRef(false);

  const fetchTasks = useCallback(async () => {
    if (!activeCluster || isClusterUnreachable) return;
    setLoading(true);
    setError(null);
    try {
      const raw = await getSearchTasks(activeCluster);
      const parsed = parseTasksResponse(raw);
      setTasks(parsed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load active searches';
      const isTimeoutOrNetwork = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
      setError(isTimeoutOrNetwork ? getNetworkErrorMessage(activeCluster.baseUrl) : msg);
    } finally {
      setLoading(false);
    }
  }, [activeCluster, isClusterUnreachable]);

  useEffect(() => {
    if (!diagnosisNav?.indicesSection || diagnosisNav.indicesSection !== 'activeSearches') return;
    setExpanded(true);
    if (diagnosisNav.activeSearchesIndexFilter) {
      setIndexFilter(diagnosisNav.activeSearchesIndexFilter);
    }
    void fetchTasks();
    onDiagnosisNavConsumed?.();
  }, [diagnosisNav, fetchTasks, onDiagnosisNavConsumed]);

  useEffect(() => {
    if (!expanded || fetchedOnExpandRef.current) return;
    fetchedOnExpandRef.current = true;
    void fetchTasks();
  }, [expanded, fetchTasks]);

  useEffect(() => {
    const onRefreshCluster = () => {
      if (!expanded) return;
      void fetchTasks();
    };
    window.addEventListener('refreshIndices', onRefreshCluster);
    return () => window.removeEventListener('refreshIndices', onRefreshCluster);
  }, [expanded, fetchTasks]);

  useEffect(() => {
    fetchedOnExpandRef.current = false;
    setTasks([]);
    setExpanded(false);
    setSelectedTask(null);
    setIndexFilter('');
    setSearchText('');
    setPage(1);
  }, [activeCluster?.baseUrl]);

  const filtered = useMemo(() => {
    let list = tasks;
    if (indexFilter.trim()) {
      const idx = indexFilter.trim().toLowerCase();
      list = list.filter((t) => t.index.toLowerCase() === idx);
    }
    if (searchText.trim()) {
      const terms = parseSearchTerms(searchText);
      list = list.filter((t) =>
        matchesParsedTermsInAnyText(
          [t.taskId, t.index, t.pattern, getPatternLabel(t.pattern), t.traceId ?? ''],
          terms
        )
      );
    }
    return list;
  }, [tasks, indexFilter, searchText]);

  const pageData = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const summary = useMemo(() => summarizeActiveSearches(filtered), [filtered]);

  const queryDisplay = selectedTask?.queryJson
    ? JSON.stringify(selectedTask.queryJson, null, 2)
    : selectedTask?.queryRaw ?? selectedTask?.description ?? '';

  return (
    <>
      <section className="tab-section-card">
        <div className="tab-section-header tab-section-header-split">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TabSectionExpandTrigger
              expanded={expanded}
              onToggle={() => setExpanded((p) => !p)}
              label="Active searches"
              fillHitArea={true}
              suffix={
                <>
                  <InfoPopup
                    title="Active searches"
                    modalTitle="Active searches"
                    open={infoOpen}
                    onOpen={() => setInfoOpen(true)}
                    onClose={() => setInfoOpen(false)}
                  >
                    <p>
                      In-flight search tasks from{' '}
                      <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">
                        GET /_tasks?actions=*search*
                      </code>
                      . Loaded when you expand this section or reload the page — not polled automatically.
                    </p>
                  </InfoPopup>
                  {error ? (
                    <span className="text-xs max-w-[220px] truncate text-rose-600 dark:text-rose-400" title={error}>
                      Error
                    </span>
                  ) : loading ? (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <RefreshCw className="h-3 w-3 animate-spin shrink-0" aria-hidden />
                      Loading…
                    </span>
                  ) : (
                    <HeaderCount count={tasks.length} />
                  )}
                </>
              }
            />
          </div>
          {expanded && (
            <div className="tab-section-inline-tools flex-wrap">
              <div className="relative">
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search tasks…"
                  value={searchText}
                  onChange={(e) => {
                    setSearchText(e.target.value);
                    setPage(1);
                  }}
                  className="pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 w-32"
                />
                {searchText && (
                  <button
                    type="button"
                    onClick={() => setSearchText('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400"
                    aria-label="Clear"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                totalItems={filtered.length}
                pageSize={pageSize}
                onPageChange={setPage}
                inline
              />
              <select
                value={String(pageSize)}
                onChange={(e) => setPageSize(parseInt(e.target.value, 10) || 10)}
                className="text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 px-2 py-1"
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    Top {n}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {expanded && (
          <div className="tab-section-body">
            {error && (
              <div className="mx-2 mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30">
                {error}{' '}
                <button type="button" onClick={() => void fetchTasks()} className="underline">
                  Retry
                </button>
              </div>
            )}
            {!error && filtered.length > 0 && (
              <p className="px-3 pt-2 text-xs text-gray-500 dark:text-gray-400">
                Showing {filtered.length} tasks · p95 runtime {formatRuntime(summary.p95RunningSec)}
              </p>
            )}
            <div className="tab-section-scroll tab-section-scroll-flush">
              <DataTable
                data={pageData}
                columns={[
                  {
                    key: 'taskId',
                    header: 'Task ID',
                    sortable: false,
                    render: (r) => (
                      <button
                        type="button"
                        className="font-mono text-xs text-blue-700 dark:text-blue-300 hover:underline text-left truncate max-w-[140px] block"
                        title={r.taskId}
                        onClick={() => setSelectedTask(r)}
                      >
                        {r.taskId.split(':').pop() ?? r.taskId}
                      </button>
                    )
                  },
                  {
                    key: 'index',
                    header: 'Index',
                    render: (r) => (
                      <button
                        type="button"
                        className="text-xs hover:underline text-left"
                        onClick={() => onOpenIndexDiagnosis?.(r.index)}
                        disabled={r.index === '—'}
                      >
                        {r.index}
                      </button>
                    )
                  },
                  {
                    key: 'queryPreview',
                    header: 'Query',
                    render: (r) => {
                      const preview = extractSearchQueryPreview(r.queryJson, r.queryRaw);
                      return (
                        <span
                          className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate max-w-[160px] block"
                          title={preview ?? undefined}
                        >
                          {preview ?? '—'}
                        </span>
                      );
                    }
                  },
                  {
                    key: 'runningSec',
                    header: 'Runtime',
                    sortable: true,
                    align: 'right',
                    render: (r) => (
                      <span className="font-mono tab-content-value">{formatRuntime(r.runningSec)}</span>
                    )
                  },
                  {
                    key: 'pattern',
                    header: 'Pattern',
                    render: (r) => (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${patternBadgeClass(r.pattern)}`}>
                        {getPatternLabel(r.pattern)}
                      </span>
                    )
                  },
                  {
                    key: 'childQueryCount',
                    header: 'Query shards',
                    align: 'right',
                    render: (r) => (
                      <span className="font-mono tab-content-value">{r.childQueryCount || '—'}</span>
                    )
                  }
                ]}
                emptyMessage="No active search tasks match filters"
                dense
              />
            </div>
          </div>
        )}
      </section>

      {selectedTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
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
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Search task details</h3>
                <p className="text-xs font-mono text-gray-500 truncate mt-0.5">{selectedTask.taskId}</p>
              </div>
              <button type="button" onClick={() => setSelectedTask(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-500">Index</span>
                  <div className="font-mono">{selectedTask.index}</div>
                </div>
                <div>
                  <span className="text-gray-500">Runtime</span>
                  <div className="font-mono">{formatRuntime(selectedTask.runningSec)}</div>
                </div>
                <div>
                  <span className="text-gray-500">Pattern</span>
                  <div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${patternBadgeClass(selectedTask.pattern)}`}>
                      {getPatternLabel(selectedTask.pattern)}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">Query shards</span>
                  <div className="font-mono">{selectedTask.childQueryCount}</div>
                </div>
                {selectedTask.traceId && (
                  <div className="col-span-2">
                    <span className="text-gray-500">trace.id</span>
                    <div className="font-mono text-xs break-all">{selectedTask.traceId}</div>
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Query</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-blue-600"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(queryDisplay);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      } catch {
                        toast.error('Copy failed');
                      }
                    }}
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    Copy
                  </button>
                </div>
                <pre className="text-[11px] font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-2 overflow-x-auto max-h-64">
                  {queryDisplay}
                </pre>
              </div>
            </div>
            {onOpenIndexDiagnosis && selectedTask.index !== '—' && (
              <div className="border-t border-gray-200 dark:border-slate-700 px-4 py-3 flex justify-end gap-2">
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600"
                  onClick={() => {
                    onOpenIndexDiagnosis(selectedTask.index);
                    setSelectedTask(null);
                  }}
                >
                  Index diagnosis
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
