'use strict';

const MIN_C = 20;
const MAX_C = 130;
const MAX_STEP_C = 1.2;

// thermal mass means small steps; transformer temp does not swing wildly tick to tick
function nextValue(previousValue) {
  const previous = typeof previousValue === 'number' ? previousValue : 45;
  const step = (Math.random() * 2 - 1) * MAX_STEP_C;
  const next = previous + step;
  return Math.min(MAX_C, Math.max(MIN_C, Number(next.toFixed(1))));
}

module.exports = { nextValue, MIN_C, MAX_C };
