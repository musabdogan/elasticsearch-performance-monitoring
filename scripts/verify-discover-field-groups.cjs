/**
 * Unit checks for Discover field grouping and top-values parsing.
 * Run: node scripts/verify-discover-field-groups.cjs
 */

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

function isMetaDataField(field) {
  return field === '_id' || field === '_index';
}

function isKeywordSubfield(field) {
  return field.endsWith('.keyword');
}

function isDisplayableSourceField(field) {
  if (field.startsWith('_')) return isMetaDataField(field);
  return !isKeywordSubfield(field);
}

function sortFieldNames(fields) {
  return [...fields].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function buildDiscoverFieldGroups(input) {
  const {
    selectedColumns,
    availableFields,
    hits,
    fieldUsageSummary,
    nameFilter = ''
  } = input;

  const q = nameFilter.trim().toLowerCase();
  const matchesFilter = (field) => !q || field.toLowerCase().includes(q);

  const selectedSet = new Set(
    selectedColumns.filter((f) => isDisplayableSourceField(f) && matchesFilter(f))
  );

  const metaFields = sortFieldNames(
    ['_id', '_index'].filter(matchesFilter)
  );

  const popularFromUsage =
    fieldUsageSummary?.fieldList
      ?.filter((f) => f.usage > 0 && isDisplayableSourceField(f.name) && !isMetaDataField(f.name))
      .sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name))
      .slice(0, 5)
      .map((f) => f.name) ?? [];

  const hitFieldSet = new Set();
  for (const hit of hits) {
    const source = hit._source ?? {};
    for (const key of Object.keys(source)) {
      if (isDisplayableSourceField(key)) hitFieldSet.add(key);
    }
  }

  const allKnown = new Set([...availableFields, ...popularFromUsage, ...hitFieldSet]);
  const selected = sortFieldNames([...selectedSet]);
  const popular = popularFromUsage.filter(matchesFilter);
  const available = sortFieldNames(
    [...allKnown].filter((field) => {
      if (isMetaDataField(field)) return false;
      if (selectedSet.has(field)) return false;
      if (popular.includes(field)) return false;
      return true;
    })
  ).filter(matchesFilter);

  return [
    { id: 'selected', fields: selected },
    { id: 'popular', fields: popular.filter((f) => !selectedSet.has(f)) },
    { id: 'available', fields: available },
    { id: 'meta', fields: metaFields.filter((f) => !selectedSet.has(f)) }
  ].filter((g) => g.fields.length > 0 || g.id === 'selected');
}

const groups = buildDiscoverFieldGroups({
  selectedColumns: ['@timestamp', 'hostname'],
  availableFields: ['@timestamp', 'hostname', 'message'],
  hits: [{ _source: { hostname: 'a', message: 'x' } }],
  fieldUsageSummary: {
    fieldList: [
      { name: 'hostname', usage: 10, usageTypes: ['search'] },
      { name: 'message', usage: 2, usageTypes: ['search'] }
    ]
  }
});

const selected = groups.find((g) => g.id === 'selected');
assert(selected.fields.includes('@timestamp'), 'selected includes timestamp');
const popular = groups.find((g) => g.id === 'popular');
assert(popular.fields.includes('message'), 'popular includes message from usage');
const meta = groups.find((g) => g.id === 'meta');
assert(meta.fields.includes('_id'), 'meta includes _id');
assert(meta.fields.includes('_index'), 'meta always includes _index');

function parseFieldTopValuesResponse(response, field) {
  const sample = response.aggregations?.sample;
  const sampleSize = sample?.doc_count ?? 0;
  const buckets = (sample?.top_values?.buckets ?? []).map((b) => ({
    key: String(b.key ?? ''),
    docCount: b.doc_count ?? 0,
    percent: sampleSize > 0 ? ((b.doc_count ?? 0) / sampleSize) * 100 : 0
  }));
  return { field, sampleSize, buckets };
}

const parsed = parseFieldTopValuesResponse(
  {
    aggregations: {
      sample: {
        doc_count: 15000,
        top_values: {
          buckets: [
            { key: 'host-a', doc_count: 9000 },
            { key: 'host-b', doc_count: 6000 }
          ]
        }
      }
    }
  },
  'hostname'
);

assert(parsed.buckets.length === 2, 'parses sampler terms buckets');
assert(parsed.sampleSize === 15000, 'uses sample doc_count');
assert(parsed.buckets[0].percent === 60, 'percent from sample size');

const noPopular = buildDiscoverFieldGroups({
  selectedColumns: ['message'],
  availableFields: ['message'],
  hits: [{ _source: { message: 'x' } }],
  fieldUsageSummary: null
});
assert(!noPopular.some((g) => g.id === 'popular'), 'popular hidden without usage stats');

console.log('Discover field groups verification OK');

function getSourceValueByFlatten(source, targetPath) {
  let found;
  const walk = (value, prefix) => {
    if (found !== undefined) return;
    if (prefix === targetPath) {
      found = value;
      return;
    }
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      walk(child, prefix ? `${prefix}.${key}` : key);
    }
  };
  for (const [key, value] of Object.entries(source)) {
    walk(value, key);
  }
  return found;
}

function getSourceValueByPath(source, path) {
  if (Object.prototype.hasOwnProperty.call(source, path)) return source[path];
  if (!path.includes('.')) return source[path];
  let current = source;
  for (const part of path.split('.')) {
    if (current == null || typeof current !== 'object' || Array.isArray(current)) {
      current = undefined;
      break;
    }
    current = current[part];
  }
  if (current !== undefined) return current;
  return getSourceValueByFlatten(source, path);
}

const nestedSource = {
  currentStop: { arrivalEstimate: '2025-10-03T00:09:00' },
  'driverInfo.shiftName': 'No Shift',
  driverInfo: { shiftName: '0' },
  dateandtime: '2025-10-01T22:12:43.000Z'
};
assert(
  getSourceValueByPath(nestedSource, 'currentStop.arrivalEstimate') === '2025-10-03T00:09:00',
  'nested object path'
);
assert(
  getSourceValueByPath(nestedSource, 'driverInfo.shiftName') === 'No Shift',
  'flat dotted key wins over nested traversal'
);
assert(getSourceValueByPath(nestedSource, 'dateandtime') === '2025-10-01T22:12:43.000Z', 'top-level field');

console.log('Source field path verification OK');
