const { boundedStep } = require('./randomWalk');

// degC, 5-35
function nextValue(previousValue) {
  return boundedStep(previousValue, 5, 35, 0.3);
}

module.exports = { nextValue };
