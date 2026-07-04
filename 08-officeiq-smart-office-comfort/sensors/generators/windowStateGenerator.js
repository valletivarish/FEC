'use strict';

const MIN = 0;
const MAX = 1;
const FLIP_PROBABILITY = 0.08;

// window state is a rare binary flip, not a continuous walk
function nextValue(previousValue) {
  const start = previousValue === 1 ? 1 : 0;
  if (Math.random() < FLIP_PROBABILITY) {
    return start === 1 ? 0 : 1;
  }
  return start;
}

module.exports = { nextValue, MIN, MAX };
