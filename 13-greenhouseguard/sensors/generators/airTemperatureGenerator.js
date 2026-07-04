const { boundedStep } = require('./randomWalk');

// degC, 5-45
function nextValue(previousValue) {
  return boundedStep(previousValue, 5, 45, 0.4);
}

module.exports = { nextValue };
