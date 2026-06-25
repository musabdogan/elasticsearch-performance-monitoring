import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMonitoring } from '@/context/MonitoringProvider';
import {
  getIndicesCatalog,
  getCatAliases,
  getIndexDetails,
  getIlmExplain,
  getFieldUsageStats,
  getCatShardsPlacement,
  getAllMappings,
  getDataStreams,
  getCatShardsBytes,
  getNodesRoles,
  getNetworkErrorMessage
} from '@/services/elasticsearch';
import type {
  CatIndexRow,
  CatAliasRow,
  CatShardRow,
  IlmExplainResponse,
  FieldUsageStatsResponse,
  DataStreamInfo,
  DataStreamsResponse
} from '@/types/api';
import type { OpenIndexDetailsFn } from '@/types/indexDetail';
import Pagination from '@/components/data/Pagination';
import { InfoPopup } from '@/components/ui/InfoPopup';
import { TabSectionExpandTrigger } from '@/components/ui/TabSectionExpandTrigger';
import { formatNumber } from '@/utils/format';
import {
  hasSearchTerms,
  matchesParsedTermsInAnyText,
  normalizeSearchText,
  parseSearchTerms
} from '@/utils/search';
import type { MappingsIndexEntry } from '@/utils/mappingFields';
import {
  buildIndexMetaCache,
  runRegexQuery,
  type IndexMatchResult,
  type MatchScope
} from '@/utils/regexQuery';
import {
  RefreshCw,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ArrowUp,
  ArrowDown,
  ArrowUpDown
} from 'lucide-react';
import type { DiagnosisNavigation } from '@/types/diagnosis';
import { ActiveSearchesSection } from '@/components/cluster/ActiveSearchesSection';

const INDICES_PERMISSION_MESSAGE =
  'To view the index catalog, ensure your user has monitor or view_index_metadata cluster privilege.';

/** Usage type labels derived from field_usage_stats API. Short labels for compact display. */
export const FIELD_USAGE_TYPE_LABELS: Record<string, string> = {
  search: 'Search',
  aggregation_sort: 'Sort & Agg',
  range_query: 'Range query',
  stored: 'Stored',
  scoring: 'Scoring',
  term_vectors: 'Term vectors',
  vector_search: 'Vector search'
};

/** Parsed field usage stats per index: totalFields, usedFields, unusedFields, mostUsedFieldName */
export interface FieldUsageSummary {
  totalFields: number;
  usedFields: number;
  unusedFields: number;
  mostUsedFieldName: string | null;
  /** List of fields with usage count and usage types, sorted by usage (desc), then name. */
  fieldList?: Array<{ name: string; usage: number; usageTypes: string[] }>;
  /** Names of unsearched fields (from mapping when available; else from fieldList where usage === 0). */
  unusedFieldNames?: string[];
  /** True when field_usage_stats API returned data. False for ES 7.15.0 and below, OpenSearch, or API errors. */
  hasUsageData: boolean;
}

/** Recursively count leaf fields in mapping properties. */
function countLeafFieldsFromMapping(props: Record<string, unknown> | undefined, prefix = ''): number {
  if (!props || typeof props !== 'object') return 0;
  let count = 0;
  for (const [key, value] of Object.entries(props)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (v.properties) {
      count += countLeafFieldsFromMapping(v.properties as Record<string, unknown>, fullPath);
    } else if (v.fields) {
      if (v.type) count += 1;
      const fields = v.fields as Record<string, unknown>;
      for (const [fk, fv] of Object.entries(fields)) {
        const f = fv as Record<string, unknown>;
        if (f?.properties) {
          count += countLeafFieldsFromMapping(f.properties as Record<string, unknown>, `${fullPath}.${fk}`);
        } else {
          count += 1;
        }
      }
    } else if (v.type) {
      count += 1;
    }
  }
  return count;
}

/** Recursively collect leaf field names (dotted paths) from mapping properties. */
function getLeafFieldNamesFromMapping(props: Record<string, unknown> | undefined, prefix = ''): string[] {
  if (!props || typeof props !== 'object') return [];
  const names: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (v.properties) {
      names.push(...getLeafFieldNamesFromMapping(v.properties as Record<string, unknown>, fullPath));
    } else if (v.fields) {
      if (v.type) names.push(fullPath);
      const fields = v.fields as Record<string, unknown>;
      for (const [fk, fv] of Object.entries(fields)) {
        const f = fv as Record<string, unknown>;
        if (f?.properties) {
          names.push(...getLeafFieldNamesFromMapping(f.properties as Record<string, unknown>, `${fullPath}.${fk}`));
        } else {
          names.push(`${fullPath}.${fk}`);
        }
      }
    } else if (v.type) {
      names.push(fullPath);
    }
  }
  return names;
}

function getFieldUsageTypes(data: Record<string, unknown>): string[] {
  const types: string[] = [];
  const inv = data.inverted_index as Record<string, unknown> | undefined;
  const terms = typeof inv?.terms === 'number' ? inv.terms : parseInt(String(inv?.terms ?? 0), 10) || 0;
  const postings = typeof inv?.postings === 'number' ? inv.postings : parseInt(String(inv?.postings ?? 0), 10) || 0;
  if (terms > 0 || postings > 0) types.push('search');
  const docValues = typeof data.doc_values === 'number' ? data.doc_values : parseInt(String(data.doc_values ?? 0), 10) || 0;
  if (docValues > 0) types.push('aggregation_sort');
  const points = typeof data.points === 'number' ? data.points : parseInt(String(data.points ?? 0), 10) || 0;
  if (points > 0) types.push('range_query');
  const stored = typeof data.stored_fields === 'number' ? data.stored_fields : parseInt(String(data.stored_fields ?? 0), 10) || 0;
  if (stored > 0) types.push('stored');
  const norms = typeof data.norms === 'number' ? data.norms : parseInt(String(data.norms ?? 0), 10) || 0;
  if (norms > 0) types.push('scoring');
  const termVectors = typeof data.term_vectors === 'number' ? data.term_vectors : parseInt(String(data.term_vectors ?? 0), 10) || 0;
  if (termVectors > 0) types.push('term_vectors');
  const knnVectors = typeof data.knn_vectors === 'number' ? data.knn_vectors : parseInt(String(data.knn_vectors ?? 0), 10) || 0;
  if (knnVectors > 0) types.push('vector_search');
  return types;
}

type MappingsResponse = Record<string, { mappings?: { properties?: Record<string, unknown> } }>;

function parseFieldUsageIndexLite(
  indexName: string,
  fieldUsageResponse: FieldUsageStatsResponse | null,
  mappingsResponse: MappingsResponse | null
): FieldUsageSummary {
  const totalFieldsFromMapping =
    mappingsResponse?.[indexName]?.mappings?.properties != null
      ? countLeafFieldsFromMapping(mappingsResponse[indexName].mappings!.properties)
      : 0;

  const indexData = fieldUsageResponse?.[indexName] as { shards?: unknown[] } | undefined;
  const shards = indexData?.shards;

  let usedFields = 0;
  let mostUsedFieldName: string | null = null;
  let maxUsage = 0;
  const allUserFields = new Set<string>();
  const fieldUsageMax: Record<string, number> = {};

  if (Array.isArray(shards)) {
    for (const shard of shards) {
      const stats = (shard as { stats?: { fields?: Record<string, Record<string, unknown>> } }).stats;
      const fields = stats?.fields;
      if (!fields || typeof fields !== 'object') continue;
      for (const [fieldName, fieldData] of Object.entries(fields)) {
        if (fieldName.startsWith('_')) continue;
        allUserFields.add(fieldName);
        const data = fieldData as Record<string, unknown>;
        const any = typeof data.any === 'number' ? data.any : parseInt(String(data.any ?? 0), 10) || 0;
        if (any > (fieldUsageMax[fieldName] ?? 0)) fieldUsageMax[fieldName] = any;
      }
    }
    for (const fn of allUserFields) {
      const usage = fieldUsageMax[fn] ?? 0;
      if (usage > 0) usedFields++;
      if (usage > maxUsage) {
        maxUsage = usage;
        mostUsedFieldName = fn;
      }
    }
  }

  const totalFields = totalFieldsFromMapping > 0 ? totalFieldsFromMapping : allUserFields.size;
  const hasUsageData = Array.isArray(shards) && shards.length > 0;
  return {
    totalFields,
    usedFields,
    unusedFields: Math.max(0, totalFields - usedFields),
    mostUsedFieldName,
    hasUsageData
  };
}

function parseFieldUsageIndexDetailed(
  indexName: string,
  fieldUsageResponse: FieldUsageStatsResponse | null,
  mappingsResponse: MappingsResponse | null
): FieldUsageSummary {
  const mappingProps = mappingsResponse?.[indexName]?.mappings?.properties;
  const mappingLeafFieldNames = mappingProps ? getLeafFieldNamesFromMapping(mappingProps) : [];
  const totalFieldsFromMapping =
    mappingProps != null
      ? countLeafFieldsFromMapping(mappingProps)
      : 0;

  const indexData = fieldUsageResponse?.[indexName] as { shards?: unknown[] } | undefined;
  const shards = indexData?.shards;
  let usedFields = 0;
  let mostUsedFieldName: string | null = null;
  let maxUsage = 0;
  const allFieldNames = new Set<string>();
  const fieldUsageMax: Record<string, number> = {};
  const fieldUsageTypesMap: Record<string, Set<string>> = {};

  if (Array.isArray(shards)) {
    for (const shard of shards) {
      const stats = (shard as { stats?: { fields?: Record<string, Record<string, unknown>> } }).stats;
      const fields = stats?.fields;
      if (!fields || typeof fields !== 'object') continue;
      for (const [fieldName, fieldData] of Object.entries(fields)) {
        allFieldNames.add(fieldName);
        const data = fieldData as Record<string, unknown>;
        const any = typeof data.any === 'number' ? data.any : parseInt(String(data.any ?? 0), 10) || 0;
        if (any > (fieldUsageMax[fieldName] ?? 0)) fieldUsageMax[fieldName] = any;
        const types = getFieldUsageTypes(data);
        if (!fieldUsageTypesMap[fieldName]) fieldUsageTypesMap[fieldName] = new Set();
        types.forEach((t) => fieldUsageTypesMap[fieldName].add(t));
      }
    }
    const userFieldNames = [...allFieldNames].filter((name) => !name.startsWith('_'));
    for (const fn of userFieldNames) {
      const usage = fieldUsageMax[fn] ?? 0;
      if (usage > 0) usedFields++;
      if (usage > maxUsage) {
        maxUsage = usage;
        mostUsedFieldName = fn;
      }
    }
  }

  const userFieldNamesFromUsage = [...allFieldNames].filter((name) => !name.startsWith('_'));
  const totalFields = totalFieldsFromMapping > 0 ? totalFieldsFromMapping : userFieldNamesFromUsage.length;
  const listFieldNames = mappingLeafFieldNames.length > 0
    ? mappingLeafFieldNames.filter((name) => !name.startsWith('_'))
    : userFieldNamesFromUsage;
  const fieldList: Array<{ name: string; usage: number; usageTypes: string[] }> = [];
  for (const fn of listFieldNames) {
    const usage = fieldUsageMax[fn] ?? 0;
    const usageTypes = Array.from(fieldUsageTypesMap[fn] ?? []);
    fieldList.push({ name: fn, usage, usageTypes });
  }
  fieldList.sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name));

  let unusedFieldNames: string[] | undefined;
  if (mappingProps) {
    unusedFieldNames = mappingLeafFieldNames
      .filter((name) => !name.startsWith('_') && (fieldUsageMax[name] ?? 0) === 0)
      .sort((a, b) => a.localeCompare(b));
  } else {
    unusedFieldNames = fieldList.filter((f) => f.usage === 0).map((f) => f.name).sort((a, b) => a.localeCompare(b));
  }

  const hasUsageData = Array.isArray(shards) && shards.length > 0;
  return {
    totalFields,
    usedFields,
    unusedFields: Math.max(0, totalFields - usedFields),
    mostUsedFieldName,
    fieldList,
    unusedFieldNames,
    hasUsageData
  };
}

const FIELD_USAGE_TYPE_INFO = (
  <div className="space-y-2">
    <p className="font-medium">Usage types (from Elasticsearch field_usage_stats):</p>
    <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400">
      <li><strong>Search</strong> — Full-text search (inverted index terms/postings)</li>
      <li><strong>Aggregation / Sort</strong> — doc_values used for sorting, aggregations, scripts</li>
      <li><strong>Range query</strong> — Numeric/date range queries (points index)</li>
      <li><strong>Stored</strong> — Stored fields (e.g. _source, stored: true)</li>
      <li><strong>Scoring</strong> — Norms used for relevance scoring</li>
      <li><strong>Term vectors</strong> — Term vectors (highlighting, etc.)</li>
      <li><strong>Vector search</strong> — KNN / dense vector search</li>
    </ul>
  </div>
);

function FieldsPopoverContent({
  indexName,
  summary,
  fieldList,
  mode,
  usageTypeInfoOpen,
  setUsageTypeInfoOpen,
  onClose
}: {
  indexName: string;
  summary: FieldUsageSummary | undefined;
  fieldList: Array<{ name: string; usage: number; usageTypes: string[] }>;
  mode: 'all' | 'used';
  usageTypeInfoOpen: boolean;
  setUsageTypeInfoOpen: (open: boolean) => void;
  onClose: () => void;
}) {
  const fieldsPopoverBackdropMouseDownRef = useRef(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        fieldsPopoverBackdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && fieldsPopoverBackdropMouseDownRef.current) {
          onClose();
        }
        fieldsPopoverBackdropMouseDownRef.current = false;
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="fields-popover-title"
    >
      <div
        className="max-h-[70vh] w-full max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-600">
          <h3 id="fields-popover-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono">
            Index: {indexName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="tab-section-scroll">
          {summary ? (
            <>
              {!summary.hasUsageData && (
                <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                  Field usage stats require Elasticsearch 7.15.0+. Not available in OpenSearch or older ES versions.
                </p>
              )}
              <div className="mb-3 flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-400">
                <span>Total: {summary.totalFields}</span>
                {summary.hasUsageData && (
                  <>
                    <span>Used: {summary.usedFields}</span>
                    <span>Unsearched: {summary.unusedFields}</span>
                  </>
                )}
              </div>
              {summary.hasUsageData && (
                <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                  {mode === 'all'
                    ? 'Total fields come from mappings; this table lists all mapped fields with usage when observed.'
                    : 'The table below lists fields observed by field usage stats.'}
                </p>
              )}
              {!summary.hasUsageData ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">Usage data not available for this cluster.</p>
              ) : fieldList.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {mode === 'all' ? 'No mapped fields found.' : 'No used fields observed yet.'}
                </p>
              ) : (
                <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-600">
                  <table className="w-full min-w-[400px] text-left text-sm tab-content-value">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-700/50">
                        <th className="min-w-[140px] px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">Field</th>
                        <th className="min-w-[90px] px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">Usage</th>
                        <th className="min-w-[180px] px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">
                          <span className="inline-flex items-center gap-1">
                            Usage type
                            <InfoPopup
                              title="Usage type"
                              modalTitle="Field usage types"
                              open={usageTypeInfoOpen}
                              onClose={() => setUsageTypeInfoOpen(false)}
                              onOpen={() => setUsageTypeInfoOpen(true)}
                            >
                              {FIELD_USAGE_TYPE_INFO}
                            </InfoPopup>
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {fieldList.map((f, i) => (
                        <tr
                          key={f.name ?? i}
                          className="border-b border-gray-100 text-gray-800 dark:border-gray-700 dark:text-gray-200 last:border-b-0"
                        >
                          <td className="max-w-[220px] px-3 py-2 font-mono" title={f.name}>
                            <span className="block truncate">{f.name}</span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {f.usage === 0 ? (
                              <span className="text-amber-600 dark:text-amber-400">unsearched</span>
                            ) : (
                              <>{Intl.NumberFormat('en-US').format(f.usage)} docs</>
                            )}
                          </td>
                          <td className="min-w-[180px] px-3 py-2">
                            {f.usageTypes.length === 0 ? (
                              <span className="text-gray-400">—</span>
                            ) : (
                              <span className="inline-flex flex-wrap gap-1.5">
                                {f.usageTypes.map((t) => (
                                  <span
                                    key={t}
                                    className="inline-flex shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800 dark:bg-blue-900/50 dark:text-blue-200"
                                  >
                                    {FIELD_USAGE_TYPE_LABELS[t] ?? t}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">No field usage summary available for this index.</p>
          )}
        </div>
      </div>
    </div>
  );
}

const INDICES_KIBANA_SNIPPET = `POST _security/user/your_user
{
  "password": "your_password",
  "roles": ["monitoring_user", "viewer"]
}`;

function getIndicesCurlSnippet(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, '');
  return `curl -u elastic:YOUR_PASSWORD "${base}/_cat/indices?v"`;
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
      <pre className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 pr-10 text-xs font-mono whitespace-pre overflow-x-auto max-w-full tab-content-value">
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

const DEFAULT_PAGE_SIZE = 10;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardToRegex(pattern: string): RegExp | null {
  const p = pattern.trim();
  if (!p) return null;
  const parts = p.split('*').map(escapeRegex);
  return new RegExp(`^${parts.join('.*')}$`, 'i');
}

function matchesMaybeWildcard(haystack: string, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;
  // Keep wildcard behavior only when user explicitly uses '*'
  if (q.includes('*')) {
    const rx = wildcardToRegex(q);
    return rx ? rx.test(normalizeSearchText(haystack)) : true;
  }
  // Default behavior (like other search bars): substring match
  return normalizeSearchText(haystack).includes(q);
}

function parseAgeToMs(age: string | undefined): number {
  if (!age) return 0;
  // accepts strings like "56.58d", "1h", "30m"
  const raw = String(age).trim().toLowerCase();
  const m = raw.match(/^([\d.]+)\s*(ms|s|m|h|d)?$/);
  if (!m) return 0;
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return 0;
  const unit = m[2] ?? 'ms';
  const mult =
    unit === 'd' ? 86400000 :
    unit === 'h' ? 3600000 :
    unit === 'm' ? 60000 :
    unit === 's' ? 1000 :
    1;
  return num * mult;
}

function healthToBadgeClass(health: string | undefined): string {
  if (health === 'green') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (health === 'yellow') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  if (health === 'red') return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
  return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
}

function parseCatByteSizeToBytes(value: string | undefined): number {
  if (!value) return 0;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return 0;
  const m = raw.match(/^([\d.]+)\s*([kmgtp]?b)?$/i);
  if (!m) return 0;
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return 0;
  const unit = (m[2] ?? 'b').toLowerCase();
  const pow = unit === 'kb' ? 1 : unit === 'mb' ? 2 : unit === 'gb' ? 3 : unit === 'tb' ? 4 : unit === 'pb' ? 5 : 0;
  return num * Math.pow(1024, pow);
}

function parseCatNumber(value: string | undefined): number {
  if (value == null) return 0;
  const n = parseInt(String(value).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function indexNameToRolloverAlias(indexName: string): string {
  // Example:
  // ".ds-foo-bar-2026.03.05-000001" -> "foo-bar"
  // "foo-bar-2026.03.05-000001" -> "foo-bar"
  const raw = (indexName ?? '').trim();
  if (!raw) return raw;
  const withoutDs = raw.startsWith('.ds-') ? raw.slice(4) : raw;
  return withoutDs.replace(/-\d{4}\.\d{2}\.\d{2}-\d{6}$/, '');
}

/** Primary/Total shards: pri / (pri * (1 + rep)). */
function formatPrimaryTotal(pri: string | undefined, rep: string | undefined): string {
  const p = Number(pri ?? 0) || 0;
  const r = Number(rep ?? 0) || 0;
  if (p <= 0) return '—';
  const total = p * (1 + r);
  return `${p} / ${total}`;
}

const INDEX_EXPLORER_PAGE_SIZES = [10, 20, 100] as const;
const INDEX_EXPLORER_DEFAULT_PAGE_SIZE = 10;
const INDEX_EXPLORER_QUERY_DEBOUNCE_MS = 200;

const INDEX_EXPLORER_MATCH_SCOPE_LABELS: Record<MatchScope, string> = {
  index: 'index',
  alias: 'alias',
  datastream: 'datastream',
  field: 'field',
  ilm: 'ilm'
};

const INDEX_EXPLORER_MATCH_SCOPE_STYLES: Record<MatchScope, string> = {
  index: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  alias: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
  datastream: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
  field: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  ilm: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200'
};

function indexExplorerHealthDotClass(health?: string): string {
  if (health === 'green') return 'bg-emerald-500';
  if (health === 'yellow') return 'bg-amber-500';
  if (health === 'red') return 'bg-red-500';
  return 'bg-gray-400';
}

function indexExplorerFormatPreview(values: string[], max = 3): string {
  if (values.length === 0) return '—';
  const shown = values.slice(0, max);
  const suffix = values.length > max ? ` +${values.length - max}` : '';
  return `${shown.join(', ')}${suffix}`;
}

type IndexExplorerSectionProps = {
  activeCluster: ReturnType<typeof useMonitoring>['activeCluster'];
  isClusterUnreachable: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onRefreshStateChange?: (loading: boolean) => void;
  onOpenIndexDetails?: OpenIndexDetailsFn;
};

function IndexExplorerSection({
  activeCluster,
  isClusterUnreachable,
  expanded,
  onToggleExpanded,
  onRefreshStateChange,
  onOpenIndexDetails
}: IndexExplorerSectionProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatIndexRow[]>([]);
  const [aliases, setAliases] = useState<CatAliasRow[]>([]);
  const [mappings, setMappings] = useState<Record<string, MappingsIndexEntry> | null>(null);
  const [dataStreams, setDataStreams] = useState<DataStreamsResponse>({ data_streams: [] });
  const [ilmExplain, setIlmExplain] = useState<IlmExplainResponse | null>(null);
  const [queryInput, setQueryInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [lastGoodResults, setLastGoodResults] = useState<IndexMatchResult[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(INDEX_EXPLORER_DEFAULT_PAGE_SIZE);
  const [infoOpen, setInfoOpen] = useState(false);

  const clusterKey = activeCluster ? `${activeCluster.baseUrl}|${activeCluster.label}` : '';
  const sectionExpanded = expanded;

  const indexMetaRecords = useMemo(
    () => buildIndexMetaCache(catalog, aliases, dataStreams, mappings, ilmExplain),
    [catalog, aliases, dataStreams, mappings, ilmExplain]
  );

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(queryInput), INDEX_EXPLORER_QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [queryInput]);

  useEffect(() => {
    if (!sectionExpanded) return;
    if (!debouncedQuery.trim()) {
      setParseError(null);
      setEvalError(null);
      setLastGoodResults([]);
      return;
    }
    const { results, parseError: pErr, evalError: eErr } = runRegexQuery(debouncedQuery, indexMetaRecords);
    if (pErr) {
      setParseError(pErr);
      setEvalError(null);
      return;
    }
    if (eErr) {
      setParseError(null);
      setEvalError(eErr);
      return;
    }
    setParseError(null);
    setEvalError(null);
    setLastGoodResults(results);
  }, [debouncedQuery, indexMetaRecords, sectionExpanded]);

  const displayResults = debouncedQuery.trim()
    ? lastGoodResults
    : indexMetaRecords.map((record) => ({
        record,
        matchedBy: [],
        previews: {
          aliases: [],
          dataStreams: [],
          fields: [],
          ilmPolicies: record.ilmPolicy ? [record.ilmPolicy] : []
        }
      }));

  const totalPages = Math.max(1, Math.ceil(displayResults.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const paginatedResults = useMemo(() => {
    const start = (pageSafe - 1) * pageSize;
    return displayResults.slice(start, start + pageSize);
  }, [displayResults, pageSafe, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, pageSize]);

  const fetchMetadata = useCallback(async (signal?: AbortSignal) => {
    const cluster = activeCluster;
    if (!cluster || isClusterUnreachable || !sectionExpanded) return;
    setLoading(true);
    onRefreshStateChange?.(true);
    setError(null);
    try {
      const [catalogRes, aliasesRes, dataStreamsRes, mappingsRes, ilmExplainRes] = await Promise.all([
        getIndicesCatalog(cluster, signal),
        getCatAliases(cluster, signal).catch(() => [] as CatAliasRow[]),
        getDataStreams(cluster, signal).catch(() => ({ data_streams: [] })),
        getAllMappings(cluster, signal).catch(() => ({})),
        getIlmExplain(cluster, '*', signal).catch(() => ({ indices: {} } as IlmExplainResponse))
      ]);
      setCatalog(catalogRes);
      setAliases(aliasesRes);
      setDataStreams(dataStreamsRes ?? { data_streams: [] });
      setMappings(mappingsRes && Object.keys(mappingsRes).length > 0 ? mappingsRes : null);
      setIlmExplain(ilmExplainRes ?? { indices: {} });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load index metadata';
      const isTimeoutOrNetwork =
        msg.toLowerCase().includes('network') || msg.toLowerCase().includes('timed out');
      setError(isTimeoutOrNetwork ? getNetworkErrorMessage(cluster.baseUrl) : msg);
      setCatalog([]);
      setAliases([]);
      setDataStreams({ data_streams: [] });
      setMappings(null);
      setIlmExplain(null);
    } finally {
      setLoading(false);
      onRefreshStateChange?.(false);
    }
  }, [clusterKey, isClusterUnreachable, onRefreshStateChange, sectionExpanded]);

  useEffect(() => {
    if (!activeCluster || isClusterUnreachable || !sectionExpanded) return;
    const controller = new AbortController();
    void fetchMetadata(controller.signal);
    return () => controller.abort();
  }, [clusterKey, fetchMetadata, isClusterUnreachable, sectionExpanded]);

  useEffect(() => {
    const onRefresh = () => {
      const controller = new AbortController();
      void fetchMetadata(controller.signal);
    };
    window.addEventListener('refreshIndices', onRefresh);
    return () => window.removeEventListener('refreshIndices', onRefresh);
  }, [fetchMetadata]);

  if (!activeCluster) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-gray-300 bg-white p-8 dark:bg-gray-800 dark:border-gray-600">
        <p className="text-sm text-gray-500 dark:text-gray-400">Select a cluster to use Index Explorer.</p>
      </div>
    );
  }

  const queryError = parseError ?? evalError;
  const metaCount = indexMetaRecords.length;

  return (
    <section className="tab-section-card">
      <div className="tab-section-header tab-section-header-split">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TabSectionExpandTrigger
            expanded={sectionExpanded}
            onToggle={onToggleExpanded}
            label="Index Explorer"
            fillHitArea={true}
            suffix={
              <>
                <InfoPopup
                  title="Index Explorer"
                  modalTitle="Index Explorer"
                  open={infoOpen}
                  onOpen={() => setInfoOpen(true)}
                  onClose={() => setInfoOpen(false)}
                >
                  <p>
                    Search indices using regex and boolean logic across index names, aliases, data streams, and mapping
                    fields.
                  </p>
                </InfoPopup>
                {sectionExpanded && loading && metaCount > 0 && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Refreshing…</span>
                )}
              </>
            }
          />
        </div>
        {sectionExpanded && (
          <div className="tab-section-inline-tools">
            <div className="relative min-w-[12rem] max-w-[28rem] flex-1 sm:flex-none sm:w-80">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
              <input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="index:/logs-.*/ AND field:/user_id/"
                className="w-full pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 tab-content-value font-mono"
                spellCheck={false}
              />
              {queryInput && (
                <button
                  type="button"
                  onClick={() => setQueryInput('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Clear query"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <Pagination
              inline
              currentPage={pageSafe}
              totalPages={totalPages}
              totalItems={displayResults.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
            <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 shrink-0">
              <span className="whitespace-nowrap">Show</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="py-1 pl-1.5 pr-6 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              >
                {INDEX_EXPLORER_PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    Top {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
      {sectionExpanded && (
        <div className="tab-section-body">
          {queryError && (
            <div className="mx-3 mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
              {queryError}
              {lastGoodResults.length > 0 && (
                <span className="block mt-1 text-red-600/80 dark:text-red-300/80">
                  Showing {formatNumber(lastGoodResults.length)} result(s) from the last valid query.
                </span>
              )}
            </div>
          )}
          {!queryError && debouncedQuery.trim() && (
            <div className="mx-3 mt-2 text-xs text-gray-600 dark:text-gray-400">
              {formatNumber(displayResults.length)} matching index(es) · {formatNumber(metaCount)} in catalog
            </div>
          )}
          {!queryError && !debouncedQuery.trim() && (
            <div className="mx-3 mt-2 text-xs text-gray-600 dark:text-gray-400">
              Showing all indices ({formatNumber(metaCount)}).
            </div>
          )}
          <div className="tab-section-scroll tab-section-scroll-flush">
            {error ? (
              <div className="p-4">
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                  {error}
                </div>
              </div>
            ) : loading && metaCount === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm text-gray-500 dark:text-gray-400">
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                Loading index metadata…
              </div>
            ) : paginatedResults.length === 0 && !queryError ? (
              <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">No indices match this query.</div>
            ) : (
              <table className="w-full text-left tab-content-value border-collapse">
                <thead>
                  <tr className="border-b-2 border-gray-300 bg-gray-100 dark:border-gray-600 dark:bg-gray-800">
                    <th className="px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 w-[32%]">Index</th>
                    <th className="px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 w-[14%]">Matched by</th>
                    <th className="px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 w-[18%]">ILM policy</th>
                    <th className="px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 w-[18%]">Aliases</th>
                    <th className="px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 w-[18%]">Data streams</th>
                    <th className="px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 w-[16%]">Fields</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedResults.map((row) => (
                    <tr
                      key={row.record.indexName}
                      className="border-b border-gray-200 hover:bg-blue-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`h-2 w-2 rounded-full shrink-0 ${indexExplorerHealthDotClass(row.record.health)}`}
                            title={row.record.health ?? 'unknown'}
                          />
                          <button
                            type="button"
                            onClick={() => onOpenIndexDetails?.(row.record.indexName)}
                            className="truncate font-mono entity-name-link text-left"
                            title={row.record.indexName}
                          >
                            {row.record.indexName}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {row.matchedBy.length === 0 ? (
                            <span className="text-[10px] text-gray-500 dark:text-gray-400">—</span>
                          ) : (
                            row.matchedBy.map((scope) => (
                              <span
                                key={scope}
                                className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${INDEX_EXPLORER_MATCH_SCOPE_STYLES[scope]}`}
                              >
                                {INDEX_EXPLORER_MATCH_SCOPE_LABELS[scope]}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-gray-700 dark:text-gray-300 font-mono truncate" title={row.previews.ilmPolicies.join(', ') || row.record.ilmPolicy || ''}>
                        {indexExplorerFormatPreview(row.previews.ilmPolicies.length ? row.previews.ilmPolicies : (row.record.ilmPolicy ? [row.record.ilmPolicy] : []))}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-gray-700 dark:text-gray-300 font-mono truncate" title={row.previews.aliases.join(', ')}>
                        {indexExplorerFormatPreview(row.previews.aliases.length ? row.previews.aliases : row.record.aliases)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-gray-700 dark:text-gray-300 font-mono truncate" title={row.previews.dataStreams.join(', ')}>
                        {indexExplorerFormatPreview(
                          row.previews.dataStreams.length ? row.previews.dataStreams : row.record.dataStreams
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-gray-700 dark:text-gray-300 font-mono truncate" title={row.previews.fields.join(', ')}>
                        {indexExplorerFormatPreview(row.previews.fields)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function IndicesTabContent({
  onRefreshStateChange,
  onOpenIndexDetails,
  onOpenNodeDetails,
  onOpenInQuery,
  diagnosisNav,
  onDiagnosisNavConsumed,
  onOpenIndexDiagnosis
}: {
  onRefreshStateChange?: (loading: boolean) => void;
  onOpenIndexDetails?: OpenIndexDetailsFn;
  onOpenNodeDetails?: (nodeName: string) => void;
  onOpenInQuery?: (indexName: string) => void;
  diagnosisNav?: DiagnosisNavigation | null;
  onDiagnosisNavConsumed?: () => void;
  onOpenIndexDiagnosis?: (indexName: string) => void;
} = {}) {
  const { activeCluster, isClusterUnreachable } = useMonitoring();
  const activeClusterRef = useRef(activeCluster);
  activeClusterRef.current = activeCluster;
  const clusterKey = activeCluster ? `${activeCluster.label ?? ''}-${activeCluster.baseUrl}` : '';

  const [catalog, setCatalog] = useState<CatIndexRow[]>([]);
  const [aliases, setAliases] = useState<CatAliasRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [permissionHelpOpen, setPermissionHelpOpen] = useState(false);
  /** Field usage / catalog: index name or any field name from usage list */
  const [searchTerm, setSearchTerm] = useState('');
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogPageSize, setCatalogPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [catalogSortColumn, setCatalogSortColumn] = useState<string>('docs.count');
  const [catalogSortDirection, setCatalogSortDirection] = useState<'asc' | 'desc'>('desc');
  const [aliasesPopoverIndex, setAliasesPopoverIndex] = useState<string | null>(null);
  const [fieldsPopoverIndex, setFieldsPopoverIndex] = useState<string | null>(null);
  const [fieldsPopoverMode, setFieldsPopoverMode] = useState<'all' | 'used'>('all');
  const [unsearchedFieldsPopoverIndex, setUnsearchedFieldsPopoverIndex] = useState<string | null>(null);
  const [usageTypeInfoOpen, setUsageTypeInfoOpen] = useState(false);
  const rolloverAlertBackdropMouseDownRef = useRef(false);
  const dataStreamBackdropMouseDownRef = useRef(false);
  const aliasesBackdropMouseDownRef = useRef(false);
  const [fieldUsageAllMap, setFieldUsageAllMap] = useState<Record<string, FieldUsageSummary>>({});
  const [fieldUsageBuildTotal, setFieldUsageBuildTotal] = useState(0);
  const [fieldUsageBuildProcessed, setFieldUsageBuildProcessed] = useState(0);
  const [fieldUsageBuilding, setFieldUsageBuilding] = useState(false);
  const fieldUsageBuildIdRef = useRef(0);
  const latestFieldUsageRef = useRef<FieldUsageStatsResponse | null>(null);
  const latestMappingsRef = useRef<MappingsResponse | null>(null);
  const mappingsCacheRef = useRef<MappingsResponse | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [shardsMapInfoOpen, setShardsMapInfoOpen] = useState(false);
  const [ilmExplainInfoOpen, setIlmExplainInfoOpen] = useState(false);
  /** Field usage stats section: closed by default; expanding triggers fetch. */
  const [indicesExpanded, setIndicesExpanded] = useState(false);
  /** Data streams section: independent collapsible; closed by default. */
  const [dataStreamsExpanded, setDataStreamsExpanded] = useState(false);

  type TierKey = 'hot' | 'warm' | 'cold' | 'frozen';
  type DataStreamTierRow = {
    name: string;
    status: string;
    indexCount: number;
    totalStoreBytes: number;
    hotStoreBytes: number;
    warmStoreBytes: number;
    coldStoreBytes: number;
    frozenStoreBytes: number;
  };
  const [dataStreamRows, setDataStreamRows] = useState<DataStreamTierRow[]>([]);
  const [dataStreamBackingIndicesMap, setDataStreamBackingIndicesMap] = useState<Record<string, string[]>>({});
  const [dataStreamIndexStoreBytesMap, setDataStreamIndexStoreBytesMap] = useState<Record<string, number>>({});
  const [dataStreamsLoading, setDataStreamsLoading] = useState(false);
  const [dataStreamsError, setDataStreamsError] = useState<string | null>(null);
  const [dataStreamsSearchTerm, setDataStreamsSearchTerm] = useState('');
  const [dataStreamsSortColumn, setDataStreamsSortColumn] = useState<keyof DataStreamTierRow>('totalStoreBytes');
  const [dataStreamsSortDirection, setDataStreamsSortDirection] = useState<'asc' | 'desc'>('desc');
  const [dataStreamsPage, setDataStreamsPage] = useState(1);
  const [dataStreamsPageSize, setDataStreamsPageSize] = useState(10);
  const [dataStreamsInfoOpen, setDataStreamsInfoOpen] = useState(false);
  const [selectedDataStreamName, setSelectedDataStreamName] = useState<string | null>(null);
  const [dataStreamModalSortColumn, setDataStreamModalSortColumn] = useState<
    'index' | 'health' | 'primaryTotal' | 'sizeBytes' | 'created' | 'ilmAge' | 'phase' | 'ilmActionStep'
  >('ilmAge');
  const [dataStreamModalSortDirection, setDataStreamModalSortDirection] = useState<'asc' | 'desc'>('desc');

  const [dataStreamIlmLoading, setDataStreamIlmLoading] = useState(false);
  const [dataStreamIlmError, setDataStreamIlmError] = useState<string | null>(null);
  const [dataStreamIlmExplain, setDataStreamIlmExplain] = useState<IlmExplainResponse | null>(null);

  // Index → Node map (cluster-wide _cat/shards; default closed, fetch on expand)
  const [placementExpanded, setPlacementExpanded] = useState(false);
  const [regexSearchExpanded, setRegexSearchExpanded] = useState(false);
  const [placementSearchTerm, setPlacementSearchTerm] = useState('');
  const [placementLoading, setPlacementLoading] = useState(false);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [placementPage, setPlacementPage] = useState(1);
  const [placementPageSize, setPlacementPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [placementRowsRaw, setPlacementRowsRaw] = useState<CatShardRow[]>([]);
  const [placementSortColumn, setPlacementSortColumn] = useState<string>('max_store');
  const [placementSortDirection, setPlacementSortDirection] = useState<'asc' | 'desc'>('desc');

  // ILM explain (cluster-wide)
  const [ilmAllExpanded, setIlmAllExpanded] = useState(false);
  const [ilmAllLoading, setIlmAllLoading] = useState(false);
  const [ilmAllError, setIlmAllError] = useState<string | null>(null);
  const [ilmAllSearchTerm, setIlmAllSearchTerm] = useState('');
  const [ilmAllPage, setIlmAllPage] = useState(1);
  const [ilmAllPageSize, setIlmAllPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [ilmAllSortColumn, setIlmAllSortColumn] = useState<string>('message');
  const [ilmAllSortDirection, setIlmAllSortDirection] = useState<'asc' | 'desc'>('desc');
  const [ilmAllExplain, setIlmAllExplain] = useState<IlmExplainResponse | null>(null);
  const [ilmAllShards, setIlmAllShards] = useState<CatShardRow[]>([]);
  const [ilmAllPhaseFilter, setIlmAllPhaseFilter] = useState<string>('');
  const [ilmAllRolloverAlertOpen, setIlmAllRolloverAlertOpen] = useState(false);
  const [ilmAllRolloverAlertText, setIlmAllRolloverAlertText] = useState<string>('');
  const [ilmAllRolloverCommand, setIlmAllRolloverCommand] = useState<string>('');
  const curlSnippet = useMemo(
    () => getIndicesCurlSnippet(activeCluster?.baseUrl ?? 'https://your-cluster:9200'),
    [activeCluster?.baseUrl]
  );

  useEffect(() => {
    if (!indicesExpanded) {
      // Cancel any in-flight progressive build to avoid wasted work.
      fieldUsageBuildIdRef.current += 1;
      setFieldUsageBuilding(false);
    }
  }, [indicesExpanded]);

  const fetchCatalogAndLists = useCallback(async () => {
    const cluster = activeClusterRef.current;
    if (!cluster || isClusterUnreachable) return;
    setLoading(true);
    setError(null);
    setForbidden(false);
    const controller = new AbortController();
    const signal = controller.signal;
    try {
      const [catalogRes, aliasesRes, mappingsRes, usageAllRes] = await Promise.all([
        getIndicesCatalog(cluster, signal),
        getCatAliases(cluster, signal).catch(() => [] as CatAliasRow[]),
        getAllMappings(cluster, signal).catch(() => ({})),
        // Cluster-wide field usage stats are only needed for the Field usage stats table.
        indicesExpanded ? getFieldUsageStats(cluster, '_all', signal).catch(() => null) : Promise.resolve(null)
      ]);
      setCatalog(catalogRes);
      setAliases(aliasesRes);
      const mappings = mappingsRes && Object.keys(mappingsRes).length > 0 ? (mappingsRes as MappingsResponse) : null;
      mappingsCacheRef.current = mappings;
      latestFieldUsageRef.current = usageAllRes;
      latestMappingsRef.current = mappings;

      // Progressive build: show partial results quickly instead of blocking UI.
      setFieldUsageAllMap({});
      const buildId = ++fieldUsageBuildIdRef.current;

      const allIndexNames = new Set<string>();
      if (mappings && typeof mappings === 'object') {
        for (const k of Object.keys(mappings)) if (k !== '_shards') allIndexNames.add(k);
      }
      if (usageAllRes && typeof usageAllRes === 'object') {
        for (const k of Object.keys(usageAllRes)) if (k !== '_shards') allIndexNames.add(k);
      }
      const indexNames = Array.from(allIndexNames);

      setFieldUsageBuildTotal(indexNames.length);
      setFieldUsageBuildProcessed(0);
      setFieldUsageBuilding(indicesExpanded && indexNames.length > 0);

      if (indicesExpanded && indexNames.length > 0) {
        const BATCH_SIZE = 10;
        (async () => {
          for (let i = 0; i < indexNames.length; i += BATCH_SIZE) {
            if (fieldUsageBuildIdRef.current !== buildId) return;
            const slice = indexNames.slice(i, i + BATCH_SIZE);
            const batch: Record<string, FieldUsageSummary> = {};
            for (const idx of slice) {
              batch[idx] = parseFieldUsageIndexLite(idx, usageAllRes, mappings);
            }
            setFieldUsageAllMap((prev) => ({ ...prev, ...batch }));
            setFieldUsageBuildProcessed(Math.min(indexNames.length, i + slice.length));
            // Yield to keep UI responsive.
            await new Promise((r) => setTimeout(r, 0));
          }
          if (fieldUsageBuildIdRef.current === buildId) {
            setFieldUsageBuilding(false);
          }
        })();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) {
        setForbidden(true);
        setError(INDICES_PERMISSION_MESSAGE);
      } else {
        const isTimeoutOrNetwork =
          msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
        setError(
          isTimeoutOrNetwork && cluster ? getNetworkErrorMessage(cluster.baseUrl) : (msg || 'Failed to load indices')
        );
      }
      setCatalog([]);
      setAliases([]);
      setFieldUsageAllMap({});
      setFieldUsageBuildTotal(0);
      setFieldUsageBuildProcessed(0);
      setFieldUsageBuilding(false);
    } finally {
      setLoading(false);
    }
  }, [clusterKey, indicesExpanded, isClusterUnreachable]);

  const ensureFieldUsageDetails = useCallback(
    (indexName: string) => {
      if (!indexName) return;

      const cluster = activeClusterRef.current;
      const fieldUsage = latestFieldUsageRef.current;
      const mappingsFromAll = latestMappingsRef.current;

      const effectiveMappings: MappingsResponse | null =
        mappingsFromAll && mappingsFromAll[indexName] ? mappingsFromAll : null;

      // Fast path: we already have usage data cached for this specific index (from a previous call),
      // or we have mappings available to derive field counts/unsearched fields.
      const hasCachedUsageForIndex =
        fieldUsage != null &&
        typeof fieldUsage === 'object' &&
        Object.prototype.hasOwnProperty.call(fieldUsage, indexName);

      if (hasCachedUsageForIndex || effectiveMappings) {
        setFieldUsageAllMap((prev) => {
          const existing = prev[indexName];
          const detailed = parseFieldUsageIndexDetailed(indexName, fieldUsage, effectiveMappings);
          if (
            existing &&
            existing.totalFields === detailed.totalFields &&
            existing.usedFields === detailed.usedFields &&
            existing.unusedFields === detailed.unusedFields &&
            existing.mostUsedFieldName === detailed.mostUsedFieldName &&
            existing.hasUsageData === detailed.hasUsageData &&
            (existing.fieldList?.length ?? 0) === (detailed.fieldList?.length ?? 0)
          ) {
            return prev;
          }
          return { ...prev, [indexName]: { ...existing, ...detailed } };
        });
        return;
      }

      // Slow path: all/_field_usage_stats henüz gelmemiş, sadece bu index için çağrı yap.
      // Modal-only akışta mapping gelmeden sadece usage ile parse etmek geçici/yanlış toplam
      // field sayısı üretebilir; bu yüzden mapping'i de (gerekirse) birlikte getir.
      if (!cluster) return;

      (async () => {
        try {
          const controller = new AbortController();
          const signal = controller.signal;
          const [usageRes, detailsRes] = await Promise.all([
            getFieldUsageStats(cluster, indexName, signal).catch(() => null),
            effectiveMappings ? Promise.resolve(null) : getIndexDetails(cluster, indexName, signal).catch(() => null)
          ]);

          const fetchedMappings: MappingsResponse | null =
            effectiveMappings ??
            (detailsRes?.[indexName] != null
              ? {
                  [indexName]: {
                    mappings: (detailsRes[indexName] as { mappings?: { properties?: Record<string, unknown> } }).mappings
                  }
                }
              : null);

          if (!usageRes && !fetchedMappings) return;

          // Cache per-index field usage so future parses can reuse it.
          if (usageRes) {
            latestFieldUsageRef.current = {
              ...(latestFieldUsageRef.current ?? {}),
              ...usageRes
            } as FieldUsageStatsResponse;
          }

          if (fetchedMappings?.[indexName]) {
            latestMappingsRef.current = {
              ...(latestMappingsRef.current ?? {}),
              ...fetchedMappings
            };
          }

          setFieldUsageAllMap((prev) => {
            const usageForParse = usageRes ?? latestFieldUsageRef.current;
            const mappingForParse = fetchedMappings ?? effectiveMappings;
            const lite = parseFieldUsageIndexLite(indexName, usageForParse, mappingForParse);
            const detailed = parseFieldUsageIndexDetailed(indexName, usageForParse, mappingForParse);
            const existing = prev[indexName] ?? {};
            return {
              ...prev,
              [indexName]: { ...lite, ...existing, ...detailed }
            };
          });
        } catch {
          // Ignore index-specific field usage errors; UI will simply show no data.
        }
      })();
    },
    []
  );

  useEffect(() => {
    if (clusterKey) {
      setError(null);
      setCatalog([]);
      setAliases([]);
      setFieldUsageAllMap({});
      mappingsCacheRef.current = null;
      setForbidden(false);
      setCatalogPage(1);
      setCatalogPageSize(DEFAULT_PAGE_SIZE);
      setDataStreamsExpanded(false);
      // Keep indicesExpanded as-is; user controls when to expand and fetch
      setPlacementExpanded(false);
      setPlacementRowsRaw([]);
      setPlacementError(null);
      setPlacementLoading(false);
      setPlacementPage(1);
      setPlacementPageSize(DEFAULT_PAGE_SIZE);
      setPlacementSearchTerm('');
      setPlacementSortColumn('max_store');
      setPlacementSortDirection('desc');

      setIlmAllExpanded(false);
      setIlmAllLoading(false);
      setIlmAllError(null);
      setIlmAllSearchTerm('');
      setIlmAllPage(1);
      setIlmAllPageSize(DEFAULT_PAGE_SIZE);
      setIlmAllSortColumn('message');
      setIlmAllSortDirection('desc');
      setIlmAllExplain(null);
      setIlmAllShards([]);
      setIlmAllPhaseFilter('');
      setIlmAllRolloverAlertOpen(false);
      setIlmAllRolloverAlertText('');
      setIlmAllRolloverCommand('');
      setDataStreamRows([]);
      setDataStreamBackingIndicesMap({});
      setDataStreamIndexStoreBytesMap({});
      setDataStreamsError(null);
      setDataStreamsLoading(false);
      setDataStreamsSearchTerm('');
      setDataStreamsSortColumn('totalStoreBytes');
      setDataStreamsSortDirection('desc');
      setDataStreamsPage(1);
      setDataStreamsPageSize(10);
      setSelectedDataStreamName(null);
      setDataStreamIlmLoading(false);
      setDataStreamIlmError(null);
      setDataStreamIlmExplain(null);
      setDataStreamModalSortColumn('created');
      setDataStreamModalSortDirection('desc');
    } else {
      setCatalog([]);
      setAliases([]);
      setError(null);
      setForbidden(false);
    }
  }, [clusterKey]);

  const parseBytes = useCallback((value?: string): number => {
    if (!value) return 0;
    const n = parseInt(String(value).trim(), 10);
    return Number.isFinite(n) ? n : 0;
  }, []);

  const formatBytesCompact = useCallback((bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }, []);

  const getNodeTier = useCallback((roles?: string[] | null): TierKey => {
    const r = (roles ?? []).map((x) => String(x).toLowerCase());
    if (r.includes('data_frozen')) return 'frozen';
    if (r.includes('data_cold')) return 'cold';
    if (r.includes('data_warm')) return 'warm';
    if (r.includes('data_hot')) return 'hot';
    // fallback: content/other data roles -> hot (per requirement)
    return 'hot';
  }, []);

  const fetchDataStreamsTierRows = useCallback(async (signal?: AbortSignal) => {
    const cluster = activeClusterRef.current;
    if (!cluster || isClusterUnreachable) return;
    setDataStreamsLoading(true);
    setDataStreamsError(null);
    try {
      const [dsRes, shardsRes, nodesRes, catalogRes] = await Promise.all([
        getDataStreams(cluster, signal),
        getCatShardsBytes(cluster, signal),
        getNodesRoles(cluster, signal),
        // Needed for modal columns: health, docs, pri/rep.
        // Keep it coupled to Data streams so modal isn't empty when Indices catalog isn't expanded.
        getIndicesCatalog(cluster, signal).catch(() => [] as CatIndexRow[])
      ]);

      if (Array.isArray(catalogRes)) {
        setCatalog(catalogRes);
      }

      const dataStreams = (dsRes?.data_streams ?? []).filter(Boolean) as DataStreamInfo[];
      const backingIndexToStream = new Map<string, string>();
      const streamStatus = new Map<string, string>();
      const streamIndexCount = new Map<string, number>();
      const streamToBackingIndices: Record<string, string[]> = {};

      for (const ds of dataStreams) {
        const name = ds.name;
        const indices = ds.indices ?? [];
        streamStatus.set(name, String(ds.status ?? 'UNKNOWN'));
        streamIndexCount.set(name, indices.length);
        streamToBackingIndices[name] = indices.map((i) => i.index_name).filter(Boolean);
        for (const idx of indices) {
          if (idx?.index_name) backingIndexToStream.set(idx.index_name, name);
        }
      }

      const nodeNameToTier = new Map<string, TierKey>();
      const nodes = nodesRes?.nodes ?? {};
      for (const nodeId of Object.keys(nodes)) {
        const n = nodes[nodeId];
        const nodeName = n?.name ? String(n.name) : '';
        if (!nodeName) continue;
        nodeNameToTier.set(nodeName, getNodeTier(n?.roles ?? []));
      }

      const byStream: Record<
        string,
        { hot: number; warm: number; cold: number; frozen: number; total: number }
      > = {};
      const byIndexTotal: Record<string, number> = {};

      for (const row of shardsRes ?? []) {
        const indexName = row.index;
        const streamName = backingIndexToStream.get(indexName);
        if (!streamName) continue; // not a data stream backing index
        if (!row.node) continue;
        const state = String(row.state ?? '').toUpperCase();
        if (state === 'UNASSIGNED') continue;
        // keep STARTED/RELOCATING; ignore initializing shards (store often 0)
        if (state !== 'STARTED' && state !== 'RELOCATING') continue;

        const tier = nodeNameToTier.get(String(row.node)) ?? 'hot';
        const storeBytes = parseBytes(row.store);
        if (!byStream[streamName]) byStream[streamName] = { hot: 0, warm: 0, cold: 0, frozen: 0, total: 0 };
        byStream[streamName][tier] += storeBytes;
        byStream[streamName].total += storeBytes;
        byIndexTotal[indexName] = (byIndexTotal[indexName] ?? 0) + storeBytes;
      }

      const rows: DataStreamTierRow[] = dataStreams.map((ds) => {
        const name = ds.name;
        const agg = byStream[name] ?? { hot: 0, warm: 0, cold: 0, frozen: 0, total: 0 };
        return {
          name,
          status: String(ds.status ?? 'UNKNOWN'),
          indexCount: streamIndexCount.get(name) ?? (ds.indices?.length ?? 0),
          totalStoreBytes: agg.total,
          hotStoreBytes: agg.hot,
          warmStoreBytes: agg.warm,
          coldStoreBytes: agg.cold,
          frozenStoreBytes: agg.frozen
        };
      });

      setDataStreamRows(rows);
      setDataStreamBackingIndicesMap(streamToBackingIndices);
      setDataStreamIndexStoreBytesMap(byIndexTotal);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      const isTimeoutOrNetwork = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
      setDataStreamsError(
        isTimeoutOrNetwork && cluster ? getNetworkErrorMessage(cluster.baseUrl) : (msg || 'Failed to load data streams')
      );
      setDataStreamRows([]);
      setDataStreamBackingIndicesMap({});
      setDataStreamIndexStoreBytesMap({});
    } finally {
      setDataStreamsLoading(false);
    }
  }, [getNodeTier, parseBytes, clusterKey, isClusterUnreachable]);

  const selectedDataStreamRow = useMemo(() => {
    if (!selectedDataStreamName) return null;
    return dataStreamRows.find((r) => r.name === selectedDataStreamName) ?? null;
  }, [selectedDataStreamName, dataStreamRows]);

  const catalogByIndex = useMemo(() => {
    const map = new Map<string, CatIndexRow>();
    (catalog ?? []).forEach((r) => {
      if (r.index) map.set(r.index, r);
    });
    return map;
  }, [catalog]);

  const getIlmPhaseForIndex = useCallback((indexName: string): string => {
    const info = dataStreamIlmExplain?.indices?.[indexName];
    const phase = info?.phase;
    return phase ? String(phase) : '—';
  }, [dataStreamIlmExplain]);

  const getIlmActionStepForIndex = useCallback((indexName: string): string => {
    const info = dataStreamIlmExplain?.indices?.[indexName];
    const action = info?.action ? String(info.action) : '';
    const step = info?.step ? String(info.step) : '';
    if (!action && !step) return '—';
    const a = action.trim();
    const s = step.trim();
    if (a && s && a.toLowerCase() === 'complete' && s.toLowerCase() === 'complete') return 'complete';
    if (a && s && a.toLowerCase() === s.toLowerCase()) return a;
    return s ? `${a || '—'} / ${s}` : a;
  }, [dataStreamIlmExplain]);

  const formatAgeShort = useCallback((createdAtMs?: number | null): string => {
    if (!createdAtMs || !Number.isFinite(createdAtMs)) return '—';
    const diffMs = Date.now() - createdAtMs;
    if (!Number.isFinite(diffMs) || diffMs < 0) return '—';
    const min = Math.floor(diffMs / 60000);
    if (min < 60) return `${Math.max(0, min)}m`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }, []);

  type DataStreamIndexRow = {
    index: string;
    health: string;
    primary: number;
    total: number;
    sizeBytes: number;
    createdAtMs: number | null;
    createdAge: string;
    ilmAgeMs: number | null;
    ilmAgeLabel: string;
    phase: string;
    ilmActionStep: string;
  };

  const selectedDataStreamIndexRows = useMemo((): DataStreamIndexRow[] => {
    if (!selectedDataStreamName) return [];
    const list = dataStreamBackingIndicesMap[selectedDataStreamName] ?? [];
    return list.map((idx) => {
      const cat = catalogByIndex.get(idx);
      const pri = parseInt(String(cat?.pri ?? 0), 10) || 0;
      const rep = parseInt(String(cat?.rep ?? 0), 10) || 0;
      const total = pri > 0 ? pri * (1 + Math.max(0, rep)) : 0;
      const health = String(cat?.health ?? '—').toUpperCase();
      const sizeBytes = dataStreamIndexStoreBytesMap[idx] ?? 0;
      const createdAtMsRaw = dataStreamIlmExplain?.indices?.[idx]?.index_creation_date_millis;
      const createdAtMsFromIlm =
        typeof createdAtMsRaw === 'number'
          ? createdAtMsRaw
          : createdAtMsRaw != null
            ? parseInt(String(createdAtMsRaw), 10) || null
            : null;
      const createdAtFromCat = cat?.['creation.date.string'];
      const createdAtMsFromCat =
        typeof createdAtFromCat === 'string' && createdAtFromCat.trim()
          ? (Number.isFinite(Date.parse(createdAtFromCat)) ? Date.parse(createdAtFromCat) : null)
          : null;
      const createdAtMs = createdAtMsFromIlm ?? createdAtMsFromCat;
      const ilmPhaseStartMsRaw = dataStreamIlmExplain?.indices?.[idx]?.phase_time_millis;
      const ilmPhaseStartMs =
        typeof ilmPhaseStartMsRaw === 'number'
          ? ilmPhaseStartMsRaw
          : ilmPhaseStartMsRaw != null
            ? parseInt(String(ilmPhaseStartMsRaw), 10) || null
            : null;
      return {
        index: idx,
        health,
        primary: pri,
        total,
        sizeBytes,
        createdAtMs,
        createdAge: formatAgeShort(createdAtMs),
        ilmAgeMs: ilmPhaseStartMs,
        ilmAgeLabel: formatAgeShort(ilmPhaseStartMs),
        phase: String(getIlmPhaseForIndex(idx) ?? '—'),
        ilmActionStep: String(getIlmActionStepForIndex(idx) ?? '—')
      };
    });
  }, [
    selectedDataStreamName,
    dataStreamBackingIndicesMap,
    dataStreamIndexStoreBytesMap,
    catalogByIndex,
    getIlmPhaseForIndex,
    getIlmActionStepForIndex,
    dataStreamIlmExplain,
    formatAgeShort
  ]);

  const selectedDataStreamIndexRowsSorted = useMemo(() => {
    const dir = dataStreamModalSortDirection === 'asc' ? 1 : -1;
    const col = dataStreamModalSortColumn;
    return [...selectedDataStreamIndexRows].sort((a, b) => {
      if (col === 'ilmAge') {
        const aVal = a.ilmAgeMs ?? -1;
        const bVal = b.ilmAgeMs ?? -1;
        return dir * (aVal - bVal);
      }
      if (col === 'created') {
        const aVal = a.createdAtMs ?? -1;
        const bVal = b.createdAtMs ?? -1;
        return dir * (aVal - bVal);
      }
      if (col === 'primaryTotal') {
        const aVal = a.total;
        const bVal = b.total;
        return dir * (aVal - bVal);
      }
      const aVal = a[col];
      const bVal = b[col];
      if (typeof aVal === 'number' && typeof bVal === 'number') return dir * (aVal - bVal);
      return dir * String(aVal).localeCompare(String(bVal));
    });
  }, [selectedDataStreamIndexRows, dataStreamModalSortColumn, dataStreamModalSortDirection]);

  useEffect(() => {
    if (!selectedDataStreamName) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedDataStreamName(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedDataStreamName]);

  useEffect(() => {
    const cluster = activeClusterRef.current;
    const dsName = selectedDataStreamName;
    if (!cluster || !dsName) {
      setDataStreamIlmLoading(false);
      setDataStreamIlmError(null);
      setDataStreamIlmExplain(null);
      return;
    }

    // Try targeted explain first, then fallback to backing indices if needed.
    const controller = new AbortController();
    const signal = controller.signal;
    const backingIndices = (dataStreamBackingIndicesMap[dsName] ?? []).filter(Boolean);
    setDataStreamIlmError(null);
    setDataStreamIlmExplain(null);
    (async () => {
      try {
        setDataStreamIlmLoading(true);
        try {
          const explain = await getIlmExplain(cluster, dsName, signal);
          setDataStreamIlmExplain(explain);
          return;
        } catch (primaryError) {
          const primaryMsg = primaryError instanceof Error ? primaryError.message : '';
          const isUnsupportedDatastreamExplain = /ILM explain (400|404)\b/i.test(primaryMsg);
          if (!isUnsupportedDatastreamExplain || backingIndices.length === 0) {
            throw primaryError;
          }
          const explainFallback = await getIlmExplain(cluster, backingIndices.join(','), signal);
          setDataStreamIlmExplain(explainFallback);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : '';
        const lowerMsg = msg.toLowerCase();
        const isAbort = lowerMsg.includes('abort');
        if (isAbort) return;
        const isTimeoutOrNetwork = lowerMsg.includes('timeout') || lowerMsg.includes('network');
        setDataStreamIlmError(
          isTimeoutOrNetwork ? getNetworkErrorMessage(cluster.baseUrl) : (msg || 'Failed to load ILM explain')
        );
        setDataStreamIlmExplain(null);
      } finally {
        setDataStreamIlmLoading(false);
      }
    })();

    return () => controller.abort();
  }, [selectedDataStreamName, clusterKey, dataStreamBackingIndicesMap]);

  useEffect(() => {
    if (!dataStreamsExpanded || isClusterUnreachable) return;
    const controller = new AbortController();
    void fetchDataStreamsTierRows(controller.signal);
    return () => controller.abort();
  }, [dataStreamsExpanded, fetchDataStreamsTierRows, isClusterUnreachable]);

  const filteredDataStreams = useMemo(() => {
    const parsed = parseSearchTerms(dataStreamsSearchTerm);
    const base = hasSearchTerms(parsed)
      ? dataStreamRows.filter((r) => {
          const backing = dataStreamBackingIndicesMap[r.name] ?? [];
          return matchesParsedTermsInAnyText([r.name, ...backing.map((idx) => String(idx))], parsed);
        })
      : dataStreamRows;

    const sorted = [...base].sort((a, b) => {
      const dir = dataStreamsSortDirection === 'asc' ? 1 : -1;
      const col = dataStreamsSortColumn;
      const aVal = a[col];
      const bVal = b[col];
      if (typeof aVal === 'number' && typeof bVal === 'number') return dir * (aVal - bVal);
      return dir * String(aVal).localeCompare(String(bVal));
    });

    return sorted;
  }, [
    dataStreamsSearchTerm,
    dataStreamRows,
    dataStreamBackingIndicesMap,
    dataStreamsSortColumn,
    dataStreamsSortDirection
  ]);

  const dataStreamsTotals = useMemo(() => {
    const term = dataStreamsSearchTerm.trim();
    const base = term ? filteredDataStreams : dataStreamRows;
    const streamCount = base.length;
    let indexCountSum = 0;
    let totalBytes = 0;
    let hotBytes = 0;
    let warmBytes = 0;
    let coldBytes = 0;
    let frozenBytes = 0;
    for (const r of base) {
      indexCountSum += r.indexCount ?? 0;
      totalBytes += r.totalStoreBytes ?? 0;
      hotBytes += r.hotStoreBytes ?? 0;
      warmBytes += r.warmStoreBytes ?? 0;
      coldBytes += r.coldStoreBytes ?? 0;
      frozenBytes += r.frozenStoreBytes ?? 0;
    }
    return {
      streamCount,
      indexCountSum,
      totalBytes,
      hotBytes,
      warmBytes,
      coldBytes,
      frozenBytes,
      isFiltered: !!term
    };
  }, [dataStreamsSearchTerm, filteredDataStreams, dataStreamRows]);

  useEffect(() => {
    if (!selectedDataStreamName) return;
    // Default sort for modal: Created desc
    setDataStreamModalSortColumn('created');
    setDataStreamModalSortDirection('desc');
  }, [selectedDataStreamName]);

  useEffect(() => {
    setDataStreamsPage(1);
  }, [filteredDataStreams.length, dataStreamsPageSize, dataStreamsSearchTerm, dataStreamsSortColumn, dataStreamsSortDirection]);

  const dataStreamsTotalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredDataStreams.length / Math.max(1, dataStreamsPageSize)));
  }, [filteredDataStreams.length, dataStreamsPageSize]);

  const paginatedDataStreams = useMemo(() => {
    const size = Math.max(1, dataStreamsPageSize);
    const page = Math.min(Math.max(1, dataStreamsPage), dataStreamsTotalPages);
    const start = (page - 1) * size;
    return filteredDataStreams.slice(start, start + size);
  }, [filteredDataStreams, dataStreamsPage, dataStreamsPageSize, dataStreamsTotalPages]);

  const visibleTierColumns = useMemo(() => {
    const anyHot = dataStreamRows.some((r) => (r.hotStoreBytes ?? 0) > 0);
    const anyWarm = dataStreamRows.some((r) => (r.warmStoreBytes ?? 0) > 0);
    const anyCold = dataStreamRows.some((r) => (r.coldStoreBytes ?? 0) > 0);
    const anyFrozen = dataStreamRows.some((r) => (r.frozenStoreBytes ?? 0) > 0);
    return { hot: anyHot, warm: anyWarm, cold: anyCold, frozen: anyFrozen };
  }, [dataStreamRows]);

  useEffect(() => {
    const allowed: Array<keyof DataStreamTierRow> = [
      'name',
      'status',
      'indexCount',
      'totalStoreBytes',
      ...(visibleTierColumns.hot ? (['hotStoreBytes'] as const) : []),
      ...(visibleTierColumns.warm ? (['warmStoreBytes'] as const) : []),
      ...(visibleTierColumns.cold ? (['coldStoreBytes'] as const) : []),
      ...(visibleTierColumns.frozen ? (['frozenStoreBytes'] as const) : [])
    ];
    if (!allowed.includes(dataStreamsSortColumn)) {
      setDataStreamsSortColumn('totalStoreBytes');
      setDataStreamsSortDirection('desc');
    }
  }, [dataStreamsSortColumn, visibleTierColumns]);

  const fetchIlmAllExplain = useCallback(async () => {
    if (!activeCluster || isClusterUnreachable) return;
    setIlmAllLoading(true);
    setIlmAllError(null);
    const controller = new AbortController();
    const signal = controller.signal;
    try {
      const [data, shards, catalogRes] = await Promise.all([
        getIlmExplain(activeCluster, '*', signal),
        getCatShardsPlacement(activeCluster, signal).catch(() => [] as CatShardRow[]),
        getIndicesCatalog(activeCluster, signal).catch(() => [] as CatIndexRow[])
      ]);
      setIlmAllExplain(data);
      setIlmAllShards(Array.isArray(shards) ? shards : []);
      if (Array.isArray(catalogRes) && catalogRes.length > 0) {
        setCatalog(catalogRes);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      const isTimeoutOrNetwork =
        msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
      setIlmAllError(
        isTimeoutOrNetwork ? getNetworkErrorMessage(activeCluster.baseUrl) : (msg || 'Failed to load ILM explain')
      );
      setIlmAllExplain(null);
      setIlmAllShards([]);
    } finally {
      setIlmAllLoading(false);
    }
  }, [activeCluster?.baseUrl, isClusterUnreachable]);

  const fetchPlacement = useCallback(async () => {
    if (!activeCluster || isClusterUnreachable) return;
    setPlacementLoading(true);
    setPlacementError(null);
    const controller = new AbortController();
    const signal = controller.signal;
    try {
      const rows = await getCatShardsPlacement(activeCluster, signal);
      setPlacementRowsRaw(rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      const isTimeoutOrNetwork =
        msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
      setPlacementError(
        isTimeoutOrNetwork ? getNetworkErrorMessage(activeCluster.baseUrl) : (msg || 'Failed to load shard placement')
      );
      setPlacementRowsRaw([]);
    } finally {
      setPlacementLoading(false);
    }
  }, [activeCluster?.baseUrl, isClusterUnreachable]);

  type PlacementSummaryRow = {
    index: string;
    nodes: string[];
    nodesText: string;
    shardCount: number;
    primaries: number;
    replicas: number;
    unassigned: number;
    primaryTotalValue: number;
    maxStore: string | null;
    maxStoreBytes: number;
  };

  const placementSummaryRows = useMemo((): PlacementSummaryRow[] => {
    const map = new Map<string, PlacementSummaryRow>();
    for (const r of placementRowsRaw) {
      const idx = r.index ?? '';
      if (!idx) continue;
      const key = idx;
      const node = r.node ?? '—';
      const storeBytes = parseCatByteSizeToBytes(r.store);
      let row = map.get(key);
      if (!row) {
        row = {
          index: key,
          nodes: [],
          nodesText: '',
          shardCount: 0,
          primaries: 0,
          replicas: 0,
          unassigned: 0,
          primaryTotalValue: 0,
          maxStore: null,
          maxStoreBytes: 0
        };
        map.set(key, row);
      }
      row.shardCount += 1;
      if (r.prirep === 'p') row.primaries += 1;
      else if (r.prirep === 'r') row.replicas += 1;
      if ((r.state ?? '').toUpperCase() === 'UNASSIGNED') row.unassigned += 1;

      if (!row.nodes.includes(node)) row.nodes.push(node);
      if (storeBytes > row.maxStoreBytes) {
        row.maxStoreBytes = storeBytes;
        row.maxStore = r.store ?? null;
      }
    }
    return [...map.values()].map((r) => {
      const sortedNodes = [...r.nodes].sort((a, b) => a.localeCompare(b));
      return {
        ...r,
        nodes: sortedNodes,
        nodesText: sortedNodes.join(', '),
        primaryTotalValue: r.shardCount > 0 ? r.primaries / r.shardCount : 0
      };
    });
  }, [placementRowsRaw]);

  const filteredPlacementRows = useMemo(() => {
    const parsed = parseSearchTerms(placementSearchTerm);
    if (!hasSearchTerms(parsed)) return placementSummaryRows;
    return placementSummaryRows.filter((row) => {
      const indexIncludeMatch = parsed.includeTerms.every((term) => matchesMaybeWildcard(row.index, term));
      const indexExcludeMatch = parsed.excludeTerms.every((term) => !matchesMaybeWildcard(row.index, term));
      const nodeMatch = row.nodes.some((n) => {
        const normalizedNode = normalizeSearchText(n);
        const nodeIncludeMatch = parsed.includeTerms.every((term) => normalizedNode.includes(term));
        const nodeExcludeMatch = parsed.excludeTerms.every((term) => !normalizedNode.includes(term));
        return nodeIncludeMatch && nodeExcludeMatch;
      });
      const indexMatch = indexIncludeMatch && indexExcludeMatch;
      return indexMatch || nodeMatch;
    });
  }, [placementSummaryRows, placementSearchTerm]);

  const getPlacementSortFn = useCallback((col: string) => {
    switch (col) {
      case 'index':
        return (a: PlacementSummaryRow, b: PlacementSummaryRow) => a.index.localeCompare(b.index);
      case 'nodes':
        return (a: PlacementSummaryRow, b: PlacementSummaryRow) => a.nodesText.localeCompare(b.nodesText);
      case 'primary_total':
        return (a: PlacementSummaryRow, b: PlacementSummaryRow) => a.primaryTotalValue - b.primaryTotalValue;
      case 'max_store':
        return (a: PlacementSummaryRow, b: PlacementSummaryRow) => a.maxStoreBytes - b.maxStoreBytes;
      default:
        return () => 0;
    }
  }, []);

  const sortedPlacementRows = useMemo(() => {
    const fn = getPlacementSortFn(placementSortColumn);
    const mult = placementSortDirection === 'asc' ? 1 : -1;
    return [...filteredPlacementRows].sort((a, b) => mult * fn(a, b));
  }, [filteredPlacementRows, getPlacementSortFn, placementSortColumn, placementSortDirection]);

  const handlePlacementSort = useCallback((columnKey: string) => {
    setPlacementSortColumn((prev) => {
      if (prev === columnKey) {
        setPlacementSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        // First click should sort descending
        setPlacementSortDirection('desc');
      }
      return columnKey;
    });
    setPlacementPage(1);
  }, []);

  const placementTotalPages = Math.max(1, Math.ceil(sortedPlacementRows.length / Math.max(1, placementPageSize)));
  const placementPaginatedRows = useMemo(() => {
    const size = Math.max(1, placementPageSize);
    const start = (placementPage - 1) * size;
    return sortedPlacementRows.slice(start, start + size);
  }, [sortedPlacementRows, placementPage, placementPageSize]);

  useEffect(() => {
    setPlacementPage(1);
  }, [placementSearchTerm, sortedPlacementRows.length, placementPageSize]);

  type IlmAllRow = {
    index: string;
    managed: boolean;
    ilmStatus: 'Managed' | 'Without ILM';
    policy: string;
    phase: string;
    actionStep: string;
    rolloverConditions: string;
    shardSizesText: string;
    shardSizesAllText: string;
    totalShardSizeText: string;
    totalShardSizeBytes: number;
    primaryCount: number;
    totalCount: number;
    ageText: string;
    ageMs: number;
    stepMessage: string;
    rolloverStatusText: string;
    rolloverAlertText: string;
    rolloverIsDue: boolean;
  };

  const ilmAllRows = useMemo((): IlmAllRow[] => {
    const indices = ilmAllExplain?.indices ?? {};
    const catalogIndexNames = (catalog ?? [])
      .map((r) => (r.index ?? '').trim())
      .filter(Boolean);
    const explainIndexNames = Object.keys(indices).filter((name) => name !== '_shards');
    const allIndexNames = Array.from(new Set([...catalogIndexNames, ...explainIndexNames]));
    const rows: IlmAllRow[] = [];
    const shardAgg: Record<string, {
      sizes: Array<{ bytes: number; text: string }>;
      totalBytes: number;
      primary: number;
      total: number;
      primaryDocsSum: number;
      primaryMaxDocs: number;
      primaryMaxBytes: number;
    }> = {};
    for (const s of ilmAllShards) {
      const idx = s.index ?? '';
      if (!idx) continue;
      const bytes = parseCatByteSizeToBytes(s.store);
      const docs = parseCatNumber(s.docs);
      if (!shardAgg[idx]) {
        shardAgg[idx] = { sizes: [], totalBytes: 0, primary: 0, total: 0, primaryDocsSum: 0, primaryMaxDocs: 0, primaryMaxBytes: 0 };
      }
      shardAgg[idx].sizes.push({ bytes, text: s.store ?? '—' });
      shardAgg[idx].totalBytes += bytes;
      shardAgg[idx].total += 1;
      if (s.prirep === 'p') {
        shardAgg[idx].primary += 1;
        shardAgg[idx].primaryDocsSum += docs;
        shardAgg[idx].primaryMaxDocs = Math.max(shardAgg[idx].primaryMaxDocs, docs);
        shardAgg[idx].primaryMaxBytes = Math.max(shardAgg[idx].primaryMaxBytes, bytes);
      }
    }

    for (const indexName of allIndexNames) {
      const v = indices[indexName];
      const hasExplain = !!v && typeof v === 'object';
      const managed = hasExplain ? ((v as { managed?: boolean }).managed ?? false) : false;
      const ilmStatus: IlmAllRow['ilmStatus'] = managed ? 'Managed' : 'Without ILM';
      const policy = hasExplain ? ((v as { policy?: string }).policy ?? '—') : '—';
      const phase = hasExplain ? ((v as { phase?: string }).phase ?? '—') : '—';
      const action = hasExplain ? ((v as { action?: string }).action ?? '—') : '—';
      const stepRaw = hasExplain ? (v as { step?: unknown }).step : undefined;
      const step =
        typeof stepRaw === 'string'
          ? stepRaw
          : (stepRaw as { name?: string } | undefined)?.name ?? '—';
      const actionStep = hasExplain ? (action === step ? action : `${action} / ${step}`) : 'not managed by ILM';
      const alreadyCompleted = action === 'complete' && step === 'complete';
      const rollover = hasExplain ? (v as {
        phase_execution?: { phase_definition?: { actions?: { rollover?: Record<string, unknown> } } };
      }).phase_execution?.phase_definition?.actions?.rollover : undefined;
      const rolloverConditions = (() => {
        if (!rollover || typeof rollover !== 'object') return '—';
        const minLines: string[] = [];
        const maxLines: string[] = [];

        // Hide defaults: min_docs=1, max_primary_shard_docs=200000000
        if (rollover.min_docs != null && String(rollover.min_docs) !== '1') {
          minLines.push(`min_docs=${String(rollover.min_docs)}`);
        }
        if (rollover.min_size != null) minLines.push(`min_size=${String(rollover.min_size)}`);

        if (rollover.max_age != null) maxLines.push(`max_age=${String(rollover.max_age)}`);
        if (rollover.max_primary_shard_size != null) maxLines.push(`max_primary_shard_size=${String(rollover.max_primary_shard_size)}`);
        if (rollover.max_primary_shard_docs != null && String(rollover.max_primary_shard_docs) !== '200000000') {
          maxLines.push(`max_primary_shard_docs=${String(rollover.max_primary_shard_docs)}`);
        }

        const lines = [...minLines, ...maxLines];
        return lines.length > 0 ? lines.join('\n') : '—';
      })();
      const ageText = hasExplain ? ((v as { age?: string }).age ?? '—') : '—';
      const ageMs = parseAgeToMs(ageText);
      const stepMessage =
        hasExplain
          ? ((v as { step_info?: { message?: string; reason?: string } }).step_info?.message ??
            (v as { step_info?: { message?: string; reason?: string } }).step_info?.reason ??
            '')
          : 'No ILM policy is attached to this index.';

      const shards = shardAgg[indexName];
      const sizesSorted = shards?.sizes ? [...shards.sizes].sort((a, b) => b.bytes - a.bytes) : [];
      const visibleSizes = sizesSorted.slice(0, 3).map((x) => x.text);
      const moreCount = Math.max(0, sizesSorted.length - visibleSizes.length);
      const shardSizesAllText = sizesSorted.map((x) => x.text).join('\n');
      const shardSizesText = sizesSorted.length === 0
        ? '—'
        : `${visibleSizes.join('\n')}${moreCount > 0 ? `\n+${moreCount} more` : ''}`;

      const totalBytes = shards?.totalBytes ?? 0;
      const totalShardSizeText = totalBytes > 0
        ? `${(totalBytes / (1024 ** 3)).toFixed(2)} GB`
        : '—';

      // Evaluate rollover due (heuristic): any max_* met AND all min_* met
      const maxAgeMs = rollover?.max_age ? parseAgeToMs(String(rollover.max_age)) : 0;
      const maxPriDocs = rollover?.max_primary_shard_docs != null ? Number(rollover.max_primary_shard_docs) : 0;
      const maxPriSizeBytes = rollover?.max_primary_shard_size ? parseCatByteSizeToBytes(String(rollover.max_primary_shard_size)) : 0;
      const minDocs = rollover?.min_docs != null ? Number(rollover.min_docs) : 0;
      const minSizeBytes = rollover?.min_size ? parseCatByteSizeToBytes(String(rollover.min_size)) : 0;

      const primaryMaxDocs = shards?.primaryMaxDocs ?? 0;
      const primaryMaxBytes = shards?.primaryMaxBytes ?? 0;
      const primaryDocsSum = shards?.primaryDocsSum ?? 0;

      const maxMet =
        (maxAgeMs > 0 && ageMs >= maxAgeMs) ||
        (maxPriDocs > 0 && primaryMaxDocs >= maxPriDocs) ||
        (maxPriSizeBytes > 0 && primaryMaxBytes >= maxPriSizeBytes);
      const minMet =
        (minDocs <= 0 || primaryDocsSum >= minDocs) &&
        (minSizeBytes <= 0 || totalBytes >= minSizeBytes);
      // If ILM already reports action+step complete, treat rollover as already handled (no alert)
      const rolloverIsDue = !!rollover && maxMet && minMet && !alreadyCompleted;

      const buildRolloverChecklist = (opts: {
        includeDefaults: boolean;
        includeDefaultTag: boolean;
        includeNote: boolean;
        includeMaxFailures: boolean;
      }) => {
        if (!rollover) return '—';
        const minLines: string[] = [];
        const maxOkLines: string[] = [];
        const maxFailLines: string[] = [];
        const defaultLines: string[] = [];
        const gb = (bytes: number) => `${(bytes / (1024 ** 3)).toFixed(2)} GB`;

        if (rollover.max_age != null && maxAgeMs > 0) {
          const ok = ageMs >= maxAgeMs;
          if (ok) {
            maxOkLines.push(`✅ max_age=${String(rollover.max_age)} age=${ageText}`);
          } else if (opts.includeMaxFailures) {
            maxFailLines.push(`❌ max_age=${String(rollover.max_age)} age=${ageText}`);
          }
        }
        if (rollover.max_primary_shard_size != null && maxPriSizeBytes > 0) {
          const ok = primaryMaxBytes >= maxPriSizeBytes;
          if (ok) {
            maxOkLines.push(`✅ max_primary_shard_size=${String(rollover.max_primary_shard_size)} shard_size=${gb(primaryMaxBytes)}`);
          } else if (opts.includeMaxFailures) {
            maxFailLines.push(`❌ max_primary_shard_size=${String(rollover.max_primary_shard_size)} shard_size=${gb(primaryMaxBytes)}`);
          }
        }
        if (rollover.max_primary_shard_docs != null && maxPriDocs > 0) {
          const isDefault = String(rollover.max_primary_shard_docs) === '200000000';
          const ok = primaryMaxDocs >= maxPriDocs;
          if (isDefault) {
            if (opts.includeDefaults) {
              const defaultTag = opts.includeDefaultTag ? ' (default)' : '';
              defaultLines.push(`${ok ? '✅' : '❌'}${defaultTag} max_primary_shard_docs=${String(rollover.max_primary_shard_docs)} doc_count=${primaryMaxDocs}`);
            }
          } else {
            if (ok) {
              maxOkLines.push(`✅ max_primary_shard_docs=${String(rollover.max_primary_shard_docs)} doc_count=${primaryMaxDocs}`);
            } else if (opts.includeMaxFailures) {
              maxFailLines.push(`❌ max_primary_shard_docs=${String(rollover.max_primary_shard_docs)} doc_count=${primaryMaxDocs}`);
            }
          }
        }
        if (rollover.min_docs != null && minDocs > 0) {
          const isDefault = String(rollover.min_docs) === '1';
          const ok = primaryDocsSum >= minDocs;
          if (isDefault) {
            if (opts.includeDefaults) {
              minLines; // keep non-default min_* section clean
              defaultLines.push(
                `${ok ? '✅' : '❌'}${opts.includeDefaultTag ? ' (default)' : ''} min_docs=${String(rollover.min_docs)} doc_count=${primaryDocsSum}`
              );
            }
          } else {
            minLines.push(`${ok ? '✅' : '❌'} min_docs=${String(rollover.min_docs)} doc_count=${primaryDocsSum}`);
          }
        }
        if (rollover.min_size != null && minSizeBytes > 0) {
          const ok = totalBytes >= minSizeBytes;
          minLines.push(`${ok ? '✅' : '❌'} min_size=${String(rollover.min_size)} total=${totalShardSizeText}`);
        }

        const lines = [...minLines, ...maxOkLines, ...maxFailLines];
        const base = lines.length > 0 ? lines.join('\n') : 'rollover configured';

        const withDefaultsBlock =
          opts.includeDefaults && defaultLines.length > 0
            ? `${base}\n\n---\n${defaultLines.join('\n')}`
            : base;

        if (!opts.includeNote) return withDefaultsBlock;
        return `${withDefaultsBlock}\n\nNote: Default rollover conditions must also be satisfied.`;
      };

      // Message column: show all min_* lines; for max_* show only ✅ ones (hide ❌ max lines)
      const rolloverStatusText = buildRolloverChecklist({
        includeDefaults: false,
        includeDefaultTag: false,
        includeNote: false,
        includeMaxFailures: false
      });
      // Alert modal: include defaults + include max failures + include note
      const rolloverAlertText = buildRolloverChecklist({
        includeDefaults: true,
        includeDefaultTag: true,
        includeNote: false,
        includeMaxFailures: true
      });

      rows.push({
        index: indexName,
        managed,
        ilmStatus,
        policy,
        phase,
        actionStep,
        rolloverConditions,
        ageText,
        ageMs,
        stepMessage
        ,
        shardSizesText,
        shardSizesAllText,
        totalShardSizeText,
        totalShardSizeBytes: totalBytes,
        primaryCount: shards?.primary ?? 0,
        totalCount: shards?.total ?? 0,
        rolloverStatusText,
        rolloverAlertText,
        rolloverIsDue
      });
    }
    return rows;
  }, [ilmAllExplain, ilmAllShards, catalog]);

  const ilmWithoutCount = useMemo(() => {
    return ilmAllRows.reduce((count, row) => count + (row.managed ? 0 : 1), 0);
  }, [ilmAllRows]);

  const filteredIlmAllRows = useMemo(() => {
    const parsed = parseSearchTerms(ilmAllSearchTerm);
    return ilmAllRows.filter((r) => {
      const phaseOk = ilmAllPhaseFilter ? r.phase === ilmAllPhaseFilter : true;
      if (!hasSearchTerms(parsed)) return phaseOk;
      return phaseOk && matchesParsedTermsInAnyText(
        [
          r.index,
          r.ilmStatus,
          r.policy,
          r.phase,
          r.actionStep,
          r.rolloverConditions,
          r.stepMessage,
          r.rolloverStatusText,
          r.rolloverAlertText
        ],
        parsed
      );
    });
  }, [ilmAllRows, ilmAllSearchTerm, ilmAllPhaseFilter]);

  const getIlmAllSortFn = useCallback((col: string) => {
    switch (col) {
      case 'index':
        return (a: IlmAllRow, b: IlmAllRow) => a.index.localeCompare(b.index);
      case 'ilm_status':
      case 'managed':
        return (a: IlmAllRow, b: IlmAllRow) => Number(a.managed) - Number(b.managed);
      case 'primary_total':
        return (a: IlmAllRow, b: IlmAllRow) => (a.totalCount ? a.primaryCount / a.totalCount : 0) - (b.totalCount ? b.primaryCount / b.totalCount : 0);
      case 'policy':
        return (a: IlmAllRow, b: IlmAllRow) => a.policy.localeCompare(b.policy);
      case 'phase':
        return (a: IlmAllRow, b: IlmAllRow) => a.phase.localeCompare(b.phase);
      case 'action_step':
        return (a: IlmAllRow, b: IlmAllRow) => a.actionStep.localeCompare(b.actionStep);
      case 'rollover':
        return (a: IlmAllRow, b: IlmAllRow) => a.rolloverConditions.localeCompare(b.rolloverConditions);
      case 'shard_sizes':
        return (a: IlmAllRow, b: IlmAllRow) => a.totalShardSizeBytes - b.totalShardSizeBytes;
      case 'age':
        return (a: IlmAllRow, b: IlmAllRow) => a.ageMs - b.ageMs;
      case 'message':
        return (a: IlmAllRow, b: IlmAllRow) => {
          const aHas = !!a.stepMessage?.trim() || a.rolloverIsDue;
          const bHas = !!b.stepMessage?.trim() || b.rolloverIsDue;
          if (aHas !== bHas) return Number(aHas) - Number(bHas);
          const aText = (a.rolloverIsDue ? a.rolloverStatusText : a.stepMessage).trim();
          const bText = (b.rolloverIsDue ? b.rolloverStatusText : b.stepMessage).trim();
          return aText.localeCompare(bText);
        };
      default:
        return () => 0;
    }
  }, []);

  const sortedIlmAllRows = useMemo(() => {
    const fn = getIlmAllSortFn(ilmAllSortColumn);
    const mult = ilmAllSortDirection === 'asc' ? 1 : -1;
    return [...filteredIlmAllRows].sort((a, b) => mult * fn(a, b));
  }, [filteredIlmAllRows, getIlmAllSortFn, ilmAllSortColumn, ilmAllSortDirection]);

  const handleIlmAllSort = useCallback((columnKey: string) => {
    setIlmAllSortColumn((prev) => {
      if (prev === columnKey) {
        setIlmAllSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        // First click should sort descending
        setIlmAllSortDirection('desc');
      }
      return columnKey;
    });
    setIlmAllPage(1);
  }, []);

  const ilmAllTotalPages = Math.max(1, Math.ceil(sortedIlmAllRows.length / Math.max(1, ilmAllPageSize)));
  const ilmAllPaginatedRows = useMemo(() => {
    const size = Math.max(1, ilmAllPageSize);
    const start = (ilmAllPage - 1) * size;
    return sortedIlmAllRows.slice(start, start + size);
  }, [sortedIlmAllRows, ilmAllPage, ilmAllPageSize]);

  useEffect(() => {
    setIlmAllPage(1);
  }, [ilmAllSearchTerm, sortedIlmAllRows.length, ilmAllPageSize]);

  useEffect(() => {
    if (!clusterKey || !placementExpanded || isClusterUnreachable) return;
    fetchPlacement();
  }, [clusterKey, placementExpanded, fetchPlacement, isClusterUnreachable]);

  useEffect(() => {
    if (!clusterKey || !ilmAllExpanded || isClusterUnreachable) return;
    fetchIlmAllExplain();
  }, [clusterKey, ilmAllExpanded, fetchIlmAllExplain, isClusterUnreachable]);

  useEffect(() => {
    if (!clusterKey || !indicesExpanded || isClusterUnreachable) return;
    fetchCatalogAndLists();
  }, [clusterKey, indicesExpanded, fetchCatalogAndLists, isClusterUnreachable]);

  useEffect(() => {
    const onRefresh = async () => {
      if (
        !activeCluster ||
        isClusterUnreachable ||
        (!indicesExpanded && !placementExpanded && !ilmAllExpanded)
      )
        return;
      onRefreshStateChange?.(true);
      try {
        await Promise.all([
          indicesExpanded ? fetchCatalogAndLists() : Promise.resolve(),
          placementExpanded ? fetchPlacement() : Promise.resolve(),
          ilmAllExpanded ? fetchIlmAllExplain() : Promise.resolve()
        ]);
      } finally {
        onRefreshStateChange?.(false);
      }
    };
    window.addEventListener('refreshIndices', onRefresh);
    return () => window.removeEventListener('refreshIndices', onRefresh);
  }, [
    activeCluster,
    isClusterUnreachable,
    indicesExpanded,
    placementExpanded,
    ilmAllExpanded,
    fetchCatalogAndLists,
    fetchPlacement,
    fetchIlmAllExplain,
    onRefreshStateChange
  ]);

  const filteredCatalog = useMemo(() => {
    const parsed = parseSearchTerms(searchTerm);
    if (!hasSearchTerms(parsed)) return catalog;
    return catalog.filter((row) => {
      const idx = row.index ?? '';
      const aliasesForIndex = aliases
        .filter((a) => (a.index ?? '') === idx)
        .map((a) => a.alias ?? '')
        .filter(Boolean);
      const dataStreamsForIndex = dataStreamRows
        .filter((ds) => (dataStreamBackingIndicesMap[ds.name] ?? []).includes(idx))
        .map((ds) => ds.name ?? '')
        .filter(Boolean);
      const summary = row.index ? fieldUsageAllMap[row.index] : undefined;
      const fieldList = summary?.fieldList ?? [];
      return matchesParsedTermsInAnyText(
        [
          row.index ?? '',
          ...aliasesForIndex,
          ...dataStreamsForIndex,
          ...fieldList.map((f) => f.name)
        ],
        parsed
      );
    });
  }, [catalog, searchTerm, fieldUsageAllMap, aliases, dataStreamRows, dataStreamBackingIndicesMap]);

  const indexToAliases = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const r of aliases) {
      const idx = r.index ?? '';
      const al = r.alias ?? '';
      if (idx && al) {
        if (!map[idx]) map[idx] = [];
        map[idx].push(al);
      }
    }
    return map;
  }, [aliases]);

  const getCatalogSortFn = useCallback(
    (col: string) => {
      const healthOrder: Record<string, number> = { green: 1, yellow: 2, red: 3 };
      switch (col) {
        case 'index':
          return (a: CatIndexRow, b: CatIndexRow) => (a.index ?? '').localeCompare(b.index ?? '');
        case 'health':
          return (a: CatIndexRow, b: CatIndexRow) =>
            (healthOrder[a.health ?? ''] ?? 99) - (healthOrder[b.health ?? ''] ?? 99);
        case 'aliases':
          return (a: CatIndexRow, b: CatIndexRow) => {
            const as = (indexToAliases[a.index ?? ''] ?? []).join(',');
            const bs = (indexToAliases[b.index ?? ''] ?? []).join(',');
            return as.localeCompare(bs);
          };
        case 'pri_rep':
          return (a: CatIndexRow, b: CatIndexRow) => {
            const pa = parseInt(a.pri ?? '0', 10) + parseInt(a.rep ?? '0', 10);
            const pb = parseInt(b.pri ?? '0', 10) + parseInt(b.rep ?? '0', 10);
            return pa - pb;
          };
        case 'docs.count':
          return (a: CatIndexRow, b: CatIndexRow) =>
            parseInt(a['docs.count'] ?? '0', 10) - parseInt(b['docs.count'] ?? '0', 10);
        case 'field_usage_total':
          return (a: CatIndexRow, b: CatIndexRow) =>
            (fieldUsageAllMap[a.index ?? '']?.totalFields ?? 0) - (fieldUsageAllMap[b.index ?? '']?.totalFields ?? 0);
        case 'field_usage_unused':
          return (a: CatIndexRow, b: CatIndexRow) =>
            (fieldUsageAllMap[a.index ?? '']?.unusedFields ?? 0) - (fieldUsageAllMap[b.index ?? '']?.unusedFields ?? 0);
        case 'field_usage_used':
          return (a: CatIndexRow, b: CatIndexRow) =>
            (fieldUsageAllMap[a.index ?? '']?.usedFields ?? 0) - (fieldUsageAllMap[b.index ?? '']?.usedFields ?? 0);
        default:
          return () => 0;
      }
    },
    [indexToAliases, fieldUsageAllMap]
  );

  const sortedCatalog = useMemo(() => {
    const fn = getCatalogSortFn(catalogSortColumn);
    const mult = catalogSortDirection === 'asc' ? 1 : -1;
    return [...filteredCatalog].sort((a, b) => mult * fn(a, b));
  }, [filteredCatalog, catalogSortColumn, catalogSortDirection, getCatalogSortFn]);

  const catalogTotalPages = Math.max(1, Math.ceil(sortedCatalog.length / Math.max(1, catalogPageSize)));
  const paginatedCatalog = useMemo(() => {
    const size = Math.max(1, catalogPageSize);
    const start = (catalogPage - 1) * size;
    return sortedCatalog.slice(start, start + size);
  }, [sortedCatalog, catalogPage, catalogPageSize]);

  useEffect(() => {
    setCatalogPage(1);
  }, [searchTerm, catalogPageSize]);

  useEffect(() => {
    if (!aliasesPopoverIndex) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAliasesPopoverIndex(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aliasesPopoverIndex]);

  useEffect(() => {
    if (!fieldsPopoverIndex) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (usageTypeInfoOpen) {
          setUsageTypeInfoOpen(false);
        } else {
          setFieldsPopoverIndex(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fieldsPopoverIndex, usageTypeInfoOpen]);

  useEffect(() => {
    if (!unsearchedFieldsPopoverIndex) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUnsearchedFieldsPopoverIndex(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [unsearchedFieldsPopoverIndex]);

  const handleUsedFieldsClick = useCallback((indexName: string) => {
    if (!indexName) return;
    setUsageTypeInfoOpen(false);
    ensureFieldUsageDetails(indexName);
    setFieldsPopoverMode('used');
    setFieldsPopoverIndex(indexName);
  }, [ensureFieldUsageDetails]);

  /** Same flow: lite map has no fieldList/unusedFieldNames until detailed parse runs. */
  const handleUnsearchedFieldsClick = useCallback((indexName: string) => {
    if (!indexName) return;
    ensureFieldUsageDetails(indexName);
    setUnsearchedFieldsPopoverIndex(indexName);
  }, [ensureFieldUsageDetails]);

  const handleCatalogSort = useCallback((columnKey: string) => {
    setCatalogSortColumn((prev) => {
      if (prev === columnKey) {
        setCatalogSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        // First click should sort descending
        setCatalogSortDirection('desc');
      }
      return columnKey;
    });
    setCatalogPage(1);
  }, []);

  const catalogColumns = useMemo(
    () => [
      {
        key: 'index',
        header: 'Index',
        className: 'font-mono tab-content-value',
        render: (row: CatIndexRow) => (
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => onOpenIndexDetails?.(row.index ?? '')}
              className="min-w-0 flex-1 text-left font-mono tab-content-value entity-name-link break-all"
            >
              {row.index ?? '—'}
            </button>
            {onOpenInQuery && row.index && (
              <button
                type="button"
                onClick={() => onOpenInQuery(row.index ?? '')}
                title="Open in Query tab"
                className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-blue-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-blue-400"
                aria-label={`Query ${row.index}`}
              >
                <Search className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )
      },
      {
        key: 'health',
        header: 'Health',
        className: 'tab-content-value',
        render: (row: CatIndexRow) => (
          <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${healthToBadgeClass(row.health)}`}>
            {row.health ?? '—'}
          </span>
        )
      },
      {
        key: 'aliases',
        header: 'Aliases',
        className: 'tab-content-value',
        render: (row: CatIndexRow) => {
          const list = row.index ? indexToAliases[row.index] : undefined;
          if (!list || list.length === 0) return '—';
          if (list.length > 3) {
            return (
              <button
                type="button"
                onClick={() => setAliasesPopoverIndex(row.index ?? null)}
                className="inline-flex items-center rounded border border-gray-300 bg-gray-50 px-2 py-0.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 tab-content-value"
              >
                {list.length} aliases
              </button>
            );
          }
          return <span className="break-all">{list.join(', ')}</span>;
        }
      },
      {
        key: 'pri_rep',
        header: 'Primary / Total',
        className: 'tab-content-value',
        render: (row: CatIndexRow) => formatPrimaryTotal(row.pri, row.rep)
      },
      {
        key: 'docs.count',
        header: 'Doc count',
        className: 'tab-content-value',
        render: (row: CatIndexRow) => {
          const raw = row['docs.count'];
          const num = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
          if (!Number.isFinite(num) && raw != null) return String(raw);
          return Number.isFinite(num) ? Intl.NumberFormat('en-US').format(num) : '—';
        }
      },
      {
        key: 'field_usage_total',
        header: 'Total fields',
        className: 'tab-content-value',
        render: (row: CatIndexRow) => {
          const s = row.index ? fieldUsageAllMap[row.index] : undefined;
          if (!s || s.totalFields === 0) return '—';
          return `${s.totalFields} field${s.totalFields !== 1 ? 's' : ''}`;
        }
      },
      {
        key: 'field_usage_unused',
        header: 'Unsearched fields',
        className: 'tab-content-value',
        render: (row: CatIndexRow) => {
          const s = row.index ? fieldUsageAllMap[row.index] : undefined;
          if (!s) return '—';
          if (!s.hasUsageData) return '—';
          return (
            <button
              type="button"
              onClick={() => row.index && handleUnsearchedFieldsClick(row.index)}
              className="inline-flex items-center rounded border border-gray-300 bg-gray-50 px-2 py-0.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 tab-content-value"
              title="Click to see field names"
            >
              {s.unusedFields} field{s.unusedFields !== 1 ? 's' : ''}
            </button>
          );
        }
      },
      {
        key: 'field_usage_used',
        header: 'Used fields',
        className: 'tab-content-value',
        render: (row: CatIndexRow) => {
          const s = row.index ? fieldUsageAllMap[row.index] : undefined;
          if (!s || !s.hasUsageData) return '—';
          return (
            <button
              type="button"
              onClick={() => row.index && handleUsedFieldsClick(row.index)}
              className="inline-flex items-center rounded border border-gray-300 bg-gray-50 px-2 py-0.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 tab-content-value"
              title="Click to see used fields"
            >
              {s.usedFields} field{s.usedFields !== 1 ? 's' : ''}
            </button>
          );
        }
      }
    ],
    [indexToAliases, fieldUsageAllMap, handleUsedFieldsClick, handleUnsearchedFieldsClick, onOpenIndexDetails, onOpenInQuery]
  );

  if (!activeCluster) {
    return (
      <div className="rounded-lg border border-gray-300 bg-white p-4 text-center text-sm text-gray-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400">
        No cluster selected.
      </div>
    );
  }

  const catalogForbidden = forbidden || (error != null && catalog.length === 0 && indicesExpanded);

  if (catalogForbidden) {
    return (
      <div className="flex flex-col gap-4">
        <ActiveSearchesSection
          diagnosisNav={diagnosisNav}
          onDiagnosisNavConsumed={onDiagnosisNavConsumed}
          onOpenIndexDiagnosis={onOpenIndexDiagnosis}
        />
        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800/50 shadow-sm max-h-[85vh] min-h-0 flex flex-col overflow-hidden">
        <div className="p-4 text-sm text-gray-700 dark:text-gray-300 relative flex flex-col min-h-0 overflow-y-auto">
          <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setPermissionHelpOpen((o) => !o)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              {permissionHelpOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              Insufficient permissions — How to add <code className="font-mono text-xs">view_index_metadata</code> or <code className="font-mono text-xs">monitor</code>?
            </button>
            {permissionHelpOpen && (
              <div className="px-3 pb-3 pt-1 border-t border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/30">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 dark:text-gray-100 mb-1.5">Description</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      The Field usage stats tab needs <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded font-mono">view_index_metadata</code> or <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded font-mono">monitor</code> cluster privilege.
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
                    <p className="text-xs font-medium text-gray-900 dark:text-gray-100 mb-1.5">Kibana Dev Tools</p>
                    <CodeBlockWithCopy text={INDICES_KIBANA_SNIPPET} label="Kibana snippet" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 dark:text-gray-100 mb-1.5">Terminal (cURL)</p>
                    <CodeBlockWithCopy text={curlSnippet} label="curl" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ActiveSearchesSection
        diagnosisNav={diagnosisNav}
        onDiagnosisNavConsumed={onDiagnosisNavConsumed}
        onOpenIndexDiagnosis={onOpenIndexDiagnosis}
      />

      <IndexExplorerSection
        activeCluster={activeCluster}
        isClusterUnreachable={isClusterUnreachable}
        expanded={regexSearchExpanded}
        onToggleExpanded={() => setRegexSearchExpanded((prev) => !prev)}
        onRefreshStateChange={onRefreshStateChange}
        onOpenIndexDetails={onOpenIndexDetails}
      />

      {/* Shards Map (cluster-wide shards placement) */}
      <section className="tab-section-card">
        <div className="tab-section-header tab-section-header-split">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TabSectionExpandTrigger
              expanded={placementExpanded}
              onToggle={() => setPlacementExpanded((prev) => !prev)}
              label="Shards Map"
              fillHitArea={true}
              suffix={
                <>
                  <InfoPopup
                    title="Shards Map"
                    modalTitle="Shards Map"
                    open={shardsMapInfoOpen}
                    onOpen={() => setShardsMapInfoOpen(true)}
                    onClose={() => setShardsMapInfoOpen(false)}
                  >
                    <div className="space-y-2">
                      <p>
                        Shows shard placement across nodes using <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET _cat/shards</code>.
                        Search matches index name (supports * wildcards) or node name.
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Tip: Click a node chip to filter by that node.
                      </p>
                    </div>
                  </InfoPopup>
                  {placementExpanded && placementLoading && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">Loading…</span>
                  )}
                </>
              }
            />
          </div>
          {placementExpanded && (
          <div className="tab-section-inline-tools">
            <div className="relative min-w-[8rem] max-w-[14rem] flex-1 sm:flex-none sm:w-44">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
              <input
                type="text"
                placeholder="Search index or node…"
                value={placementSearchTerm}
                onChange={(e) => setPlacementSearchTerm(e.target.value)}
                className="w-full pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 tab-content-value"
              />
              {placementSearchTerm && (
                <button
                  type="button"
                  onClick={() => setPlacementSearchTerm('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <Pagination
              currentPage={placementPage}
              totalPages={placementTotalPages}
              totalItems={sortedPlacementRows.length}
              pageSize={placementPageSize}
              onPageChange={setPlacementPage}
              inline
            />
            <select
              value={String(placementPageSize)}
              onChange={(e) => setPlacementPageSize(parseInt(e.target.value, 10) || DEFAULT_PAGE_SIZE)}
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
          )}
        </div>
        {placementExpanded && (
          <div className="tab-section-body">
            {placementError && (
              <div className="mx-2 mt-2 flex-shrink-0 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                {placementError}
              </div>
            )}
            <div className="tab-section-scroll tab-section-scroll-flush">
            <div className="overflow-x-auto">
              <table className="w-full text-left tab-content-value border-collapse table-auto">
                <thead>
                  <tr className="border-b-2 border-gray-300 bg-gray-100 dark:border-gray-600 dark:bg-gray-800">
                    {[
                      { key: 'index', label: 'Index', align: '' },
                      { key: 'nodes', label: 'Nodes', align: '' },
                      { key: 'primary_total', label: 'Primary / Total', align: 'text-right' },
                      { key: 'max_store', label: 'Shard size', align: 'text-right' }
                    ].map((col) => (
                      <th
                        key={col.key}
                        className={`px-3 py-2.5 font-bold text-gray-900 dark:text-gray-50 tab-content-value cursor-pointer select-none hover:bg-gray-200 dark:hover:bg-gray-700 ${col.align}`}
                        onClick={() => handlePlacementSort(col.key)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {placementSortColumn === col.key ? (
                            placementSortDirection === 'asc' ? (
                              <ArrowUp className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {placementPaginatedRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-gray-500 dark:text-gray-400">
                        {placementLoading ? 'Loading…' : 'No indices match the filter.'}
                      </td>
                    </tr>
                  ) : (
                    placementPaginatedRows.map((r) => (
                      <tr
                        key={r.index}
                        className="border-b border-gray-200 text-gray-800 transition hover:bg-blue-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/50"
                      >
                        <td
                          className={`px-3 py-2 font-mono tab-content-value whitespace-normal break-words ${
                            r.unassigned > 0 ? 'text-amber-600 dark:text-amber-400' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onOpenIndexDetails?.(r.index)}
                            className="text-left font-mono tab-content-value entity-name-link break-words"
                          >
                            {r.index}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex flex-wrap gap-1.5">
                            {(() => {
                              const parsed = parseSearchTerms(placementSearchTerm);
                              const nodeMatchesAllTerms = (node: string) =>
                                parsed.includeTerms.every((term) => normalizeSearchText(node).includes(term)) &&
                                parsed.excludeTerms.every((term) => !normalizeSearchText(node).includes(term));
                              const indexMatchesAllTerms =
                                parsed.includeTerms.every((term) => matchesMaybeWildcard(r.index, term)) &&
                                parsed.excludeTerms.every((term) => !matchesMaybeWildcard(r.index, term));
                              const anyNodeMatches = r.nodes.some((n) => nodeMatchesAllTerms(n));
                              const nodesToShow = !hasSearchTerms(parsed)
                                ? r.nodes
                                : indexMatchesAllTerms && !anyNodeMatches
                                  ? r.nodes
                                  : r.nodes.filter((n) => nodeMatchesAllTerms(n));
                              const visible = nodesToShow.slice(0, 6);
                              const hidden = Math.max(0, nodesToShow.length - visible.length);
                              return (
                                <>
                                  {visible.map((n) => (
                                    <button
                                      key={n}
                                      type="button"
                                      onClick={() => onOpenNodeDetails?.(n)}
                                      className="inline-flex shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-blue-700 hover:bg-gray-200 hover:underline dark:bg-gray-700/60 dark:text-gray-100 dark:hover:bg-gray-600 font-mono transition-colors"
                                      title={`Open node details for ${n}`}
                                    >
                                      {n}
                                    </button>
                                  ))}
                                  {hidden > 0 && (
                                    <span className="text-xs text-gray-500 dark:text-gray-400">+{hidden} more</span>
                                  )}
                                </>
                              );
                            })()}
                          </span>
                        </td>
                        <td
                          className="px-3 py-2 font-mono tabular-nums text-right"
                          title={`unassigned: ${r.unassigned}\nprimary: ${r.primaries}\nreplicas: ${r.replicas}`}
                        >
                          {r.primaries} / {r.shardCount}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-right">{r.maxStore ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            </div>
          </div>
        )}
      </section>

      {/* ILM explain — single section */}
      {/* ILM explain — single section */}
      <section className="tab-section-card">
        <div className="tab-section-header tab-section-header-split">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TabSectionExpandTrigger
              expanded={ilmAllExpanded}
              onToggle={() => setIlmAllExpanded((prev) => !prev)}
              label="ILM explain"
              fillHitArea={true}
              suffix={
                <>
                  <InfoPopup
                    title="ILM explain"
                    modalTitle="ILM explain"
                    open={ilmExplainInfoOpen}
                    onOpen={() => setIlmExplainInfoOpen(true)}
                    onClose={() => setIlmExplainInfoOpen(false)}
                  >
                    <div className="space-y-2">
                      <p>
                        Shows Index Lifecycle Management (ILM) health and progress per index using{' '}
                        <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET _all/_ilm/explain</code>, enriched with shard stats from{' '}
                        <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET _cat/shards</code>.
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Tip: Use Phase filter and the Message checklist to quickly spot rollover-related anomalies.
                      </p>
                    </div>
                  </InfoPopup>
                  {ilmAllExpanded && ilmAllLoading && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">Loading…</span>
                  )}
                  {ilmAllExpanded && !ilmAllLoading && !ilmAllError && (
                    <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/30 dark:text-amber-200">
                      Without ILM: {ilmWithoutCount}
                    </span>
                  )}
                </>
              }
            />
          </div>
          {ilmAllExpanded && (
            <div className="tab-section-inline-tools">
              <div className="relative min-w-[8rem] max-w-[14rem] flex-1 sm:flex-none sm:w-44">
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search index, policy, phase…"
                  value={ilmAllSearchTerm}
                  onChange={(e) => setIlmAllSearchTerm(e.target.value)}
                  className="w-full pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 tab-content-value"
                />
                {ilmAllSearchTerm && (
                  <button
                    type="button"
                    onClick={() => setIlmAllSearchTerm('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Pagination
                currentPage={ilmAllPage}
                totalPages={ilmAllTotalPages}
                totalItems={sortedIlmAllRows.length}
                pageSize={ilmAllPageSize}
                onPageChange={setIlmAllPage}
                inline
              />
              <select
                value={String(ilmAllPageSize)}
                onChange={(e) => setIlmAllPageSize(parseInt(e.target.value, 10) || DEFAULT_PAGE_SIZE)}
                className="text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 px-2 py-1"
                aria-label="Items per page"
              >
                {[10, 20, 100].map((n) => (
                  <option key={n} value={n}>
                    Top {n}
                  </option>
                ))}
              </select>
              {ilmAllPhaseFilter && (
                <button
                  type="button"
                  onClick={() => setIlmAllPhaseFilter('')}
                  className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                  title="Clear phase filter"
                >
                  Phase: {ilmAllPhaseFilter} <span className="ml-1 text-gray-400">×</span>
                </button>
              )}
            </div>
          )}
        </div>
        {ilmAllExpanded && (
          <div className="tab-section-body">
            {ilmAllError && (
              <div className="mx-2 mt-2 flex-shrink-0 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                {ilmAllError}
              </div>
            )}
            <div className="tab-section-scroll tab-section-scroll-flush">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1500px] text-left tab-content-value border-collapse table-fixed">
                <thead>
                  <tr className="border-b-2 border-gray-300 bg-gray-100 dark:border-gray-600 dark:bg-gray-800">
                    {[
                      { key: 'index', label: 'Index', align: '' },
                      { key: 'ilm_status', label: 'ILM', align: '' },
                      { key: 'primary_total', label: 'Primary / Total', align: 'text-right' },
                      { key: 'shard_sizes', label: 'Shard sizes', align: '' },
                      { key: 'phase', label: 'Phase', align: '' },
                      { key: 'action_step', label: 'Action / Step', align: '' },
                      { key: 'rollover', label: 'Rollover condition', align: '' },
                      { key: 'message', label: 'Message', align: '' }
                    ].map((col) => (
                      <th
                        key={col.key}
                        className={`px-3 py-2.5 font-bold text-gray-900 dark:text-gray-50 tab-content-value cursor-pointer select-none hover:bg-gray-200 dark:hover:bg-gray-700 ${col.align} ${
                          col.key === 'index' ? 'w-[360px]' :
                          col.key === 'ilm_status' ? 'w-[120px]' :
                          col.key === 'primary_total' ? 'w-[120px]' :
                          col.key === 'shard_sizes' ? 'w-[160px]' :
                          col.key === 'phase' ? 'w-[90px]' :
                          col.key === 'action_step' ? 'w-[180px]' :
                          col.key === 'rollover' ? 'w-[260px]' :
                          col.key === 'message' ? 'w-[320px]' : ''
                        }`}
                        onClick={() => handleIlmAllSort(col.key)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {ilmAllSortColumn === col.key ? (
                            ilmAllSortDirection === 'asc' ? (
                              <ArrowUp className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ilmAllPaginatedRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-4 text-center text-gray-500 dark:text-gray-400">
                        {ilmAllLoading ? 'Loading…' : 'No indices match the filter.'}
                      </td>
                    </tr>
                  ) : (
                    ilmAllPaginatedRows.map((r) => (
                      <tr
                        key={r.index}
                        className="border-b border-gray-200 text-gray-800 transition hover:bg-blue-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/50"
                      >
                        <td className="px-3 py-2 tab-content-value w-[360px] max-w-[360px] align-top">
                          <div className="min-w-0 flex flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={() => onOpenIndexDetails?.(r.index)}
                              className="text-left font-mono break-all entity-name-link"
                            >
                              {r.index}
                            </button>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono break-all">
                              {r.policy}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 tab-content-value w-[120px] align-top">
                          {r.managed ? (
                            <span className="inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                              Managed
                            </span>
                          ) : (
                            <span className="inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                              Without ILM
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-right w-[120px]" title={`Replicas: ${Math.max(0, r.totalCount - r.primaryCount)}`}>
                          {r.primaryCount} / {r.totalCount}
                        </td>
                        <td className="px-3 py-2 tab-content-value w-[160px]">
                          <div className="font-mono text-[11px] whitespace-pre-line" title={r.shardSizesAllText || undefined}>
                            {r.shardSizesText}
                          </div>
                          <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 font-mono">
                            total: {r.totalShardSizeText}
                          </div>
                        </td>
                        <td className="px-3 py-2 tab-content-value w-[90px]">
                          <button
                            type="button"
                            onClick={() => setIlmAllPhaseFilter(r.phase === '—' ? '' : r.phase)}
                            className="text-left hover:underline"
                            title="Click to filter by this phase"
                          >
                            {r.phase}
                          </button>
                        </td>
                        <td className="px-3 py-2 tab-content-value w-[180px]">
                          <span className="block max-w-[220px] truncate" title={r.actionStep}>
                            {r.actionStep}
                          </span>
                        </td>
                        <td className="px-3 py-2 tab-content-value w-[260px]">
                          <span
                            className="block max-w-[360px] font-mono text-[11px] whitespace-pre-line"
                            title={r.rolloverConditions !== '—' ? r.rolloverConditions : undefined}
                          >
                            {r.rolloverConditions}
                          </span>
                        </td>
                        <td className="px-3 py-2 tab-content-value w-[320px] max-w-[320px] align-top overflow-hidden">
                          <div className="flex items-start gap-2 min-w-0 max-w-[320px]">
                            <span
                              className={`block min-w-0 max-w-[280px] whitespace-pre-wrap break-all leading-snug font-mono text-[11px] ${
                                r.rolloverIsDue ? 'text-red-700 dark:text-red-300 font-medium' : (r.stepMessage ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400')
                              }`}
                            >
                              {r.rolloverIsDue ? r.rolloverStatusText : (r.stepMessage || '—')}
                            </span>
                            {r.rolloverIsDue && (
                              <button
                                type="button"
                                className="shrink-0 inline-flex items-center justify-center rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-900/30"
                                onClick={() => {
                                  const alias = indexNameToRolloverAlias(r.index);
                                  const cmd = `POST ${alias}/_rollover`;
                                  setIlmAllRolloverCommand(cmd);
                                  setIlmAllRolloverAlertText(
                                    `All \`min_*\` conditions are satisfied and at least one \`max_*\` condition is satisfied. This index should have rolled over—please investigate.\n\nIndex: ${r.index}\n\n${r.rolloverAlertText}\n\n---\nThe index might be stuck. You can manually trigger rollover using the command below.`
                                  );
                                  setIlmAllRolloverAlertOpen(true);
                                }}
                                title="All rollover conditions met"
                              >
                                !
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            </div>
            {ilmAllRolloverAlertOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="rollover-alert-title">
                <div
                  className="absolute inset-0 bg-black/50 dark:bg-black/60"
                  onMouseDown={(e) => {
                    rolloverAlertBackdropMouseDownRef.current = e.target === e.currentTarget;
                  }}
                  onClick={(e) => {
                    if (e.target === e.currentTarget && rolloverAlertBackdropMouseDownRef.current) {
                      setIlmAllRolloverAlertOpen(false);
                    }
                    rolloverAlertBackdropMouseDownRef.current = false;
                  }}
                  aria-hidden="true"
                />
                <div className="relative max-h-[85vh] w-full max-w-xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800">
                  <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-600">
                    <h2 id="rollover-alert-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Rollover alert
                    </h2>
                    <button
                      type="button"
                      onClick={() => setIlmAllRolloverAlertOpen(false)}
                      className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      aria-label="Close"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="min-h-0 max-h-[calc(85vh-8rem)] overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3 text-xs text-gray-700 dark:text-gray-300 space-y-3">
                    <pre className="whitespace-pre-wrap text-xs bg-gray-50 dark:bg-gray-800/50 rounded p-3 border border-gray-200 dark:border-gray-700">
                      {ilmAllRolloverAlertText}
                    </pre>
                    {ilmAllRolloverCommand && (
                      <CodeBlockWithCopy text={ilmAllRolloverCommand} label="rollover command" />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Data streams — single section */}
      <section className="tab-section-card">
        <div className="tab-section-header tab-section-header-split">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TabSectionExpandTrigger
              expanded={dataStreamsExpanded}
              onToggle={() => setDataStreamsExpanded((prev) => !prev)}
              label="Data streams"
              fillHitArea={true}
              suffix={
                <>
                  <InfoPopup
                    title="How is Total calculated?"
                    modalTitle="Data streams - API & Calculations"
                    open={dataStreamsInfoOpen}
                    onOpen={() => setDataStreamsInfoOpen(true)}
                    onClose={() => setDataStreamsInfoOpen(false)}
                  >
                    <div className="space-y-3">
                      <div>
                        <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">API Endpoints</h3>
                        <div className="space-y-1">
                          <code className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded block">/_data_stream</code>
                          <code className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded block">/_cat/shards?format=json&amp;bytes=b</code>
                          <code className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded block">/_nodes?filter_path=nodes.*.name,nodes.*.roles</code>
                        </div>
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">Calculations</h3>
                        <p className="text-xs">
                          Tier sizes (Hot/Warm/Cold/Frozen) are computed by summing shard <code>store</code> bytes for backing indices
                          in each data stream, grouped by the tier of the shard&apos;s node (node roles).{' '}
                          <strong>Total</strong> equals <strong>Hot + Warm + Cold + Frozen</strong>.
                          If a node tier cannot be determined, shards are counted as <strong>Hot</strong>.
                        </p>
                      </div>
                    </div>
                  </InfoPopup>
                  {dataStreamsExpanded && dataStreamsLoading && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">Loading…</span>
                  )}
                </>
              }
            />
          </div>

          {dataStreamsExpanded && (
            <div className="tab-section-inline-tools">
              <div className="relative">
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search data streams…"
                  value={dataStreamsSearchTerm}
                  onChange={(e) => setDataStreamsSearchTerm(e.target.value)}
                  className="pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-36 tab-content-value"
                  aria-label="Search data streams"
                />
                {dataStreamsSearchTerm && (
                  <button
                    type="button"
                    onClick={() => setDataStreamsSearchTerm('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <Pagination
                currentPage={dataStreamsPage}
                totalPages={dataStreamsTotalPages}
                totalItems={filteredDataStreams.length}
                pageSize={dataStreamsPageSize}
                onPageChange={setDataStreamsPage}
                inline
              />

              <select
                value={String(dataStreamsPageSize)}
                onChange={(e) => setDataStreamsPageSize(parseInt(e.target.value, 10) || 10)}
                className="text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 px-2 py-1.5"
                aria-label="Items per page"
              >
                {[10, 20, 30].map((n) => (
                  <option key={n} value={n}>
                    Top {n}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {dataStreamsExpanded && (
          <div className="tab-section-body">
            {dataStreamsError && (
              <div className="mx-3 mt-3 flex-shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                {dataStreamsError}
              </div>
            )}

            <div className="tab-section-scroll">
            <div className="space-y-3">
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-600">
              <table className="min-w-[900px] w-full text-left text-sm tab-content-value">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-700/50">
                    {[
                      { key: 'name', label: 'Data stream', align: 'left' },
                      { key: 'status', label: 'Status', align: 'left' },
                      { key: 'indexCount', label: 'Index count', align: 'right' },
                      { key: 'totalStoreBytes', label: 'Total', align: 'right' },
                      ...(visibleTierColumns.hot ? [{ key: 'hotStoreBytes', label: 'Hot', align: 'right' } as const] : []),
                      ...(visibleTierColumns.warm ? [{ key: 'warmStoreBytes', label: 'Warm', align: 'right' } as const] : []),
                      ...(visibleTierColumns.cold ? [{ key: 'coldStoreBytes', label: 'Cold', align: 'right' } as const] : []),
                      ...(visibleTierColumns.frozen ? [{ key: 'frozenStoreBytes', label: 'Frozen', align: 'right' } as const] : [])
                    ].map((h) => (
                      <th
                        key={h.key}
                        className={`px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 cursor-pointer select-none hover:bg-gray-200 dark:hover:bg-gray-700 ${
                          dataStreamsSortColumn === (h.key as keyof DataStreamTierRow) ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                        } ${h.align === 'right' ? 'text-right' : ''}`}
                        onClick={() => {
                          const key = h.key as keyof DataStreamTierRow;
                          if (dataStreamsSortColumn === key) {
                            setDataStreamsSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
                          } else {
                            setDataStreamsSortColumn(key);
                            setDataStreamsSortDirection(key === 'name' || key === 'status' ? 'asc' : 'desc');
                          }
                        }}
                      >
                        <div className={`flex items-center gap-1.5 ${h.align === 'right' ? 'justify-end' : 'justify-start'}`}>
                          <span>{h.label}</span>
                          <span className="flex-shrink-0">
                            {dataStreamsSortColumn === (h.key as keyof DataStreamTierRow) ? (
                              dataStreamsSortDirection === 'asc' ? (
                                <ArrowUp className="h-3.5 w-3.5" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                            )}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataStreamsLoading ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                        Loading…
                      </td>
                    </tr>
                  ) : filteredDataStreams.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                        No data streams found.
                      </td>
                    </tr>
                  ) : (
                    paginatedDataStreams.map((r) => (
                      <tr
                        key={r.name}
                        className="border-b border-gray-200 text-gray-800 transition hover:bg-blue-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/50"
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedDataStreamName(r.name)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedDataStreamName(r.name);
                          }
                        }}
                      >
                        <td className="px-3 py-2 font-mono text-xs text-gray-900 dark:text-gray-100">{r.name}</td>
                        <td className="px-3 py-2 text-xs">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              String(r.status).toUpperCase() === 'GREEN'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                                : String(r.status).toUpperCase() === 'YELLOW'
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
                                  : String(r.status).toUpperCase() === 'RED'
                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
                                    : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                            }`}
                          >
                            {String(r.status).toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{r.indexCount}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{formatBytesCompact(r.totalStoreBytes)}</td>
                        {visibleTierColumns.hot && (
                          <td className="px-3 py-2 text-right font-mono text-xs">{formatBytesCompact(r.hotStoreBytes)}</td>
                        )}
                        {visibleTierColumns.warm && (
                          <td className="px-3 py-2 text-right font-mono text-xs">{formatBytesCompact(r.warmStoreBytes)}</td>
                        )}
                        {visibleTierColumns.cold && (
                          <td className="px-3 py-2 text-right font-mono text-xs">{formatBytesCompact(r.coldStoreBytes)}</td>
                        )}
                        {visibleTierColumns.frozen && (
                          <td className="px-3 py-2 text-right font-mono text-xs">{formatBytesCompact(r.frozenStoreBytes)}</td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60">
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-gray-900 dark:text-gray-100">
                      Total ({dataStreamsTotals.streamCount})
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                      {dataStreamsTotals.isFiltered ? 'Filtered' : 'All'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-gray-900 dark:text-gray-100">
                      {dataStreamsTotals.indexCountSum}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-gray-900 dark:text-gray-100">
                      {formatBytesCompact(dataStreamsTotals.totalBytes)}
                    </td>
                    {visibleTierColumns.hot && (
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-gray-900 dark:text-gray-100">
                        {formatBytesCompact(dataStreamsTotals.hotBytes)}
                      </td>
                    )}
                    {visibleTierColumns.warm && (
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-gray-900 dark:text-gray-100">
                        {formatBytesCompact(dataStreamsTotals.warmBytes)}
                      </td>
                    )}
                    {visibleTierColumns.cold && (
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-gray-900 dark:text-gray-100">
                        {formatBytesCompact(dataStreamsTotals.coldBytes)}
                      </td>
                    )}
                    {visibleTierColumns.frozen && (
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-gray-900 dark:text-gray-100">
                        {formatBytesCompact(dataStreamsTotals.frozenBytes)}
                      </td>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* InfoPopup moved to section header */}
            </div>
            </div>
          </div>
        )}
      </section>

      {/* Field usage stats — single section; title and controls on one row like other tables */}
      <section className="tab-section-card">
        <div className="tab-section-header tab-section-header-split">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TabSectionExpandTrigger
              expanded={indicesExpanded}
              onToggle={() => setIndicesExpanded((prev) => !prev)}
              label="Field usage stats"
              fillHitArea={true}
              suffix={
                <>
                  <InfoPopup
                    title="Field usage stats"
                    modalTitle="Field usage stats"
                    open={infoOpen}
                    onOpen={() => setInfoOpen(true)}
                    onClose={() => setInfoOpen(false)}
                  >
                    <div className="space-y-3">
                      <p>
                        Index list from <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET _cat/indices</code>. Click an index name to open details (mapping, settings, ILM, field usage). Total fields and usage come from <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET _all/_mapping</code> and <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET _field_usage_stats</code>.
                      </p>
                      <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                        <strong>Note:</strong> Field usage stats require <strong>Elasticsearch 7.15.0+</strong>. Not available in OpenSearch or older ES versions. Used and unsearched fields will show — when unavailable.
                      </p>
                      <p className="font-medium">Unsearched field count</p>
                      <p>
                        Fields that were <strong>never used</strong> in search, sort, aggregation, script, or range query. Elasticsearch tracks when a field&apos;s index structures (inverted index, doc_values, points, stored) are accessed. If a field was only returned in <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">_source</code> or in response hits but never used in a query/sort/agg, it counts as <strong>unsearched</strong>. Unsearched fields still consume mapping and storage; consider removing them from the mapping if they are not needed.
                      </p>
                    </div>
                  </InfoPopup>
                  {indicesExpanded && loading && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">Loading…</span>
                  )}
                  {indicesExpanded && !loading && fieldUsageBuilding && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Processing field usage… {fieldUsageBuildProcessed}/{fieldUsageBuildTotal}
                    </span>
                  )}
                </>
              }
            />
          </div>
          {indicesExpanded && (
            <div className="tab-section-inline-tools">
            <div className="relative min-w-[8rem] max-w-[14rem] flex-1 sm:flex-none sm:w-44">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
              <input
                type="text"
                placeholder="Search index or field…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 tab-content-value"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <Pagination
              currentPage={catalogPage}
              totalPages={catalogTotalPages}
              totalItems={sortedCatalog.length}
              pageSize={catalogPageSize}
              onPageChange={setCatalogPage}
              inline
            />
            <select
              value={String(catalogPageSize)}
              onChange={(e) => setCatalogPageSize(parseInt(e.target.value, 10) || DEFAULT_PAGE_SIZE)}
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
          )}
        </div>
        {indicesExpanded && (
          <div className="tab-section-body">
            {error && catalog.length > 0 && (
              <div className="mx-2 mt-2 flex-shrink-0 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                {error}
              </div>
            )}
            <div className="tab-section-scroll tab-section-scroll-flush">
            <div className="overflow-x-auto">
          <table className="w-full text-left tab-content-value border-collapse">
            <thead>
              <tr className="border-b-2 border-gray-300 bg-gray-100 dark:border-gray-600 dark:bg-gray-800">
                {catalogColumns.map((col) => (
                  <th
                    key={col.key as string}
                    className="px-3 py-2.5 font-bold text-gray-900 dark:text-gray-50 tab-content-value cursor-pointer select-none hover:bg-gray-200 dark:hover:bg-gray-700"
                    onClick={() => handleCatalogSort(col.key as string)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {catalogSortColumn === col.key ? (
                        catalogSortDirection === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedCatalog.length === 0 ? (
                <tr>
                  <td colSpan={catalogColumns.length} className="px-3 py-4 text-center text-gray-500 dark:text-gray-400">
                    {loading ? (
                      'Loading…'
                    ) : (
                      'No indices match the filter. Try adjusting the health filter or search.'
                    )}
                  </td>
                </tr>
              ) : (
                paginatedCatalog.map((row, rowIndex) => (
                  <React.Fragment key={row.index ?? `row-${rowIndex}`}>
                    <tr
                      className="border-b border-gray-200 text-gray-800 transition hover:bg-blue-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/50"
                    >
                      {catalogColumns.map((col) => (
                        <td
                          key={col.key as string}
                          className={`px-3 py-2 ${typeof col.className === 'string' ? col.className : ''}`}
                        >
                          {col.render ? col.render(row) : (row[col.key as keyof CatIndexRow] as React.ReactNode)}
                        </td>
                      ))}
                    </tr>
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
            </div>
          </div>
        )}
      </section>

      {selectedDataStreamName && selectedDataStreamRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onMouseDown={(e) => {
            dataStreamBackdropMouseDownRef.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && dataStreamBackdropMouseDownRef.current) {
              setSelectedDataStreamName(null);
            }
            dataStreamBackdropMouseDownRef.current = false;
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="datastream-modal-title"
        >
          <div
            className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-600">
              <div className="min-w-0">
                <h3 id="datastream-modal-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono break-all">
                  {selectedDataStreamName}
                </h3>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                  <span className="font-medium">{String(selectedDataStreamRow.status).toUpperCase()}</span>
                  <span>•</span>
                  <span>{selectedDataStreamRow.indexCount} indices</span>
                  <span>•</span>
                  <span>Total: {formatBytesCompact(selectedDataStreamRow.totalStoreBytes)}</span>
                  {dataStreamIlmLoading && (
                    <>
                      <span>•</span>
                      <span>Loading ILM…</span>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDataStreamName(null)}
                className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 max-h-[min(68vh,75dvh)] overflow-y-auto overflow-x-hidden overscroll-contain p-4">
              {dataStreamIlmError && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                  {dataStreamIlmError}
                </div>
              )}
              <div className="overflow-x-hidden rounded border border-gray-200 dark:border-gray-600">
                <table className="w-full table-fixed text-left text-xs tab-content-value">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-700/50">
                      {[
                        { key: 'index' as const, label: 'Index', className: 'w-[32%] text-left' },
                        { key: 'health' as const, label: 'Health', className: 'w-[8%] text-left' },
                        { key: 'primaryTotal' as const, label: 'Primary / Total', className: 'w-[9%] text-right' },
                        { key: 'sizeBytes' as const, label: 'Size', className: 'w-[9%] text-right' },
                        { key: 'created' as const, label: 'Created', className: 'w-[8%] text-right' },
                        { key: 'ilmAge' as const, label: 'ILM age', className: 'w-[8%] text-right' },
                        { key: 'phase' as const, label: 'Phase', className: 'w-[8%] text-left' },
                        { key: 'ilmActionStep' as const, label: 'ILM', className: 'w-[18%] text-left' }
                      ].map((h) => (
                        <th
                          key={h.key}
                          className={`${h.className} px-3 py-2 font-semibold text-gray-900 dark:text-gray-100 cursor-pointer select-none hover:bg-gray-200 dark:hover:bg-gray-700 ${
                            dataStreamModalSortColumn === h.key ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                          }`}
                          onClick={() => {
                            if (dataStreamModalSortColumn === h.key) {
                              setDataStreamModalSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
                            } else {
                              setDataStreamModalSortColumn(h.key);
                              setDataStreamModalSortDirection(
                                h.key === 'index' || h.key === 'phase' || h.key === 'ilmActionStep' ? 'asc' : 'desc'
                              );
                            }
                          }}
                        >
                          <div
                            className={`flex items-center gap-1.5 whitespace-nowrap ${
                              h.className.includes('text-right') ? 'justify-end w-full' : ''
                            }`}
                          >
                            {h.label}
                            {dataStreamModalSortColumn === h.key ? (
                              dataStreamModalSortDirection === 'asc' ? (
                                <ArrowUp className="h-3.5 w-3.5" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDataStreamIndexRowsSorted.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                          No backing indices found.
                        </td>
                      </tr>
                    ) : (
                      selectedDataStreamIndexRowsSorted.map((row) => (
                        <tr
                          key={row.index}
                          className="border-b border-gray-200 text-gray-800 transition hover:bg-blue-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/50"
                        >
                          <td className="px-3 py-2 font-mono text-[11px] break-all whitespace-normal">
                            <button
                              type="button"
                              onClick={() => onOpenIndexDetails?.(row.index)}
                              className="text-left font-mono text-[11px] break-all whitespace-normal entity-name-link"
                            >
                              {row.index}
                            </button>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-gray-700 dark:text-gray-300">{row.health}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{row.primary} / {row.total}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{formatBytesCompact(row.sizeBytes)}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{row.createdAge}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{row.ilmAgeLabel}</td>
                          <td className="px-3 py-2 text-[11px]">
                            {(() => {
                              const phase = String(row.phase ?? '—');
                              const p = phase.toLowerCase();
                              const cls =
                                p === 'hot'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
                                  : p === 'warm'
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
                                    : p === 'cold'
                                      ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200'
                                      : p === 'frozen'
                                        ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-200'
                                        : p === 'delete'
                                          ? 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                                          : 'bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-200';
                              return (
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
                                  {phase}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2 text-[11px] whitespace-normal break-words">{row.ilmActionStep}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {/* Default sorting handled programmatically (Created desc). */}
            </div>
          </div>
        </div>
      )}

      {aliasesPopoverIndex && (() => {
        const aliases = indexToAliases[aliasesPopoverIndex] ?? [];
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onMouseDown={(e) => {
              aliasesBackdropMouseDownRef.current = e.target === e.currentTarget;
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget && aliasesBackdropMouseDownRef.current) {
                setAliasesPopoverIndex(null);
              }
              aliasesBackdropMouseDownRef.current = false;
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="aliases-popover-title"
          >
            <div
              className="max-h-[70vh] w-full max-w-md overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-600">
                <h3 id="aliases-popover-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono">
                  Aliases: {aliasesPopoverIndex}
                </h3>
                <button
                  type="button"
                  onClick={() => setAliasesPopoverIndex(null)}
                  className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="tab-section-scroll">
                {aliases.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No aliases.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {aliases.map((al, i) => (
                      <li key={al ?? i} className="font-mono text-sm text-gray-800 dark:text-gray-200 tab-content-value">
                        {al}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {fieldsPopoverIndex && (() => {
        const summary = fieldUsageAllMap[fieldsPopoverIndex];
        const fieldList = fieldsPopoverMode === 'used'
          ? (summary?.fieldList ?? []).filter((f) => f.usage > 0)
          : (summary?.fieldList ?? []);
        return (
          <FieldsPopoverContent
            indexName={fieldsPopoverIndex}
            summary={summary}
            fieldList={fieldList}
            mode={fieldsPopoverMode}
            usageTypeInfoOpen={usageTypeInfoOpen}
            setUsageTypeInfoOpen={setUsageTypeInfoOpen}
            onClose={() => {
              setUsageTypeInfoOpen(false);
              setFieldsPopoverIndex(null);
            }}
          />
        );
      })()}

      {unsearchedFieldsPopoverIndex && (() => {
        const summary = fieldUsageAllMap[unsearchedFieldsPopoverIndex];
        const unsearchedNames =
          (summary?.unusedFieldNames?.length ? summary.unusedFieldNames : null) ??
          (summary?.fieldList ?? []).filter((f) => f.usage === 0).map((f) => f.name).sort((a, b) => a.localeCompare(b));
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => setUnsearchedFieldsPopoverIndex(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsearched-fields-popover-title"
          >
            <div
              className="max-h-[70vh] w-full max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-600">
                <h3 id="unsearched-fields-popover-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono">
                  Index: {unsearchedFieldsPopoverIndex}
                </h3>
                <button
                  type="button"
                  onClick={() => setUnsearchedFieldsPopoverIndex(null)}
                  className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="tab-section-scroll">
                {!summary?.hasUsageData ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Usage data not available for this index.</p>
                ) : unsearchedNames.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No unsearched fields.</p>
                ) : (
                  <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-600">
                    <table className="w-full min-w-[400px] text-left text-sm tab-content-value">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-700/50">
                          <th className="min-w-[140px] px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">Field</th>
                          <th className="min-w-[90px] px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">Usage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unsearchedNames.map((name, i) => (
                          <tr
                            key={name ?? i}
                            className="border-b border-gray-100 text-gray-800 dark:border-gray-700 dark:text-gray-200 last:border-b-0"
                          >
                            <td className="max-w-[220px] px-3 py-2 font-mono" title={name}>
                              <span className="block truncate">{name}</span>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span className="text-amber-600 dark:text-amber-400">unsearched</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
