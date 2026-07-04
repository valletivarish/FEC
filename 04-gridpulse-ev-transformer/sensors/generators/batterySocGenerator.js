'use strict';

const MIN_PCT = 5;
const MAX_PCT = 100;
const MAX_STEP_PCT = 0.8;

// battery SoC changes slowly relative to instantaneous power readings
function nextValue(previousValue) {
  const previous = typeof previousValue === 'number' ? previousValue : 50;
  const step = (Math.random() * 2 - 1) * MAX_STEP_PCT;
  const next = previous + step;
  return Math.min(MAX_PCT, Math.max(MIN_PCT, Number(next.toFixed(1))));
}

module.exports = { nextValue, MIN_PCT, MAX_PCT };
