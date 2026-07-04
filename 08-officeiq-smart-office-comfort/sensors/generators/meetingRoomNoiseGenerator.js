'use strict';

const MIN = 30;
const MAX = 95;
const MAX_STEP = 6;

function nextValue(previousValue) {
  const start = Number.isFinite(previousValue) ? previousValue : 38;
  const step = (Math.random() * 2 - 1) * MAX_STEP;
  const next = start + step;
  return Math.min(MAX, Math.max(MIN, Number(next.toFixed(1))));
}

module.exports = { nextValue, MIN, MAX };
