'use strict';

const SCAN_EVERY_N_TICKS = 15;

let tickCount = 0;

// fires true roughly every 15th tick to simulate a rare badge-scan event
function nextValue(_previousValue) {
  tickCount += 1;
  return tickCount % SCAN_EVERY_N_TICKS === 0;
}

module.exports = { nextValue, SCAN_EVERY_N_TICKS };
