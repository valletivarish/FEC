'use strict';

const MIN = 20;
const MAX = 70;
const MAX_STEP = 2;

function nextValue(previousValue) {
  const start = Number.isFinite(previousValue) ? previousValue : 45;
  const step = (Math.random() * 2 - 1) * MAX_STEP;
  const next = start + step;
  return Math.min(MAX, Math.max(MIN, Number(next.toFixed(1))));
}

module.exports = { nextValue, MIN, MAX };
