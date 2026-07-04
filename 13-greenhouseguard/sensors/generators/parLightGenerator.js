// umol/m2/s, 0-2200. Bell curve over the 06:00-22:00 daylight window so the
// fog layer's DLI accumulation has a realistic daily shape to react to.
function daylightCeiling(hourOfDay) {
  const sunrise = 6;
  const sunset = 22;
  if (hourOfDay < sunrise || hourOfDay >= sunset) return 0;
  const windowLength = sunset - sunrise;
  const noonOffset = (hourOfDay - sunrise) / windowLength; // 0..1 across the day
  const bell = Math.sin(noonOffset * Math.PI); // 0 at edges, 1 at midday
  return 2200 * bell;
}

function nextValue(previousValue, timestamp) {
  const hourOfDay = new Date(timestamp).getUTCHours();
  const ceiling = daylightCeiling(hourOfDay);
  if (ceiling <= 0) return 0;
  const noise = (Math.random() * 2 - 1) * ceiling * 0.1;
  const target = ceiling + noise;
  return Math.min(2200, Math.max(0, target));
}

module.exports = { nextValue };
