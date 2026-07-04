'use strict';

const STATES = ['unplugged', 'plugged', 'charging', 'fault'];

// weighted so charging is the common state and fault stays rare, mimicking a real hub
const TRANSITIONS = {
  unplugged: { unplugged: 0.6, plugged: 0.4, charging: 0, fault: 0 },
  plugged: { unplugged: 0.1, plugged: 0.3, charging: 0.58, fault: 0.02 },
  charging: { unplugged: 0, plugged: 0.15, charging: 0.83, fault: 0.02 },
  fault: { unplugged: 0.5, plugged: 0.3, charging: 0, fault: 0.2 },
};

function pickWeighted(weights) {
  const roll = Math.random();
  let cumulative = 0;
  for (const state of STATES) {
    cumulative += weights[state];
    if (roll < cumulative) return state;
  }
  return STATES[STATES.length - 1];
}

function nextValue(previousValue) {
  const previous = STATES.includes(previousValue) ? previousValue : 'unplugged';
  return pickWeighted(TRANSITIONS[previous]);
}

module.exports = { nextValue, STATES };
