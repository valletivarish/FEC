'use strict';

const MIN_PENCE = 5;
const MAX_PENCE = 45;
const MAX_STEP_PENCE = 3;

// tariff moves in small steps most ticks but can jump between peak/off-peak bands
function nextValue(previousValue) {
  const previous = typeof previousValue === 'number' ? previousValue : 20;
  const jump = Math.random() < 0.05 ? (Math.random() * 2 - 1) * 15 : 0;
  const step = (Math.random() * 2 - 1) * MAX_STEP_PENCE + jump;
  const next = previous + step;
  return Math.min(MAX_PENCE, Math.max(MIN_PENCE, Number(next.toFixed(2))));
}

module.exports = { nextValue, MIN_PENCE, MAX_PENCE };
