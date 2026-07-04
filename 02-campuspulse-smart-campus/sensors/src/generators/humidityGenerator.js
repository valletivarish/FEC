// Relative humidity tracks temperature/occupancy changes slowly.
const MIN = 20;
const MAX = 70;
const STEP = 1.5;

module.exports = function humidityGenerator(previousValue) {
  const base = typeof previousValue === "number" ? previousValue : 45;
  const delta = (Math.random() - 0.5) * 2 * STEP;
  return Math.min(MAX, Math.max(MIN, base + delta));
};
