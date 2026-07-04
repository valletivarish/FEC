'use strict';

const MIN = -150;
const MAX = 150;
const MAX_STEP = 25;

// random walk with occasional bigger jumps so occupancy transitions actually happen
function nextValue(previousValue) {
  const base = typeof previousValue === 'number' ? previousValue : 0;
  const step = (Math.random() * 2 - 1) * MAX_STEP;
  let value = base + step;
  if (value > MAX) value = MAX;
  if (value < MIN) value = MIN;
  return Math.round(value * 100) / 100;
}

module.exports = { nextValue, MIN, MAX };
