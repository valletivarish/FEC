'use strict';

const MIN = 0;
const MAX = 1800;
const MAX_STEP = 120;

// plug load swings with device switching, so allow relatively large steps
function nextValue(previousValue) {
  const start = Number.isFinite(previousValue) ? previousValue : 50;
  const step = (Math.random() * 2 - 1) * MAX_STEP;
  const next = start + step;
  return Math.min(MAX, Math.max(MIN, Math.round(next)));
}

module.exports = { nextValue, MIN, MAX };
