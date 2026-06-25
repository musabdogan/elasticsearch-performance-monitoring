/**
 * Integration check: field top-values sampler agg against a live cluster.
 * Reads credentials from .env.local (gitignored).
 *
 *   node scripts/verify-discover-top-values.cjs [index-name] [field-name]
 */
const fs = require('fs');
const path = require('path');

const SAMPLER_SHARD_SIZE = 5000;
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

function parseSampleTopValues(response) {
  const sample = response.aggregations?.sample;
  const sampleSize = sample?.doc_count ?? 0;
  const buckets = sample?.top_values?.buckets ?? [];
  return { sampleSize, bucketCount: buckets.length, buckets };
}

async function pickIndexAndField(baseUrl, auth) {
  const res = await esSearch(baseUrl, auth, '_all', {
    size: 0,
    aggs: { indices: { terms: { field: '_index', size: 5 } } }
  });
  const index = res.aggregations?.indices?.buckets?.[0]?.key;
  if (!index) throw new Error('No indices found');

  const mappingRes = await fetch(
    `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(index)}/_mapping`,
    { headers: { Authorization: `Basic ${Buffer.from(auth).toString('base64')}` } }
  );
  const mapping = await mappingRes.json();
  const props = Object.values(mapping)[0]?.mappings?.properties ?? {};
  const field =
    Object.entries(props).find(([, spec]) => spec?.type === 'keyword')?.[0] ??
    Object.keys(props)[0];
  if (!field) throw new Error(`No fields in ${index}`);
  const aggField = props[field]?.type === 'text' ? `${field}.keyword` : field;
  return { index, field, aggField };
}

function histogramIntervalToEsFields(interval) {
  if (interval.kind === 'calendar_interval') {
    return { calendar_interval: interval.value };
  }
  return { fixed_interval: interval.value };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const fixed = histogramIntervalToEsFields({ kind: 'fixed_interval', value: '15s' });
assert(fixed.fixed_interval === '15s', 'fixed_interval is a string');
assert(!('calendar_interval' in fixed), 'no calendar_interval on fixed');

const cal = histogramIntervalToEsFields({ kind: 'calendar_interval', value: '1d' });
assert(cal.calendar_interval === '1d', 'calendar_interval is a string');
assert(typeof cal.fixed_interval === 'undefined', 'no object fixed_interval');

console.log('Field top-values histogram interval verification OK');

async function main() {
  const env = loadEnvLocal();
  const baseUrl = env.ES_TEST_URL;
  const user = env.ES_TEST_USERNAME;
  const pass = env.ES_TEST_PASSWORD;
  if (!baseUrl || !user || !pass) {
    console.error('Set ES_TEST_URL, ES_TEST_USERNAME, ES_TEST_PASSWORD in .env.local');
    process.exit(1);
  }
  const auth = `${user}:${pass}`;

  const argIndex = process.argv[2];
  const argField = process.argv[3];
  let index = argIndex;
  let field = argField;
  let aggField = argField;

  if (!index || !field) {
    const picked = await pickIndexAndField(baseUrl, auth);
    index = index ?? picked.index;
    field = field ?? picked.field;
    aggField = picked.aggField;
  }

  const body = {
    query: { match_all: {} },
    size: 0,
    track_total_hits: false,
    aggs: {
      sample: {
        sampler: { shard_size: SAMPLER_SHARD_SIZE },
        aggs: {
          top_values: {
            terms: { field: aggField, size: 10, order: { _count: 'desc' } }
          },
          field_cardinality: { cardinality: { field: aggField } }
        }
      }
    }
  };

  const res = await esSearch(baseUrl, auth, index, body);
  const parsed = parseSampleTopValues(res);

  if (parsed.sampleSize <= 0) {
    throw new Error(`Expected sample.doc_count > 0, got ${parsed.sampleSize}`);
  }
  if (parsed.sampleSize > SAMPLER_SHARD_SIZE * 50) {
    throw new Error(`Sample size unexpectedly large: ${parsed.sampleSize}`);
  }

  console.log('Discover top-values sampler OK');
  console.log(`  index: ${index}`);
  console.log(`  field: ${field} (agg: ${aggField})`);
  console.log(`  sample records: ${parsed.sampleSize.toLocaleString()}`);
  console.log(`  top value buckets: ${parsed.bucketCount}`);
  if (parsed.buckets[0]) {
    console.log(`  top bucket: ${parsed.buckets[0].key} (${parsed.buckets[0].doc_count})`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
