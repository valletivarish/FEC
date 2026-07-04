'use strict';

const MIN = 60;
const MAX = 99;

// confidence scores cluster around a plausible match band rather than walking smoothly
function nextValue(_previousValue) {
  const value = MIN + Math.random() * (MAX - MIN);
  return Math.round(value * 10) / 10;
}

module.exports = { nextValue, MIN, MAX };
