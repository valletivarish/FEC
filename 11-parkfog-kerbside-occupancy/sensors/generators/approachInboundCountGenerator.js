'use strict';

const MIN = 0;
const MAX = 30;

// approach counts vary independently tick to tick, no need for a walk on a bounded count
function nextValue(_previousValue) {
  return Math.round(MIN + Math.random() * (MAX - MIN));
}

module.exports = { nextValue, MIN, MAX };
