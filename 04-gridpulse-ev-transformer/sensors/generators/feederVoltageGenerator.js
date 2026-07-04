'use strict';

const MIN_V = 207;
const MAX_V = 253;
const MAX_STEP_V = 1.5;

// UK LV feeder tolerance is +10%/-6% of 230V nominal, hence the tight band
function nextValue(previousValue) {
  const previous = typeof previousValue === 'number' ? previousValue : 230;
  const step = (Math.random() * 2 - 1) * MAX_STEP_V;
  const next = previous + step;
  return Math.min(MAX_V, Math.max(MIN_V, Number(next.toFixed(1))));
}

module.exports = { nextValue, MIN_V, MAX_V };
