// Light level swings more sharply than climate readings (switches, blinds, daylight).
const MIN = 0;
const MAX = 1200;
const STEP = 60;

module.exports = function lightLuxGenerator(previousValue) {
  const base = typeof previousValue === "number" ? previousValue : 300;
  const delta = (Math.random() - 0.5) * 2 * STEP;
  return Math.min(MAX, Math.max(MIN, base + delta));
};
