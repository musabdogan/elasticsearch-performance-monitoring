/**
 * Natural index name sort (Query picker / Nodes-style numeric collation).
 * Run: node scripts/verify-index-name-sort.cjs
 */

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const naturalNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareNaturalNames(a, b) {
  return naturalNameCollator.compare(a, b);
}

function compareIndexNamesDotLast(a, b) {
  const aHidden = a.startsWith('.');
  const bHidden = b.startsWith('.');
  if (aHidden !== bHidden) return aHidden ? 1 : -1;
  return compareNaturalNames(a, b);
}

function sortIndexNamesDotLast(names) {
  return [...names].sort(compareIndexNamesDotLast);
}

const mixedPadding = [
  'customers-v3-2',
  'customers-v3-10',
  'customers-v3-99',
  'customers-v3-100',
  'customers-v3-000550',
  'customers-v3-000556',
  'customers-v3-000559',
  'customers-v3-00056'
];

const asc = sortIndexNamesDotLast(mixedPadding);
assert(asc.indexOf('customers-v3-2') < asc.indexOf('customers-v3-10'), '2 before 10');
assert(asc.indexOf('customers-v3-10') < asc.indexOf('customers-v3-99'), '10 before 99');
assert(asc.indexOf('customers-v3-99') < asc.indexOf('customers-v3-100'), '99 before 100');
assert(asc.indexOf('customers-v3-00056') < asc.indexOf('customers-v3-000550'), '56 before 550');
assert(asc.indexOf('customers-v3-000550') < asc.indexOf('customers-v3-000556'), '550 before 556');

const desc = [...mixedPadding].sort((a, b) => compareIndexNamesDotLast(b, a));
assert(desc.indexOf('customers-v3-000559') < desc.indexOf('customers-v3-000556'), 'desc: 559 before 556');
assert(desc.indexOf('customers-v3-000556') < desc.indexOf('customers-v3-000550'), 'desc: 556 before 550');
assert(desc.indexOf('customers-v3-100') < desc.indexOf('customers-v3-99'), 'desc: 100 before 99');

const withHidden = sortIndexNamesDotLast([
  '.ds-logs-2026.06.26-000001',
  'logs-2026.06.9',
  'logs-2026.06.26',
  'anchersentrips'
]);
assert(withHidden[withHidden.length - 1].startsWith('.'), 'hidden indices last');
assert(
  withHidden.indexOf('logs-2026.06.9') < withHidden.indexOf('logs-2026.06.26'),
  'date-like segments sort numerically'
);

console.log('Index name sort verification OK');
