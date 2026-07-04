import { GuardApiClient } from './api/guardApiClient.js';
import { renderAssetGridTable } from './components/assetGridTable.js';
import { renderVibeFaultDetail } from './components/vibeFaultDetail.js';
import { renderThermalEventsTable } from './components/thermalEventsTable.js';
import { renderHydraulicEventsTable } from './components/hydraulicEventsTable.js';
import { renderFaultTicker } from './components/faultTicker.js';
import { renderKpiRow } from './components/kpiRow.js';

const ASSET_IDS = ['asset-01', 'asset-02', 'asset-03', 'asset-04'];

// three fog nodes process the sensor streams: VibeCore, ThermalGuard, Hydraulic
const FOG_NODE_COUNT = 3;

const API_BASE_URL = window.GUARD_API_BASE_URL || 'http://localhost:3000';

// picks the field(s) needed by the asset grid row out of a per-asset diagnosis list
function buildAssetSummary(assetId, events) {
  const vibeFault = events.find((e) => e.type === 'vibe_fault');
  const thermalEvent = events.find((e) => e.type === 'thermal_event');

  let status = 'nominal';
  if (vibeFault || (thermalEvent && (thermalEvent.verdict_tags || []).includes('runaway'))) {
    status = 'fault';
  } else if (thermalEvent && (thermalEvent.verdict_tags || []).length > 0) {
    status = 'warning';
  }

  return {
    assetId,
    vibeAxial: vibeFault && vibeFault.metric === 'vibe-axial' ? vibeFault.fault_bands?.[0]?.energy : null,
    vibeRadial: vibeFault && vibeFault.metric === 'vibe-radial' ? vibeFault.fault_bands?.[0]?.energy : null,
    thermalWinding: thermalEvent ? thermalEvent.deviation : null,
    status,
  };
}

async function loadDashboard() {
  const client = new GuardApiClient(API_BASE_URL);
  const emptyBanner = document.getElementById('empty-state-banner');

  let allEvents = [];
  let hadAnySuccess = false;

  for (const assetId of ASSET_IDS) {
    try {
      const result = await client.getDiagnoses(assetId);
      // backend's query_handler responds with { diagnoses: [...] } (see backend/tests/test_query_handler.py)
      const events = Array.isArray(result.diagnoses) ? result.diagnoses : (Array.isArray(result) ? result : []);
      allEvents = allEvents.concat(events);
      hadAnySuccess = true;
    } catch (err) {
      // one asset's fetch failing shouldn't blank the whole dashboard
      console.warn(`GreengrassGuard: failed to load diagnoses for ${assetId}`, err);
    }
  }

  if (!hadAnySuccess || allEvents.length === 0) {
    emptyBanner.classList.remove('d-none');
  } else {
    emptyBanner.classList.add('d-none');
  }

  const assetSummaries = ASSET_IDS.map((assetId) => {
    const assetEvents = allEvents
      .filter((e) => e.asset_id === assetId)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return buildAssetSummary(assetId, assetEvents);
  });

  const vibeFaults = allEvents
    .filter((e) => e.type === 'vibe_fault')
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const thermalEvents = allEvents
    .filter((e) => e.type === 'thermal_event')
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const hydraulicEvents = allEvents
    .filter((e) => e.type === 'hydraulic_event')
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  renderKpiRow(document.getElementById('kpi-row'), {
    assetCount: ASSET_IDS.length,
    fogNodeCount: FOG_NODE_COUNT,
    events: allEvents,
  });
  renderAssetGridTable(document.getElementById('asset-grid'), assetSummaries);
  renderVibeFaultDetail(document.getElementById('vibe-fault-detail'), vibeFaults[0] || null);
  renderThermalEventsTable(document.getElementById('thermal-events'), thermalEvents);
  renderHydraulicEventsTable(document.getElementById('hydraulic-events'), hydraulicEvents);
  renderFaultTicker(document.getElementById('fault-ticker'), allEvents);
}

loadDashboard();
