// Bootstrap card with a key-value table — winding temp/load turn warning-colored above threshold
export class TransformerStatusLine {
  constructor(container) {
    this.container = container;
    this.container.innerHTML = `
      <div class="card" data-testid="transformer-status-line">
        <div class="card-body">
          <table class="table table-borderless align-middle mb-0">
            <tbody>
              <tr>
                <th scope="row" class="text-body-secondary fw-normal">Winding Temp</th>
                <td data-field="winding-temp">—</td>
              </tr>
              <tr>
                <th scope="row" class="text-body-secondary fw-normal">Load</th>
                <td data-field="load-amps">—</td>
              </tr>
              <tr>
                <th scope="row" class="text-body-secondary fw-normal" title="Curtailment ladder position: normal, advisory, curtail (reduced charging) or trip (charging stopped) to protect the transformer">Curtailment Level</th>
                <td data-field="rung">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  update({ windingTemp, loadAmps, rung, rungLabel } = {}) {
    const tempEl = this.container.querySelector('[data-field="winding-temp"]');
    const loadEl = this.container.querySelector('[data-field="load-amps"]');
    const rungEl = this.container.querySelector('[data-field="rung"]');

    tempEl.textContent = formatNumber(windingTemp, ' °C');
    tempEl.className = isWarm(windingTemp) ? 'text-danger fw-semibold' : '';

    loadEl.textContent = formatNumber(loadAmps, ' A');
    loadEl.className = isLoaded(loadAmps) ? 'text-danger fw-semibold' : '';

    const label = rungLabel ?? (rung !== undefined ? String(rung) : '—');
    rungEl.innerHTML = rungLabel !== undefined || rung !== undefined
      ? `<span class="badge rounded-pill ${badgeClass(rung)}">${label}</span>`
      : '—';
  }
}

function badgeClass(rung) {
  if (rung === 2 || rung === 3) return 'text-bg-danger';
  if (rung === 1) return 'text-bg-warning';
  if (rung === 0) return 'text-bg-success';
  return 'text-bg-secondary';
}

function isWarm(temp) {
  return typeof temp === 'number' && temp >= 100;
}

function isLoaded(amps) {
  return typeof amps === 'number' && amps >= 320;
}

function formatNumber(value, suffix) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : '—';
}
