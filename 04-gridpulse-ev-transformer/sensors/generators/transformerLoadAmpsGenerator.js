'use strict';

const MIN_A = 0;
const MAX_A = 400;
const MAX_STEP_A = 15;

// load amps roughly tracks aggregate bay demand, so it moves faster than winding temp
function nextValue(previousValue) {
  const previous = typeof previousValue === 'number' ? previousValue : 120;
  const step = (Math.random() * 2 - 1) * MAX_STEP_A;
  const next = previous + step;
  return Math.min(MAX_A, Math.max(MIN_A, Number(next.toFixed(1))));
}

module.exports = { nextValue, MIN_A, MAX_A };
