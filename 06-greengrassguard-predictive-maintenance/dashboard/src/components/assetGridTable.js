// asset status is derived client-side: any recent fault/runaway/cavitation tag flips it red,
// a lone deviation/tag flips it amber, otherwise nominal — mirrors the fog verdict severity
function progressVariant(status) {
  if (status === 'fault') return 'bg-danger';
  if (status === 'warning') return 'bg-warning';
  if (status === 'nominal') return 'bg-success';
  return 'bg-secondary';
}

function statusLabel(status) {
  if (status === 'fault') return 'Fault';
  if (status === 'warning') return 'Warning';
  if (status === 'nominal') return 'Nominal';
  return 'Unknown';
}

// health score is a normalized 0-100 read on how far the asset is from nominal —
// fault snaps near the top of the band, warning sits mid-band, nominal stays low
function healthScore(asset) {
  if (asset.status === 'fault') {
    const axial = asset.vibeAxial ?? 0;
    const radial = asset.vibeRadial ?? 0;
    const worst = Math.max(axial, radial, 6);
    return Math.min(100, Math.round(65 + worst * 2));
  }
  if (asset.status === 'warning') {
    const deviation = asset.thermalWinding ?? 5;
    return Math.min(64, Math.max(35, Math.round(35 + deviation * 2)));
  }
  return Math.min(20, Math.round((asset.thermalWinding ?? 2) * 2));
}

function fmt(value, unit) {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toFixed(2)} ${unit}`;
}

function emptyMarkup() {
  return `
    <div class="card">
      <div class="card-body">
        <table class="table table-striped table-hover align-middle" data-testid="asset-grid-table">
          <thead>
            <tr>
              <th scope="col">Asset ID</th>
              <th scope="col">Vibe Axial (mm/s RMS)</th>
              <th scope="col">Vibe Radial (mm/s RMS)</th>
              <th scope="col">Thermal Winding (degC)</th>
              <th scope="col">Health</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;
}

export function renderAssetGridTable(container, assets) {
  if (!assets || assets.length === 0) {
    container.innerHTML = emptyMarkup();
    return;
  }

  const rows = assets.map((asset) => {
    const score = healthScore(asset);
    return `
    <tr data-testid="asset-row" data-asset-id="${asset.assetId}" data-status="${asset.status}">
      <td>${asset.assetId}</td>
      <td>${fmt(asset.vibeAxial, 'mm/s')}</td>
      <td>${fmt(asset.vibeRadial, 'mm/s')}</td>
      <td>${fmt(asset.thermalWinding, 'degC')}</td>
      <td>
        <div class="d-flex align-items-center gap-2">
          <div class="progress flex-grow-1" role="progressbar" aria-label="${asset.assetId} health"
               aria-valuenow="${score}" aria-valuemin="0" aria-valuemax="100" data-testid="asset-health-progress"
               style="height: 0.85rem; min-width: 6rem;">
            <div class="progress-bar ${progressVariant(asset.status)}" style="width: ${score}%"></div>
          </div>
          <span class="small text-body-secondary" data-testid="asset-health-label">${statusLabel(asset.status)}</span>
        </div>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="card">
      <div class="card-body">
        <table class="table table-striped table-hover align-middle" data-testid="asset-grid-table">
          <thead>
            <tr>
              <th scope="col">Asset ID</th>
              <th scope="col">Vibe Axial (mm/s RMS)</th>
              <th scope="col">Vibe Radial (mm/s RMS)</th>
              <th scope="col">Thermal Winding (degC)</th>
              <th scope="col">Health</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}
