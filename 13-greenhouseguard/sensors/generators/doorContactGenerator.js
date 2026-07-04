// 0=closed, 1=open. Doors are closed the vast majority of the time,
// with occasional open events representing staff entering the zone.
const OPEN_PROBABILITY = 0.08;
const CLOSE_PROBABILITY = 0.4;

function nextValue(previousValue) {
  const wasOpen = previousValue === 1;
  if (wasOpen) {
    return Math.random() < CLOSE_PROBABILITY ? 0 : 1;
  }
  return Math.random() < OPEN_PROBABILITY ? 1 : 0;
}

module.exports = { nextValue };
