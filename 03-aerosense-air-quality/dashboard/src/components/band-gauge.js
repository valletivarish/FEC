import { AQI_BANDS, resolveBand } from "../lib/aqi-bands.js";

// One tick per band breakpoint; ticks up to and including the resolved band light up.
// The lit tick uses the accent for healthy bands and warning/danger hues as air quality worsens.
const TICK_COLORS = {
  good: "var(--as-accent)",
  moderate: "var(--as-accent)",
  elevated: "#d99a2b",
  unhealthy: "#c23b3b",
  hazardous: "#c23b3b",
};

function tickRailMarkup(resolved) {
  const litIndex = AQI_BANDS.findIndex((b) => b.id === resolved.id);
  const tickColor = TICK_COLORS[resolved.id] ?? "var(--as-accent)";

  const ticks = AQI_BANDS.map((b, i) => {
    if (i < litIndex) return `<span class="tick-rail__tick tick-rail__tick--past"></span>`;
    if (i === litIndex) return `<span class="tick-rail__tick tick-rail__tick--lit" style="--tick-color: ${tickColor}"></span>`;
    return `<span class="tick-rail__tick"></span>`;
  }).join("");

  return `
    <span class="tick-rail" tabindex="0" role="img" aria-label="${resolved.label} band">
      ${ticks}
      <span class="tick-rail__tooltip">${resolved.label}</span>
    </span>
  `;
}

// Value + unit as monospace text next to a CSS-only tick-rail signal indicator - no badge pill.
export function renderBandGauge({ value, unit = "", fraction, band, size } = {}) {
  const resolved = resolveBand(band ?? fraction ?? 0);
  const displayValue = value ?? "–";

  return `
    <span class="band-gauge">
      <span class="band-gauge__value">${displayValue}${unit ? ` <span class="band-gauge__unit">${unit}</span>` : ""}</span>
      ${tickRailMarkup(resolved)}
    </span>
  `;
}
