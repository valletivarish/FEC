'use strict';

const MIN = 0;
const MAX = 300;
const MAX_STEP = 15;

// slow random walk so flood risk bands change gradually, matching KerbConditionsFog's debounce
function nextValue(previousValue) {
  const base = typeof previousValue === 'number' ? previousValue : 10;
  const step = (Math.random() * 2 - 1) * MAX_STEP;
  let value = base + step;
  if (value > MAX) value = MAX;
  if (value < MIN) value = MIN;
  return Math.round(value);
}

module.exports = { nextValue, MIN, MAX };
