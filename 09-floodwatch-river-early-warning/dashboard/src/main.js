import { FloodwatchApiClient } from "./api/floodwatchApiClient.js";
import { renderReachOverviewTable } from "./components/reachOverviewTable.js";
import { renderWaterQualityTable } from "./components/waterQualityTable.js";
import { renderMeteoWatchTable } from "./components/meteoWatchTable.js";
import { renderEscalationLogList } from "./components/escalationLogList.js";
import { renderEmergencyBanner } from "./components/emergencyBanner.js";
import { renderStageBoard } from "./components/stageBoard.js";
import { renderKpiRow, updateKpiRow } from "./components/kpiRow.js";

// Same three reaches everywhere in this project: upper -> mid -> lower catchment order.
const REACH_IDS = ["reach-upper", "reach-mid", "reach-lower"];
const API_BASE_URL = window.FLOODWATCH_API_BASE_URL || "http://localhost:4566/floodwatch";
const POLL_INTERVAL_MS = 10000;

const apiClient = new FloodwatchApiClient(API_BASE_URL);

const backendNoticeEl = document.getElementById("backendNotice");
const emergencyBannerEl = document.getElementById("emergencyBanner");
const kpiRowEl = document.getElementById("kpiRow");
const reachOverviewBody = document.getElementById("reachOverviewBody");
const waterQualityBody = document.getElementById("waterQualityBody");
const meteoWatchBody = document.getElementById("meteoWatchBody");
const escalationLogList = document.getElementById("escalationLogList");
const escalationNavBadge = document.getElementById("escalationNavBadge");

renderKpiRow(kpiRowEl);

function latestEventOfType(events, type) {
  const matches = events.filter((event) => event.type === type);
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

function buildReachOverviewRows(statusesByReach) {
  return REACH_IDS.map((reachId) => {
    const events = statusesByReach[reachId] || [];
    const hydro = latestEventOfType(events, "hydro_event");
    return {
      reachId,
      riverLevel: hydro ? hydro.riverLevel : null,
      stage: hydro ? hydro.stage : null,
      rateOfRise: hydro ? hydro.rateOfRise : null,
      flowRateSlope: hydro ? hydro.flowRateSlope : null,
      blockageSuspected: hydro ? hydro.blockageSuspected : false,
    };
  });
}

function buildWaterQualityRows(statusesByReach) {
  return REACH_IDS.map((reachId) => {
    const events = statusesByReach[reachId] || [];
    const qualityEvents = events.filter((event) => event.type === "quality_event");
    const cwqiEvent = [...qualityEvents].reverse().find((event) => event.cwqi != null);
    const contaminationEvent = qualityEvents.find((event) => event.contaminationSuspected);
    return {
      reachId,
      cwqi: cwqiEvent ? cwqiEvent.cwqi : null,
      band: cwqiEvent ? cwqiEvent.band : null,
      contaminationSuspected: Boolean(contaminationEvent),
    };
  });
}

function buildMeteoWatchRows(statusesByReach) {
  return REACH_IDS.map((reachId) => {
    const events = statusesByReach[reachId] || [];
    const meteo = latestEventOfType(events, "meteo_event");
    return {
      reachId,
      pressureSlope: meteo ? meteo.pressureSlope : null,
      preStormSignal: meteo ? meteo.preStormSignal : false,
      preWarnEscalation: meteo ? meteo.preWarnEscalation : false,
    };
  });
}

// Nav badge reuses the exact same events array the escalation log and KPI row already
// render from - no second counting mechanism, and it disappears rather than show "0".
function updateEscalationNavBadge(allEvents) {
  const count = (allEvents || []).length;
  if (count === 0) {
    escalationNavBadge.classList.add("d-none");
    return;
  }
  escalationNavBadge.textContent = String(count);
  escalationNavBadge.classList.remove("d-none");
}

function renderAll(statusesByReach, allEvents) {
  const reachOverviewRows = buildReachOverviewRows(statusesByReach);
  const waterQualityRows = buildWaterQualityRows(statusesByReach);
  const meteoRows = buildMeteoWatchRows(statusesByReach);
  renderReachOverviewTable(reachOverviewBody, reachOverviewRows);
  renderEmergencyBanner(emergencyBannerEl, reachOverviewRows);
  renderWaterQualityTable(waterQualityBody, waterQualityRows);
  renderMeteoWatchTable(meteoWatchBody, meteoRows);
  renderEscalationLogList(escalationLogList, allEvents);
  renderStageBoard(reachOverviewRows, waterQualityRows, meteoRows);
  updateKpiRow(kpiRowEl, reachOverviewRows, allEvents);
  updateEscalationNavBadge(allEvents);
}

function renderEmptyShell() {
  backendNoticeEl.classList.remove("d-none");
  renderReachOverviewTable(reachOverviewBody, []);
  renderEmergencyBanner(emergencyBannerEl, []);
  renderWaterQualityTable(waterQualityBody, []);
  renderMeteoWatchTable(meteoWatchBody, []);
  renderEscalationLogList(escalationLogList, []);
  renderStageBoard([], [], []);
  updateKpiRow(kpiRowEl, [], []);
  updateEscalationNavBadge([]);
}

async function refresh() {
  const results = await apiClient.getAllReachStatuses(REACH_IDS);
  const anyOk = results.some((result) => result.ok);

  if (!anyOk) {
    renderEmptyShell();
    return;
  }

  backendNoticeEl.classList.add("d-none");

  const statusesByReach = {};
  const allEvents = [];
  for (const result of results) {
    const events = result.ok && Array.isArray(result.data?.events) ? result.data.events : [];
    statusesByReach[result.reachId] = events;
    allEvents.push(...events);
  }

  renderAll(statusesByReach, allEvents);
}

async function start() {
  try {
    await refresh();
  } catch (error) {
    renderEmptyShell();
  }
  setInterval(() => {
    refresh().catch(() => renderEmptyShell());
  }, POLL_INTERVAL_MS);
}

start();
