// Room temperature changes gradually due to HVAC thermal inertia.
const MIN = 15;
const MAX = 32;
const STEP = 0.4;

module.exports = function temperatureGenerator(previousValue) {
  const base = typeof previousValue === "number" ? previousValue : 21;
  const delta = (Math.random() - 0.5) * 2 * STEP;
  return Math.min(MAX, Math.max(MIN, base + delta));
};
