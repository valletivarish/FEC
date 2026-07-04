'use strict';

const MIN_KW = 0;
const MAX_KW = 22;
const MAX_STEP_KW = 2.5;

// bounded random walk; small idle chance keeps unplugged bays realistically near 0
function nextValue(previousValue) {
  const previous = typeof previousValue === 'number' ? previousValue : 0;
  const step = (Math.random() * 2 - 1) * MAX_STEP_KW;
  const next = previous + step;
  return Math.min(MAX_KW, Math.max(MIN_KW, Number(next.toFixed(2))));
}

module.exports = { nextValue, MIN_KW, MAX_KW };
