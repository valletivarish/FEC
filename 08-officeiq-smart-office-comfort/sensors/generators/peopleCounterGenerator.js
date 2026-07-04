'use strict';

const MIN = 0;
const MAX = 40;

// net door-crossing delta moves by a handful of people per tick, either direction
function nextValue(previousValue) {
  const start = Number.isFinite(previousValue) ? previousValue : 0;
  const step = Math.round(Math.random() * 6) - 3;
  const next = start + step;
  return Math.min(MAX, Math.max(MIN, next));
}

module.exports = { nextValue, MIN, MAX };
