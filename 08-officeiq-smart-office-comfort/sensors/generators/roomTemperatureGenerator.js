'use strict';

const MIN = 17;
const MAX = 29;
const MAX_STEP = 0.4;

// room temperature is thermally slow, so steps stay small relative to the full range
function nextValue(previousValue) {
  const start = Number.isFinite(previousValue) ? previousValue : 21;
  const step = (Math.random() * 2 - 1) * MAX_STEP;
  const next = start + step;
  return Math.min(MAX, Math.max(MIN, Number(next.toFixed(2))));
}

module.exports = { nextValue, MIN, MAX };
