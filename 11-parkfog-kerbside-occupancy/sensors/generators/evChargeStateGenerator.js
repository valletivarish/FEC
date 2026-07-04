'use strict';

const STATES = ['idle', 'charging', 'fault'];
const FAULT_PROBABILITY = 0.03;

// mostly idle/charging with a rare fault so KerbConditionsFog's fault-streak logic has something to catch
function nextValue(_previousValue) {
  if (Math.random() < FAULT_PROBABILITY) return 'fault';
  return Math.random() < 0.5 ? 'idle' : 'charging';
}

module.exports = { nextValue, STATES };
