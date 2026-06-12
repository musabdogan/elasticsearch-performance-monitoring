import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMonitoring } from '@/context/MonitoringProvider';
import { getSnapshotRepositories, getSnapshotAll, getSnapshotAllFromAllRepos, getSnapshotStatus, getNetworkErrorMessage } from '@/services/elasticsearch';
import type { CatSnapshotRow, SnapshotFailure, SnapshotInfo, SnapshotStatusEntry } from '@/types/api';
import { DataTable } from '@/components/data/DataTable';
import Pagination from '@/components/data/Pagination';
import { InfoPopup } from '@/components/ui/InfoPopup';
import { RefreshCw, Search, X, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { hasSearchTerms, matchesParsedTermsInAnyText, parseSearchTerms } from '@/utils/search';

const MONITOR_SNAPSHOT_MESSAGE =
  'To view snapshots, assign the built-in snapshot_user role to your Elasticsearch user.';

const SNAPSHOT_KIBANA_SNIPPET = `POST _security/user/your_user
{
  "password": "your_password",
  "roles": ["snapshot_user"]
}`;

function getSnapshotCurlSnippet(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, '');
  return `curl -u elastic:YOUR_ELASTIC_PASSWORD -X POST "${base}/_security/user/your_user" -H "Content-Type: application/json" -d'
{
  "password": "your_password",
  "roles": ["snapshot_user"]
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
const SNAPSHOT_DETAIL_POLL_MS = 10_000;
const SNAPSHOT_DETAIL_SLOW_HINT_DELAY_MS = 2_000;

type SortDirection = 'asc' | 'desc' | null;
type SnapshotSortKey = keyof CatSnapshotRow;

const NUMERIC_SNAPSHOT_KEYS: SnapshotSortKey[] = ['start_epoch', 'end_epoch', 'indices', 'data_streams', 'successful_shards', 'failed_shards', 'total_shards', 'remaining_shards'];

function isForbiddenError(message: string): boolean {
  const lower = message.toLowerCase();
  return message.includes('403') || lower.includes('forbidden');
}

function normalizeSnapshotStatus(status: string | undefined): string {
  const value = (status ?? '').trim().toUpperCase();
  return value || 'UNKNOWN';
}

function getSnapshotStatusPresentation(status: string | undefined): { label: string; className: string; isBadge: boolean } {
  const normalized = normalizeSnapshotStatus(status);
  if (normalized === 'SUCCESS') {
    // SUCCESS intentionally stays neutral.
    return {
      label: normalized,
      isBadge: false,
      className: 'tab-content-value font-medium text-gray-700 dark:text-gray-200'
    };
  }
  if (normalized === 'IN_PROGRESS' || normalized === 'STARTED') {
    return {
      label: normalized,
      isBadge: false,
      className: 'tab-content-value font-semibold text-blue-700 dark:text-blue-300'
    };
  }
  if (normalized === 'PARTIAL') {
    return {
      label: normalized,
      isBadge: false,
      className: 'tab-content-value font-semibold text-amber-700 dark:text-amber-300'
    };
  }
  if (normalized === 'FAILED' || normalized === 'FAILURE') {
    return {
      label: normalized,
      isBadge: false,
      className: 'tab-content-value font-semibold text-red-700 dark:text-red-300'
    };
  }
  if (normalized === 'ABORTED') {
    return {
      label: normalized,
      isBadge: false,
      className: 'tab-content-value font-semibold text-violet-700 dark:text-violet-300'
    };
  }
  if (normalized === 'INCOMPATIBLE') {
    return {
      label: normalized,
      isBadge: false,
      className: 'tab-content-value font-semibold text-gray-700 dark:text-gray-200'
    };
  }
  return {
    label: normalized,
    isBadge: false,
    className: 'tab-content-value font-semibold text-cyan-700 dark:text-cyan-300'
  };
}

function extractSnapshotFailedShards(detail: SnapshotStatusEntry): Array<{ index: string; shard: string; stage: string; reason: string }> {
  const out: Array<{ index: string; shard: string; stage: string; reason: string }> = [];
  const indices = detail.indices ?? {};
  Object.entries(indices).forEach(([indexName, indexEntry]) => {
    const shards = indexEntry?.shards ?? {};
    Object.entries(shards).forEach(([shardId, shard]) => {
      const stage = normalizeSnapshotStatus(shard?.stage);
      const reason = typeof shard?.reason === 'string' ? shard.reason.trim() : '';
      if (stage === 'FAILURE' || stage === 'FAILED' || reason.length > 0) {
        out.push({
          index: indexName,
          shard: shardId,
          stage,
          reason: reason || 'No reason returned by API.'
        });
      }
    });
  });
  return out;
}

type SnapshotIndexStatusRow = {
  index: string;
  status: string;
  done: number;
  failed: number;
  total: number;
  primaryReason: string | null;
};

function formatBytesToHumanReadable(bytes: number | undefined): string {
  if (!Number.isFinite(bytes)) return '—';
  const value = Number(bytes);
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const normalized = value / Math.pow(1024, power);
  if (power === 0) return `${Math.round(normalized)} ${units[power]}`;
  const text = normalized.toFixed(1).replace(/\.0$/, '');
  return `${text} ${units[power]}`;
}

function formatMillisDateTime(ms: number | undefined): string {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '—';
  const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });
  return `${datePart} ${timePart}`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatDurationMsHumanReadable(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 60_000) {
    const sec = Math.max(0, Math.round(value / 1000));
    return sec === 1 ? '1 second' : `${sec} seconds`;
  }
  const totalMinutes = Math.max(0, Math.round(value / 60_000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' ') : '0 minutes';
}

function getSnapshotCompletedStats(detail: SnapshotStatusEntry | null): {
  pct: number | null;
  processedBytes: number | null;
  totalBytes: number | null;
} {
  if (!detail) return { pct: null, processedBytes: null, totalBytes: null };
  const processedBytes = Number((detail as any)?.stats?.processed?.size_in_bytes ?? NaN);
  const incrementalBytes = Number((detail as any)?.stats?.incremental?.size_in_bytes ?? NaN);
  const totalBytes = Number((detail as any)?.stats?.total?.size_in_bytes ?? NaN);
  const denom = (Number.isFinite(incrementalBytes) && incrementalBytes > 0)
    ? incrementalBytes
    : (Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : NaN);

  // User expectation / ES behavior in some versions: processed.* may be missing for completed snapshots.
  // If processed is missing, treat the snapshot as completed (100%).
  // When we have a denominator (incremental or total), show processed as denom to render "X / X".
  if (!Number.isFinite(processedBytes)) {
    const denomValue = Number.isFinite(denom) && denom > 0 ? denom : null;
    return {
      pct: 100,
      processedBytes: denomValue,
      totalBytes: denomValue
    };
  }

  if (!Number.isFinite(denom) || denom <= 0) {
    return { pct: null, processedBytes, totalBytes: null };
  }
  const pct = clampPercent((processedBytes / denom) * 100);
  return { pct, processedBytes, totalBytes: denom };
}

function getSnapshotEstimatedRemaining(detail: SnapshotStatusEntry | null): {
  remainingMs: number | null;
  etaMs: number | null;
} {
  if (!detail) return { remainingMs: null, etaMs: null };
  const completed = getSnapshotCompletedStats(detail);
  const pct = completed.pct;
  const elapsedMs = Number((detail as any)?.stats?.time_in_millis ?? NaN);
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return { remainingMs: null, etaMs: null };
  if (pct == null || !Number.isFinite(pct) || pct <= 0 || pct >= 100) return { remainingMs: null, etaMs: null };

  const fraction = pct / 100;
  const remainingMs = Math.max(0, elapsedMs * (1 / fraction - 1));
  const etaMs = Date.now() + remainingMs;
  return { remainingMs, etaMs };
}

function buildSnapshotIndexRows(detail: SnapshotStatusEntry): SnapshotIndexStatusRow[] {
  const rows: SnapshotIndexStatusRow[] = [];
  const indices = detail.indices ?? {};
  Object.entries(indices).forEach(([indexName, indexEntry]) => {
    const shardMap = indexEntry?.shards ?? {};
    const shards = Object.values(shardMap);
    const doneFromStages = shards.filter((s) => normalizeSnapshotStatus(s?.stage) === 'DONE').length;
    const failedShards = shards.filter((s) => {
      const stage = normalizeSnapshotStatus(s?.stage);
      const reason = typeof s?.reason === 'string' ? s.reason.trim() : '';
      return stage === 'FAILURE' || stage === 'FAILED' || reason.length > 0;
    });
    const total = Number(indexEntry?.shards_stats?.total ?? shards.length ?? 0);
    const done = Number(indexEntry?.shards_stats?.done ?? doneFromStages);
    const failed = Number(indexEntry?.shards_stats?.failed ?? failedShards.length);

    let status = 'IN_PROGRESS';
    if (failed > 0 && done > 0) status = 'PARTIAL';
    else if (failed > 0) status = 'FAILED';
    else if (total > 0 && done >= total) status = 'SUCCESS';

    const firstReason = failedShards
      .map((s) => (typeof s.reason === 'string' ? s.reason.trim() : ''))
      .find((reason) => reason.length > 0);

    rows.push({
      index: indexName,
      status,
      done,
      failed,
      total,
      primaryReason: firstReason ?? null
    });
  });

  return rows.sort((a, b) => {
    if (b.failed !== a.failed) return b.failed - a.failed;
    if (a.failed > 0 && b.failed === 0) return -1;
    if (b.failed > 0 && a.failed === 0) return 1;
    return a.index.localeCompare(b.index);
  });
}

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

export function SnapshotsTabContent(
  {
    onRefreshStateChange,
    onOpenIndexDetails,
    onOpenNodeDetails,
    isIndexDetailModalOpen
  }: {
    onRefreshStateChange?: (loading: boolean) => void;
    onOpenIndexDetails?: (indexName: string) => void;
    onOpenNodeDetails?: (nodeName: string) => void;
    isIndexDetailModalOpen?: boolean;
  } = {}
) {
  const { activeCluster, isClusterUnreachable } = useMonitoring();
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
  const [snapshotDetailOpen, setSnapshotDetailOpen] = useState(false);
  const [snapshotDetailTarget, setSnapshotDetailTarget] = useState<{ repository: string; snapshot: string } | null>(null);
  const [snapshotDetailLoading, setSnapshotDetailLoading] = useState(false);
  const [snapshotDetailShowSlowHint, setSnapshotDetailShowSlowHint] = useState(false);
  const [snapshotDetailError, setSnapshotDetailError] = useState<string | null>(null);
  const [snapshotDetail, setSnapshotDetail] = useState<SnapshotStatusEntry | null>(null);
  const snapshotDetailBackdropMouseDownRef = useRef(false);
  const [snapshotGlobalStateInfoOpen, setSnapshotGlobalStateInfoOpen] = useState(false);
  const [snapshotIndexSearchTerm, setSnapshotIndexSearchTerm] = useState('');
  const snapshotStatusCacheRef = useRef<Record<string, SnapshotStatusEntry>>({});
  const snapshotDetailRequestKeyRef = useRef<string | null>(null);
  const snapshotDetailPollInFlightRef = useRef(false);
  const snapshotDetailPollAbortRef = useRef<AbortController | null>(null);

  const snapshotCurlSnippet = useMemo(
    () => getSnapshotCurlSnippet(activeCluster?.baseUrl ?? 'https://your-cluster:9200'),
    [activeCluster?.baseUrl]
  );
  const snapshotFailedShards = useMemo(
    () => (snapshotDetail ? extractSnapshotFailedShards(snapshotDetail) : []),
    [snapshotDetail]
  );
  const snapshotCompleted = useMemo(() => getSnapshotCompletedStats(snapshotDetail), [snapshotDetail]);
  const snapshotEta = useMemo(() => getSnapshotEstimatedRemaining(snapshotDetail), [snapshotDetail]);
  const snapshotIndexRows = useMemo(
    () => (snapshotDetail ? buildSnapshotIndexRows(snapshotDetail) : []),
    [snapshotDetail]
  );
  const filteredSnapshotIndexRows = useMemo(() => {
    const parsed = parseSearchTerms(snapshotIndexSearchTerm);
    if (!hasSearchTerms(parsed)) return snapshotIndexRows;
    return snapshotIndexRows.filter((row) => {
      return matchesParsedTermsInAnyText([row.index, row.primaryReason ?? ''], parsed);
    });
  }, [snapshotIndexRows, snapshotIndexSearchTerm]);

  const openSnapshotDetail = useCallback(async (row: CatSnapshotRow) => {
    const cluster = activeClusterRef.current;
    const repository = (row.repository ?? '').trim();
    const snapshot = (row.id ?? '').trim();
    if (!cluster || !repository || !snapshot) return;
    const cacheKey = `${repository}/${snapshot}`;
    setSnapshotDetailOpen(true);
    setSnapshotDetailTarget({ repository, snapshot });
    setSnapshotDetailError(null);
    setSnapshotIndexSearchTerm('');
    snapshotDetailRequestKeyRef.current = cacheKey;

    const cachedStatus = snapshotStatusCacheRef.current[cacheKey];
    const cachedProcessedBytes = Number((cachedStatus as any)?.stats?.processed?.size_in_bytes ?? NaN);
    // If cache was created before we started requesting snapshots.stats.processed.*, it won't have "processed" fields.
    // Treat that as a cache miss so we refetch and the Completed % can render.
    if (cachedStatus && Number.isFinite(cachedProcessedBytes)) {
      setSnapshotDetail(cachedStatus);
      setSnapshotDetailLoading(false);
      return;
    }

    setSnapshotDetailLoading(true);
    setSnapshotDetail(null);
    // Prevent the 10s poll from starting overlapping requests while initial load is in progress.
    snapshotDetailPollInFlightRef.current = true;
    let controller: AbortController | null = null;
    try {
      snapshotDetailPollAbortRef.current?.abort();
      controller = new AbortController();
      snapshotDetailPollAbortRef.current = controller;
      const res = await getSnapshotStatus(cluster, repository, snapshot, controller.signal);
      if (snapshotDetailRequestKeyRef.current !== cacheKey) return;
      const first = res.snapshots?.[0];
      if (!first) {
        setSnapshotDetailError('No detailed snapshot status returned by API.');
        setSnapshotDetail(null);
      } else {
        snapshotStatusCacheRef.current[cacheKey] = first;
        setSnapshotDetail(first);
      }
    } catch (e) {
      if (controller?.signal.aborted) return;
      if (snapshotDetailRequestKeyRef.current !== cacheKey) return;
      const msg = e instanceof Error ? e.message : '';
      const isTimeoutOrNetwork = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
      setSnapshotDetailError(isTimeoutOrNetwork ? getNetworkErrorMessage(cluster.baseUrl) : (msg || 'Failed to load snapshot detail'));
      setSnapshotDetail(null);
    } finally {
      if (snapshotDetailPollAbortRef.current === controller) {
        snapshotDetailPollAbortRef.current = null;
      }
      if (snapshotDetailRequestKeyRef.current === cacheKey) {
        setSnapshotDetailLoading(false);
      }
      snapshotDetailPollInFlightRef.current = false;
    }
  }, []);

  const closeSnapshotDetail = useCallback(() => {
    setSnapshotDetailOpen(false);
    snapshotDetailRequestKeyRef.current = null;
    setSnapshotDetailShowSlowHint(false);
    setSnapshotGlobalStateInfoOpen(false);
    setSnapshotIndexSearchTerm('');
  }, []);

  useEffect(() => {
    if (!snapshotDetailOpen || !snapshotDetailLoading) {
      setSnapshotDetailShowSlowHint(false);
      return;
    }
    const timerId = window.setTimeout(() => {
      setSnapshotDetailShowSlowHint(true);
    }, SNAPSHOT_DETAIL_SLOW_HINT_DELAY_MS);
    return () => window.clearTimeout(timerId);
  }, [snapshotDetailOpen, snapshotDetailLoading]);

  // Auto-refresh: while snapshot detail popup is open, re-fetch status every 10s.
  useEffect(() => {
    if (!snapshotDetailOpen || isClusterUnreachable) return;
    // Don't start the 10s polling loop until the initial detail request completes.
    if (snapshotDetailLoading) return;
    const cluster = activeClusterRef.current;
    const target = snapshotDetailTarget;
    if (!cluster || !target?.repository || !target?.snapshot) return;

    const cacheKey = `${target.repository}/${target.snapshot}`;

    const tick = async () => {
      if (!snapshotDetailOpen) return;
      if (snapshotDetailRequestKeyRef.current !== cacheKey) return;
      if (snapshotDetailPollInFlightRef.current) return;

      snapshotDetailPollInFlightRef.current = true;
      snapshotDetailPollAbortRef.current?.abort();
      const controller = new AbortController();
      snapshotDetailPollAbortRef.current = controller;
      try {
        const res = await getSnapshotStatus(cluster, target.repository, target.snapshot, controller.signal);
        if (snapshotDetailRequestKeyRef.current !== cacheKey) return;
        const first = res.snapshots?.[0];
        if (!first) return;
        snapshotStatusCacheRef.current[cacheKey] = first;
        setSnapshotDetail(first);
        setSnapshotDetailError(null);
      } catch (e) {
        if (controller.signal.aborted) return;
        if (snapshotDetailRequestKeyRef.current !== cacheKey) return;
        const msg = e instanceof Error ? e.message : '';
        const isTimeoutOrNetwork = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
        setSnapshotDetailError(isTimeoutOrNetwork ? getNetworkErrorMessage(cluster.baseUrl) : (msg || 'Failed to refresh snapshot detail'));
      } finally {
        if (snapshotDetailPollAbortRef.current === controller) {
          snapshotDetailPollAbortRef.current = null;
        }
        snapshotDetailPollInFlightRef.current = false;
      }
    };

    // Start polling after opening (avoid double-call: openSnapshotDetail already fetches immediately).
    const intervalId = window.setInterval(tick, SNAPSHOT_DETAIL_POLL_MS);
    return () => {
      window.clearInterval(intervalId);
      snapshotDetailPollAbortRef.current?.abort();
      snapshotDetailPollAbortRef.current = null;
      snapshotDetailPollInFlightRef.current = false;
    };
  }, [snapshotDetailOpen, snapshotDetailTarget, snapshotDetailLoading, clusterKey, isClusterUnreachable]);

  useEffect(() => {
    if (!snapshotDetailOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // When index detail modal is open, let its own Escape handler close first.
      if (isIndexDetailModalOpen) return;
      closeSnapshotDetail();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [snapshotDetailOpen, isIndexDetailModalOpen, closeSnapshotDetail]);

  const fetchSnapshots = useCallback(async () => {
    const cluster = activeClusterRef.current;
    if (!cluster || isClusterUnreachable) return;
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
        // Fallback: _snapshot/_all/_all not supported (OpenSearch, ES < 7.14) — fetch per repository.
        // Allow partial success so one forbidden/failed repo does not hide all snapshot data.
        const perRepoResults = await Promise.allSettled(names.map((repo) => getSnapshotAll(cluster, repo, signal)));
        const failedRepos: string[] = [];
        const failedMessages: string[] = [];

        perRepoResults.forEach((result, i) => {
          const repoName = names[i];
          if (result.status === 'fulfilled') {
            (result.value.snapshots ?? []).forEach((s) => rows.push(snapshotToRow(s, repoName)));
            return;
          }
          failedRepos.push(repoName);
          const reason = result.reason instanceof Error ? result.reason.message : String(result.reason ?? '');
          failedMessages.push(reason);
        });

        if (rows.length > 0) {
          setForbidden(false);
          if (failedRepos.length > 0) {
            setError(`Some snapshot repositories could not be read (${failedRepos.join(', ')}). Showing available data.`);
          } else {
            setError(null);
          }
        } else if (failedMessages.length > 0) {
          throw new Error(failedMessages[0]);
        }
      }
      rows.sort((a, b) => {
        const aE = Number(a.start_epoch) || 0;
        const bE = Number(b.start_epoch) || 0;
        return bE - aE;
      });
      setSnapshots(rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (isForbiddenError(msg)) {
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
  }, [clusterKey, isClusterUnreachable]);

  // Single effect: when cluster changes, fetch snapshots once (one _cat/snapshots call)
  useEffect(() => {
    if (clusterKey && !isClusterUnreachable) {
      setError(null);
      setSnapshots([]);
      setRepoNames([]);
      setForbidden(false);
      setSelectedRepo('');
      setSearchTerm('');
      setCurrentPage(1);
      setSnapshotDetailOpen(false);
      setSnapshotDetailTarget(null);
      setSnapshotDetail(null);
      setSnapshotDetailError(null);
      setSnapshotDetailLoading(false);
      setSnapshotGlobalStateInfoOpen(false);
      snapshotStatusCacheRef.current = {};
      snapshotDetailRequestKeyRef.current = null;
      fetchSnapshots();
    } else {
      setRepoNames([]);
      setSelectedRepo('');
      setSnapshots([]);
      setError(null);
      setForbidden(false);
      setSnapshotDetailOpen(false);
      setSnapshotDetailTarget(null);
      setSnapshotDetail(null);
      setSnapshotDetailError(null);
      setSnapshotDetailLoading(false);
      setSnapshotGlobalStateInfoOpen(false);
      snapshotStatusCacheRef.current = {};
      snapshotDetailRequestKeyRef.current = null;
    }
  }, [clusterKey, fetchSnapshots, isClusterUnreachable]);

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
  }, [activeCluster, isClusterUnreachable, fetchSnapshots, onRefreshStateChange]);

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
    const parsed = parseSearchTerms(searchTerm);
    if (!hasSearchTerms(parsed)) return data;
    return data.filter((s) => {
      const list = s.indicesList ?? [];
      return matchesParsedTermsInAnyText(
        [
          s.id ?? '',
          s.repository ?? '',
          s.status ?? '',
          s.start_time ?? '',
          s.end_time ?? '',
          s.duration ?? '',
          s.indices ?? '',
          s.data_streams ?? '',
          String(s.successful_shards ?? ''),
          String(s.failed_shards ?? ''),
          String(s.total_shards ?? ''),
          String(s.remaining_shards ?? ''),
          ...list
        ],
        parsed
      );
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
                      To view snapshots, assign the built-in <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded font-mono text-gray-800 dark:text-gray-200">snapshot_user</code> role to your Elasticsearch user.
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
                <p className="mt-2">Click a snapshot name to load detailed shard status from <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET /_snapshot/{'{repo}'}/{'{snapshot}'}/_status</code>.</p>
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
                          {r.id && r.repository ? (
                            <button
                              type="button"
                              onClick={() => openSnapshotDetail(r)}
                              className="w-fit font-mono tab-content-value text-left entity-name-link"
                              title={`Show status details for ${r.id}`}
                            >
                              {r.id}
                            </button>
                          ) : (
                            <span className="font-mono tab-content-value">{r.id ?? '—'}</span>
                          )}
                          {r.policy && (
                            <span className="text-[10px] text-gray-500 dark:text-gray-400 font-normal" title="Policy">{r.policy}</span>
                          )}
                        </div>
                      ),
                      sortable: true,
                      className: 'font-mono tab-content-value'
                    },
                    {
                      key: 'repository',
                      header: 'Repository',
                      render: (r) => {
                        const repo = r.repository ?? '';
                        if (!repo) return '—';
                        return <span className="font-mono tab-content-value">{repo}</span>;
                      },
                      sortable: true,
                      className: 'font-mono tab-content-value'
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (r) => {
                        const statusUi = getSnapshotStatusPresentation(r.status);
                        if (!statusUi.isBadge) {
                          return <span className={statusUi.className}>{statusUi.label}</span>;
                        }
                        return <span className={statusUi.className}>{statusUi.label}</span>;
                      },
                      sortable: true,
                      className: 'tab-content-value'
                    },
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
                          {f.node_id != null && (
                            <div className="mt-0.5 font-mono text-[11px] text-gray-600 dark:text-gray-400">
                              Node:{' '}
                              {onOpenNodeDetails ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenNodeDetails(String(f.node_id))}
                                  className="entity-name-link"
                                  title={`Open node details for ${String(f.node_id)}`}
                                >
                                  {String(f.node_id)}
                                </button>
                              ) : (
                                String(f.node_id)
                              )}
                            </div>
                          )}
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
      {snapshotDetailOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-[1px]"
            onMouseDown={(e) => {
              snapshotDetailBackdropMouseDownRef.current = e.target === e.currentTarget;
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget && snapshotDetailBackdropMouseDownRef.current) {
                closeSnapshotDetail();
              }
              snapshotDetailBackdropMouseDownRef.current = false;
            }}
          >
            <div className="w-full max-w-3xl mx-4 max-h-[88vh] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Snapshot detail
                  </h3>
                  <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                    {snapshotDetailTarget ? `${snapshotDetailTarget.repository} / ${snapshotDetailTarget.snapshot}` : '—'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeSnapshotDetail}
                  className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                  aria-label="Close snapshot detail"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[calc(88vh-56px)] overflow-y-auto p-4 space-y-3">
                {!snapshotDetailLoading &&
                  !snapshotDetailError &&
                  snapshotDetail &&
                  (() => {
                    const state = normalizeSnapshotStatus(snapshotDetail.state);
                    const shouldShow = state !== 'SUCCESS' && state !== 'IN_PROGRESS' && state !== 'STARTED';
                    if (!shouldShow) return null;
                    const repo = snapshotDetailTarget?.repository ?? snapshotDetail.repository ?? '{repo}';
                    const baseUrl = (activeCluster?.baseUrl ?? 'https://your-cluster:9200').replace(/\/$/, '');
                    return (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
                        <p className="font-semibold">Note</p>
                        <p className="mt-1 text-amber-800 dark:text-amber-200/90">
                          If a snapshot or repository looks unhealthy, you can use this endpoint to verify the repository and inspect the underlying error details (run it with an admin user).
                        </p>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div>
                            <p className="text-[11px] font-medium text-amber-900 dark:text-amber-200 mb-1">Kibana Dev Tools</p>
                            <CodeBlockWithCopy label="verify request" text={`POST /_snapshot/${repo}/_verify`} />
                          </div>
                          <div>
                            <p className="text-[11px] font-medium text-amber-900 dark:text-amber-200 mb-1">Terminal (cURL)</p>
                            <CodeBlockWithCopy
                              label="verify curl"
                              text={`curl -u elastic:YOUR_ELASTIC_PASSWORD -X POST "${baseUrl}/_snapshot/${repo}/_verify"`}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                {snapshotDetailLoading && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 dark:border-gray-700 dark:bg-gray-900/30">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
                      {snapshotDetailShowSlowHint && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Loading snapshot details... It can take up to 30 seconds.
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {!snapshotDetailLoading && snapshotDetailError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-300">
                    {snapshotDetailError}
                  </div>
                )}
                {!snapshotDetailLoading && !snapshotDetailError && snapshotDetail && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30">
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">Repository</p>
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                          {snapshotDetailTarget?.repository ?? snapshotDetail.repository ?? '—'}
                        </p>
                      </div>
                      <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30">
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">State</p>
                        {(() => {
                          const ui = getSnapshotStatusPresentation(snapshotDetail.state);
                          return <span className={ui.className}>{ui.label}</span>;
                        })()}
                      </div>
                      <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30">
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">Include global state</p>
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {snapshotDetail.include_global_state === true ? 'Yes' : snapshotDetail.include_global_state === false ? 'No' : '—'}
                          </p>
                          <InfoPopup
                            title="Global state"
                            modalTitle="What is global state in snapshot?"
                            open={snapshotGlobalStateInfoOpen}
                            onOpen={() => setSnapshotGlobalStateInfoOpen(true)}
                            onClose={() => setSnapshotGlobalStateInfoOpen(false)}
                          >
                            <p>
                              Global state includes cluster-level metadata such as persistent settings, index templates, ingest pipelines,
                              and ILM/SLM-related metadata. Restoring it can change cluster-wide behavior beyond individual indices.
                            </p>
                          </InfoPopup>
                        </div>
                      </div>
                      <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30">
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">Shards</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {snapshotDetail.shards_stats?.done ?? 0} done / {snapshotDetail.shards_stats?.failed ?? 0} failed / {snapshotDetail.shards_stats?.total ?? 0} total
                        </p>
                      </div>
                      <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30">
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">Failed shard entries</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{snapshotFailedShards.length}</p>
                      </div>
                    </div>

                    <section className="rounded-lg border border-gray-200 dark:border-gray-700">
                      <div className="border-b border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200">
                        Snapshot stats
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-3">
                        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30">
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">Start time</p>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {formatMillisDateTime(snapshotDetail.stats?.start_time_in_millis)}
                          </p>
                        </div>
                        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30">
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">Duration</p>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {formatDurationMsToHoursMinutes(Number(snapshotDetail.stats?.time_in_millis ?? NaN))}
                          </p>
                        </div>
                        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30">
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">Completed</p>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {snapshotCompleted.pct == null ? '—' : `${snapshotCompleted.pct.toFixed(snapshotCompleted.pct < 10 ? 2 : 1)}%`}
                          </p>
                          <div className="mt-1 h-1.5 w-full rounded bg-gray-200 dark:bg-gray-700 overflow-hidden" aria-hidden>
                            <div
                              className="h-full bg-emerald-500 dark:bg-emerald-400"
                              style={{ width: `${snapshotCompleted.pct ?? 0}%` }}
                            />
                          </div>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                            {snapshotCompleted.processedBytes == null
                              ? 'Processed: —'
                              : `Processed: ${formatBytesToHumanReadable(snapshotCompleted.processedBytes)}`}
                            {snapshotCompleted.totalBytes == null
                              ? ''
                              : ` / ${formatBytesToHumanReadable(snapshotCompleted.totalBytes)}`}
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                            Remaining: {snapshotEta.remainingMs == null ? '—' : formatDurationMsHumanReadable(snapshotEta.remainingMs)}
                          </p>
                        </div>
                        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30">
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">Incremental size</p>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {formatBytesToHumanReadable(snapshotDetail.stats?.incremental?.size_in_bytes)}
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {(snapshotDetail.stats?.incremental?.file_count ?? 0).toLocaleString()} files
                          </p>
                        </div>
                        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30">
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">Total size</p>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {formatBytesToHumanReadable(snapshotDetail.stats?.total?.size_in_bytes)}
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {(snapshotDetail.stats?.total?.file_count ?? 0).toLocaleString()} files
                          </p>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-lg border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Indices</p>
                        <div className="relative w-full max-w-sm">
                          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            value={snapshotIndexSearchTerm}
                            onChange={(e) => setSnapshotIndexSearchTerm(e.target.value)}
                            placeholder="Search index or failure reason..."
                            className="w-full rounded border border-gray-300 bg-white py-1 pl-7 pr-7 text-xs text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                          />
                          {snapshotIndexSearchTerm && (
                            <button
                              type="button"
                              onClick={() => setSnapshotIndexSearchTerm('')}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                              aria-label="Clear index search"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="max-h-80 overflow-y-auto p-3">
                        {filteredSnapshotIndexRows.length === 0 ? (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {snapshotIndexSearchTerm
                              ? 'No indices match your search.'
                              : 'No index-level status details returned by the status endpoint.'}
                          </p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-gray-200 text-left text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                <th className="py-1.5 pr-2 font-medium">Index</th>
                                <th className="py-1.5 pr-2 font-medium">Status</th>
                                <th className="py-1.5 pr-2 font-medium text-right">Done</th>
                                <th className="py-1.5 pr-2 font-medium text-right">Failed</th>
                                <th className="py-1.5 pr-2 font-medium text-right">Total</th>
                                <th className="py-1.5 font-medium">Failure reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredSnapshotIndexRows.map((row) => {
                                const statusUi = getSnapshotStatusPresentation(row.status);
                                return (
                                  <tr
                                    key={row.index}
                                    className={`border-b border-gray-100 align-top dark:border-gray-800 ${row.failed > 0 ? 'bg-red-50/40 dark:bg-red-900/10' : ''}`}
                                  >
                                    <td className="py-1.5 pr-2 font-mono text-gray-800 dark:text-gray-200">
                                      {onOpenIndexDetails ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            onOpenIndexDetails(row.index);
                                          }}
                                          className="text-left entity-name-link"
                                          title={`Open index details for ${row.index}`}
                                        >
                                          {row.index}
                                        </button>
                                      ) : (
                                        row.index
                                      )}
                                    </td>
                                    <td className="py-1.5 pr-2"><span className={statusUi.className}>{statusUi.label}</span></td>
                                    <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{row.done}</td>
                                    <td className={`py-1.5 pr-2 text-right font-medium ${row.failed > 0 ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-300'}`}>{row.failed}</td>
                                    <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{row.total}</td>
                                    <td className="py-1.5 text-gray-600 dark:text-gray-400">
                                      {row.primaryReason ? (
                                        <span className="break-all">{row.primaryReason}</span>
                                      ) : (
                                        <span className="text-gray-400 dark:text-gray-500">—</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </section>
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
