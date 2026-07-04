const { boundedStep } = require('./randomWalk');

// ppm, 300-2000
function nextValue(previousValue) {
  return boundedStep(previousValue, 300, 2000, 25);
}

module.exports = { nextValue };
