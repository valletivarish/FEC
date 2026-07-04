'use strict';

const MIN = -5;
const MAX = 20;

// net vehicle count per interval, independent each tick rather than a walk since it's a rate not a level
function nextValue(_previousValue) {
  return Math.round(MIN + Math.random() * (MAX - MIN));
}

module.exports = { nextValue, MIN, MAX };
