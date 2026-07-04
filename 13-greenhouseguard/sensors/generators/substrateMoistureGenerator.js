const { boundedStep } = require('./randomWalk');

// %VWC, 5-60
function nextValue(previousValue) {
  return boundedStep(previousValue, 5, 60, 1);
}

module.exports = { nextValue };
