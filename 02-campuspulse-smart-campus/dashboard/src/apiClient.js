import { API_BASE_URL } from './config.js';

// Thin fetch wrapper - centralizes error handling so views don't repeat it.
async function getJson(path) {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`request failed: ${path} -> ${response.status}`);
  }
  return response.json();
}

export function getZoneStatus(zoneId) {
  return getJson(`/zones/${encodeURIComponent(zoneId)}/status`);
}

export function getZoneHistory(zoneId, topic) {
  const query = topic ? `?topic=${encodeURIComponent(topic)}` : '';
  return getJson(`/zones/${encodeURIComponent(zoneId)}/history${query}`);
}

export function getActiveAlerts() {
  return getJson('/alerts/active');
}
