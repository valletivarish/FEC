// Motion flips more often than door-contact since PIR sensors trigger on any movement.
const FLIP_PROBABILITY = 0.08;

module.exports = function motionGenerator(previousValue) {
  const current = previousValue === 1 ? 1 : 0;
  return Math.random() < FLIP_PROBABILITY ? (current === 1 ? 0 : 1) : current;
};
