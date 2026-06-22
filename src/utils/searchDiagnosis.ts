import type { CatThreadPoolRow } from '@/types/api';
import type {
  ActiveSearchesSummary,
  HotThreadDiagnosis,
  HotThreadPoolShare,
  HotThreadStackFamily,
  HotThreadsParseResult,
  IndexDiagnosisSignals,
  IndexSlowSearchReport,
  ParsedSearchTask,
  SearchTaskClassification,
  SearchTasksApiResponse,
  SearchWorkloadPattern,
  SlowSearchFactor,
  SlowSearchSeverity,
  ThreadPoolPoolMetric,
  ThreadPoolSummary
} from '@/types/diagnosis';

const PATTERN_LABELS: Record<SearchWorkloadPattern, string> = {
  SCRIPTED_METRIC_AGG: 'Script per document',
  LARGE_TERMS_FILTER: 'Huge terms filter',
  DEEP_PAGINATION: 'Deep pagination',
  OVERSIZED_TERMS_AGG: 'Heavy aggregation',
  SCROLL: 'Scroll export',
  UNKNOWN: 'Uncategorized'
};

const PATTERN_HINTS: Record<SearchWorkloadPattern, string> = {
  SCRIPTED_METRIC_AGG:
    'Painless runs on every matching document at query time — often much slower than built-in aggregations (discuss.elastic.co). Precompute with an ingest pipeline or at index time when the logic is fixed.',
  LARGE_TERMS_FILTER:
    'A long list of filter values forces many term lookups on each shard. Prefer one terms query, a lookup index, or fewer bool clauses instead of hundreds of should filters.',
  DEEP_PAGINATION:
    'High from + size sorts and discards every prior hit — memory scales with from+size and fails past the 10k window (discuss.elastic.co). Page forward with search_after and a point-in-time (PIT).',
  OVERSIZED_TERMS_AGG:
    'Large terms aggregations on high-cardinality fields allocate big bucket structures per shard. Lower size, use composite aggregation to page buckets, or pre-rollup metrics.',
  SCROLL:
    'Scroll keeps an open search context on the cluster — costly with many concurrent exports. Elastic recommends PIT + search_after instead of scroll for deep paging; clear scroll IDs when finished.',
  UNKNOWN: 'Open query details and share with your search team if latency stays high.'
};

export function getPatternLabel(pattern: SearchWorkloadPattern): string {
  return PATTERN_LABELS[pattern];
}

export function getPatternHint(pattern: SearchWorkloadPattern): string {
  return PATTERN_HINTS[pattern];
}

export function hasKnownSlowPattern(task: ParsedSearchTask): boolean {
  return task.pattern !== 'UNKNOWN';
}

/** Short tag label — only for classified slow-search patterns. */
export function describeActiveTaskIssue(task: ParsedSearchTask): string | null {
  if (task.pattern === 'UNKNOWN') return null;
  return getPatternLabel(task.pattern);
}

/** Actionable detail for tooltips and modals (discuss / Elastic docs informed). */
export function describeActiveTaskIssueDetail(task: ParsedSearchTask): string | null {
  if (task.pattern === 'UNKNOWN') return null;

  const { pattern, classification } = task;
  const hint = getPatternHint(pattern);

  switch (pattern) {
    case 'LARGE_TERMS_FILTER':
      return classification.termsListSize > 0
        ? `${hint} (${classification.termsListSize} filter values in this query.)`
        : hint;
    case 'DEEP_PAGINATION':
      return classification.fromOffset > 0
        ? `${hint} (from: ${classification.fromOffset.toLocaleString()}.)`
        : hint;
    case 'OVERSIZED_TERMS_AGG':
      return classification.aggMaxSize > 0
        ? `${hint} (largest terms size: ${classification.aggMaxSize.toLocaleString()}.)`
        : hint;
    default:
      return hint;
  }
}

/** Plain-language explanation of where search time is spent (no ES jargon). */
export function describeSearchBottleneck(
  queryPhasePercent: number | null,
  fetchPhasePercent: number | null
): string | null {
  if (queryPhasePercent == null) return null;
  if (queryPhasePercent > 85) {
    return 'Most time goes to matching filters and running aggregations — not loading document fields.';
  }
  if (fetchPhasePercent != null && fetchPhasePercent > 40) {
    return 'A large share of time is spent loading document fields after rows are matched.';
  }
  return 'Time is split between matching documents and loading their fields.';
}

export function describeShardSkew(skew: number | null): string | null {
  if (skew == null || skew <= 2.5) return null;
  return 'Some shards are much slower than others — data may be unevenly spread across shards.';
}

function parseIntSafe(value: string | undefined): number {
  const n = parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : 0;
}

function extractIndexFromDescription(description: string): string {
  const m = description.match(/indices\[([^\]]+)\]/);
  return m?.[1] ?? '—';
}

/** Physical indices from child shard descriptions, e.g. shardId[[recipient-2][7]]. */
function extractShardIndicesFromChildren(
  children?: Array<{ description?: string }>
): string[] {
  const indices = new Set<string>();
  for (const child of children ?? []) {
    const desc = child.description ?? '';
    for (const match of desc.matchAll(/shardId\[\[([^\]]+)\]/g)) {
      const name = match[1]?.trim();
      if (name) indices.add(name);
    }
  }
  return [...indices];
}

export function indexMatchNames(concreteIndex: string, aliases: string[] = []): string[] {
  const names = new Set<string>();
  const add = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (normalized) names.add(normalized);
  };
  add(concreteIndex);
  for (const alias of aliases) add(alias);
  return [...names];
}

/** True when a task targets or executes on any of the index names (concrete + aliases). */
export function taskTouchesIndex(
  task: ParsedSearchTask,
  concreteIndex: string,
  aliases: string[] = []
): boolean {
  const names = new Set(indexMatchNames(concreteIndex, aliases));
  if (names.has(task.index.toLowerCase())) return true;
  return task.shardIndices.some((shardIndex) => names.has(shardIndex.toLowerCase()));
}

function extractSourceJson(description: string): { raw: string; parsed: unknown } | null {
  const idx = description.indexOf('source[');
  if (idx < 0) return null;
  const start = idx + 'source['.length;
  if (description[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < description.length; i++) {
    const ch = description[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const raw = description.slice(start, i + 1);
        try {
          return { raw, parsed: JSON.parse(raw) };
        } catch {
          return { raw, parsed: null };
        }
      }
    }
  }
  return null;
}

function countBrandCodeTerms(text: string): number {
  const mustMatch = text.match(/"brandCode"\s*:\s*\[([^\]]*)\]/);
  if (mustMatch) {
    return (mustMatch[1].match(/"/g)?.length ?? 0) / 2;
  }
  const termsMatch = text.match(/"brandCode"\s*:\s*\{[^}]*"terms"\s*:\s*\{[^}]*\[([^\]]*)\]/);
  if (termsMatch) {
    return (termsMatch[1].match(/"/g)?.length ?? 0) / 2;
  }
  return 0;
}

/** Largest value list inside any `terms` filter in the query tree. */
function maxTermsFilterListSize(node: unknown): number {
  if (Array.isArray(node)) {
    return node.reduce((max, item) => Math.max(max, maxTermsFilterListSize(item)), 0);
  }
  if (!isPlainObject(node)) return 0;

  let max = 0;
  const terms = node.terms;
  if (isPlainObject(terms)) {
    for (const value of Object.values(terms)) {
      if (Array.isArray(value)) {
        max = Math.max(max, value.length);
      } else if (isPlainObject(value) && Array.isArray(value.values)) {
        max = Math.max(max, value.values.length);
      }
    }
  }

  for (const value of Object.values(node)) {
    if (value === terms) continue;
    max = Math.max(max, maxTermsFilterListSize(value));
  }
  return max;
}

function resolveTermsListSize(heuristicText: string, parsed: unknown): number {
  const fromText = countBrandCodeTerms(heuristicText);
  const fromQuery = isPlainObject(parsed) ? maxTermsFilterListSize(parsed.query ?? parsed) : 0;
  return Math.max(fromText, fromQuery);
}

/**
 * `from` + `size` pagination is only "deep" at high skip offsets.
 * `from: 40, size: 20` is page 3 — not a performance pattern.
 */
function isDeepPagination(fromOffset: number, pageSize: number, parsed?: unknown): boolean {
  if (fromOffset <= 0) return false;
  if (isPlainObject(parsed) && ('search_after' in parsed || 'searchAfter' in parsed)) {
    return false;
  }
  if (fromOffset >= 1000) return true;
  if (fromOffset + pageSize > 10000) return true;
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Max `size` inside aggs/aggregations only — not top-level hit count. */
function maxSizeInAggregationTree(node: unknown): number {
  if (Array.isArray(node)) {
    return node.reduce((max, item) => Math.max(max, maxSizeInAggregationTree(item)), 0);
  }
  if (!isPlainObject(node)) return 0;

  let max = 0;
  if (typeof node.size === 'number' && Number.isFinite(node.size)) {
    max = node.size;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'size') continue;
    max = Math.max(max, maxSizeInAggregationTree(value));
  }
  return max;
}

function analyzeParsedQuery(query: Record<string, unknown>): {
  hasAggregations: boolean;
  aggMaxSize: number;
  topLevelSize: number;
  fromOffset: number;
} {
  const aggs = query.aggs ?? query.aggregations;
  const hasAggregations = isPlainObject(aggs) || Array.isArray(aggs);
  return {
    hasAggregations,
    aggMaxSize: hasAggregations ? maxSizeInAggregationTree(aggs) : 0,
    topLevelSize: typeof query.size === 'number' && Number.isFinite(query.size) ? query.size : 0,
    fromOffset: typeof query.from === 'number' && Number.isFinite(query.from) ? query.from : 0
  };
}

function extractBalancedJsonBlock(text: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(openBraceIndex, i + 1);
    }
  }
  return '';
}

/** Text fallback: only count `size` inside aggs/aggregations JSON blocks. */
function maxTermsAggSizeFromText(text: string): number {
  if (!/"aggs"\s*:/.test(text) && !/"aggregations"\s*:/.test(text)) {
    return 0;
  }

  const source = extractSourceJson(text);
  if (source?.parsed && isPlainObject(source.parsed)) {
    return analyzeParsedQuery(source.parsed).aggMaxSize;
  }

  const markers = [/"aggs"\s*:\s*\{/, /"aggregations"\s*:\s*\{/];
  let max = 0;
  for (const marker of markers) {
    const match = text.match(marker);
    if (!match || match.index == null) continue;
    const braceIndex = text.indexOf('{', match.index);
    if (braceIndex < 0) continue;
    const block = extractBalancedJsonBlock(text, braceIndex);
    const sizes = [...block.matchAll(/"size"\s*:\s*(\d+)/g)].map((m) => parseInt(m[1], 10));
    if (sizes.length > 0) max = Math.max(max, ...sizes);
  }
  return max;
}

function extractFromOffset(text: string, parsed?: unknown): number {
  if (isPlainObject(parsed)) {
    return analyzeParsedQuery(parsed).fromOffset;
  }
  const m = text.match(/"from"\s*:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function queryTextForHeuristics(description: string, queryJson?: unknown): string {
  if (queryJson != null && typeof queryJson === 'object') {
    try {
      return JSON.stringify(queryJson);
    } catch {
      return description;
    }
  }
  return extractSourceJson(description)?.raw ?? description;
}

function detectScriptedMetric(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('scripted_metric') ||
    lower.includes('scriptedmetricaggregator') ||
    lower.includes('tacir_eposta') ||
    lower.includes('bireysel_eposta')
  );
}

export function classifySearchTask(description: string, queryJson?: unknown): SearchTaskClassification {
  const parsed =
    queryJson != null && typeof queryJson === 'object'
      ? queryJson
      : extractSourceJson(description)?.parsed;
  const heuristicText = queryTextForHeuristics(description, parsed);

  const termsListSize = resolveTermsListSize(heuristicText, parsed);
  const hasScriptedMetric = detectScriptedMetric(heuristicText);
  const fromOffset = extractFromOffset(description, parsed);

  let aggMaxSize = 0;
  let hasAggregations = false;
  let pageSize = 10;
  if (isPlainObject(parsed)) {
    const analyzed = analyzeParsedQuery(parsed);
    aggMaxSize = analyzed.aggMaxSize;
    hasAggregations = analyzed.hasAggregations;
    pageSize = analyzed.topLevelSize > 0 ? analyzed.topLevelSize : 10;
  } else {
    aggMaxSize = maxTermsAggSizeFromText(description);
    hasAggregations =
      /"aggs"\s*:/.test(description) || /"aggregations"\s*:/.test(description);
    const sizeMatch = description.match(/"size"\s*:\s*(\d+)/);
    if (sizeMatch) pageSize = parseInt(sizeMatch[1], 10) || 10;
  }

  const isScroll =
    description.toLowerCase().includes('scroll') ||
    description.toLowerCase().includes('search[phase/query/scroll]');

  const deepPagination = isDeepPagination(fromOffset, pageSize, parsed);

  let pattern: SearchWorkloadPattern = 'UNKNOWN';
  if (hasScriptedMetric) pattern = 'SCRIPTED_METRIC_AGG';
  else if (isScroll) pattern = 'SCROLL';
  else if (hasAggregations && aggMaxSize >= 1000) pattern = 'OVERSIZED_TERMS_AGG';
  else if (termsListSize >= 40) pattern = 'LARGE_TERMS_FILTER';
  else if (deepPagination) pattern = 'DEEP_PAGINATION';

  return { pattern, termsListSize, hasScriptedMetric, fromOffset, aggMaxSize };
}

const QUERY_CLAUSE_KEYS = new Set([
  'match',
  'match_phrase',
  'match_phrase_prefix',
  'match_bool_prefix',
  'term',
  'terms',
  'query_string',
  'multi_match',
  'simple_query_string',
  'wildcard',
  'prefix',
  'regexp',
  'fuzzy',
  'ids',
  'range',
  'bool',
  'dis_max',
  'constant_score',
  'function_score'
]);

function pushQuerySnippet(add: (value: string) => void, value: unknown): void {
  if (typeof value === 'boolean') return;
  if (typeof value === 'string' || typeof value === 'number') {
    add(String(value));
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return;
    if (value.length === 1) {
      pushQuerySnippet(add, value[0]);
      return;
    }
    const first = value[0];
    if (typeof first === 'string' || typeof first === 'number') {
      add(`${first} +${value.length - 1}`);
      return;
    }
    pushQuerySnippet(add, first);
    return;
  }
  if (isPlainObject(value) && typeof value.value !== 'undefined') {
    pushQuerySnippet(add, value.value);
    return;
  }
  if (isPlainObject(value) && typeof value.query === 'string') {
    add(value.query);
  }
}

function collectQuerySnippets(node: unknown, add: (value: string) => void, depth = 0): void {
  if (depth > 14) return;
  if (node == null) return;

  if (Array.isArray(node)) {
    for (const item of node) collectQuerySnippets(item, add, depth + 1);
    return;
  }

  if (!isPlainObject(node)) return;

  for (const [key, value] of Object.entries(node)) {
    if (key === 'aggs' || key === 'aggregations' || key === 'sort' || key === 'highlight') continue;

    if (QUERY_CLAUSE_KEYS.has(key)) {
      if (key === 'bool' && isPlainObject(value)) {
        for (const clause of ['must', 'filter', 'should', 'must_not'] as const) {
          if (value[clause]) collectQuerySnippets(value[clause], add, depth + 1);
        }
        continue;
      }

      if ((key === 'match' || key === 'match_phrase' || key === 'match_phrase_prefix') && isPlainObject(value)) {
        for (const fieldSpec of Object.values(value)) {
          pushQuerySnippet(add, fieldSpec);
        }
        continue;
      }

      if (key === 'term' || key === 'terms') {
        if (isPlainObject(value)) {
          for (const fieldValue of Object.values(value)) {
            pushQuerySnippet(add, fieldValue);
          }
        }
        continue;
      }

      if (
        (key === 'query_string' || key === 'multi_match' || key === 'simple_query_string') &&
        isPlainObject(value)
      ) {
        pushQuerySnippet(add, value.query);
        continue;
      }

      collectQuerySnippets(value, add, depth + 1);
      continue;
    }

    if (key === 'query' && typeof value === 'string') {
      add(value);
      continue;
    }

    if (key === 'value' && (typeof value === 'string' || typeof value === 'number')) {
      add(String(value));
      continue;
    }
  }
}

/** Short human-readable query text for tables (e.g. match query "e10ffa"). */
export function extractSearchQueryPreview(queryJson: unknown, queryRaw?: string): string | null {
  const seen = new Set<string>();
  const snippets: string[] = [];
  const add = (raw: string) => {
    const text = raw.trim();
    if (!text || text === 'true' || text === 'false' || text.length > 120 || seen.has(text)) return;
    seen.add(text);
    snippets.push(text);
  };

  let root: unknown = queryJson;
  if (isPlainObject(queryJson) && 'query' in queryJson) {
    root = queryJson.query;
  }
  collectQuerySnippets(root, add, 0);

  if (snippets.length === 0 && queryRaw) {
    const matches = [...queryRaw.matchAll(/"query"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
    for (const match of matches.slice(0, 3)) {
      add(match[1].replace(/\\"/g, '"'));
    }
  }

  if (snippets.length === 0) return null;
  const preview = snippets.slice(0, 2).join(', ');
  if (snippets.length > 2) return `${preview} +${snippets.length - 2}`;
  return preview;
}

export function parseTasksResponse(raw: SearchTasksApiResponse): ParsedSearchTask[] {
  const tasks = raw.tasks ?? {};
  const results: ParsedSearchTask[] = [];

  for (const [taskId, task] of Object.entries(tasks)) {
    const description = task.description ?? '';
    if (!description.includes('indices[')) continue;
    if (!(task.action ?? '').includes('search')) continue;

    const source = extractSourceJson(description);
    const classification = classifySearchTask(description, source?.parsed ?? undefined);
    const childQueryCount = Array.isArray(task.children)
      ? task.children.filter((c) => (c.action ?? '').includes('phase/query')).length
      : 0;

    results.push({
      taskId,
      nodeId: task.node ?? taskId.split(':')[0] ?? '',
      index: extractIndexFromDescription(description),
      shardIndices: extractShardIndicesFromChildren(task.children),
      runningSec: (task.running_time_in_nanos ?? 0) / 1e9,
      startTimeMs: task.start_time_in_millis,
      pattern: classification.pattern,
      classification,
      traceId: task.headers?.['trace.id'],
      queryJson: source?.parsed ?? undefined,
      queryRaw: source?.raw,
      childQueryCount,
      description
    });
  }

  return results.sort((a, b) => b.runningSec - a.runningSec);
}

export function filterTasksByIndex(
  tasks: ParsedSearchTask[],
  concreteIndex: string,
  aliases: string[] = []
): ParsedSearchTask[] {
  return tasks.filter((t) => taskTouchesIndex(t, concreteIndex, aliases));
}

export function summarizeActiveSearches(tasks: ParsedSearchTask[]): ActiveSearchesSummary {
  const byIndex: Record<string, number> = {};
  const byPattern = {} as Record<SearchWorkloadPattern, number>;
  const runtimes = tasks.map((t) => t.runningSec).sort((a, b) => a - b);

  for (const t of tasks) {
    byIndex[t.index] = (byIndex[t.index] ?? 0) + 1;
    byPattern[t.pattern] = (byPattern[t.pattern] ?? 0) + 1;
  }

  const p95Idx = runtimes.length > 0 ? Math.min(runtimes.length - 1, Math.floor(runtimes.length * 0.95)) : 0;

  return {
    total: tasks.length,
    byIndex,
    byPattern,
    p95RunningSec: runtimes[p95Idx] ?? 0,
    maxRunningSec: runtimes[runtimes.length - 1] ?? 0
  };
}

const STACK_SIGNATURES: Array<{ family: HotThreadStackFamily; re: RegExp }> = [
  { family: 'SEARCH_BKD_TERMS', re: /BKDReader\.intersect|PointInSetQuery/ },
  { family: 'SEARCH_SCRIPT_AGG', re: /ScriptedMetricAggregator|PainlessScript/ },
  { family: 'REFRESH_DOCVALUES', re: /InternalEngine\.refresh|Lucene80DocValuesConsumer/ },
  { family: 'MERGE', re: /SegmentMerger|IndexWriter\.merge/ },
  { family: 'TRANSPORT', re: /transport_worker|InboundHandler/ }
];

function detectStackFamilies(block: string): HotThreadStackFamily[] {
  const found: HotThreadStackFamily[] = [];
  for (const { family, re } of STACK_SIGNATURES) {
    if (re.test(block)) found.push(family);
  }
  return found.length > 0 ? found : ['UNKNOWN'];
}

export function parseHotThreadsText(text: string): HotThreadsParseResult {
  const blocks = text.split(/::: \{/);
  const byNode: HotThreadDiagnosis[] = [];
  const familyCounts = new Map<HotThreadStackFamily, number>();

  for (const block of blocks.slice(1)) {
    const headerEnd = block.indexOf('}');
    if (headerEnd < 0) continue;
    const header = block.slice(0, headerEnd);
    const nameParts = header.split('}{');
    const nodeName = nameParts.length >= 3 ? nameParts[2] : nameParts[0];
    const body = block.slice(headerEnd + 1);

    const threadPattern =
      /(\d+\.?\d*)%\s*\[cpu=(\d+\.?\d*)%[^\]]*\][^\n]*cpu usage by thread 'elasticsearch\[([^\]]+)\]\[([^\]]+)\]/g;
    let bestCpu = 0;
    let dominantPool = 'unknown';
    let bestBlock = '';

    let m: RegExpExecArray | null;
    while ((m = threadPattern.exec(body)) !== null) {
      const cpu = parseFloat(m[2]);
      if (cpu > bestCpu) {
        bestCpu = cpu;
        dominantPool = m[4];
        const start = Math.max(0, m.index - 50);
        bestBlock = body.slice(start, m.index + 2500);
      }
    }

    if (bestCpu <= 0) continue;

    const stackFamilies = detectStackFamilies(bestBlock);
    for (const f of stackFamilies) {
      familyCounts.set(f, (familyCounts.get(f) ?? 0) + 1);
    }

    byNode.push({
      nodeName,
      dominantPool,
      maxCpuPercent: bestCpu,
      stackFamilies
    });
  }

  byNode.sort((a, b) => b.maxCpuPercent - a.maxCpuPercent);

  let primaryStackFamily: HotThreadStackFamily = 'UNKNOWN';
  let maxCount = 0;
  for (const [family, count] of familyCounts) {
    if (count > maxCount) {
      maxCount = count;
      primaryStackFamily = family;
    }
  }

  return { byNode, primaryStackFamily };
}

export function summarizeThreadPool(rows: CatThreadPoolRow[], nodeName?: string): ThreadPoolSummary {
  const filtered = nodeName
    ? rows.filter((r) => (r.node_name ?? '').toLowerCase() === nodeName.toLowerCase())
    : rows;

  let searchActive = 0;
  let searchQueue = 0;
  let searchRejected = 0;
  let refreshActive = 0;
  let mergeActive = 0;
  const poolActive = new Map<string, number>();

  for (const row of filtered) {
    const name = row.name ?? '';
    const active = parseIntSafe(row.active);
    poolActive.set(name, (poolActive.get(name) ?? 0) + active);

    if (name === 'search') {
      searchActive += active;
      searchQueue += parseIntSafe(row.queue);
      searchRejected += parseIntSafe(row.rejected);
    } else if (name === 'refresh') {
      refreshActive += active;
    } else if (name.includes('merge')) {
      mergeActive += active;
    }
  }

  let dominantPool = 'search';
  let maxActive = 0;
  for (const [pool, active] of poolActive) {
    if (active > maxActive) {
      maxActive = active;
      dominantPool = pool;
    }
  }

  return {
    searchActive,
    searchQueue,
    searchRejected,
    refreshActive,
    mergeActive,
    dominantPool
  };
}

const KEY_THREAD_POOLS = [
  'search',
  'write',
  'refresh',
  'flush',
  'force_merge',
  'generic',
  'management',
  'get',
  'warmer',
  'snapshot'
] as const;

export const STACK_FAMILY_LABELS: Record<HotThreadStackFamily, string> = {
  SEARCH_BKD_TERMS: 'Search (BKD / terms)',
  SEARCH_SCRIPT_AGG: 'Scripted aggregation',
  REFRESH_DOCVALUES: 'Refresh / doc values',
  MERGE: 'Segment merge',
  TRANSPORT: 'Transport / coordination',
  UNKNOWN: 'Unclassified stack'
};

export function getStackFamilyLabel(family: HotThreadStackFamily): string {
  return STACK_FAMILY_LABELS[family];
}

export const THREAD_POOL_LABELS: Record<string, string> = {
  search: 'Search queries',
  write: 'Indexing writes',
  refresh: 'Segment refresh',
  flush: 'Disk flush',
  force_merge: 'Background merge',
  generic: 'General tasks',
  management: 'Cluster maintenance',
  get: 'Document fetch',
  warmer: 'Shard warming',
  snapshot: 'Snapshots'
};

export function getThreadPoolLabel(pool: string): string {
  return THREAD_POOL_LABELS[pool] ?? pool.replace(/_/g, ' ');
}

export function buildNodeThreadPoolMetrics(
  rows: CatThreadPoolRow[],
  nodeName: string
): ThreadPoolPoolMetric[] {
  const filtered = rows.filter(
    (r) => (r.node_name ?? '').toLowerCase() === nodeName.toLowerCase()
  );

  const metrics: ThreadPoolPoolMetric[] = [];
  for (const row of filtered) {
    const pool = row.name ?? '';
    if (!pool) continue;
    const active = parseIntSafe(row.active);
    const queue = parseIntSafe(row.queue);
    const rejected = parseIntSafe(row.rejected);
    const max = parseIntSafe(row.max);
    const utilizationPct = max > 0 ? Math.min(100, (active / max) * 100) : null;
    metrics.push({ pool, active, queue, rejected, max, utilizationPct });
  }

  const keyOrder = new Map(KEY_THREAD_POOLS.map((pool, index) => [pool, index]));
  return metrics.sort((a, b) => {
    const aKey = keyOrder.get(a.pool as (typeof KEY_THREAD_POOLS)[number]) ?? 99;
    const bKey = keyOrder.get(b.pool as (typeof KEY_THREAD_POOLS)[number]) ?? 99;
    if (aKey !== bKey) return aKey - bKey;
    return b.active + b.queue - (a.active + a.queue);
  });
}

const HOT_THREAD_REGEX =
  /(\d+\.?\d*)%\s*\[cpu=(\d+\.?\d*)%[^\]]*\][^\n]*cpu usage by thread 'elasticsearch\[([^\]]+)\]\[([^\]]+)\]/g;

export function parseHotThreadPoolShares(text: string, nodeName?: string): HotThreadPoolShare[] {
  const bodies: string[] = [];
  const blocks = text.split(/::: \{/);
  if (blocks.length > 1) {
    for (const block of blocks.slice(1)) {
      const headerEnd = block.indexOf('}');
      if (headerEnd < 0) continue;
      const header = block.slice(0, headerEnd);
      const nameParts = header.split('}{');
      const blockNodeName = nameParts.length >= 3 ? nameParts[2] : nameParts[0];
      if (nodeName && blockNodeName.toLowerCase() !== nodeName.toLowerCase()) continue;
      bodies.push(block.slice(headerEnd + 1));
    }
  } else {
    bodies.push(text);
  }

  const poolMax = new Map<string, number>();
  for (const body of bodies) {
    let match: RegExpExecArray | null;
    HOT_THREAD_REGEX.lastIndex = 0;
    while ((match = HOT_THREAD_REGEX.exec(body)) !== null) {
      const cpu = parseFloat(match[2]);
      const pool = match[4];
      poolMax.set(pool, Math.max(poolMax.get(pool) ?? 0, cpu));
    }
  }

  return [...poolMax.entries()]
    .map(([pool, cpuPercent]) => ({ pool, cpuPercent }))
    .sort((a, b) => b.cpuPercent - a.cpuPercent);
}

export function buildCpuWorkloadConclusion(input: {
  dominantPool: string;
  primaryStack: HotThreadStackFamily;
  searchQueue: number;
  searchRejected: number;
  hotThreadShares: HotThreadPoolShare[];
  poolMetrics: ThreadPoolPoolMetric[];
}): string {
  const { dominantPool, primaryStack, searchQueue, searchRejected, hotThreadShares, poolMetrics } =
    input;

  if (searchRejected > 0) {
    return `${searchRejected} search request(s) were dropped — this node cannot keep up with query load.`;
  }
  if (searchQueue > 0) {
    return `${searchQueue} search request(s) are waiting — queries are backing up on this node.`;
  }

  const searchPool = poolMetrics.find((p) => p.pool === 'search');
  if (searchPool && searchPool.active > 0 && dominantPool === 'search') {
    if (primaryStack === 'SEARCH_SCRIPT_AGG') {
      return 'This node is busy running searches with custom script calculations.';
    }
    if (primaryStack === 'SEARCH_BKD_TERMS') {
      return 'This node is busy running searches with heavy term or filter lookups.';
    }
    return 'This node is mainly busy running search queries.';
  }

  if (dominantPool === 'refresh' || primaryStack === 'REFRESH_DOCVALUES') {
    return 'This node is busy refreshing index segments (normal after writes or merges).';
  }
  if (dominantPool.includes('merge') || primaryStack === 'MERGE') {
    return 'This node is running background segment merges (usually follows heavy indexing).';
  }
  if (hotThreadShares.length === 0) {
    const cpu = searchPool?.active ?? 0;
    if (cpu === 0) {
      return 'No heavy workload detected right now — CPU looks normal for current traffic.';
    }
    return 'Workload is spread across routine background tasks.';
  }

  const topHot = hotThreadShares[0];
  if (topHot) {
    return `Most CPU time is in ${getThreadPoolLabel(topHot.pool).toLowerCase()} (${topHot.cpuPercent.toFixed(0)}% of sampled thread time).`;
  }

  return `Main activity: ${getThreadPoolLabel(dominantPool).toLowerCase()}.`;
}

export function computeShardLatencySkew(
  shardStats: Array<{ queryTotal: number; queryTimeMs: number }>
): number | null {
  const avgs = shardStats
    .filter((s) => s.queryTotal > 0)
    .map((s) => s.queryTimeMs / s.queryTotal);
  if (avgs.length < 2) return null;
  avgs.sort((a, b) => a - b);
  const median = avgs[Math.floor(avgs.length / 2)];
  const p95 = avgs[Math.min(avgs.length - 1, Math.floor(avgs.length * 0.95))];
  if (median <= 0) return null;
  return p95 / median;
}

export function buildIndexDiagnosisConclusion(signals: IndexDiagnosisSignals): string {
  const { dominantPattern, activeTaskCount, stats, searchLatencyFromPoll } = signals;

  if (dominantPattern === 'SCRIPTED_METRIC_AGG' && activeTaskCount > 0) {
    return `${activeTaskCount} running search${activeTaskCount > 1 ? 'es' : ''} use custom script calculations — often the main cause of slow searches on this index.`;
  }
  if (dominantPattern === 'LARGE_TERMS_FILTER' && activeTaskCount > 0) {
    return `${activeTaskCount} running search${activeTaskCount > 1 ? 'es' : ''} filter on a very long value list — this pattern is expensive at scale.`;
  }
  if (dominantPattern === 'OVERSIZED_TERMS_AGG' && activeTaskCount > 0) {
    return `Running searches request too many aggregation buckets at once — reduce bucket size or paginate aggregations.`;
  }
  if (dominantPattern === 'DEEP_PAGINATION' && activeTaskCount > 0) {
    return `Running searches skip deep into result pages — prefer search_after for large result sets.`;
  }

  const bottleneck = describeSearchBottleneck(stats.queryPhasePercent, stats.fetchPhasePercent);
  if (bottleneck && stats.queryPhasePercent != null && stats.queryPhasePercent > 85) {
    return bottleneck;
  }

  const skewNote = describeShardSkew(stats.shardLatencySkew);
  if (skewNote) return skewNote;

  if (searchLatencyFromPoll != null && searchLatencyFromPoll >= 200) {
    return `Searches on this index averaged about ${searchLatencyFromPoll.toFixed(0)} ms recently. Check active queries below while load is high.`;
  }
  if (activeTaskCount === 0) {
    return 'Nothing is running on this index right now. Slow averages may be from queries that already finished — refresh during peak traffic.';
  }
  return 'Several different search patterns are active — review the list below for the slowest ones.';
}

export function dominantPatternFromTasks(tasks: ParsedSearchTask[]): SearchWorkloadPattern | null {
  if (tasks.length === 0) return null;
  const counts = new Map<SearchWorkloadPattern, number>();
  for (const t of tasks) {
    counts.set(t.pattern, (counts.get(t.pattern) ?? 0) + 1);
  }
  let best: SearchWorkloadPattern | null = null;
  let max = 0;
  for (const [p, c] of counts) {
    if (c > max) {
      max = c;
      best = p;
    }
  }
  return best;
}

function latencySeverity(ms: number | null | undefined): SlowSearchSeverity {
  if (ms == null || !Number.isFinite(ms)) return 'ok';
  if (ms >= 500) return 'critical';
  if (ms >= 200) return 'slow';
  if (ms >= 100) return 'watch';
  return 'ok';
}

function worstSeverity(a: SlowSearchSeverity, b: SlowSearchSeverity): SlowSearchSeverity {
  const rank: Record<SlowSearchSeverity, number> = { ok: 0, watch: 1, slow: 2, critical: 3 };
  return rank[a] >= rank[b] ? a : b;
}

export function isActiveTaskSlow(task: ParsedSearchTask): boolean {
  return task.runningSec >= 0.5 || task.pattern !== 'UNKNOWN';
}

function shardAverageLatencies(
  shardStats: Array<{ queryTotal: number; queryTimeMs: number }>
): number[] {
  return shardStats
    .filter((s) => s.queryTotal > 0)
    .map((s) => s.queryTimeMs / s.queryTotal)
    .sort((a, b) => a - b);
}

export function buildIndexSlowSearchReport(input: {
  searchLatencyFromPoll?: number | null;
  queryPhasePercent: number | null;
  fetchPhasePercent: number | null;
  shardSkew: number | null;
  shardStats: Array<{ queryTotal: number; queryTimeMs: number }>;
  totalQueryTotal: number;
  totalQueryTimeMs: number;
  activeTasks: ParsedSearchTask[];
  topFields: string[];
  dominantPattern: SearchWorkloadPattern | null;
}): IndexSlowSearchReport {
  const {
    searchLatencyFromPoll,
    queryPhasePercent,
    fetchPhasePercent,
    shardSkew,
    shardStats,
    totalQueryTotal,
    totalQueryTimeMs,
    activeTasks,
    topFields,
    dominantPattern
  } = input;

  const avgSearchMs = totalQueryTotal > 0 ? totalQueryTimeMs / totalQueryTotal : null;
  const pollLatencyMs = searchLatencyFromPoll ?? null;
  const latencyMs = pollLatencyMs ?? avgSearchMs;
  let severity = latencySeverity(latencyMs);

  const shardAvgs = shardAverageLatencies(shardStats);
  const medianShardAvgMs =
    shardAvgs.length > 0 ? shardAvgs[Math.floor(shardAvgs.length / 2)] : null;
  const slowestShardAvgMs =
    shardAvgs.length > 0 ? shardAvgs[shardAvgs.length - 1] : null;

  const slowNow: SlowSearchFactor[] = [];
  const notTheProblem: SlowSearchFactor[] = [];

  const matchingPct = queryPhasePercent;
  const loadingDocsPct = fetchPhasePercent;

  if (matchingPct != null && matchingPct >= 70) {
    slowNow.push({
      title: 'Matching & aggregations',
      detail: `About ${matchingPct.toFixed(0)}% of search time is spent evaluating filters and aggregations — this is the main cost.`,
      severity: matchingPct >= 85 ? 'slow' : 'watch'
    });
    if (loadingDocsPct != null && loadingDocsPct <= 25) {
      notTheProblem.push({
        title: 'Loading document fields',
        detail: `Only ~${loadingDocsPct.toFixed(0)}% of time — fetching _source fields is not the bottleneck.`
      });
    }
  } else if (loadingDocsPct != null && loadingDocsPct >= 40) {
    slowNow.push({
      title: 'Loading document fields',
      detail: `About ${loadingDocsPct.toFixed(0)}% of time is spent loading fields after matching — reduce _source size or use docvalue_fields.`,
      severity: 'watch'
    });
  }

  if (latencyMs != null && latencyMs >= 100) {
    const source = pollLatencyMs != null ? 'index statistics table (recent poll)' : 'cumulative index stats';
    slowNow.push({
      title: `Average search time: ${latencyMs.toFixed(0)} ms`,
      detail: `From ${source}. Target is typically under 100 ms for interactive use.`,
      severity: latencySeverity(latencyMs)
    });
    severity = worstSeverity(severity, latencySeverity(latencyMs));
  } else if (latencyMs != null) {
    notTheProblem.push({
      title: 'Average search time',
      detail: `${latencyMs.toFixed(0)} ms — within a healthy range for interactive searches.`
    });
  }

  const slowTasks = activeTasks.filter(isActiveTaskSlow);
  const longestTask = activeTasks[0];
  if (longestTask) {
    const preview = extractSearchQueryPreview(longestTask.queryJson, longestTask.queryRaw);
    const label = describeActiveTaskIssue(longestTask);
    const detailParts: string[] = [];
    if (label) detailParts.push(label);
    if (preview) detailParts.push(`query: ${preview}`);
    detailParts.push(`still executing on ${longestTask.childQueryCount || '?'} shard(s)`);
    slowNow.push({
      title: `Running now: ${formatTaskRuntime(longestTask.runningSec)}`,
      detail: detailParts.join(' · '),
      severity: longestTask.runningSec >= 5 ? 'critical' : longestTask.runningSec >= 1 ? 'slow' : 'watch'
    });
    if (longestTask.runningSec >= 1) {
      severity = worstSeverity(severity, longestTask.runningSec >= 5 ? 'critical' : 'slow');
    }
  } else if (activeTasks.length === 0 && latencyMs != null && latencyMs >= 100) {
    slowNow.push({
      title: 'No long-running query visible',
      detail: 'Slowness may come from many short queries that already finished, or from a burst when you were not watching.',
      severity: 'watch'
    });
  }

  if (dominantPattern && dominantPattern !== 'UNKNOWN' && activeTasks.length > 0) {
    slowNow.push({
      title: `Repeated pattern: ${getPatternLabel(dominantPattern)}`,
      detail: getPatternHint(dominantPattern),
      severity: 'watch'
    });
  }

  if (shardSkew != null && shardSkew > 2.5 && slowestShardAvgMs != null && medianShardAvgMs != null) {
    slowNow.push({
      title: 'Uneven shard speed',
      detail: `Slowest shard averages ${slowestShardAvgMs.toFixed(0)} ms vs median ${medianShardAvgMs.toFixed(0)} ms (${shardSkew.toFixed(1)}× skew) — data may be unevenly spread.`,
      severity: shardSkew > 4 ? 'slow' : 'watch'
    });
    severity = worstSeverity(severity, shardSkew > 4 ? 'slow' : 'watch');
  } else if (shardAvgs.length >= 2 && medianShardAvgMs != null) {
    notTheProblem.push({
      title: 'Shard balance',
      detail: `Shards perform similarly (median ${medianShardAvgMs.toFixed(0)} ms per search) — uneven shards are unlikely the cause.`
    });
  }

  if (topFields.length > 0 && matchingPct != null && matchingPct >= 70) {
    slowNow.push({
      title: 'Hot fields',
      detail: `Most queried: ${topFields.slice(0, 4).join(', ')}${topFields.length > 4 ? '…' : ''} — filters/aggregations on these drive matching cost.`,
      severity: 'watch'
    });
  }

  if (activeTasks.length === 0) {
    notTheProblem.push({
      title: 'Stuck queries',
      detail: 'Nothing is running on this index right now — no query is currently blocking the cluster.'
    });
  }

  if (slowTasks.length === 0 && activeTasks.length > 0) {
    notTheProblem.push({
      title: 'Long-running searches',
      detail: `${activeTasks.length} active but all under 500 ms — none look stuck yet.`
    });
  }

  if (matchingPct != null && matchingPct < 55 && loadingDocsPct != null && loadingDocsPct < 40) {
    notTheProblem.push({
      title: 'Clear matching vs fetch split',
      detail: 'Time is split between matching and loading — no single phase dominates in historical stats.'
    });
  }

  // Headline — first slow factor title or generic
  let headline = 'Search performance looks normal on this index.';
  if (slowNow.length > 0) {
    const primary = slowNow.find((f) => f.severity === 'critical' || f.severity === 'slow') ?? slowNow[0];
    headline = primary.title;
    if (primary.title === 'Matching & aggregations') {
      headline = 'Searches are slow because of filters & aggregations — not loading documents';
    } else if (primary.title.startsWith('Running now')) {
      headline = `A search is running now (${longestTask ? formatTaskRuntime(longestTask.runningSec) : ''}) — see details below`;
    } else if (primary.title.startsWith('Average search time')) {
      headline = `Searches on this index average ${latencyMs?.toFixed(0) ?? '?'} ms — above comfortable interactive speed`;
    }
  }

  return {
    headline,
    severity,
    slowNow: slowNow.slice(0, 5),
    notTheProblem: notTheProblem.slice(0, 4),
    matchingPct,
    loadingDocsPct,
    avgSearchMs,
    pollLatencyMs,
    shardSkew,
    slowestShardAvgMs,
    medianShardAvgMs,
    topFields,
    dominantPattern
  };
}

function formatTaskRuntime(sec: number): string {
  if (sec >= 60) return `${(sec / 60).toFixed(1)}m`;
  if (sec >= 1) return `${sec.toFixed(1)}s`;
  return `${(sec * 1000).toFixed(0)}ms`;
}
