// Tiny shared state so views can react to zone selection without a framework.
const listeners = new Set();
const state = {
  zones: ['A101', 'A102', 'A103', 'B201', 'B202', 'B203', 'C301', 'C302', 'C303', 'C304'],
  selectedZoneId: null,
};

export function getState() {
  return state;
}

export function setSelectedZone(zoneId) {
  state.selectedZoneId = zoneId;
  listeners.forEach((listener) => listener(state));
}

export function onStateChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
