const { boundedStep } = require('./randomWalk');

// mS/cm, 0.2-5
function nextValue(previousValue) {
  return boundedStep(previousValue, 0.2, 5, 0.1);
}

module.exports = { nextValue };
