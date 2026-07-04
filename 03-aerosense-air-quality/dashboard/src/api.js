import { API_BASE_URL } from "./config.js";

// Centralised fetch wrapper so every call gets consistent error surfacing in the UI.
async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`AeroSense API ${response.status}: ${path}`);
  }
  return response.json();
}

export function getZoneStatus(zoneId) {
  return request(`/zones/${encodeURIComponent(zoneId)}/status`);
}

export function getZoneHistory(zoneId) {
  return request(`/zones/${encodeURIComponent(zoneId)}/history`);
}

export function getZoneConfig(zoneId) {
  return request(`/config/${encodeURIComponent(zoneId)}`);
}

export function putZoneConfig(zoneId, config) {
  return request(`/config/${encodeURIComponent(zoneId)}`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}
