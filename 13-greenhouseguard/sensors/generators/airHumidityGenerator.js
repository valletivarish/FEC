const { boundedStep } = require('./randomWalk');

// %RH, 20-100
function nextValue(previousValue) {
  return boundedStep(previousValue, 20, 100, 1.5);
}

module.exports = { nextValue };
