'use strict';

const MIN = 0;
const MAX = 6;

// desk occupancy changes by at most one desk per tick (people sit/leave one at a time)
function nextValue(previousValue) {
  const start = Number.isFinite(previousValue) ? previousValue : Math.round(MAX / 2);
  const step = Math.round(Math.random() * 2) - 1;
  const next = start + step;
  return Math.min(MAX, Math.max(MIN, next));
}

module.exports = { nextValue, MIN, MAX };
