export type SearchWorkloadPattern =
  | 'SCRIPTED_METRIC_AGG'
  | 'LARGE_TERMS_FILTER'
  | 'DEEP_PAGINATION'
  | 'OVERSIZED_TERMS_AGG'
  | 'SCROLL'
  | 'UNKNOWN';

export type HotThreadStackFamily =
  | 'SEARCH_BKD_TERMS'
  | 'SEARCH_SCRIPT_AGG'
  | 'REFRESH_DOCVALUES'
  | 'MERGE'
  | 'TRANSPORT'
  | 'UNKNOWN';

export interface SearchTaskClassification {
  pattern: SearchWorkloadPattern;
  termsListSize: number;
  hasScriptedMetric: boolean;
  fromOffset: number;
  aggMaxSize: number;
}

export interface ParsedSearchTask {
  taskId: string;
  nodeId: string;
  /** Index or alias from the parent task (`indices[recipients]`). */
  index: string;
  /** Concrete indices from child shards (`shardId[[recipient-2][7]]`). */
  shardIndices: string[];
  runningSec: number;
  startTimeMs?: number;
  pattern: SearchWorkloadPattern;
  classification: SearchTaskClassification;
  traceId?: string;
  queryJson?: unknown;
  queryRaw?: string;
  childQueryCount: number;
  description: string;
}

export interface ActiveSearchesSummary {
  total: number;
  byIndex: Record<string, number>;
  byPattern: Record<SearchWorkloadPattern, number>;
  p95RunningSec: number;
  maxRunningSec: number;
}

export interface ThreadPoolSummary {
  searchActive: number;
  searchQueue: number;
  searchRejected: number;
  refreshActive: number;
  mergeActive: number;
  dominantPool: string;
}

/** Per-pool _cat/thread_pool row for a single node (charts). */
export interface ThreadPoolPoolMetric {
  pool: string;
  active: number;
  queue: number;
  rejected: number;
  max: number;
  utilizationPct: number | null;
}

/** Hot-thread CPU share by thread pool name. */
export interface HotThreadPoolShare {
  pool: string;
  cpuPercent: number;
}

export interface HotThreadDiagnosis {
  nodeName: string;
  dominantPool: string;
  maxCpuPercent: number;
  stackFamilies: HotThreadStackFamily[];
}

export interface HotThreadsParseResult {
  byNode: HotThreadDiagnosis[];
  primaryStackFamily: HotThreadStackFamily;
}

export interface IndexSearchStatsSignals {
  queryPhasePercent: number | null;
  fetchPhasePercent: number | null;
  shardLatencySkew: number | null;
  avgQueryMsPerOp: number | null;
}

export interface IndexDiagnosisSignals {
  searchLatencyFromPoll?: number | null;
  stats: IndexSearchStatsSignals;
  activeTaskCount: number;
  dominantPattern: SearchWorkloadPattern | null;
  topFields: string[];
  threadPool?: ThreadPoolSummary | null;
}

export interface IndexSearchDiagnosis {
  conclusion: string;
  signals: IndexDiagnosisSignals;
  activeTasks: ParsedSearchTask[];
  sampleQueryJson?: unknown;
}

export type SlowSearchSeverity = 'ok' | 'watch' | 'slow' | 'critical';

export interface SlowSearchFactor {
  title: string;
  detail: string;
  severity?: SlowSearchSeverity;
}

export interface IndexSlowSearchReport {
  headline: string;
  severity: SlowSearchSeverity;
  slowNow: SlowSearchFactor[];
  notTheProblem: SlowSearchFactor[];
  matchingPct: number | null;
  loadingDocsPct: number | null;
  avgSearchMs: number | null;
  pollLatencyMs: number | null;
  shardSkew: number | null;
  slowestShardAvgMs: number | null;
  medianShardAvgMs: number | null;
  topFields: string[];
  dominantPattern: SearchWorkloadPattern | null;
}

export type DiagnosisNavigation = {
  indicesSection?: 'activeSearches';
  activeSearchesIndexFilter?: string;
};

/** Raw _tasks API response shape (partial). */
export interface SearchTasksApiResponse {
  tasks?: Record<
    string,
    {
      node?: string;
      id?: number;
      action?: string;
      description?: string;
      start_time_in_millis?: number;
      running_time_in_nanos?: number;
      headers?: { 'trace.id'?: string };
      children?: Array<{
        action?: string;
        node?: string;
        description?: string;
      }>;
    }
  >;
}
