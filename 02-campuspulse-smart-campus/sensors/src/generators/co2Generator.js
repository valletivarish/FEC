// CO2 builds up with occupancy and vents down slowly, hence a modest random walk.
const MIN = 400;
const MAX = 2000;
const STEP = 40;

module.exports = function co2Generator(previousValue) {
  const base = typeof previousValue === "number" ? previousValue : 500;
  const delta = (Math.random() - 0.5) * 2 * STEP;
  return Math.min(MAX, Math.max(MIN, base + delta));
};
