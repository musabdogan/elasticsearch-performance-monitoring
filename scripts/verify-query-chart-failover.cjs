/**
 * Integration check: 15m probe empty → bounds → All range has data.
 * Reads credentials from .env.local (gitignored).
 *
 *   node scripts/verify-query-chart-failover.cjs [index-name]
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env.local');

function loadEnvLocal() {
  if (!fs.existsSync(envPath)) {
    console.error('Missing .env.local — copy .env.local.example and set ES_TEST_*');
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function timeChartRangeHasData(buckets, total, hitCount) {
  if (hitCount > 0) return true;
  if (total != null && total > 0) return true;
  return buckets.some((b) => (b.doc_count ?? 0) > 0);
}

function hasValidTimeFieldBounds(bounds) {
  if (!bounds) return false;
  return (
    typeof bounds.minMs === 'number' &&
    Number.isFinite(bounds.minMs) &&
    typeof bounds.maxMs === 'number' &&
    Number.isFinite(bounds.maxMs)
  );
}

function buildAllHistogramRange(field, bounds) {
  if (!field || bounds?.minMs == null || bounds?.maxMs == null) return null;
  if (bounds.minMs > bounds.maxMs) return null;
  return {
    field,
    gte: new Date(bounds.minMs).toISOString(),
    lte: new Date(bounds.maxMs).toISOString()
  };
}

function resolveExpandedChartTimeSearchContext(preset, timeField, brushRange, bounds) {
  const range = brushRange ?? { field: timeField, gte: '', lte: '' };
  let resolution;
  if (preset === 'all' && !brushRange) {
    const fullRange = buildAllHistogramRange(timeField, bounds);
    resolution = fullRange
      ? { mode: 'filter', range: fullRange, histogramRange: fullRange }
      : { mode: 'none' };
  } else {
    resolution = { mode: 'filter', range };
  }
  if (resolution.mode === 'skip' || (preset === 'all' && !brushRange && !hasValidTimeFieldBounds(bounds))) {
    resolution = hasValidTimeFieldBounds(bounds)
      ? (() => {
          const full = buildAllHistogramRange(timeField, bounds);
          return full ? { mode: 'filter', range: full, histogramRange: full } : { mode: 'none' };
        })()
      : { mode: 'none' };
  }
  return { timeField, resolution };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const testBounds = { minMs: 1_700_000_000_000, maxMs: 1_800_000_000_000 };
const expandedAll = resolveExpandedChartTimeSearchContext('all', 'actionDate', null, testBounds);
assert(expandedAll.resolution.mode === 'filter', 'expanded All always applies time filter when bounds exist');
assert(expandedAll.resolution.range.field === 'actionDate', 'filter uses selected time field');
assert(expandedAll.resolution.range.gte && expandedAll.resolution.range.lte, 'filter has gte/lte');

const expandedNoBounds = resolveExpandedChartTimeSearchContext('all', 'actionDate', null, null);
assert(expandedNoBounds.resolution.mode === 'none', 'expanded All without bounds uses match_none not skip');

console.log('Expanded chart time context verification OK');

async function esSearch(baseUrl, auth, index, body) {
  const url = `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(index)}/_search`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(auth).toString('base64')}`
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 400)}`);
  }
  return json;
}

async function pickIndexWithDateField(baseUrl, auth) {
  const res = await esSearch(baseUrl, auth, '_all', {
    size: 0,
    aggs: {
      indices: {
        terms: { field: '_index', size: 20 }
      }
    }
  });
  const names = (res.aggregations?.indices?.buckets ?? []).map((b) => b.key);
  for (const name of names) {
    const mappingRes = await fetch(
      `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}/_mapping`,
      { headers: { Authorization: `Basic ${Buffer.from(auth).toString('base64')}` } }
    );
    const mapping = await mappingRes.json();
    const props = Object.values(mapping)[0]?.mappings?.properties ?? {};
    for (const [field, spec] of Object.entries(props)) {
      if (spec && typeof spec === 'object' && (spec.type === 'date' || spec.type === 'date_nanos')) {
        return { index: name, timeField: field, format: spec.format ?? null };
      }
    }
  }
  return null;
}

function build15mProbeBody(timeField, fieldFormat) {
  const now = new Date();
  const gteMs = now.getTime() - 15 * 60 * 1000;
  const lteMs = now.getTime();
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtLocal = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  };
  const useLocal = fieldFormat && String(fieldFormat).includes('yyyy-MM-dd');
  const gte = useLocal ? fmtLocal(gteMs) : new Date(gteMs).toISOString();
  const lte = useLocal ? fmtLocal(lteMs) : new Date(lteMs).toISOString();
  const boundsMin = useLocal ? fmtLocal(gteMs) : new Date(gteMs).toISOString();
  const boundsMax = useLocal ? fmtLocal(lteMs) : new Date(lteMs).toISOString();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const aggFormat =
    fieldFormat && String(fieldFormat).includes('yyyy-MM-dd') ? String(fieldFormat).split('||')[0] : undefined;

  const dateHistogram = {
    field: timeField,
    min_doc_count: 0,
    time_zone: tz,
    fixed_interval: '15s',
    extended_bounds: { min: boundsMin, max: boundsMax }
  };
  if (aggFormat) dateHistogram.format = aggFormat;

  return {
    size: 10,
    from: 0,
    sort: [{ [timeField]: { order: 'desc' } }],
    query: {
      bool: {
        must: [{ match_all: {} }],
        filter: [{ range: { [timeField]: { gte, lte } } }]
      }
    },
    aggs: { time_histogram: { date_histogram: dateHistogram } }
  };
}

async function main() {
  const env = loadEnvLocal();
  const baseUrl = env.ES_TEST_URL;
  const auth = `${env.ES_TEST_USERNAME}:${env.ES_TEST_PASSWORD}`;
  if (!baseUrl || !env.ES_TEST_USERNAME) {
    console.error('ES_TEST_URL / ES_TEST_USERNAME missing in .env.local');
    process.exit(1);
  }

  let index = process.argv[2];
  let timeField;
  let fieldFormat = null;

  if (!index) {
    const picked = await pickIndexWithDateField(baseUrl, auth);
    if (!picked) {
      console.error('No index with a date field found');
      process.exit(1);
    }
    ({ index, timeField, format: fieldFormat } = picked);
    console.log(`Auto-picked index: ${index}, timeField: ${timeField}`);
  } else {
    const mappingRes = await fetch(
      `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(index)}/_mapping`,
      { headers: { Authorization: `Basic ${Buffer.from(auth).toString('base64')}` } }
    );
    const mapping = await mappingRes.json();
    const props = Object.values(mapping)[0]?.mappings?.properties ?? {};
    for (const [field, spec] of Object.entries(props)) {
      if (spec?.type === 'date' || spec?.type === 'date_nanos') {
        timeField = field;
        fieldFormat = spec.format ?? null;
        break;
      }
    }
    if (!timeField) {
      console.error(`No date field in ${index}`);
      process.exit(1);
    }
  }

  console.log('\n1) match_all (chart collapsed)');
  const initial = await esSearch(baseUrl, auth, index, {
    size: 10,
    from: 0,
    sort: [],
    query: { match_all: {} }
  });
  const initialHits = initial.hits?.hits?.length ?? 0;
  const initialTotal = initial.hits?.total?.value ?? initial.hits?.total ?? 0;
  console.log(`   hits=${initialHits}, total=${initialTotal}`);

  console.log('\n2) 15m probe');
  const probeBody = build15mProbeBody(timeField, fieldFormat);
  const probe = await esSearch(baseUrl, auth, index, probeBody);
  const probeHits = probe.hits?.hits?.length ?? 0;
  const probeTotal = probe.hits?.total?.value ?? probe.hits?.total ?? 0;
  const buckets = probe.aggregations?.time_histogram?.buckets ?? [];
  const probeHasData = timeChartRangeHasData(buckets, probeTotal, probeHits);
  console.log(`   hits=${probeHits}, total=${probeTotal}, buckets=${buckets.length}, hasData=${probeHasData}`);

  console.log('\n3) bounds min/max');
  const bounds = await esSearch(baseUrl, auth, index, {
    size: 0,
    aggs: {
      min_time: { min: { field: timeField } },
      max_time: { max: { field: timeField } }
    }
  });
  const minMs = bounds.aggregations?.min_time?.value;
  const maxMs = bounds.aggregations?.max_time?.value;
  console.log(`   min=${bounds.aggregations?.min_time?.value_as_string ?? minMs}`);
  console.log(`   max=${bounds.aggregations?.max_time?.value_as_string ?? maxMs}`);

  if (!probeHasData && minMs != null && maxMs != null) {
    console.log('\n4) All range (failover expected)');
    const pad2 = (n) => String(n).padStart(2, '0');
    const fmtLocal = (ms) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    };
    const useLocal = fieldFormat && String(fieldFormat).includes('yyyy-MM-dd');
    const gte = useLocal ? fmtLocal(minMs) : new Date(minMs).toISOString();
    const lte = useLocal ? fmtLocal(maxMs) : new Date(maxMs).toISOString();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const spanMs = maxMs - minMs;
    const interval = spanMs > 90 * 24 * 60 * 60 * 1000 ? '1M' : '1d';
    const aggFormat =
      fieldFormat && String(fieldFormat).includes('yyyy-MM-dd')
        ? String(fieldFormat).split('||')[0]
        : undefined;
    const dateHistogram = {
      field: timeField,
      min_doc_count: 0,
      time_zone: tz,
      calendar_interval: interval,
      extended_bounds: { min: gte, max: lte }
    };
    if (aggFormat) dateHistogram.format = aggFormat;

    const allRes = await esSearch(baseUrl, auth, index, {
      size: 10,
      from: 0,
      sort: [{ [timeField]: { order: 'desc' } }],
      query: {
        bool: {
          must: [{ match_all: {} }],
          filter: [{ range: { [timeField]: { gte, lte } } }]
        }
      },
      aggs: { time_histogram: { date_histogram: dateHistogram } }
    });
    const allHits = allRes.hits?.hits?.length ?? 0;
    const allTotal = allRes.hits?.total?.value ?? allRes.hits?.total ?? 0;
    const allBuckets = allRes.aggregations?.time_histogram?.buckets ?? [];
    const nonZeroBuckets = allBuckets.filter((b) => (b.doc_count ?? 0) > 0).length;
    console.log(`   hits=${allHits}, total=${allTotal}, nonZeroBuckets=${nonZeroBuckets}`);

    if (allHits > 0 || nonZeroBuckets > 0) {
      console.log('\n✅ Failover chain OK: 15m empty → All has data');
      process.exit(0);
    }
    console.log('\n⚠️  15m empty but All also empty — index may have no docs in bounds');
    process.exit(1);
  }

  if (probeHasData) {
    console.log('\n✅ 15m has data — failover not needed');
    process.exit(0);
  }

  console.log('\n❌ 15m empty but bounds missing');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
