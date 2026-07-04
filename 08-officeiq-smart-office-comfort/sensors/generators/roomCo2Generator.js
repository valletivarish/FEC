'use strict';

const MIN = 400;
const MAX = 2200;
const MAX_STEP = 40;

// CO2 drifts upward while occupied and vents down slowly, modelled as a bounded random walk
function nextValue(previousValue) {
  const start = Number.isFinite(previousValue) ? previousValue : 500;
  const step = (Math.random() * 2 - 1) * MAX_STEP;
  const next = start + step;
  return Math.min(MAX, Math.max(MIN, Math.round(next)));
}

module.exports = { nextValue, MIN, MAX };
