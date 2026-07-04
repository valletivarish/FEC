// Compact inline trend line; degrades to a flat mid-line when there is not enough data to shape a trend.
export function renderSparkline(values, { width = 160, height = 36, color = "#59635e" } = {}) {
  const points = Array.isArray(values) ? values.filter((v) => typeof v === "number" && !Number.isNaN(v)) : [];
  if (points.length < 2) {
    const y = height / 2;
    return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <line x1="0" y1="${y}" x2="${width}" y2="${y}" class="sparkline__flat" />
    </svg>`;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);

  const coords = points.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const linePath = `M ${coords.join(" L ")}`;

  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none">
      <path d="${linePath}" class="sparkline__line" fill="none" stroke="${color}" stroke-width="1" />
    </svg>
  `;
}
