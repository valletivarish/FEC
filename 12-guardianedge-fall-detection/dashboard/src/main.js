import { CareWatchApiClient } from './api/careWatchApiClient.js';
import { renderResidentRosterPanel } from './components/residentRosterPanel.js';
import { renderVitalsTimelinePanel } from './components/vitalsTimelinePanel.js';
import { renderFallIncidentPanel, wireFallIncidentAcknowledgements } from './components/fallIncidentPanel.js';
import { renderRoomPresencePanel } from './components/roomPresencePanel.js';
import { renderCareSummaryKpiRow, updateCareSummaryKpiRow } from './components/careSummaryKpiRow.js';

// Query param override lets tests/carers point the console at any backend without a rebuild.
function resolveApiBaseUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('apiBaseUrl') || window.CAREWATCH_API_BASE_URL || 'http://localhost:3000';
}

function extractFallEvents(historyByResident, residents) {
  const events = [];
  for (const resident of residents) {
    const history = historyByResident[resident.residentId] || [];
    for (const item of history) {
      if (item.type === 'fall_event' && item.state === 'FALL_CONFIRMED') {
        events.push({ ...item, residentName: resident.residentName || resident.residentId });
      }
    }
  }
  return events;
}

function extractRoomEvents(historyByResident, residents) {
  const latestByResident = [];
  for (const resident of residents) {
    const history = historyByResident[resident.residentId] || [];
    const latest = history.find((item) =>
      ['presence_event', 'comfort_event', 'inactivity_alert'].includes(item.type)
    );
    if (latest) {
      latestByResident.push({ ...latest, residentName: resident.residentName || resident.residentId });
    }
  }
  return latestByResident;
}

// Aggregates for the KPI row, all derived from the same fetched data the panels use.
function computeCareSummary(historyByResident, residents, fallEvents) {
  let inactivityAlerts = 0;
  for (const resident of residents) {
    const history = historyByResident[resident.residentId] || [];
    inactivityAlerts += history.filter((item) => item.type === 'inactivity_alert').length;
  }
  return {
    residentCount: residents.length,
    confirmedFalls: fallEvents.length,
    criticalResidents: residents.filter((r) => r.currentRiskState === 'CRITICAL').length,
    inactivityAlerts,
  };
}

function extractVitalsSummaries(historyByResident, residents) {
  return residents.map((resident) => {
    const history = historyByResident[resident.residentId] || [];
    const latestVitalsEvent = history.find((item) => item.type === 'vitals_event' && item.sdnnMs != null);
    const rrHistory = history
      .filter((item) => item.type === 'vitals_event' && item.sdnnMs != null)
      .map((item) => item.sdnnMs)
      .slice(0, 8)
      .reverse();
    return {
      residentId: resident.residentId,
      residentName: resident.residentName || resident.residentId,
      sdnnMs: latestVitalsEvent ? latestVitalsEvent.sdnnMs : null,
      rrHistory,
    };
  });
}

function setHeaderMeta(residentCount) {
  const meta = document.getElementById('header-meta');
  if (!meta) return;
  meta.textContent = residentCount === 1 ? '1 resident monitored' : `${residentCount} residents monitored`;
}

async function loadDashboard(apiClient) {
  const rosterEl = document.getElementById('resident-roster-panel');
  const vitalsEl = document.getElementById('vitals-timeline-panel');
  const fallEl = document.getElementById('fall-incident-panel');
  const roomEl = document.getElementById('room-presence-panel');
  const kpiEl = document.getElementById('care-kpi-row');

  renderCareSummaryKpiRow(kpiEl);

  try {
    const residents = await apiClient.getResidents();

    rosterEl.innerHTML = renderResidentRosterPanel(residents);

    const historyEntries = await Promise.all(
      residents.map(async (resident) => {
        try {
          const history = await apiClient.getResidentHistory(resident.residentId);
          return [resident.residentId, history];
        } catch {
          return [resident.residentId, []];
        }
      })
    );
    const historyByResident = Object.fromEntries(historyEntries);

    vitalsEl.innerHTML = renderVitalsTimelinePanel(extractVitalsSummaries(historyByResident, residents));

    const fallEvents = extractFallEvents(historyByResident, residents);
    fallEl.innerHTML = renderFallIncidentPanel(fallEvents);
    wireFallIncidentAcknowledgements(fallEl, apiClient);

    roomEl.innerHTML = renderRoomPresencePanel(extractRoomEvents(historyByResident, residents));

    updateCareSummaryKpiRow(kpiEl, computeCareSummary(historyByResident, residents, fallEvents));
    setHeaderMeta(residents.length);
  } catch {
    rosterEl.innerHTML = renderResidentRosterPanel([]);
    vitalsEl.innerHTML = renderVitalsTimelinePanel([]);
    fallEl.innerHTML = renderFallIncidentPanel([]);
    roomEl.innerHTML = renderRoomPresencePanel([]);
    setHeaderMeta(0);
  }
}

// Highlight the sidebar link for whichever section is currently in view.
function wireSidebarNav() {
  const links = [...document.querySelectorAll('.sidebar-link[href^="#section-"]')];
  const sections = links
    .map((link) => document.getElementById(link.getAttribute('href').slice(1)))
    .filter(Boolean);
  if (sections.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length === 0) return;
      const activeId = visible[0].target.id;
      links.forEach((link) => link.classList.toggle('sidebar-link-active', link.getAttribute('href') === `#${activeId}`));
    },
    { rootMargin: '-20% 0px -70% 0px' }
  );
  sections.forEach((section) => observer.observe(section));
}

const apiClient = new CareWatchApiClient(resolveApiBaseUrl());
wireSidebarNav();
loadDashboard(apiClient);
