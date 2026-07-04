const { boundedStep } = require('./randomWalk');

// pH, 3.5-9.0
function nextValue(previousValue) {
  return boundedStep(previousValue, 3.5, 9.0, 0.08);
}

module.exports = { nextValue };
