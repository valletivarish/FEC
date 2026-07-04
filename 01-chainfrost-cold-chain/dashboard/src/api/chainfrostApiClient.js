import { API_BASE_URL } from "../config.js";

// Centralizing fetch here keeps every view agnostic of transport and error shape.
async function getJson(path) {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`ChainFrost API ${path} failed with status ${response.status}`);
  }
  return response.json();
}

export function getShipmentStatus(shipmentId) {
  return getJson(`/shipments/${encodeURIComponent(shipmentId)}`);
}

export function getExcursionHistory(shipmentId) {
  return getJson(`/shipments/${encodeURIComponent(shipmentId)}/excursions`);
}

export function getFleetHealth() {
  return getJson("/fleet/health");
}
