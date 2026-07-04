import { renderZoneGridView } from './views/zoneGridView.js';
import { renderEnergyPanelView } from './views/energyPanelView.js';
import { renderComfortPanelView } from './views/comfortPanelView.js';
import { renderSecurityTimelineView } from './views/securityTimelineView.js';
import { renderAlertFeedView } from './views/alertFeedView.js';
import { getState } from './state.js';

const TOP_VIEWS = ['grid', 'alerts', 'zone-detail'];
const DETAIL_SECTIONS = ['comfort', 'energy', 'security'];

function showDetailPanels(zoneId) {
  document.getElementById('zone-detail-heading').textContent = `Zone Detail / ${zoneId}`;
  renderComfortPanelView(document.getElementById('comfort-panel'), zoneId);
  renderEnergyPanelView(document.getElementById('energy-panel'), zoneId);
  renderSecurityTimelineView(document.getElementById('security-panel'), zoneId);

  // Selecting a zone unlocks its three detail sections in the sidebar.
  DETAIL_SECTIONS.forEach((name) => {
    document.querySelector(`.sidebar-link[data-view="${name}"]`).disabled = false;
  });
}

function topSectionId(name) {
  return name === 'zone-detail' ? 'zone-detail' : `view-${name}`;
}

// Comfort/Energy/Security are anchors within the single zone-detail section,
// not separate panes - all three stay visible together, matching the API's single fetch-per-zone flow.
function setActiveView(viewName) {
  const targetTop = DETAIL_SECTIONS.includes(viewName) ? 'zone-detail' : viewName;
  TOP_VIEWS.forEach((name) => {
    document.getElementById(topSectionId(name)).hidden = name !== targetTop;
  });

  document.querySelectorAll('.sidebar-link').forEach((button) => {
    button.classList.toggle('sidebar-link-active', button.dataset.view === viewName);
  });

  if (DETAIL_SECTIONS.includes(viewName)) {
    const target = document.getElementById(`${viewName}-panel`);
    if (target) target.scrollIntoView({ block: 'start' });
  }
}

function wireNav() {
  document.querySelectorAll('.sidebar-link').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      setActiveView(button.dataset.view);
    });
  });
}

function init() {
  wireNav();
  setActiveView('grid');
  renderZoneGridView(document.getElementById('view-grid'), (zoneId) => {
    showDetailPanels(zoneId);
    setActiveView('comfort');
  });
  renderAlertFeedView(document.getElementById('view-alerts'));

  const { selectedZoneId } = getState();
  if (selectedZoneId) {
    showDetailPanels(selectedZoneId);
  }
}

init();
