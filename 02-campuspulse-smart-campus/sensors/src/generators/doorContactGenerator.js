// Door contact is a rare-flip binary state, not a walk - doors stay put most ticks.
const FLIP_PROBABILITY = 0.03;

module.exports = function doorContactGenerator(previousValue) {
  const current = previousValue === 1 ? 1 : 0;
  return Math.random() < FLIP_PROBABILITY ? (current === 1 ? 0 : 1) : current;
};
