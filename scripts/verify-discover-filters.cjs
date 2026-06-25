/**
 * Unit checks for Discover filter query composition.
 * Run: node scripts/verify-discover-filters.cjs
 */

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// Inline mirror of mergeDiscoverFiltersIntoBody (no TS import in plain node script)
function extractQueryClause(body) {
  const query = body.query;
  if (!query || typeof query !== 'object' || Array.isArray(query)) return null;
  return query;
}

function buildMatchPhraseClause(filter) {
  return { match_phrase: { [filter.aggField]: filter.value } };
}

function mergeDiscoverFiltersIntoBody(body, filters) {
  if (filters.length === 0) return body;
  const next = { ...body };
  const positive = filters.filter((f) => !f.negate).map(buildMatchPhraseClause);
  const negative = filters.filter((f) => f.negate).map(buildMatchPhraseClause);
  const existingQuery = extractQueryClause(next);
  if (!existingQuery) {
    next.query = {
      bool: {
        ...(positive.length > 0 ? { filter: positive } : {}),
        ...(negative.length > 0 ? { must_not: negative } : {})
      }
    };
    return next;
  }
  if ('bool' in existingQuery && existingQuery.bool && typeof existingQuery.bool === 'object') {
    const bool = { ...existingQuery.bool };
    const existingFilter = Array.isArray(bool.filter) ? [...bool.filter] : bool.filter ? [bool.filter] : [];
    const existingMustNot = Array.isArray(bool.must_not) ? [...bool.must_not] : bool.must_not ? [bool.must_not] : [];
    bool.filter = [...existingFilter, ...positive];
    bool.must_not = [...existingMustNot, ...negative];
    next.query = { bool };
    return next;
  }
  next.query = {
    bool: {
      must: [existingQuery],
      ...(positive.length > 0 ? { filter: positive } : {}),
      ...(negative.length > 0 ? { must_not: negative } : {})
    }
  };
  return next;
}

const base = {
  query: { query_string: { query: 'error' } },
  size: 10
};

const withFilter = mergeDiscoverFiltersIntoBody(base, [
  { id: '1', field: 'hostname', aggField: 'hostname.keyword', value: 'abc' }
]);

assert(withFilter.query.bool.must[0].query_string.query === 'error', 'must preserves query_string');
assert(
  withFilter.query.bool.filter[0].match_phrase['hostname.keyword'] === 'abc',
  'filter adds match_phrase'
);

const withNegate = mergeDiscoverFiltersIntoBody(base, [
  { id: '2', field: 'status', aggField: 'status.keyword', value: 'off', negate: true }
]);

assert(withNegate.query.bool.must_not[0].match_phrase['status.keyword'] === 'off', 'must_not for negate');

console.log('Discover filter verification OK');

// --- field exists merge for collapsed top-values ---
function mergeFieldExistsIntoBody(body, aggField) {
  const existsFilter = { exists: { field: aggField } };
  const next = { ...body };
  const existingQuery = next.query;
  if (!existingQuery || typeof existingQuery !== 'object') {
    next.query = existsFilter;
    return next;
  }
  if (existingQuery.match_all) {
    next.query = existsFilter;
    return next;
  }
  if (existingQuery.bool) {
    const bool = { ...existingQuery.bool };
    const filters = Array.isArray(bool.filter) ? [...bool.filter] : bool.filter ? [bool.filter] : [];
    filters.push(existsFilter);
    bool.filter = filters;
    next.query = { bool };
    return next;
  }
  next.query = { bool: { must: [existingQuery], filter: [existsFilter] } };
  return next;
}

const existsOnly = mergeFieldExistsIntoBody({ query: { match_all: {} } }, 'contractorcode.keyword');
assert(existsOnly.query.exists.field === 'contractorcode.keyword', 'match_all → exists');

const existsWithPill = mergeFieldExistsIntoBody(
  {
    query: {
      bool: {
        must: [{ query_string: { query: '*' } }],
        filter: [{ match_phrase: { 'hostname.keyword': 'x' } }]
      }
    }
  },
  'contractorcode.keyword'
);
assert(
  existsWithPill.query.bool.filter.some((f) => f.exists?.field === 'contractorcode.keyword'),
  'exists appended to bool.filter'
);

// --- anchored popover flip (below → above near viewport bottom) ---
function computeAnchoredPopoverPosition(anchor, panelHeight, panelWidth, viewport) {
  const GAP_PX = 4;
  const VIEWPORT_PADDING_PX = 8;
  const vp = viewport ?? { width: 800, height: 600 };
  const safeHeight = Math.max(1, panelHeight);
  const safeWidth = Math.max(1, panelWidth);
  const spaceBelow = vp.height - VIEWPORT_PADDING_PX - (anchor.bottom + GAP_PX);
  const spaceAbove = anchor.top - GAP_PX - VIEWPORT_PADDING_PX;
  const fitsBelow = safeHeight <= spaceBelow;
  const fitsAbove = safeHeight <= spaceAbove;
  let placement = 'below';
  if (!fitsBelow && (fitsAbove || spaceAbove > spaceBelow)) placement = 'above';
  let top = placement === 'below' ? anchor.bottom + GAP_PX : anchor.top - GAP_PX - safeHeight;
  if (placement === 'below') top = Math.min(top, vp.height - VIEWPORT_PADDING_PX - safeHeight);
  else top = Math.max(top, VIEWPORT_PADDING_PX);
  let left = Math.min(anchor.left, vp.width - VIEWPORT_PADDING_PX - safeWidth);
  left = Math.max(left, VIEWPORT_PADDING_PX);
  return { top, left, placement };
}

const lowAnchor = { top: 520, bottom: 544, left: 12, right: 200 };
const highAnchor = { top: 120, bottom: 144, left: 12, right: 200 };
const vp = { width: 800, height: 600 };
const panelH = 360;
const lowPos = computeAnchoredPopoverPosition(lowAnchor, panelH, 288, vp);
const highPos = computeAnchoredPopoverPosition(highAnchor, panelH, 288, vp);
assert(lowPos.placement === 'above', 'flips above when near bottom');
assert(highPos.placement === 'below', 'opens below when room underneath');
assert(lowPos.top < lowAnchor.top, 'above placement sits above anchor');

function computeSidebarFieldPopoverPosition(fieldAnchor, sidebarAnchor, panelHeight, panelWidth, viewport) {
  const GAP_PX = 4;
  const VIEWPORT_PADDING_PX = 8;
  const vp = viewport ?? { width: 800, height: 600 };
  const safeHeight = Math.max(1, panelHeight);
  const safeWidth = Math.max(1, panelWidth);
  const spaceRight = vp.width - VIEWPORT_PADDING_PX - (sidebarAnchor.right + GAP_PX);
  const spaceLeft = sidebarAnchor.left - GAP_PX - VIEWPORT_PADDING_PX;
  let placement = 'right';
  let left;
  if (safeWidth <= spaceRight) left = sidebarAnchor.right + GAP_PX;
  else if (safeWidth <= spaceLeft) {
    placement = 'left';
    left = sidebarAnchor.left - GAP_PX - safeWidth;
  } else {
    left = sidebarAnchor.right + GAP_PX;
    left = Math.min(left, vp.width - VIEWPORT_PADDING_PX - safeWidth);
    left = Math.max(left, VIEWPORT_PADDING_PX);
  }
  let top = fieldAnchor.top;
  top = Math.min(top, vp.height - VIEWPORT_PADDING_PX - safeHeight);
  top = Math.max(top, VIEWPORT_PADDING_PX);
  return { top, left, placement };
}

const sidebar = { top: 80, bottom: 600, left: 0, right: 224, width: 224, height: 520 };
const fieldRow = { top: 240, bottom: 264, left: 8, right: 216, width: 208, height: 24 };
const sidebarPos = computeSidebarFieldPopoverPosition(fieldRow, sidebar, 200, 288, vp);
assert(sidebarPos.placement === 'right', 'field popover opens to the right of sidebar');
assert(sidebarPos.left >= sidebar.right, 'popover left edge starts after sidebar');
assert(sidebarPos.top === fieldRow.top, 'popover top aligns with field row when it fits');

function isValidPopoverAnchorRect(rect, viewport = { width: 800, height: 600 }) {
  if (!rect) return false;
  if (rect.width <= 0 && rect.height <= 0) return false;
  if (rect.bottom <= 0 || rect.right <= 0) return false;
  if (rect.top >= viewport.height || rect.left >= viewport.width) return false;
  return true;
}

assert(!isValidPopoverAnchorRect({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }), 'zero rect invalid');
assert(isValidPopoverAnchorRect({ top: 100, left: 50, bottom: 120, right: 150, width: 100, height: 20 }), 'normal rect valid');

function computeCellOverlayPopoverPosition(anchor, panelHeight, panelWidth, viewport = { width: 800, height: 600 }) {
  const pad = 8;
  let top = anchor.top + (anchor.height - panelHeight) / 2;
  let left = anchor.left + (anchor.width - panelWidth) / 2;
  top = Math.max(pad, Math.min(top, viewport.height - pad - panelHeight));
  left = Math.max(pad, Math.min(left, viewport.width - pad - panelWidth));
  return { top, left };
}

const cellAnchor = { top: 200, left: 300, bottom: 228, right: 420, width: 120, height: 28 };
const overlay = computeCellOverlayPopoverPosition(cellAnchor, 28, 76);
assert(overlay.top >= cellAnchor.top && overlay.top + 28 <= cellAnchor.bottom, 'overlay centered on cell');

console.log('Anchored popover position verification OK');

// --- discover cell value ---
function getDiscoverCellValue(hit, field, indexName) {
  const formatSourceCellValue = (value, maxLen = 96) => {
    if (value == null) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return value.length > maxLen ? `${value.slice(0, maxLen)}…` : value;
    return JSON.stringify(value);
  };
  if (field.startsWith('_')) {
    const raw = hit._id && field === '_id' ? hit._id : '';
    return { display: raw || '—', copyText: raw, filterValue: raw || null };
  }
  const raw = hit._source?.[field];
  if (raw == null) return { display: '—', copyText: '', filterValue: null };
  if (typeof raw === 'string') return { display: raw, copyText: raw, filterValue: raw };
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    const text = String(raw);
    return { display: text, copyText: text, filterValue: raw };
  }
  const text = JSON.stringify(raw);
  return { display: formatSourceCellValue(raw), copyText: text, filterValue: null };
}

const sampleHit = { _id: 'abc', _source: { host: 'node-1', count: 3, meta: { x: 1 } } };
assert(getDiscoverCellValue(sampleHit, 'host', 'idx').filterValue === 'node-1', 'string filter value');
assert(getDiscoverCellValue(sampleHit, 'count', 'idx').filterValue === 3, 'number filter value');
assert(getDiscoverCellValue(sampleHit, 'meta', 'idx').filterValue === null, 'object not filterable');

console.log('Discover cell value verification OK');

// --- discover document fields ---
function flattenHitDocumentFields(hit, indexName) {
  const rows = [];
  if (hit._id != null) rows.push({ field: '_id', value: String(hit._id) });
  if (hit._index != null) rows.push({ field: '_index', value: String(hit._index) });
  const source = hit._source ?? {};
  for (const key of Object.keys(source).sort()) {
    const val = source[key];
    rows.push({
      field: key,
      value: typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')
    });
  }
  return rows;
}

const docRows = flattenHitDocumentFields(
  { _id: '1', _index: 'logs', _source: { host: 'a', nested: { x: 1 } } },
  'logs'
);
assert(docRows.some((r) => r.field === '_id'), 'includes _id');
assert(docRows.some((r) => r.field === 'host'), 'includes source field');

console.log('Discover document fields verification OK');

// --- document field filter ---
function filterDocumentFieldRows(rows, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;
  const terms = normalized.split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    const fieldHaystack = row.field.toLowerCase();
    const valueHaystack = row.value.toLowerCase();
    return terms.every((term) => fieldHaystack.includes(term) || valueHaystack.includes(term));
  });
}

const docFilterRows = [
  { field: '_index', value: 'customers-v3-000686' },
  { field: 'customerid', value: '2507' },
  { field: 'customerid_vehicle', value: '2507_8270' },
  { field: 'driverInfo.ibiDriverId', value: '0' },
  { field: 'driverInfo.name', value: 'No driver signed in (system boot)' }
];
const customerFiltered = filterDocumentFieldRows(docFilterRows, 'customer');
assert(customerFiltered.length === 3, 'customer filter excludes driverInfo rows');
assert(
  !customerFiltered.some((r) => r.field.startsWith('driverInfo')),
  'no driverInfo in customer filter'
);

console.log('Discover document field filter verification OK');
