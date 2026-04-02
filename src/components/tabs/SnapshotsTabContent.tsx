import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMonitoring } from '@/context/MonitoringProvider';
import { getSnapshotRepositories, getSnapshotAll, getSnapshotAllFromAllRepos, getNetworkErrorMessage } from '@/services/elasticsearch';
import type { CatSnapshotRow, SnapshotFailure, SnapshotInfo } from '@/types/api';
import { DataTable } from '@/components/data/DataTable';
import Pagination from '@/components/data/Pagination';
import { InfoPopup } from '@/components/ui/InfoPopup';
import { RefreshCw, Search, X, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';

const MONITOR_SNAPSHOT_MESSAGE =
  'To view snapshots, use the built-in snapshot_user role for your monitoring user.';

const SNAPSHOT_KIBANA_SNIPPET = `POST _security/user/searchali_monitoring_user
{
  "password": "searchali_monitoring_password",
  "roles": ["remote_monitoring_collector", "snapshot_user"]
}`;

function getSnapshotCurlSnippet(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, '');
  return `curl -u elastic:YOUR_ELASTIC_PASSWORD -X POST "${base}/_security/user/searchali_monitoring_user" -H "Content-Type: application/json" -d'
{
  "password": "searchali_monitoring_password",
  "roles": ["remote_monitoring_collector", "snapshot_user"]
}'`;
}

function CodeBlockWithCopy({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };
  return (
    <div className="relative group">
      <pre className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 pr-10 text-xs font-mono whitespace-pre overflow-x-auto">
        {text}
      </pre>
      <button
        type="button"
        onClick={onCopy}
        title={copied ? 'Copied!' : `Copy ${label}`}
        className="absolute top-2 right-2 p-1.5 rounded text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 transition-colors"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

const TABLE_ID = 'snapshots';

type SortDirection = 'asc' | 'desc' | null;
type SnapshotSortKey = keyof CatSnapshotRow;

const NUMERIC_SNAPSHOT_KEYS: SnapshotSortKey[] = ['start_epoch', 'end_epoch', 'indices', 'data_streams', 'successful_shards', 'failed_shards', 'total_shards', 'remaining_shards'];

/** Normalize GET _snapshot/repo/_all snapshot entry to table row. */
function snapshotToRow(info: SnapshotInfo, repoName: string): CatSnapshotRow {
  const startEpoch = info.start_time ? String(Math.floor(new Date(info.start_time).getTime() / 1000)) : undefined;
  const endEpoch = info.end_time ? String(Math.floor(new Date(info.end_time).getTime() / 1000)) : undefined;
  let durationMs = info.duration_in_millis ?? 0;
  if (durationMs === 0 && info.start_time) {
    const startMs = new Date(info.start_time).getTime();
    if (Number.isFinite(startMs)) {
      durationMs = Math.max(0, Date.now() - startMs);
    }
  }
  const durationStr = formatDurationMsToHoursMinutes(durationMs);
  const indices = info.indices ?? [];
  const dataStreams = info.data_streams ?? [];
  const shards = info.shards;
  const policy = info.metadata?.policy;
  return {
    id: info.snapshot,
    policy: typeof policy === 'string' && policy.trim() ? policy.trim() : undefined,
    repository: repoName,
    status: info.state ?? '—',
    start_epoch: startEpoch,
    start_time: info.start_time,
    end_epoch: endEpoch,
    end_time: info.end_time,
    duration: durationStr,
    indices: String(indices.length),
    indicesList: indices.length > 0 ? indices : undefined,
    data_streams: String(dataStreams.length),
    dataStreamsList: dataStreams.length > 0 ? dataStreams : undefined,
    successful_shards: shards != null ? String(shards.successful) : undefined,
    failed_shards: shards != null ? String(shards.failed) : undefined,
    total_shards: shards != null ? String(shards.total) : undefined,
    remaining_shards:
      shards != null
        ? (() => {
            const t = Number(shards.total);
            const f = Number(shards.failed);
            const s = Number(shards.successful);
            if (!Number.isFinite(t) || !Number.isFinite(f) || !Number.isFinite(s)) return undefined;
            const rem = t - f - s;
            return rem >= 0 ? String(rem) : undefined;
          })()
        : undefined,
    failures: info.failures && Array.isArray(info.failures) ? (info.failures as SnapshotFailure[]) : undefined
  };
}

/** Format duration in ms as "X hours Y minutes" or "Y seconds" when under 1 minute. */
function formatDurationMsToHoursMinutes(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 60_000) {
    const sec = Math.round(ms / 1000);
    if (sec <= 0) return '0 seconds';
    return sec === 1 ? '1 second' : `${sec} seconds`;
  }
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hPart = hours === 1 ? '1 hour' : `${hours} hours`;
  const mPart = minutes === 1 ? '1 minute' : `${minutes} minutes`;
  if (hours === 0) return minutes === 0 ? '0 minutes' : mPart;
  if (minutes === 0) return hPart;
  return `${hPart} ${mPart}`;
}

/** Format epoch (seconds) as "Feb 18, 2026 12:52 PM GMT+3". Returns "—" when epoch is 0 or invalid. */
function formatSnapshotDateTime(epochSec: string | undefined): string {
  if (epochSec == null || epochSec === '') return '—';
  const sec = Number(epochSec);
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const d = new Date(sec * 1000);
  const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });
  return `${datePart} ${timePart}`;
}

/** Parse "X hours Y minutes" / "Y minutes" / "Y seconds" to total seconds for sorting. */
function parseDurationToSeconds(s: string | undefined): number | null {
  if (s == null || s === '') return null;
  const str = String(s).toLowerCase();
  let totalSec = 0;
  const hoursMatch = str.match(/(\d+)\s*hours?/);
  if (hoursMatch) totalSec += parseInt(hoursMatch[1], 10) * 3600;
  const minutesMatch = str.match(/(\d+)\s*minutes?/);
  if (minutesMatch) totalSec += parseInt(minutesMatch[1], 10) * 60;
  const secondsMatch = str.match(/(\d+)\s*seconds?/);
  if (secondsMatch) totalSec += parseInt(secondsMatch[1], 10);
  return totalSec > 0 || str.includes('0') ? totalSec : null;
}

function getSnapshotSortValue(r: CatSnapshotRow, key: SnapshotSortKey): string | number | null {
  const raw = r[key];
  if (raw == null || raw === '') return null;
  if (key === 'duration') {
    const sec = parseDurationToSeconds(typeof raw === 'string' ? raw : undefined);
    return sec != null ? sec : null;
  }
  if (NUMERIC_SNAPSHOT_KEYS.includes(key)) {
    const n = parseFloat(String(raw).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return String(raw).toLowerCase();
}

export function SnapshotsTabContent({ onRefreshStateChange }: { onRefreshStateChange?: (loading: boolean) => void } = {}) {
  const { activeCluster } = useMonitoring();
  const activeClusterRef = useRef(activeCluster);
  activeClusterRef.current = activeCluster;
  /** Stable key so effects/callbacks run only when cluster actually changes */
  const clusterKey = activeCluster?.baseUrl ?? activeCluster?.label ?? '';

  const [repoNames, setRepoNames] = useState<string[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [snapshots, setSnapshots] = useState<CatSnapshotRow[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [permissionHelpOpen, setPermissionHelpOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  /** One bar: snapshot metadata + per-snapshot index list */
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [openIndicesKey, setOpenIndicesKey] = useState<string | null>(null);
  const [indicesPopoverAnchor, setIndicesPopoverAnchor] = useState<{ top: number; right: number; bottom: number; left: number } | null>(null);
  const [openDataStreamsKey, setOpenDataStreamsKey] = useState<string | null>(null);
  const [dataStreamsPopoverAnchor, setDataStreamsPopoverAnchor] = useState<{ top: number; right: number; bottom: number; left: number } | null>(null);
  const [openFailuresKey, setOpenFailuresKey] = useState<string | null>(null);
  const [failuresPopoverAnchor, setFailuresPopoverAnchor] = useState<{ top: number; right: number; bottom: number; left: number } | null>(null);

  const snapshotCurlSnippet = useMemo(
    () => getSnapshotCurlSnippet(activeCluster?.baseUrl ?? 'https://your-cluster:9200'),
    [activeCluster?.baseUrl]
  );

  const fetchSnapshots = useCallback(async () => {
    const cluster = activeClusterRef.current;
    if (!cluster) return;
    setLoadingSnapshots(true);
    setError(null);
    setForbidden(false);
    const controller = new AbortController();
    const signal = controller.signal;
    try {
      const names = await getSnapshotRepositories(cluster, signal);
      setRepoNames(names.sort());
      setSelectedRepo((prev) => (names.includes(prev) ? prev : ''));
      if (names.length === 0) {
        setSnapshots([]);
        return;
      }
      let rows: CatSnapshotRow[] = [];
      try {
        const res = await getSnapshotAllFromAllRepos(cluster, signal);
        (res.snapshots ?? []).forEach((s) => rows.push(snapshotToRow(s, s.repository ?? '')));
      } catch {
        // Fallback: _snapshot/_all/_all not supported (OpenSearch, ES < 7.14) — fetch per repository
        const allResults = await Promise.all(names.map((repo) => getSnapshotAll(cluster, repo, signal)));
        allResults.forEach((res, i) => {
          const repoName = names[i];
          (res.snapshots ?? []).forEach((s) => rows.push(snapshotToRow(s, repoName)));
        });
      }
      rows.sort((a, b) => {
        const aE = Number(a.start_epoch) || 0;
        const bE = Number(b.start_epoch) || 0;
        return bE - aE;
      });
      setSnapshots(rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) {
        setForbidden(true);
        setError(MONITOR_SNAPSHOT_MESSAGE);
      } else {
        const isTimeoutOrNetwork = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
        setError(isTimeoutOrNetwork && cluster ? getNetworkErrorMessage(cluster.baseUrl) : (msg || 'Failed to load snapshots'));
      }
      setSnapshots([]);
      setRepoNames([]);
    } finally {
      setLoadingSnapshots(false);
    }
  }, [clusterKey]);

  // Single effect: when cluster changes, fetch snapshots once (one _cat/snapshots call)
  useEffect(() => {
    if (clusterKey) {
      setError(null);
      setSnapshots([]);
      setRepoNames([]);
      setForbidden(false);
      setSelectedRepo('');
      setSearchTerm('');
      setCurrentPage(1);
      fetchSnapshots();
    } else {
      setRepoNames([]);
      setSelectedRepo('');
      setSnapshots([]);
      setError(null);
      setForbidden(false);
    }
  }, [clusterKey, fetchSnapshots]);

  // Global Refresh button only refreshes this tab when on Snapshots (indexing/search APIs are not called)
  useEffect(() => {
    const onRefreshSnapshots = async () => {
      if (!activeCluster) return;
      onRefreshStateChange?.(true);
      try {
        await fetchSnapshots();
      } finally {
        onRefreshStateChange?.(false);
      }
    };
    window.addEventListener('refreshSnapshots', onRefreshSnapshots);
    return () => window.removeEventListener('refreshSnapshots', onRefreshSnapshots);
  }, [activeCluster, fetchSnapshots, onRefreshStateChange]);

  const getInitialSortState = useCallback((): { column: string; direction: SortDirection } => {
    try {
      const stored = localStorage.getItem(`datatable-sort-${TABLE_ID}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.column && (parsed.direction === 'asc' || parsed.direction === 'desc')) {
          return { column: parsed.column, direction: parsed.direction };
        }
      }
    } catch {
      // ignore
    }
    return { column: 'start_epoch', direction: 'desc' as SortDirection };
  }, []);

  const [sortState, setSortState] = useState<{ column: string; direction: SortDirection }>(() => getInitialSortState());
  const effectiveSortColumn = sortState.column || 'start_epoch';
  const effectiveSortDirection = sortState.direction ?? 'desc';

  const filteredByRepo = useMemo(() => {
    if (!selectedRepo) return snapshots;
    return snapshots.filter((s) => (s.repository ?? '') === selectedRepo);
  }, [snapshots, selectedRepo]);

  const filteredData = useMemo(() => {
    let data = filteredByRepo;
    const q = searchTerm.trim();
    if (!q) return data;
    const term = q.toLowerCase();
    return data.filter((s) => {
      const metaHit =
        (s.id ?? '').toLowerCase().includes(term) ||
        (s.repository ?? '').toLowerCase().includes(term) ||
        (s.status ?? '').toLowerCase().includes(term) ||
        (s.start_time ?? '').toLowerCase().includes(term) ||
        (s.end_time ?? '').toLowerCase().includes(term) ||
        (s.duration ?? '').toLowerCase().includes(term) ||
        (s.indices ?? '').toLowerCase().includes(term) ||
        (s.data_streams ?? '').toLowerCase().includes(term) ||
        (s.successful_shards ?? '').includes(term) ||
        (s.failed_shards ?? '').includes(term) ||
        (s.total_shards ?? '').includes(term) ||
        (s.remaining_shards ?? '').includes(term);
      const list = s.indicesList ?? [];
      const indexHit = list.some((idx) => idx.toLowerCase().includes(term));
      return metaHit || indexHit;
    });
  }, [filteredByRepo, searchTerm]);

  const sortedData = useMemo(() => {
    return [...filteredData].sort((a, b) => {
      const aVal = getSnapshotSortValue(a, effectiveSortColumn as SnapshotSortKey);
      const bVal = getSnapshotSortValue(b, effectiveSortColumn as SnapshotSortKey);
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = typeof aVal === 'number' && typeof bVal === 'number' ? aVal - bVal : String(aVal).localeCompare(String(bVal));
      return effectiveSortDirection === 'desc' ? -cmp : cmp;
    });
  }, [filteredData, effectiveSortColumn, effectiveSortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedData.length / Math.max(1, pageSize)));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, effectiveSortColumn, effectiveSortDirection, pageSize]);

  const paginatedData = useMemo(() => {
    const size = Math.max(1, pageSize);
    const start = (currentPage - 1) * size;
    return sortedData.slice(start, start + size);
  }, [sortedData, currentPage, pageSize]);

  const handleSortChange = useCallback((column: string | null, direction: SortDirection) => {
    setSortState({ column: column ?? 'start_epoch', direction: direction ?? 'desc' });
    try {
      localStorage.setItem(`datatable-sort-${TABLE_ID}`, JSON.stringify({ column: column ?? 'start_epoch', direction: direction ?? 'desc' }));
    } catch {
      // ignore
    }
  }, []);

  if (!activeCluster) {
    return (
      <div className="rounded-lg border border-gray-300 bg-white p-4 text-center text-sm text-gray-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400">
        No cluster selected.
      </div>
    );
  }

  if (loadingSnapshots && snapshots.length === 0 && repoNames.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-gray-300 bg-white p-8 dark:bg-gray-800 dark:border-gray-600">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (forbidden || (error && snapshots.length === 0)) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800/50 shadow-sm max-h-[85vh] min-h-0 flex flex-col overflow-hidden">
        <div className="p-4 text-sm text-gray-700 dark:text-gray-300 relative flex flex-col min-h-0 overflow-y-auto">
          {/* Expandable: Description (left) | Option A (center) | Option B (right) */}
          <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setPermissionHelpOpen((o) => !o)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              {permissionHelpOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              Insufficient permissions for Snapshots — How to add <code className="font-mono text-xs">snapshot_user</code> role?
            </button>
            {permissionHelpOpen && (
              <div className="px-3 pb-3 pt-1 border-t border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/30">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 dark:text-gray-100 mb-1.5">Description</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      To view snapshots, you can use the built-in <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded font-mono text-gray-800 dark:text-gray-200">snapshot_user</code> role for your monitoring user.
                    </p>
                    <a
                      href="https://www.elastic.co/docs/reference/elasticsearch/roles"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1.5 inline-block"
                    >
                      Official Documentation
                    </a>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 dark:text-gray-100 mb-1.5">Option A: Kibana Dev Tools</p>
                    <CodeBlockWithCopy text={SNAPSHOT_KIBANA_SNIPPET} label="Kibana snippet" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 dark:text-gray-100 mb-1.5">Option B: Terminal (cURL)</p>
                    <CodeBlockWithCopy text={snapshotCurlSnippet} label="curl commands" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && repoNames.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      )}

      {repoNames.length === 0 && !loadingSnapshots && (
        <div className="rounded-lg border border-gray-300 bg-white p-4 text-center text-sm text-gray-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400">
          No snapshot repositories found.
        </div>
      )}

      {repoNames.length > 0 && (
        <section className="tab-section-card">
          <div className="tab-section-header tab-section-header-split items-stretch">
            <div className="flex min-w-0 flex-wrap items-center gap-2 shrink-0 pr-2 border-r border-[var(--color-border)]">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Snapshots</h2>
              <InfoPopup title="Snapshots" modalTitle="Snapshots" open={infoOpen} onOpen={() => setInfoOpen(true)} onClose={() => setInfoOpen(false)}>
                <p>Snapshots are loaded in two steps: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET /_snapshot</code> (repositories), then <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET /_snapshot/_all/_all</code> (all snapshots from all repositories in one request). Compatible with Elasticsearch 7.14+. Requires <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">snapshot_user</code> or <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">monitor_snapshot</code> cluster privilege.</p>
              </InfoPopup>
              <span className="text-gray-600 dark:text-gray-400 font-normal">Repository:</span>
              <select
                value={selectedRepo}
                onChange={(e) => setSelectedRepo(e.target.value)}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="">All repositories</option>
                {repoNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="tab-section-inline-tools">
              <div className="relative min-w-[8rem] max-w-[14rem] flex-1 sm:flex-none sm:w-44">
                <Search className="absolute left-1.5 top-1/2 transform -translate-y-1/2 h-3 w-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search snapshot or index…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 tab-content-value"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-1.5 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={sortedData.length}
                pageSize={pageSize}
                onPageChange={setCurrentPage}
                inline
              />
              <select
                value={String(pageSize)}
                onChange={(e) => setPageSize(parseInt(e.target.value, 10) || 10)}
                className="text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 px-2 py-1"
                aria-label="Items per page"
              >
                {[10, 20, 100].map((n) => (
                  <option key={n} value={n}>
                    Top {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="tab-section-body">
          {loadingSnapshots && snapshots.length === 0 ? (
            <div className="flex justify-center p-6">
              <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="tab-section-scroll tab-section-scroll-flush">
                <DataTable<CatSnapshotRow>
                  tableId={TABLE_ID}
                  data={paginatedData}
                  controlledSort={{
                    sortColumn: sortState.column,
                    sortDirection: sortState.direction,
                    onSortChange: handleSortChange
                  }}
                  columns={[
                    {
                      key: 'id',
                      header: 'Snapshot',
                      render: (r) => (
                        <div className="flex flex-col gap-0">
                          <span className="font-mono tab-content-value">{r.id ?? '—'}</span>
                          {r.policy && (
                            <span className="text-[10px] text-gray-500 dark:text-gray-400 font-normal" title="Policy">{r.policy}</span>
                          )}
                        </div>
                      ),
                      sortable: true,
                      className: 'font-mono tab-content-value'
                    },
                    { key: 'repository', header: 'Repository', render: (r) => r.repository ?? '—', sortable: true, className: 'font-mono tab-content-value' },
                    { key: 'status', header: 'Status', render: (r) => r.status ?? '—', sortable: true, className: 'tab-content-value' },
                    { key: 'start_epoch', header: 'Start', render: (r) => formatSnapshotDateTime(r.start_epoch), sortable: true, className: 'tab-content-value' },
                    { key: 'end_epoch', header: 'End', render: (r) => (r.end_epoch != null && r.end_epoch !== '' && Number(r.end_epoch) > 0 ? formatSnapshotDateTime(r.end_epoch) : '—'), sortable: true, className: 'tab-content-value' },
                    { key: 'duration', header: 'Duration', render: (r) => r.duration ?? '—', sortable: true, className: 'tab-content-value' },
                    {
                      key: 'indices',
                      header: 'Indices',
                      render: (r) => {
                        const key = `${r.repository ?? ''}/${r.id ?? ''}`;
                        const count = r.indices ?? '0';
                        const isOpen = openIndicesKey === key;
                        return (
                          <div className="inline-block text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                if (isOpen) {
                                  setOpenIndicesKey(null);
                                  setIndicesPopoverAnchor(null);
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setOpenIndicesKey(key);
                                  setIndicesPopoverAnchor({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left });
                                }
                              }}
                              className="inline-flex items-center gap-0.5 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 tab-content-value font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                            >
                              {count} indices
                            </button>
                          </div>
                        );
                      },
                      sortable: true,
                      align: 'right',
                      className: 'tab-content-value'
                    },
                    {
                      key: 'data_streams',
                      header: 'Data streams',
                      render: (r) => {
                        const key = `${r.repository ?? ''}/${r.id ?? ''}`;
                        const count = r.data_streams ?? '0';
                        const isOpen = openDataStreamsKey === key;
                        return (
                          <div className="inline-block text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                if (isOpen) {
                                  setOpenDataStreamsKey(null);
                                  setDataStreamsPopoverAnchor(null);
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setOpenDataStreamsKey(key);
                                  setDataStreamsPopoverAnchor({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left });
                                }
                              }}
                              className="inline-flex items-center gap-0.5 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 tab-content-value font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                            >
                              {count} data streams
                            </button>
                          </div>
                        );
                      },
                      sortable: true,
                      align: 'right',
                      className: 'tab-content-value'
                    },
                    { key: 'successful_shards', header: 'Successful shards', render: (r) => r.successful_shards ?? '—', sortable: true, align: 'right', className: 'tab-content-value' },
                    {
                      key: 'failed_shards',
                      header: 'Failed shards',
                      render: (r) => {
                        const key = `${r.repository ?? ''}/${r.id ?? ''}`;
                        const count = r.failed_shards ?? '—';
                        const hasFailures = (r.failures?.length ?? 0) > 0;
                        const isOpen = openFailuresKey === key;
                        if (hasFailures) {
                          return (
                            <div className="inline-block text-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  if (isOpen) {
                                    setOpenFailuresKey(null);
                                    setFailuresPopoverAnchor(null);
                                  } else {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setOpenFailuresKey(key);
                                    setFailuresPopoverAnchor({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left });
                                  }
                                }}
                                className="inline-flex items-center gap-0.5 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 tab-content-value font-medium text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200 dark:hover:bg-red-900/50"
                              >
                                {count}
                              </button>
                            </div>
                          );
                        }
                        return <span className="tab-content-value">{count}</span>;
                      },
                      sortable: true,
                      align: 'right',
                      className: 'tab-content-value'
                    },
                    { key: 'remaining_shards', header: 'Remaining shards', render: (r) => r.remaining_shards ?? '—', sortable: true, align: 'right', className: 'tab-content-value' },
                    { key: 'total_shards', header: 'Total shards', render: (r) => r.total_shards ?? '—', sortable: true, align: 'right', className: 'tab-content-value' }
                  ]}
                  emptyMessage="No snapshots found"
                />
            </div>
          )}
          </div>
        </section>
      )}
      {openIndicesKey &&
        indicesPopoverAnchor &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[100]"
              aria-hidden
              onClick={() => {
                setOpenIndicesKey(null);
                setIndicesPopoverAnchor(null);
              }}
            />
            <div
              className="fixed z-[101] max-h-64 min-w-[12rem] overflow-y-auto rounded border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800"
              style={{
                top: indicesPopoverAnchor.bottom + 4,
                right: window.innerWidth - indicesPopoverAnchor.right,
                left: 'auto'
              }}
            >
              {(() => {
                const row = sortedData.find((r) => `${r.repository ?? ''}/${r.id ?? ''}` === openIndicesKey);
                const list = row?.indicesList ?? [];
                return list.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">No indices</p>
                ) : (
                  <ul className="text-left">
                    {list.map((idx) => (
                      <li key={idx} className="truncate px-2 py-0.5 font-mono text-xs text-gray-800 dark:text-gray-200">
                        {idx}
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          </>,
          document.body
        )}
      {openDataStreamsKey &&
        dataStreamsPopoverAnchor &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[100]"
              aria-hidden
              onClick={() => {
                setOpenDataStreamsKey(null);
                setDataStreamsPopoverAnchor(null);
              }}
            />
            <div
              className="fixed z-[101] max-h-64 min-w-[12rem] overflow-y-auto rounded border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800"
              style={{
                top: dataStreamsPopoverAnchor.bottom + 4,
                right: window.innerWidth - dataStreamsPopoverAnchor.right,
                left: 'auto'
              }}
            >
              {(() => {
                const row = sortedData.find((r) => `${r.repository ?? ''}/${r.id ?? ''}` === openDataStreamsKey);
                const list = row?.dataStreamsList ?? [];
                return list.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">No data streams</p>
                ) : (
                  <ul className="text-left">
                    {list.map((ds) => (
                      <li key={ds} className="truncate px-2 py-0.5 font-mono text-xs text-gray-800 dark:text-gray-200">
                        {ds}
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          </>,
          document.body
        )}
      {openFailuresKey &&
        failuresPopoverAnchor &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[100]"
              aria-hidden
              onClick={() => {
                setOpenFailuresKey(null);
                setFailuresPopoverAnchor(null);
              }}
            />
            <div
              className="fixed z-[101] max-h-80 min-w-[20rem] overflow-y-auto rounded border border-red-200 bg-white py-2 shadow-lg dark:border-red-900/50 dark:bg-gray-800 dark:border-red-800"
              style={{
                top: failuresPopoverAnchor.bottom + 4,
                right: window.innerWidth - failuresPopoverAnchor.right,
                left: 'auto'
              }}
            >
              {(() => {
                const row = sortedData.find((r) => `${r.repository ?? ''}/${r.id ?? ''}` === openFailuresKey);
                const failures = row?.failures ?? [];
                if (failures.length === 0) {
                  return <p className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">No failure details</p>;
                }
                return (
                  <div className="space-y-2 px-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Failures ({failures.length})</p>
                    <ul className="space-y-2 text-left">
                      {failures.map((f, i) => (
                        <li key={i} className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700/50">
                          {f.index != null && <div><span className="text-gray-500 dark:text-gray-400">Index:</span> <span className="font-mono">{String(f.index)}</span></div>}
                          {f.shard_id != null && <div><span className="text-gray-500 dark:text-gray-400">Shard:</span> {f.shard_id}</div>}
                          {f.reason != null && <div className="mt-0.5 text-red-700 dark:text-red-300">{String(f.reason)}</div>}
                          {f.node_id != null && <div className="mt-0.5 font-mono text-[11px] text-gray-600 dark:text-gray-400">Node: {String(f.node_id)}</div>}
                          {f.status != null && <div className="text-[11px] text-gray-500">Status: {String(f.status)}</div>}
                          {f.type != null && <div className="text-[11px] text-gray-500">Type: {String(f.type)}</div>}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
