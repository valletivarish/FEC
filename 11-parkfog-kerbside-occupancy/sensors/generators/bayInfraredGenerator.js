'use strict';

const MIN = 0.0;
const MAX = 1.0;
const MAX_STEP = 0.2;

// bounded random walk keeps presence probability plausible between ticks
function nextValue(previousValue) {
  const base = typeof previousValue === 'number' ? previousValue : 0;
  const step = (Math.random() * 2 - 1) * MAX_STEP;
  let value = base + step;
  if (value > MAX) value = MAX;
  if (value < MIN) value = MIN;
  return Math.round(value * 1000) / 1000;
}

module.exports = { nextValue, MIN, MAX };
