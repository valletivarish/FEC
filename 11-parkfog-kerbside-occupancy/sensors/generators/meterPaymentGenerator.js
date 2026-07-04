'use strict';

const MIN = 0;
const MAX = 180;

// minutes count down like a real parking meter, occasionally topped up by a new purchase
function nextValue(previousValue) {
  const base = typeof previousValue === 'number' ? previousValue : MAX;
  if (base <= 0) {
    // small chance of a fresh purchase after hitting zero, otherwise stays expired
    return Math.random() < 0.15 ? Math.round(30 + Math.random() * 120) : 0;
  }
  const drift = base - (5 + Math.random() * 10);
  return Math.max(MIN, Math.min(MAX, Math.round(drift)));
}

module.exports = { nextValue, MIN, MAX };
