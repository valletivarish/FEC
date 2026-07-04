const SPARK_BLOCKS = ["▁", "▂", "▃", "▅", "▇"];

// Renders a plain temperature reading with its setpoint delta, for use inside a table cell.
export function renderZoneThermTile({ label, celsius, setpoint, sparkline }) {
  const cell = document.createElement("div");

  const delta = typeof celsius === "number" && typeof setpoint === "number" ? celsius - setpoint : null;
  const deltaClass = delta === null ? "text-muted" : Math.abs(delta) >= 2 ? "text-danger fw-semibold" : Math.abs(delta) >= 1 ? "text-warning-emphasis fw-semibold" : "text-muted";

  cell.innerHTML = `
    <span class="font-monospace">${formatTemp(celsius)}</span>
    <span class="${deltaClass}">(set ${formatTemp(setpoint)}, &Delta; ${delta === null ? "--" : delta.toFixed(1)}&deg;C)</span>
    ${Array.isArray(sparkline) && sparkline.length > 0 ? `<span class="cf-sparkline font-monospace">${buildSparkline(sparkline)}</span>` : ""}
  `;
  return cell;
}

// Quantizes readings into 5 Unicode block levels so the trend reads inline in a monospace cell.
function buildSparkline(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((value) => {
      const level = Math.min(SPARK_BLOCKS.length - 1, Math.floor(((value - min) / range) * SPARK_BLOCKS.length));
      return SPARK_BLOCKS[level];
    })
    .join("");
}

function formatTemp(value) {
  return typeof value === "number" ? `${value.toFixed(1)}&deg;C` : "--&deg;C";
}
