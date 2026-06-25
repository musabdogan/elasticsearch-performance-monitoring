import type { ClusterConnection } from '@/types/app';
import { searchIndexDocuments } from '@/services/elasticsearch';
import type { QueryMode } from '@/utils/querySearch';

export type TimeRangeFilter = {
  field: string;
  gte: string;
  lte: string;
};

export type RelativeTimeRangePreset = '5m' | '15m' | '1h' | '24h' | '7d' | '30d' | '1y';

export type TimeRangePreset = 'search' | 'all' | RelativeTimeRangePreset;

export type HistogramBucket = {
  key: number;
  docCount: number;
  label: string;
};

export const DEFAULT_TIME_PRESET: RelativeTimeRangePreset = '15m';

/** Initial chart preset when the time chart is opened or reset. */
export const DEFAULT_CHART_PRESET: TimeRangePreset = DEFAULT_TIME_PRESET;

const RELATIVE_PRESET_RANGE: Record<
  RelativeTimeRangePreset,
  { gte: string; lte: string; spanMs: number; label: string }
> = {
  '5m': { gte: 'now-5m', lte: 'now', spanMs: 5 * 60 * 1000, label: 'Last 5 minutes' },
  '15m': { gte: 'now-15m', lte: 'now', spanMs: 15 * 60 * 1000, label: 'Last 15 minutes' },
  '1h': { gte: 'now-1h', lte: 'now', spanMs: 60 * 60 * 1000, label: 'Last 1 hour' },
  '24h': { gte: 'now-24h', lte: 'now', spanMs: 24 * 60 * 60 * 1000, label: 'Last 24 hours' },
  '7d': { gte: 'now-7d', lte: 'now', spanMs: 7 * 24 * 60 * 60 * 1000, label: 'Last 7 days' },
  '30d': { gte: 'now-30d', lte: 'now', spanMs: 30 * 24 * 60 * 60 * 1000, label: 'Last 30 days' },
  '1y': { gte: 'now-1y', lte: 'now', spanMs: 365 * 24 * 60 * 60 * 1000, label: 'Last 1 year' }
};

export function isRelativeDateMathRange(range: TimeRangeFilter): boolean {
  return /^now/i.test(range.gte) && /^now$/i.test(range.lte);
}

/** Target bar count for date_histogram; interval is derived from window span. */
export const TARGET_HISTOGRAM_BUCKETS = 60;

/** Stay well below Elasticsearch search.max_buckets (65536). */
export const MAX_HISTOGRAM_BUCKETS = 500;

function parseBoundToMs(value: string): number {
  if (/^now/i.test(value)) return Date.now();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && /^\d+$/.test(value.trim())) return numeric;
  return Date.parse(value);
}

function parseRelativeOffsetMs(offset: string): number | null {
  const match = offset.replace(/^now/i, '').match(/^-(\d+)([smhdwMy])$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    M: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000
  };
  return amount * (multipliers[unit] ?? 60 * 1000);
}

export function resolveAbsoluteTimeRangeMs(range: TimeRangeFilter): { gteMs: number; lteMs: number } | null {
  const gteRelative = /^now/i.test(range.gte);
  const lteRelative = /^now$/i.test(range.lte);
  const nowMs = Date.now();

  if (gteRelative && lteRelative) {
    const spanMs = parseRelativeOffsetMs(range.gte);
    if (spanMs == null) return null;
    return { gteMs: nowMs - spanMs, lteMs: nowMs };
  }

  let gteMs: number;
  let lteMs: number;

  if (gteRelative) {
    const spanMs = parseRelativeOffsetMs(range.gte);
    if (spanMs == null) return null;
    gteMs = nowMs - spanMs;
  } else {
    gteMs = parseBoundToMs(range.gte);
  }

  if (lteRelative) {
    lteMs = nowMs;
  } else {
    lteMs = parseBoundToMs(range.lte);
  }

  if (!Number.isFinite(gteMs) || !Number.isFinite(lteMs)) return null;
  return { gteMs, lteMs };
}

function toAbsoluteTimeRange(range: TimeRangeFilter, gteMs: number, lteMs: number): TimeRangeFilter {
  return {
    field: range.field,
    gte: new Date(gteMs).toISOString(),
    lte: new Date(lteMs).toISOString()
  };
}

export function normalizeTimeRangeForElasticsearch(
  range: TimeRangeFilter,
  fieldFormat?: string | null
): TimeRangeFilter {
  const absolute = resolveAbsoluteTimeRangeMs(range);
  if (!absolute) return range;

  const gte = formatAbsoluteDateMsForField(absolute.gteMs, fieldFormat);
  const lte = formatAbsoluteDateMsForField(absolute.lteMs, fieldFormat);
  return {
    field: range.field,
    gte: typeof gte === 'number' ? String(gte) : gte,
    lte: typeof lte === 'number' ? String(lte) : lte
  };
}

export type HistogramInterval =
  | { kind: 'fixed_interval'; value: string }
  | { kind: 'calendar_interval'; value: string };

/** Kibana-style interval: fixed for short windows, calendar for longer spans. */
export function resolveHistogramInterval(range: TimeRangeFilter): HistogramInterval {
  const spanMs = estimateRangeSpanMs(range);

  if (spanMs <= 60 * 60 * 1000) {
    return { kind: 'fixed_interval', value: computeHistogramFixedInterval(range) };
  }
  if (spanMs <= 24 * 60 * 60 * 1000) {
    return {
      kind: 'fixed_interval',
      value: intervalMsToFixedInterval(computeHistogramIntervalMsForSpan(spanMs))
    };
  }
  if (spanMs <= 7 * 24 * 60 * 60 * 1000) {
    return { kind: 'calendar_interval', value: '1h' };
  }
  if (spanMs <= 90 * 24 * 60 * 60 * 1000) {
    return { kind: 'calendar_interval', value: '1d' };
  }
  if (spanMs <= 730 * 24 * 60 * 60 * 1000) {
    return { kind: 'calendar_interval', value: '1w' };
  }
  return { kind: 'calendar_interval', value: '1M' };
}

function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function resolveRangeFieldFormat(
  gte: string | number,
  lte: string | number,
  fieldFormat?: string | null
): string | undefined {
  if (typeof gte === 'number' || typeof lte === 'number') return undefined;
  const fmt = fieldFormat?.trim() ?? '';
  if (fmt.includes('strict_date_optional_time') || fmt.includes('date_time')) {
    return 'strict_date_optional_time';
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(gte) && /^\d{4}-\d{2}-\d{2}T/.test(lte)) {
    return 'strict_date_optional_time';
  }
  return undefined;
}

export type TimeFieldBounds = {
  minMs: number | null;
  maxMs: number | null;
};

export type TimeRangeResolution =
  | { mode: 'skip' }
  | { mode: 'none' }
  | {
      mode: 'histogram-only';
      histogramInterval: HistogramInterval;
    }
  | {
      mode: 'filter';
      range: TimeRangeFilter;
      /** When null, skip histogram (unsafe with ES + relative filter beyond data). */
      histogramRange: TimeRangeFilter | null;
    };

export function isSearchResultsPreset(preset: TimeRangePreset): boolean {
  return preset === 'search';
}

/** Map legacy "search" preset to the default time window. */
export function normalizeChartPreset(preset: TimeRangePreset): TimeRangePreset {
  return preset === 'search' ? DEFAULT_TIME_PRESET : preset;
}

/** True when the chart applies a time range filter to document hits (not histogram-only Results). */
export function isChartTimeFilterActive(
  preset: TimeRangePreset,
  brushRange: TimeRangeFilter | null
): boolean {
  if (brushRange != null) return true;
  return !isSearchResultsPreset(preset);
}

export function buildResultsHistogramCacheKey(opts: {
  indexPattern: string;
  timeField: string;
  mode: string;
  query: string;
  advancedBody: string;
  searchRevision: number;
}): string {
  return [
    opts.indexPattern,
    opts.timeField,
    opts.mode,
    opts.query,
    opts.advancedBody,
    String(opts.searchRevision)
  ].join('\0');
}

export function isAllTimePreset(preset: TimeRangePreset): boolean {
  return preset === 'all';
}

export function resolveHistogramIntervalForUnfilteredSearch(
  field: string,
  bounds: TimeFieldBounds | null
): HistogramInterval {
  const fullRange = buildAllHistogramRange(field, bounds);
  if (fullRange) return resolveHistogramInterval(fullRange);
  return { kind: 'calendar_interval', value: '1d' };
}

export function buildAllHistogramRange(field: string, bounds: TimeFieldBounds | null): TimeRangeFilter | null {
  if (!field || bounds?.minMs == null || bounds?.maxMs == null) return null;
  if (bounds.minMs > bounds.maxMs) return null;
  return {
    field,
    gte: new Date(bounds.minMs).toISOString(),
    lte: new Date(bounds.maxMs).toISOString()
  };
}

export function resolveTimeSearchResolution(
  preset: TimeRangePreset,
  range: TimeRangeFilter,
  bounds: TimeFieldBounds | null,
  brushActive: boolean
): TimeRangeResolution {
  const normalized = normalizeChartPreset(preset);
  if (brushActive) {
    return resolveTimeRangeForIndex(range, bounds);
  }
  if (isAllTimePreset(normalized)) {
    if (!range.field) return { mode: 'skip' };
    const fullRange = buildAllHistogramRange(range.field, bounds);
    if (!fullRange) return { mode: 'skip' };
    return { mode: 'filter', range: fullRange, histogramRange: fullRange };
  }
  return resolveTimeRangeForIndex(range, bounds);
}

export type ExpandedChartTimeSearchContext = {
  timeField: string;
  timeFieldFormat: string | null;
  resolution: TimeRangeResolution;
};

/**
 * When the time chart is expanded, every _search must include a time constraint.
 * Never returns resolution.mode === 'skip' (falls back to filter or match_none).
 */
export function resolveExpandedChartTimeSearchContext(
  preset: TimeRangePreset,
  timeField: string,
  brushRange: TimeRangeFilter | null,
  bounds: TimeFieldBounds | null,
  timeFieldFormat: string | null = null
): ExpandedChartTimeSearchContext {
  const range = resolveChartFilterRange(preset, timeField, brushRange);
  let resolution = resolveTimeSearchResolution(preset, range, bounds, brushRange != null);

  if (resolution.mode === 'skip') {
    if (hasValidTimeFieldBounds(bounds)) {
      const fullRange = buildAllHistogramRange(timeField, bounds);
      resolution = fullRange
        ? { mode: 'filter', range: fullRange, histogramRange: fullRange }
        : { mode: 'none' };
    } else {
      resolution = { mode: 'none' };
    }
  }

  return { timeField, timeFieldFormat, resolution };
}

import { isDateMappingField } from '@/utils/fieldMappingTypes';

export function mergeChartTimeFieldOptions(
  mappingDateFields: string[],
  candidateFields: string[],
  mappings: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null | undefined
): string[] {
  const merged = new Set(mappingDateFields);
  for (const field of candidateFields) {
    if (field && isDateMappingField(field, mappings)) merged.add(field);
  }
  return sortTimeFieldNames([...merged]);
}

export function needsTimeFieldBounds(
  preset: TimeRangePreset,
  brushRange: TimeRangeFilter | null
): boolean {
  if (brushRange != null) return false;
  return preset === 'all';
}

/** Time field used when the chart is first expanded (open probe). */
export const CHART_PROBE_TIME_FIELD = '@timestamp';

export const STANDARD_CHART_TIME_FIELDS = ['@timestamp', 'timestamp'] as const;

export function hasStandardChartTimeField(fields: string[]): boolean {
  const set = new Set(fields);
  return STANDARD_CHART_TIME_FIELDS.some((field) => set.has(field));
}

export function resolveStandardChartTimeField(fields: string[]): string | null {
  if (fields.includes('@timestamp')) return '@timestamp';
  if (fields.includes('timestamp')) return 'timestamp';
  return null;
}

/** Presets tried on chart open — on {@link CHART_PROBE_TIME_FIELD} or `timestamp`. */
export const CHART_PROBE_PRESETS = ['15m', '24h', '30d', '1y', 'all'] as const;
export type ChartProbePreset = (typeof CHART_PROBE_PRESETS)[number];

export function buildSelectTimestampFieldMessage(): string {
  return 'Please select a timestamp field above.';
}

/** e.g. "in last 15 minutes", "in last 24 hours", "in all time" */
export function formatEmptyChartRangePhrase(preset?: TimeRangePreset): string {
  if (!preset) return 'in the selected time range';

  const normalized = normalizeChartPreset(preset);
  if (isAllTimePreset(normalized)) return 'in all time';
  if (isSearchResultsPreset(normalized)) return 'in the current search results';

  const entry = RELATIVE_PRESET_RANGE[normalized as RelativeTimeRangePreset];
  if (entry) {
    const tail = entry.label.replace(/^Last /i, 'last ');
    return `in ${tail}`;
  }

  return 'in the selected time range';
}

export function buildNoTimestampChartDataMessage(
  field: string = CHART_PROBE_TIME_FIELD,
  preset?: TimeRangePreset
): string {
  const rangePhrase = formatEmptyChartRangePhrase(preset);
  const normalized = preset ? normalizeChartPreset(preset) : null;
  const action =
    normalized && isAllTimePreset(normalized)
      ? 'Select another date time field above.'
      : 'Extend the time range or select another date time field above.';
  return `There is no data for the ${field} field ${rangePhrase}. ${action}`;
}

export type ChartProbeAdvance =
  | { action: 'success' }
  | { action: 'retry'; preset: ChartProbePreset }
  | { action: 'exhausted' };

/** Advance chart open probe: 15m → 24h → 30d → 1y → all on @timestamp. */
export function advanceChartProbeStep(input: {
  presetStep: ChartProbePreset;
  hasData: boolean;
}): ChartProbeAdvance {
  if (input.hasData) return { action: 'success' };

  const index = CHART_PROBE_PRESETS.indexOf(input.presetStep);
  if (index < 0 || index >= CHART_PROBE_PRESETS.length - 1) {
    return { action: 'exhausted' };
  }

  return { action: 'retry', preset: CHART_PROBE_PRESETS[index + 1] };
}

/** True when min/max aggregations returned usable numeric bounds for the time field. */
export function hasValidTimeFieldBounds(bounds: TimeFieldBounds | null | undefined): boolean {
  if (!bounds) return false;
  const hasMin = typeof bounds.minMs === 'number' && Number.isFinite(bounds.minMs);
  const hasMax = typeof bounds.maxMs === 'number' && Number.isFinite(bounds.maxMs);
  return hasMin && hasMax;
}

/**
 * Align a time window with index min/max so ES date_histogram + range filters do not 400
 * when "now" is past the newest document (common on rolled monthly indices).
 */
export function resolveTimeRangeForIndex(
  range: TimeRangeFilter,
  bounds: TimeFieldBounds | null
): TimeRangeResolution {
  if (!range.field) return { mode: 'skip' };

  const absolute = resolveAbsoluteTimeRangeMs(range);
  if (!absolute) {
    return { mode: 'filter', range, histogramRange: range };
  }

  const { gteMs, lteMs } = absolute;

  if (bounds?.minMs == null || bounds?.maxMs == null) {
    const normalized = toAbsoluteTimeRange(range, gteMs, lteMs);
    return { mode: 'filter', range: normalized, histogramRange: normalized };
  }

  const { minMs, maxMs } = bounds;

  if (gteMs > maxMs || lteMs < minMs) {
    return { mode: 'none' };
  }

  const clampedGte = Math.max(gteMs, minMs);
  const clampedLte = Math.min(lteMs, maxMs);
  if (clampedGte > clampedLte) {
    return { mode: 'none' };
  }

  const normalized = toAbsoluteTimeRange(range, clampedGte, clampedLte);
  const chartWindow = toAbsoluteTimeRange(range, gteMs, lteMs);
  return { mode: 'filter', range: normalized, histogramRange: chartWindow };
}

export function applyMatchNoneQuery(body: Record<string, unknown>): Record<string, unknown> {
  return { ...body, query: { match_none: {} } };
}


export function resolvePresetSpanMs(preset: TimeRangePreset, bounds?: TimeFieldBounds | null): number {
  const normalized = normalizeChartPreset(preset);
  if (isAllTimePreset(normalized)) {
    if (bounds?.minMs != null && bounds?.maxMs != null) {
      return Math.max(bounds.maxMs - bounds.minMs, 1000);
    }
    return RELATIVE_PRESET_RANGE['30d'].spanMs;
  }
  return RELATIVE_PRESET_RANGE[normalized as RelativeTimeRangePreset].spanMs;
}

export const TIME_RANGE_PRESETS: Array<{ id: TimeRangePreset; label: string }> = [
  { id: '5m', label: '5m' },
  { id: '15m', label: '15m' },
  { id: '1h', label: '1h' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '1y', label: '1y' },
  { id: 'all', label: 'All' }
];

const DATE_FIELD_TYPES = new Set(['date', 'date_nanos']);

function resolveMappingPropertyNode(
  props: Record<string, unknown>,
  fieldPath: string
): Record<string, unknown> | null {
  const parts = fieldPath.split('.');
  let current: Record<string, unknown> = props;
  for (let i = 0; i < parts.length; i++) {
    const node = current[parts[i]] as Record<string, unknown> | undefined;
    if (!node) return null;
    if (i === parts.length - 1) return node;
    if (node.properties && typeof node.properties === 'object') {
      current = node.properties as Record<string, unknown>;
      continue;
    }
    return null;
  }
  return null;
}

export function getDateFieldFormatFromMappings(
  mappings: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null | undefined,
  fieldPath: string
): string | null {
  if (!mappings || !fieldPath) return null;
  for (const entry of Object.values(mappings)) {
    const props = entry?.mappings?.properties;
    if (!props) continue;
    const node = resolveMappingPropertyNode(props, fieldPath);
    if (!node) continue;
    if (typeof node.format === 'string' && node.format.trim()) return node.format.trim();
  }
  return null;
}

export function collectDateFieldsFromMappingProps(
  props: Record<string, unknown> | undefined,
  prefix = ''
): string[] {
  if (!props || typeof props !== 'object') return [];
  const names: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (v.properties) {
      names.push(...collectDateFieldsFromMappingProps(v.properties as Record<string, unknown>, fullPath));
      continue;
    }
    if (v.fields) {
      const fieldType = typeof v.type === 'string' ? v.type : '';
      if (DATE_FIELD_TYPES.has(fieldType)) names.push(fullPath);
      for (const [fk, fv] of Object.entries(v.fields as Record<string, unknown>)) {
        const f = fv as Record<string, unknown>;
        if (f?.properties && typeof f.properties === 'object') {
          names.push(...collectDateFieldsFromMappingProps(f.properties as Record<string, unknown>, `${fullPath}.${fk}`));
        } else {
          const subType = typeof f?.type === 'string' ? f.type : '';
          if (DATE_FIELD_TYPES.has(subType)) names.push(`${fullPath}.${fk}`);
        }
      }
      continue;
    }
    const fieldType = typeof v.type === 'string' ? v.type : '';
    if (DATE_FIELD_TYPES.has(fieldType)) names.push(fullPath);
  }
  return names;
}

export function shouldShowQueryTimeHistogram(_pattern: string): boolean {
  return true;
}

export function sortTimeFieldNames(fields: string[]): string[] {
  const priority = (name: string) => {
    if (name === '@timestamp') return 0;
    if (name === 'timestamp') return 1;
    return 2;
  };
  return [...new Set(fields)].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
}

export function pickDefaultTimeField(fields: string[]): string | null {
  const sorted = sortTimeFieldNames(fields);
  if (sorted.length > 0) return sorted[0];
  return null;
}

export function mergeDateFieldsFromMappingsResponse(
  mappings: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null | undefined
): string[] {
  if (!mappings || typeof mappings !== 'object') return [];
  const all: string[] = [];
  for (const entry of Object.values(mappings)) {
    const props = entry?.mappings?.properties;
    if (props) all.push(...collectDateFieldsFromMappingProps(props));
  }
  return sortTimeFieldNames(all);
}

export function resolvePresetTimeRange(preset: TimeRangePreset): TimeRangeFilter {
  const normalized = normalizeChartPreset(preset);
  if (isAllTimePreset(normalized)) {
    return { field: '', gte: '', lte: '' };
  }
  const { gte, lte } = RELATIVE_PRESET_RANGE[normalized as RelativeTimeRangePreset];
  return { field: '', gte, lte };
}

export function withTimeField(range: TimeRangeFilter, field: string): TimeRangeFilter {
  return { ...range, field };
}

export function estimateRangeSpanMs(range: TimeRangeFilter): number {
  const absolute = resolveAbsoluteTimeRangeMs(range);
  if (absolute) {
    return Math.max(absolute.lteMs - absolute.gteMs, 1000);
  }

  if (isRelativeDateMathRange(range)) {
    const spanMs = parseRelativeOffsetMs(range.gte);
    if (spanMs != null) return spanMs;
  }

  return RELATIVE_PRESET_RANGE[DEFAULT_TIME_PRESET].spanMs;
}

export function computeHistogramIntervalMs(
  preset: TimeRangePreset,
  bounds?: TimeFieldBounds | null
): number {
  const spanMs = resolvePresetSpanMs(preset, bounds);
  return computeHistogramIntervalMsForSpan(spanMs);
}

/** Auto interval from window span (~60 bars, capped for ES bucket limit). */
export function computeHistogramIntervalMsForSpan(
  spanMs: number,
  targetBuckets = TARGET_HISTOGRAM_BUCKETS,
  maxBuckets = MAX_HISTOGRAM_BUCKETS
): number {
  const safeSpanMs = Math.max(spanMs, 1000);
  let intervalMs = Math.max(1000, Math.ceil(safeSpanMs / targetBuckets));
  if (Math.ceil(safeSpanMs / intervalMs) > maxBuckets) {
    intervalMs = Math.ceil(safeSpanMs / maxBuckets);
  }
  return intervalMs;
}

export function computeHistogramFixedInterval(
  range: TimeRangeFilter,
  targetBuckets = TARGET_HISTOGRAM_BUCKETS,
  maxBuckets = MAX_HISTOGRAM_BUCKETS
): string {
  const spanMs = estimateRangeSpanMs(range);
  return intervalMsToFixedInterval(computeHistogramIntervalMsForSpan(spanMs, targetBuckets, maxBuckets));
}

export function intervalMsToFixedInterval(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.ceil(hours / 24);
  return `${days}d`;
}

function formatRangeBound(value: string): string {
  if (/^now/i.test(value)) return value;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toISOString();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Wall-clock components in the browser timezone (matches date_histogram time_zone). */
function formatMsInBrowserLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Format absolute ms for ES using the mapped date format when known. */
export function formatAbsoluteDateMsForField(
  ms: number,
  fieldFormat: string | null | undefined
): string | number {
  if (!Number.isFinite(ms)) return ms;

  const fmt = fieldFormat?.trim() ?? '';
  const d = new Date(ms);

  if (fmt === 'epoch_millis' || fmt.includes('epoch_millis')) {
    return ms;
  }

  if (fmt.includes('yyyy-MM-dd') && fmt.includes('HH:mm:ss')) {
    return formatMsInBrowserLocal(ms);
  }

  if (fmt.includes('strict_date_optional_time') || fmt.includes('date_time')) {
    return d.toISOString();
  }

  return d.toISOString();
}

export function isElasticsearchDateParseError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('parse_exception') ||
    lower.includes('date_time_parse_exception') ||
    lower.includes('failed to parse date field')
  );
}

/** Pull `yyyy-MM-dd HH:mm:ss` from ES 400 error text when present. */
export function parseElasticsearchDateFormatFromError(message: string): string | null {
  const match = message.match(/with format \[([^\]]+)\]/i);
  return match?.[1]?.trim() ?? null;
}

function isEpochMillisBound(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 1e11;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^\d{12,}$/.test(trimmed);
  }
  return false;
}

function epochMillisFromBound(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d{12,}$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function rewriteRangeClause(
  clause: Record<string, unknown>,
  fieldFormat: string
): { clause: Record<string, unknown>; changed: boolean } {
  const range = clause.range;
  if (!range || typeof range !== 'object' || Array.isArray(range)) {
    return { clause, changed: false };
  }

  let changed = false;
  const nextRange: Record<string, unknown> = {};

  for (const [field, spec] of Object.entries(range as Record<string, unknown>)) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      nextRange[field] = spec;
      continue;
    }
    const nextSpec = { ...(spec as Record<string, unknown>) };
    for (const bound of ['gte', 'gt', 'lte', 'lt'] as const) {
      const value = nextSpec[bound];
      if (typeof value === 'string' && /^now/i.test(value.trim())) continue;

      let ms: number | null = null;
      if (isEpochMillisBound(value)) {
        ms = epochMillisFromBound(value);
      } else if (typeof value === 'number' && Number.isFinite(value) && value > 1e11) {
        ms = value;
      } else if (typeof value === 'string') {
        const parsed = Date.parse(value.trim());
        if (Number.isFinite(parsed)) ms = parsed;
      }

      if (ms == null) continue;

      const rewritten = formatAbsoluteDateMsForField(ms, fieldFormat);
      if (rewritten !== value) {
        nextSpec[bound] = rewritten;
        changed = true;
      }
    }
    if (changed) {
      delete nextSpec.format;
    }
    nextRange[field] = nextSpec;
  }

  return changed ? { clause: { range: nextRange }, changed: true } : { clause, changed: false };
}

function rewriteQueryNode(node: unknown, fieldFormat: string): { node: unknown; changed: boolean } {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return { node, changed: false };
  }

  const obj = node as Record<string, unknown>;
  if (obj.range) {
    const rewritten = rewriteRangeClause(obj, fieldFormat);
    return { node: rewritten.clause, changed: rewritten.changed };
  }

  if (obj.bool && typeof obj.bool === 'object' && !Array.isArray(obj.bool)) {
    const bool = { ...(obj.bool as Record<string, unknown>) };
    let changed = false;
    for (const key of ['filter', 'must', 'should', 'must_not'] as const) {
      const clause = bool[key];
      if (Array.isArray(clause)) {
        const nextClauses: unknown[] = [];
        for (const item of clause) {
          const rewritten = rewriteQueryNode(item, fieldFormat);
          if (rewritten.changed) changed = true;
          nextClauses.push(rewritten.node);
        }
        bool[key] = nextClauses;
      } else if (clause) {
        const rewritten = rewriteQueryNode(clause, fieldFormat);
        if (rewritten.changed) changed = true;
        bool[key] = rewritten.node;
      }
    }
    return changed ? { node: { bool }, changed: true } : { node, changed: false };
  }

  return { node, changed: false };
}

/** Rewrite epoch-millis range bounds to a string date format (one-shot retry for ES 400s). */
export function rewriteEpochMillisRangeBoundsInSearchBody(
  body: Record<string, unknown>,
  fieldFormat: string
): { body: Record<string, unknown>; changed: boolean } {
  const query = body.query;
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return { body, changed: false };
  }
  const rewritten = rewriteQueryNode(query, fieldFormat);
  if (!rewritten.changed) return { body, changed: false };
  return {
    body: { ...body, query: rewritten.node },
    changed: true
  };
}

/** ES date range bound: date math as-is; absolute dates match the field mapping format. */
export function resolveRangeBoundForElasticsearch(
  value: string,
  fieldFormat?: string | null
): string | number {
  if (/^now/i.test(value)) return value;
  const ms = Date.parse(value);
  if (Number.isFinite(ms)) return formatAbsoluteDateMsForField(ms, fieldFormat);
  return value;
}

function buildTimeRangeFilter(range: TimeRangeFilter, fieldFormat?: string | null): Record<string, unknown> {
  const normalized = normalizeTimeRangeForElasticsearch(range, fieldFormat);
  const gte = resolveRangeBoundForElasticsearch(normalized.gte, fieldFormat);
  const lte = resolveRangeBoundForElasticsearch(normalized.lte, fieldFormat);
  const fieldSpec: Record<string, unknown> = { gte, lte };
  const esFormat = resolveRangeFieldFormat(gte, lte, fieldFormat);
  if (esFormat) fieldSpec.format = esFormat;

  return {
    range: {
      [range.field]: fieldSpec
    }
  };
}

export function formatTimeRangeForQueryString(range: TimeRangeFilter): string {
  const gte = formatRangeBound(range.gte);
  const lte = formatRangeBound(range.lte);
  const field = range.field.includes(' ') || range.field.includes(':') ? `"${range.field}"` : range.field;
  return `${field}:[${gte} TO ${lte}]`;
}

export function appendTimeRangeToSimpleQuery(query: string, range: TimeRangeFilter): string {
  const rangeClause = formatTimeRangeForQueryString(range);
  const trimmed = query.trim();
  if (!trimmed || trimmed === '*') return rangeClause;
  return `(${trimmed}) AND ${rangeClause}`;
}

function extractQueryClause(body: Record<string, unknown>): Record<string, unknown> | null {
  const query = body.query;
  if (!query || typeof query !== 'object' || Array.isArray(query)) return null;
  return query as Record<string, unknown>;
}

export function mergeTimeRangeIntoAdvancedBody(
  body: Record<string, unknown>,
  range: TimeRangeFilter,
  fieldFormat?: string | null
): Record<string, unknown> {
  const next = { ...body };
  const rangeFilter = buildTimeRangeFilter(range, fieldFormat);

  const existingQuery = extractQueryClause(next);
  if (!existingQuery) {
    next.query = {
      bool: {
        filter: [rangeFilter]
      }
    };
    return next;
  }

  if ('bool' in existingQuery && existingQuery.bool && typeof existingQuery.bool === 'object') {
    const bool = { ...(existingQuery.bool as Record<string, unknown>) };
    const filters = Array.isArray(bool.filter) ? [...bool.filter] : bool.filter ? [bool.filter] : [];
    filters.push(rangeFilter);
    bool.filter = filters;
    next.query = { bool };
    return next;
  }

  next.query = {
    bool: {
      must: [existingQuery],
      filter: [rangeFilter]
    }
  };
  return next;
}

export function applyTimeRangeToSearchBody(
  body: Record<string, unknown>,
  range: TimeRangeFilter | null,
  mode: QueryMode,
  simpleQuery: string,
  fieldFormat?: string | null
): Record<string, unknown> {
  if (!range?.field) return body;

  if (mode === 'advanced') {
    return mergeTimeRangeIntoAdvancedBody(body, range, fieldFormat);
  }

  const next = { ...body };
  const trimmed = simpleQuery.trim();
  next.query =
    !trimmed || trimmed === '*'
      ? { match_all: {} }
      : { query_string: { query: trimmed } };
  return mergeTimeRangeIntoAdvancedBody(next, range, fieldFormat);
}

function resolveDateHistogramAggFormat(fieldFormat: string | null | undefined): string | undefined {
  const fmt = fieldFormat?.trim() ?? '';
  if (!fmt || fmt.includes('epoch_millis')) return undefined;
  const base = fmt.split('||')[0]?.trim() ?? fmt;
  if (base.includes('yyyy-MM-dd') || base.includes('strict_date')) return base;
  return undefined;
}

export function histogramIntervalToEsFields(interval: HistogramInterval): Record<string, string> {
  if (interval.kind === 'calendar_interval') {
    return { calendar_interval: interval.value };
  }
  return { fixed_interval: interval.value };
}

function buildDateHistogramAgg(
  timeField: string,
  interval: HistogramInterval,
  windowRange?: TimeRangeFilter | null,
  fieldFormat?: string | null
): Record<string, unknown> {
  const dateHistogram: Record<string, unknown> = {
    field: timeField,
    min_doc_count: 0,
    time_zone: getBrowserTimeZone()
  };

  const aggFormat = resolveDateHistogramAggFormat(fieldFormat);
  if (aggFormat) dateHistogram.format = aggFormat;

  Object.assign(dateHistogram, histogramIntervalToEsFields(interval));

  if (windowRange?.field) {
    const absolute = resolveAbsoluteTimeRangeMs(windowRange);
    if (absolute && absolute.gteMs <= absolute.lteMs) {
      const boundsRange = toAbsoluteTimeRange(windowRange, absolute.gteMs, absolute.lteMs);
      const normalized = normalizeTimeRangeForElasticsearch(boundsRange, fieldFormat);
      dateHistogram.extended_bounds = {
        min: normalized.gte,
        max: normalized.lte
      };
    }
  }

  return dateHistogram;
}

export function mergeHistogramIntoSearchBody(
  searchBody: Record<string, unknown>,
  timeField: string,
  windowRange: TimeRangeFilter,
  interval: HistogramInterval,
  fieldFormat?: string | null
): Record<string, unknown> {
  return {
    ...searchBody,
    aggs: {
      time_histogram: {
        date_histogram: buildDateHistogramAgg(timeField, interval, windowRange, fieldFormat)
      }
    }
  };
}

export function buildHistogramSearchBody(
  searchBody: Record<string, unknown>,
  timeField: string,
  windowRange: TimeRangeFilter,
  interval: HistogramInterval,
  fieldFormat?: string | null
): Record<string, unknown> {
  const { size: _size, from: _from, sort: _sort, aggs: _aggs, ...rest } = searchBody;

  return {
    ...rest,
    size: 0,
    track_total_hits: false,
    aggs: {
      time_histogram: {
        date_histogram: buildDateHistogramAgg(timeField, interval, windowRange, fieldFormat)
      }
    }
  };
}

type EsHistogramBucket = {
  key?: number | string;
  key_as_string?: string;
  doc_count?: number;
};

export function parseHistogramAggregationResponse(
  response: Record<string, unknown> | null | undefined
): HistogramBucket[] {
  const aggs = response?.aggregations as Record<string, unknown> | undefined;
  const hist = aggs?.time_histogram as { buckets?: EsHistogramBucket[] } | undefined;
  const buckets = hist?.buckets ?? [];
  const parsed = buckets
    .map((bucket) => {
      const key =
        typeof bucket.key === 'number'
          ? bucket.key
          : typeof bucket.key === 'string'
            ? Date.parse(bucket.key)
            : bucket.key_as_string
              ? Date.parse(bucket.key_as_string)
              : NaN;
      return {
        key,
        docCount: bucket.doc_count ?? 0,
        label: ''
      };
    })
    .filter((b) => Number.isFinite(b.key));
  const spanMs =
    parsed.length >= 2 ? parsed[parsed.length - 1].key - parsed[0].key : 0;
  return parsed.map((b) => ({
    ...b,
    label: formatHistogramTick(b.key, spanMs)
  }));
}

/** True when a chart time window returned documents or non-zero histogram buckets. */
export function timeChartRangeHasData(
  buckets: HistogramBucket[],
  total: number | null,
  hitCount: number
): boolean {
  if (hitCount > 0) return true;
  if (total != null && total > 0) return true;
  return buckets.some((bucket) => bucket.docCount > 0);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Format a histogram bucket timestamp for axis labels and tooltips (always includes year). */
export function formatHistogramTick(ms: number, spanMs = 0): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';

  if (spanMs > 365 * MS_PER_DAY) {
    return d.toLocaleString(undefined, { month: 'short', year: 'numeric' });
  }
  if (spanMs > 7 * MS_PER_DAY) {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** Size bars from median bucket gap in pixel space so they never overlap on a linear time axis. */
export function computeHistogramBarSizePx(
  buckets: HistogramBucket[],
  plotWidthPx: number,
  opts?: { marginLeft?: number; marginRight?: number; yAxisWidth?: number; maxBarPx?: number }
): number {
  const marginLeft = opts?.marginLeft ?? 0;
  const marginRight = opts?.marginRight ?? 12;
  const yAxisWidth = opts?.yAxisWidth ?? 56;
  const maxBarPx = opts?.maxBarPx ?? 28;

  if (buckets.length === 0 || plotWidthPx <= 0) return 8;

  const inner = Math.max(1, plotWidthPx - marginLeft - marginRight - yAxisWidth);
  const sorted = [...buckets].sort((a, b) => a.key - b.key);
  if (sorted.length === 1) {
    return Math.min(maxBarPx, Math.max(4, Math.floor(inner * 0.04)));
  }

  const domainSpan = Math.max(sorted[sorted.length - 1].key - sorted[0].key, 1);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].key - sorted[i - 1].key;
    if (gap > 0) intervals.push(gap);
  }

  let medianInterval = domainSpan / (sorted.length - 1);
  if (intervals.length > 0) {
    intervals.sort((a, b) => a - b);
    medianInterval = intervals[Math.floor(intervals.length / 2)] ?? medianInterval;
  }

  const pxPerMs = inner / domainSpan;
  const barPx = medianInterval * pxPerMs * 0.82;
  return Math.max(2, Math.min(maxBarPx, Math.floor(barPx)));
}

function medianBucketIntervalMs(buckets: HistogramBucket[]): number {
  const sorted = [...buckets].sort((a, b) => a.key - b.key);
  if (sorted.length < 2) return 60_000;
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].key - sorted[i - 1].key;
    if (gap > 0) intervals.push(gap);
  }
  if (intervals.length === 0) return 60_000;
  intervals.sort((a, b) => a - b);
  return intervals[Math.floor(intervals.length / 2)] ?? 60_000;
}

function resolveHalfBucketPadMs(windowRange: TimeRangeFilter, buckets: HistogramBucket[]): number {
  if (buckets.length >= 2) {
    return Math.max(1, Math.floor(medianBucketIntervalMs(buckets) / 2));
  }
  const spanMs = estimateRangeSpanMs(windowRange);
  const intervalMs = computeHistogramIntervalMsForSpan(spanMs);
  return Math.max(1, Math.floor(intervalMs / 2));
}

function resolveHistogramVisualWindowMs(
  windowRange: TimeRangeFilter,
  buckets: HistogramBucket[],
  bounds?: TimeFieldBounds | null
): { gteMs: number; lteMs: number } | null {
  const sorted = [...buckets].sort((a, b) => a.key - b.key);
  const absolute = resolveAbsoluteTimeRangeMs(windowRange);

  if (absolute) {
    if (sorted.length === 0) return absolute;

    const step = sorted.length >= 2 ? medianBucketIntervalMs(sorted) : computeHistogramIntervalMsForSpan(Math.max(absolute.lteMs - absolute.gteMs, 1000));
    const tolerance = Math.max(step, 1);
    const overlapsWindow = sorted.some(
      (bucket) => bucket.key >= absolute.gteMs - tolerance && bucket.key <= absolute.lteMs + tolerance
    );
    if (overlapsWindow) return absolute;

    const first = sorted[0].key;
    const last = sorted[sorted.length - 1].key;
    const bucketSpan = Math.max(last - first, step);
    const windowSpan = Math.max(absolute.lteMs - absolute.gteMs, step);

    // Some date fields are formatted without timezone. Elasticsearch returns bucket
    // keys in a shifted epoch space, while the UI range is based on browser time.
    // If the response is a same-sized time window with no overlap, render in the
    // bucket key space instead of treating valid data as out-of-window.
    if (bucketSpan <= windowSpan + step * 2) {
      return { gteMs: first, lteMs: Math.max(last, first + windowSpan) };
    }

    return absolute;
  }

  if (bounds?.minMs != null && bounds?.maxMs != null && bounds.minMs <= bounds.maxMs) {
    return { gteMs: bounds.minMs, lteMs: bounds.maxMs };
  }

  if (sorted.length === 0) return null;
  return { gteMs: sorted[0].key, lteMs: sorted[sorted.length - 1].key };
}

/**
 * X-axis domain aligned with the active time filter (Kibana/Discover-style).
 * The domain must come from the selected window, not from returned buckets; otherwise
 * stale/out-of-window buckets can stretch the chart and visually pin bars to one side.
 */
export function resolveHistogramXDomain(
  windowRange: TimeRangeFilter,
  buckets: HistogramBucket[],
  bounds?: TimeFieldBounds | null
): [number, number] {
  const visualWindow = resolveHistogramVisualWindowMs(windowRange, buckets, bounds);
  if (visualWindow) return [visualWindow.gteMs, visualWindow.lteMs];

  const sorted = [...buckets].sort((a, b) => a.key - b.key);
  if (sorted.length === 0) return [0, 1];

  const min = sorted[0].key;
  const max = sorted[sorted.length - 1].key;
  if (max <= min) {
    const half = resolveHalfBucketPadMs(windowRange, buckets);
    return [min - half, min + half];
  }
  return [min, max];
}

export function resolveHistogramChartSpanMs(
  windowRange: TimeRangeFilter,
  buckets: HistogramBucket[],
  bounds?: TimeFieldBounds | null
): number {
  const absolute = resolveAbsoluteTimeRangeMs(windowRange);
  if (absolute) return Math.max(absolute.lteMs - absolute.gteMs, 0);

  if (bounds?.minMs != null && bounds?.maxMs != null) {
    return Math.max(bounds.maxMs - bounds.minMs, 0);
  }

  if (buckets.length >= 2) {
    const sorted = [...buckets].sort((a, b) => a.key - b.key);
    return sorted[sorted.length - 1].key - sorted[0].key;
  }
  return 0;
}

/**
 * Fill the histogram into a complete, evenly-spaced series across the selected window.
 * Returned buckets outside the active window are intentionally ignored; the visual time
 * axis is owned by the selected range, not by Elasticsearch's response extent.
 */
export function padHistogramBucketsToWindow(
  buckets: HistogramBucket[],
  windowRange: TimeRangeFilter,
  bounds?: TimeFieldBounds | null
): HistogramBucket[] {
  if (buckets.length === 0) return buckets;

  const sorted = [...buckets].sort((a, b) => a.key - b.key);
  const visualWindow = resolveHistogramVisualWindowMs(windowRange, sorted, bounds);
  if (!visualWindow) return sorted;
  const { gteMs, lteMs } = visualWindow;

  const step =
    sorted.length >= 2
      ? medianBucketIntervalMs(sorted)
      : computeHistogramIntervalMsForSpan(Math.max(lteMs - gteMs, 1000));
  if (!Number.isFinite(step) || step <= 0) return sorted;

  const startKey = Math.floor(gteMs / step) * step;
  const endKey = Math.ceil(lteMs / step) * step;

  const count = Math.floor((endKey - startKey) / step) + 1;
  if (count <= 0 || count > MAX_HISTOGRAM_BUCKETS * 3) return sorted;

  const docCountByKey = new Map<number, number>();
  for (const bucket of sorted) {
    if (bucket.key < startKey || bucket.key > endKey) continue;
    const alignedKey = startKey + Math.round((bucket.key - startKey) / step) * step;
    if (alignedKey < startKey || alignedKey > endKey) continue;
    docCountByKey.set(alignedKey, (docCountByKey.get(alignedKey) ?? 0) + bucket.docCount);
  }

  const spanForLabel = endKey - startKey;
  const result: HistogramBucket[] = [];
  for (let i = 0; i < count; i++) {
    const key = startKey + i * step;
    result.push({
      key,
      docCount: docCountByKey.get(key) ?? 0,
      label: formatHistogramTick(key, spanForLabel)
    });
  }
  return result;
}

export function formatHistogramIntervalLabel(interval: HistogramInterval): string {
  if (interval.kind === 'calendar_interval') {
    const labels: Record<string, string> = {
      '1h': '1 hour',
      '1d': '1 day',
      '1w': '1 week',
      '1M': '1 month'
    };
    return labels[interval.value] ?? interval.value;
  }
  const match = /^(\d+)([smhd])$/i.exec(interval.value.trim());
  if (!match) return interval.value;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const names: Record<string, string> = {
    s: 'second',
    m: 'minute',
    h: 'hour',
    d: 'day'
  };
  const name = names[unit] ?? unit;
  return `${amount} ${name}${amount === 1 ? '' : 's'}`;
}

function formatHistogramFooterTimestamp(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return String(ms);
  const date = d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const msPart = String(d.getMilliseconds()).padStart(3, '0');
  return `${date} @ ${time}.${msPart}`;
}

/** Kibana-style footer: absolute range + auto interval label. */
export function formatHistogramFooterLabel(
  range: TimeRangeFilter,
  interval: HistogramInterval,
  bounds?: TimeFieldBounds | null
): string {
  const absolute = resolveAbsoluteTimeRangeMs(range);
  const intervalLabel = formatHistogramIntervalLabel(interval);

  if (absolute) {
    return `${formatHistogramFooterTimestamp(absolute.gteMs)} - ${formatHistogramFooterTimestamp(absolute.lteMs)} (interval: Auto - ${intervalLabel})`;
  }

  if (bounds?.minMs != null && bounds?.maxMs != null) {
    return `${formatHistogramFooterTimestamp(bounds.minMs)} - ${formatHistogramFooterTimestamp(bounds.maxMs)} (interval: Auto - ${intervalLabel})`;
  }

  return `interval: Auto - ${intervalLabel}`;
}

export function resolveChartFilterRange(
  preset: TimeRangePreset,
  field: string,
  brushRange: TimeRangeFilter | null
): TimeRangeFilter {
  if (brushRange) return brushRange;
  const normalized = normalizeChartPreset(preset);
  if (isAllTimePreset(normalized) && field) {
    return { field, gte: '', lte: '' };
  }
  return withTimeField(resolvePresetTimeRange(normalized), field);
}

export function formatTimeRangeLabel(
  range: TimeRangeFilter,
  preset?: TimeRangePreset,
  bounds?: TimeFieldBounds | null
): string {
  if (preset && isSearchResultsPreset(preset) && !range.gte && !range.lte) {
    return 'Current search results';
  }

  if (preset && isAllTimePreset(preset) && !range.gte && !range.lte) {
    const full = buildAllHistogramRange(range.field, bounds ?? null);
    if (full) return formatTimeRangeLabel(full);
    return 'All documents (loading range…)';
  }

  if (isRelativeDateMathRange(range)) {
    const presetEntry = Object.entries(RELATIVE_PRESET_RANGE).find(
      ([, cfg]) => cfg.gte === range.gte && cfg.lte === range.lte
    );
    if (presetEntry) return presetEntry[1].label;
    return `${range.gte} → ${range.lte}`;
  }

  const gte = new Date(range.gte);
  const lte = new Date(range.lte);
  if (!Number.isFinite(gte.getTime()) || !Number.isFinite(lte.getTime())) {
    return `${range.gte} → ${range.lte}`;
  }
  const sameDay = gte.toDateString() === lte.toDateString();
  const dateFmt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const timeFmt: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
  if (sameDay) {
    return `${gte.toLocaleDateString(undefined, dateFmt)} ${gte.toLocaleTimeString(undefined, timeFmt)} – ${lte.toLocaleTimeString(undefined, timeFmt)}`;
  }
  return `${gte.toLocaleString(undefined, { ...dateFmt, ...timeFmt })} – ${lte.toLocaleString(undefined, { ...dateFmt, ...timeFmt })}`;
}

export function brushSelectionToTimeRange(
  buckets: HistogramBucket[],
  leftKey: number,
  rightKey: number,
  field: string
): TimeRangeFilter {
  const minKey = Math.min(leftKey, rightKey);
  const maxKey = Math.max(leftKey, rightKey);
  const sorted = [...buckets].sort((a, b) => a.key - b.key);
  const inRange = sorted.filter((b) => b.key >= minKey && b.key <= maxKey);
  const gteMs = inRange.length > 0 ? inRange[0].key : minKey;
  const last = inRange.length > 0 ? inRange[inRange.length - 1] : sorted.find((b) => b.key >= maxKey) ?? sorted[sorted.length - 1];
  const lastIndex = sorted.findIndex((b) => b.key === last.key);
  const nextBucket = lastIndex >= 0 ? sorted[lastIndex + 1] : undefined;
  const lteMs = nextBucket ? nextBucket.key - 1 : last.key;
  return {
    field,
    gte: new Date(gteMs).toISOString(),
    lte: new Date(Math.max(lteMs, gteMs)).toISOString()
  };
}

export function bucketSelectionToTimeRange(
  buckets: HistogramBucket[],
  bucketKey: number,
  field: string
): TimeRangeFilter {
  return brushSelectionToTimeRange(buckets, bucketKey, bucketKey, field);
}

/** Bucket keys whose interval overlaps an absolute (brush) time range. */
export function resolveSelectedBucketKeys(
  buckets: HistogramBucket[],
  range: TimeRangeFilter
): Set<number> {
  const gteMs = Date.parse(range.gte);
  const lteMs = Date.parse(range.lte);
  if (!Number.isFinite(gteMs) || !Number.isFinite(lteMs)) return new Set();

  const sorted = [...buckets].sort((a, b) => a.key - b.key);
  const selected = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    const bucket = sorted[i];
    const next = sorted[i + 1];
    const bucketEndMs = next ? next.key - 1 : lteMs;
    if (bucket.key <= lteMs && bucketEndMs >= gteMs) {
      selected.add(bucket.key);
    }
  }

  return selected;
}

export async function fetchTimeFieldBounds(
  cluster: ClusterConnection,
  indexPattern: string,
  timeField: string,
  signal?: AbortSignal | null
): Promise<TimeFieldBounds> {
  try {
    const res = await searchIndexDocuments(
      cluster,
      indexPattern,
      {
        size: 0,
        aggs: {
          min_time: { min: { field: timeField } },
          max_time: { max: { field: timeField } }
        }
      },
      signal
    );
    const aggs = res.aggregations as Record<string, { value?: number | null }> | undefined;
    const min = aggs?.min_time?.value;
    const max = aggs?.max_time?.value;
    return {
      minMs: typeof min === 'number' && Number.isFinite(min) ? min : null,
      maxMs: typeof max === 'number' && Number.isFinite(max) ? max : null
    };
  } catch {
    return { minMs: null, maxMs: null };
  }
}
