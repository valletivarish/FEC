import { OfficeIqApiClient } from './api/officeIqApiClient.js';
import { renderZoneOverviewTable } from './components/zoneOverviewTable.js';
import { renderOccupancyReconciliationTable } from './components/occupancyReconciliationTable.js';
import { renderComfortEventsTable } from './components/comfortEventsTable.js';
import { renderUsageWasteTable } from './components/usageWasteTable.js';
import { renderScalingStatusCard } from './components/scalingStatusCard.js';
import { renderKpiRow, updateKpiRow } from './components/kpiRow.js';

// Fixed zone list per the brief — the dashboard queries each zone's status independently.
const ZONE_IDS = ['zone-101', 'zone-102', 'zone-201', 'zone-202'];

const ZONE_LABELS = {
  'zone-101': 'Zone 101',
  'zone-102': 'Zone 102',
  'zone-201': 'Zone 201',
  'zone-202': 'Zone 202',
};

const API_BASE_URL = window.OFFICEIQ_API_BASE_URL || 'http://localhost:3000';

// Drill-down state: 'all' shows every zone, otherwise a single zoneId filters every table.
let selectedZone = 'all';
let latestDashboardData = null;

function showEmptyState(message) {
  const emptyStateEl = document.getElementById('empty-state');
  emptyStateEl.textContent = message;
  emptyStateEl.classList.remove('d-none');
}

function hideEmptyState() {
  document.getElementById('empty-state').classList.add('d-none');
}

// A zone's overall status is the worst of its own comfort/occupancy signal — falls back to nominal.
function deriveZoneStatus(zoneStatus) {
  return zoneStatus?.status || 'nominal';
}

function updateBreadcrumb() {
  const currentEl = document.getElementById('zone-breadcrumb-current');
  currentEl.textContent = selectedZone === 'all' ? 'All Zones' : ZONE_LABELS[selectedZone];
}

function updatePillActiveState() {
  document.querySelectorAll('#zone-pill-nav .nav-link').forEach((pillEl) => {
    pillEl.classList.toggle('active', pillEl.dataset.zoneTarget === selectedZone);
  });
}

function filterByZone(rows) {
  if (selectedZone === 'all') return rows;
  return rows.filter((row) => row.zoneId === selectedZone);
}

function renderTables(data) {
  const zoneOverviewRows = filterByZone(data.zoneOverviewRows);
  renderZoneOverviewTable(document.getElementById('zone-overview-body'), zoneOverviewRows);

  const occupancyEvents = filterByZone(data.occupancyEvents);
  renderOccupancyReconciliationTable(document.getElementById('occupancy-reconciliation-body'), occupancyEvents);

  const comfortEvents = filterByZone(data.comfortEvents);
  renderComfortEventsTable(document.getElementById('comfort-events-body'), comfortEvents);

  const usageEvents = filterByZone(data.usageEvents);
  renderUsageWasteTable(document.getElementById('usage-waste-body'), usageEvents);

  // Scaling status reflects the whole worker fleet, not a single zone — always shown as-is.
  renderScalingStatusCard(document.getElementById('scaling-status-card'), data.scalingStatus);
}

function selectZone(zoneId) {
  selectedZone = zoneId;
  updateBreadcrumb();
  updatePillActiveState();
  if (latestDashboardData) {
    renderTables(latestDashboardData);
  }
}

function wireZonePillNav() {
  document.querySelectorAll('#zone-pill-nav .nav-link').forEach((pillEl) => {
    pillEl.addEventListener('click', () => selectZone(pillEl.dataset.zoneTarget));
  });
}

async function loadDashboard(apiClient) {
  const zoneStatuses = await Promise.all(
    ZONE_IDS.map(async (zoneId) => {
      try {
        return await apiClient.getZoneStatus(zoneId);
      } catch {
        return null;
      }
    })
  );

  const successfulStatuses = zoneStatuses.filter((status) => status !== null);
  if (successfulStatuses.length === 0) {
    showEmptyState('No live data — start the local stack to see readings');
    latestDashboardData = null;
    updateKpiRow(document.getElementById('kpi-row'), { scalingStatus: null });
    renderZoneOverviewTable(document.getElementById('zone-overview-body'), []);
    renderOccupancyReconciliationTable(document.getElementById('occupancy-reconciliation-body'), []);
    renderComfortEventsTable(document.getElementById('comfort-events-body'), []);
    renderUsageWasteTable(document.getElementById('usage-waste-body'), []);
    renderScalingStatusCard(document.getElementById('scaling-status-card'), null);
    return;
  }

  hideEmptyState();

  const zoneOverviewRows = ZONE_IDS.map((zoneId, index) => {
    const zoneStatus = zoneStatuses[index];
    return {
      zoneId,
      deskOccupancy: zoneStatus?.deskOccupancy,
      roomCo2: zoneStatus?.roomCo2,
      roomTemperature: zoneStatus?.roomTemperature,
      status: deriveZoneStatus(zoneStatus),
    };
  });

  const occupancyEvents = successfulStatuses.flatMap((status) => status.occupancyEvents || []);
  const comfortEvents = successfulStatuses.flatMap((status) => status.comfortEvents || []);
  const usageEvents = successfulStatuses.flatMap((status) => status.usageEvents || []);
  const scalingStatus = successfulStatuses.find((status) => status.scalingStatus)?.scalingStatus || null;

  latestDashboardData = { zoneOverviewRows, occupancyEvents, comfortEvents, usageEvents, scalingStatus };
  // KPI aggregates cover the whole office, so they read from the full data set, not the zone filter.
  updateKpiRow(document.getElementById('kpi-row'), latestDashboardData);
  renderTables(latestDashboardData);
}

wireZonePillNav();
renderKpiRow(document.getElementById('kpi-row'), ZONE_IDS.length);

const apiClient = new OfficeIqApiClient(API_BASE_URL);
loadDashboard(apiClient).catch(() => {
  showEmptyState('No live data — start the local stack to see readings');
});
