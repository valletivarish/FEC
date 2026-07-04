'use strict';

const MIN_KW = 0;
const MAX_KW = 50;
const MAX_STEP_KW = 3;

// cloud cover causes bursts of larger swings; modelled as an occasional bigger step
function nextValue(previousValue) {
  const previous = typeof previousValue === 'number' ? previousValue : 10;
  const burst = Math.random() < 0.1 ? 3 : 1;
  const step = (Math.random() * 2 - 1) * MAX_STEP_KW * burst;
  const next = previous + step;
  return Math.min(MAX_KW, Math.max(MIN_KW, Number(next.toFixed(2))));
}

module.exports = { nextValue, MIN_KW, MAX_KW };
