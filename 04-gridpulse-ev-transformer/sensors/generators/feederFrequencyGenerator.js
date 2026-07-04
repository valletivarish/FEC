'use strict';

const MIN_HZ = 49.5;
const MAX_HZ = 50.5;
const MAX_STEP_HZ = 0.05;

// grid frequency is tightly regulated, so steps are tiny relative to voltage/current
function nextValue(previousValue) {
  const previous = typeof previousValue === 'number' ? previousValue : 50.0;
  const step = (Math.random() * 2 - 1) * MAX_STEP_HZ;
  const next = previous + step;
  return Math.min(MAX_HZ, Math.max(MIN_HZ, Number(next.toFixed(3))));
}

module.exports = { nextValue, MIN_HZ, MAX_HZ };
