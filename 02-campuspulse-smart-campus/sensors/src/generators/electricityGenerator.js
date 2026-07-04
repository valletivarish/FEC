// Electricity draw drifts slowly; buildings rarely swing load instantly.
const MIN = 0.5;
const MAX = 45;
const STEP = 1.5;

module.exports = function electricityGenerator(previousValue) {
  const base = typeof previousValue === "number" ? previousValue : 10;
  const delta = (Math.random() - 0.5) * 2 * STEP;
  return Math.min(MAX, Math.max(MIN, base + delta));
};
