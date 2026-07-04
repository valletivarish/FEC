const { boundedStep } = require('./randomWalk');

// % open, 0-100 - actuator lags the commanded setpoint, so steps are chunkier
function nextValue(previousValue) {
  return boundedStep(previousValue, 0, 100, 6);
}

module.exports = { nextValue };
