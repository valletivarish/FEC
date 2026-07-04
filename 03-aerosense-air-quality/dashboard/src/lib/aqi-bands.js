// Shared band vocabulary so the grid, gauge and detail views always agree on badge-class/label mapping.
// Badge classes are restricted to Bootstrap's own contextual set - no decorative variety.
export const AQI_BANDS = [
  { id: "good", label: "Good", min: 0, max: 0.2, badgeClass: "text-bg-success" },
  { id: "moderate", label: "Moderate", min: 0.2, max: 0.45, badgeClass: "text-bg-success" },
  { id: "elevated", label: "Elevated", min: 0.45, max: 0.7, badgeClass: "text-bg-warning" },
  { id: "unhealthy", label: "Unhealthy", min: 0.7, max: 0.9, badgeClass: "text-bg-danger" },
  { id: "hazardous", label: "Hazardous", min: 0.9, max: 1.01, badgeClass: "text-bg-danger" },
];

// Accepts either an explicit band id from the API or a 0-1 fraction, falling back gracefully.
export function resolveBand(bandIdOrFraction) {
  if (typeof bandIdOrFraction === "string") {
    const found = AQI_BANDS.find((b) => b.id === bandIdOrFraction.toLowerCase());
    if (found) return found;
  }
  const fraction = typeof bandIdOrFraction === "number" ? bandIdOrFraction : 0;
  return AQI_BANDS.find((b) => fraction >= b.min && fraction < b.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}
