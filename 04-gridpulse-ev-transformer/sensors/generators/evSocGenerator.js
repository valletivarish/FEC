'use strict';

const MIN_PCT = 0;
const MAX_PCT = 100;
const MAX_STEP_PCT = 1.5;

// EV SoC trends upward while charging in the simulator; occasional resets model a car swap
function nextValue(previousValue) {
  const previous = typeof previousValue === 'number' ? previousValue : 20;
  if (Math.random() < 0.01) {
    return Number((5 + Math.random() * 15).toFixed(1));
  }
  const step = Math.random() * MAX_STEP_PCT;
  const next = previous + step;
  return Math.min(MAX_PCT, Math.max(MIN_PCT, Number(next.toFixed(1))));
}

module.exports = { nextValue, MIN_PCT, MAX_PCT };
