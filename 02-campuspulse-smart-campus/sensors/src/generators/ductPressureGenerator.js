// Duct pressure drifts with fan speed/damper position, rarely jumps sharply.
const MIN = 50;
const MAX = 500;
const STEP = 20;

module.exports = function ductPressureGenerator(previousValue) {
  const base = typeof previousValue === "number" ? previousValue : 200;
  const delta = (Math.random() - 0.5) * 2 * STEP;
  return Math.min(MAX, Math.max(MIN, base + delta));
};
