'use strict';

const MIN = 0;
const MAX = 1200;
const MAX_STEP = 80;

// bigger steps than temp/humidity since lighting can flip on/off between samples
function nextValue(previousValue) {
  const start = Number.isFinite(previousValue) ? previousValue : 300;
  const step = (Math.random() * 2 - 1) * MAX_STEP;
  const next = start + step;
  return Math.min(MAX, Math.max(MIN, Math.round(next)));
}

module.exports = { nextValue, MIN, MAX };
