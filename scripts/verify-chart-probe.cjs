/**
 * Unit checks for time chart open probe (@timestamp: 15m → 24h → 30d → 1y → all).
 * Run: node scripts/verify-chart-probe.cjs
 */

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const CHART_PROBE_PRESETS = ['15m', '24h', '30d', '1y', 'all'];
const CHART_PROBE_TIME_FIELD = '@timestamp';

function resolveStandardChartTimeField(fields) {
  if (fields.includes('@timestamp')) return '@timestamp';
  if (fields.includes('timestamp')) return 'timestamp';
  return null;
}

function buildSelectTimestampFieldMessage() {
  return 'Please select a timestamp field above.';
}

function advanceChartProbeStep(input) {
  if (input.hasData) return { action: 'success' };
  const index = CHART_PROBE_PRESETS.indexOf(input.presetStep);
  if (index < 0 || index >= CHART_PROBE_PRESETS.length - 1) {
    return { action: 'exhausted' };
  }
  return { action: 'retry', preset: CHART_PROBE_PRESETS[index + 1] };
}

function formatEmptyChartRangePhrase(preset) {
  if (!preset) return 'in the selected time range';
  if (preset === 'all') return 'in all time';
  if (preset === 'search') return 'in the current search results';
  const labels = {
    '5m': 'last 5 minutes',
    '15m': 'last 15 minutes',
    '1h': 'last 1 hour',
    '24h': 'last 24 hours',
    '7d': 'last 7 days',
    '30d': 'last 30 days',
    '1y': 'last 1 year'
  };
  return labels[preset] ? `in ${labels[preset]}` : 'in the selected time range';
}

function buildNoTimestampChartDataMessage(field = CHART_PROBE_TIME_FIELD, preset) {
  const rangePhrase = formatEmptyChartRangePhrase(preset);
  const action =
    preset === 'all'
      ? 'Select another date time field above.'
      : 'Extend the time range or select another date time field above.';
  return `There is no data for the ${field} field ${rangePhrase}. ${action}`;
}

assert(resolveStandardChartTimeField(['event.time', '@timestamp']) === '@timestamp', '@timestamp wins');
assert(resolveStandardChartTimeField(['created', 'timestamp']) === 'timestamp', 'timestamp wins');
assert(resolveStandardChartTimeField(['event.time', 'created']) === null, 'no standard field');

const selectMsg = buildSelectTimestampFieldMessage();
assert(selectMsg.includes('Please select a timestamp field'), 'select message');
assert(!selectMsg.includes('without a time filter'), 'select message has no unfiltered note');

let step = advanceChartProbeStep({ presetStep: '15m', hasData: false });
assert(step.action === 'retry' && step.preset === '24h', '15m empty → 24h');

step = advanceChartProbeStep({ presetStep: '24h', hasData: false });
assert(step.action === 'retry' && step.preset === '30d', '24h empty → 30d');

step = advanceChartProbeStep({ presetStep: '30d', hasData: false });
assert(step.action === 'retry' && step.preset === '1y', '30d empty → 1y');

step = advanceChartProbeStep({ presetStep: '1y', hasData: false });
assert(step.action === 'retry' && step.preset === 'all', '1y empty → all');

step = advanceChartProbeStep({ presetStep: 'all', hasData: false });
assert(step.action === 'exhausted', 'all empty → exhausted');

step = advanceChartProbeStep({ presetStep: '15m', hasData: true });
assert(step.action === 'success', 'data stops probe');

const msg = buildNoTimestampChartDataMessage('@timestamp', '15m');
assert(msg.includes('@timestamp'), 'message references field');
assert(msg.includes('in last 15 minutes'), 'message includes time range');
assert(msg.includes('Extend the time range'), 'message suggests extending range');
assert(msg.includes('select another date time field'), 'message prompts field selection');
assert(!msg.includes('without a time filter'), 'no unfiltered table note');

const allMsg = buildNoTimestampChartDataMessage('event.created', 'all');
assert(allMsg.includes('in all time'), 'all preset phrase');
assert(allMsg.includes('Select another date time field above.'), 'all preset action');
assert(!allMsg.includes('Extend the time range'), 'all preset omits extend hint');

console.log('Chart probe verification OK');
