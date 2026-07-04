const SEVERITY_META = {
  OK: { label: "OK", className: "text-bg-success" },
  WARN: { label: "WARN", className: "text-bg-warning" },
  BREACH: { label: "BREACH", className: "text-bg-danger" },
};

// Normalizes any incoming compliance/severity string to our three visual states.
export function renderReeferHealthBadge(status) {
  const meta = SEVERITY_META[status] ?? { label: status ?? "UNKNOWN", className: "text-bg-secondary" };
  const badge = document.createElement("span");
  badge.className = `badge ${meta.className}`;
  badge.setAttribute("data-testid", "reefer-health-badge");
  badge.setAttribute("data-status", meta.label);
  badge.textContent = meta.label;
  return badge;
}
