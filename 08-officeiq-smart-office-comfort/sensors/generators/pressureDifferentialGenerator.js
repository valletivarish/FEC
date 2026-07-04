'use strict';

const MIN = -15;
const MAX = 15;
const MAX_STEP = 1.5;

function nextValue(previousValue) {
  const start = Number.isFinite(previousValue) ? previousValue : 0;
  const step = (Math.random() * 2 - 1) * MAX_STEP;
  const next = start + step;
  return Math.min(MAX, Math.max(MIN, Number(next.toFixed(2))));
}

module.exports = { nextValue, MIN, MAX };
