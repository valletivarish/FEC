// Bootstrap card with a key-value table — mode shown as an informational badge, never decoratively elsewhere
export class DerStatusLine {
  constructor(container) {
    this.container = container;
    this.container.innerHTML = `
      <div class="card" data-testid="der-status-line">
        <div class="card-body">
          <table class="table table-borderless align-middle mb-0">
            <tbody>
              <tr>
                <th scope="row" class="text-body-secondary fw-normal">Solar</th>
                <td data-field="solar-kw">—</td>
              </tr>
              <tr>
                <th scope="row" class="text-body-secondary fw-normal">Battery</th>
                <td data-field="battery-soc">—</td>
              </tr>
              <tr>
                <th scope="row" class="text-body-secondary fw-normal">Tariff</th>
                <td data-field="tariff-price">—</td>
              </tr>
              <tr>
                <th scope="row" class="text-body-secondary fw-normal">Mode</th>
                <td data-field="mode">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  update({ solarKw, batterySoc, tariffPrice, mode } = {}) {
    this.container.querySelector('[data-field="solar-kw"]').textContent = formatNumber(solarKw, ' kW');
    this.container.querySelector('[data-field="battery-soc"]').textContent = formatNumber(batterySoc, '%');
    this.container.querySelector('[data-field="tariff-price"]').textContent = formatNumber(tariffPrice, 'p/kWh', ' ');

    const modeEl = this.container.querySelector('[data-field="mode"]');
    modeEl.innerHTML = mode ? `<span class="badge rounded-pill text-bg-info">${mode}</span>` : '—';
  }
}

function formatNumber(value, suffix, sep = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}${sep}${suffix}` : '—';
}
