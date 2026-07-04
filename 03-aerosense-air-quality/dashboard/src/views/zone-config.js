import { getZoneConfig, putZoneConfig } from "../api.js";

const SENSOR_KEYS = ["co2", "pm25", "pm10", "tvoc", "temperature", "humidity", "co", "no2", "hcho", "occupancy_pir"];

function rowMarkup(key, sensorConfig) {
  const frequency = sensorConfig?.frequency_s ?? 60;
  const dispatchRate = sensorConfig?.dispatch_rate ?? 1;
  return `
    <tr>
      <td class="config-form__sensor">${key}</td>
      <td><input type="number" min="1" class="form-control form-control-sm" name="${key}__frequency_s" value="${frequency}" /></td>
      <td><input type="number" min="0" step="0.1" class="form-control form-control-sm" name="${key}__dispatch_rate" value="${dispatchRate}" /></td>
    </tr>
  `;
}

function readFormValues(form) {
  const config = {};
  SENSOR_KEYS.forEach((key) => {
    config[key] = {
      frequency_s: Number(form.elements[`${key}__frequency_s`].value),
      dispatch_rate: Number(form.elements[`${key}__dispatch_rate`].value),
    };
  });
  return config;
}

// Renders an editable per-sensor frequency/dispatch-rate form and saves it via PUT /config/{zone_id}.
export async function renderZoneConfig(container, zoneId, { onBack } = {}) {
  container.innerHTML = `<div class="view__loading">Loading config for ${zoneId}…</div>`;

  const existing = await getZoneConfig(zoneId).catch(() => ({}));

  const rows = SENSOR_KEYS.map((key) => rowMarkup(key, existing?.[key])).join("");

  container.innerHTML = `
    <div class="zone-config">
      <div class="toolbar d-flex align-items-center justify-content-between gap-3 mb-3">
        <button type="button" class="btn btn-outline-secondary" data-action="back">&larr; Back</button>
        <h2 class="toolbar__title h5 mb-0">Config · ${zoneId}</h2>
      </div>
      <form class="card config-form" id="zone-config-form">
        <div class="card-body">
          <div class="table-responsive">
            <table class="table table-striped table-hover align-middle config-form__table mb-0">
              <thead>
                <tr><th>Sensor</th><th>Frequency (s)</th><th>Dispatch rate</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
        <div class="config-form__actions card-footer d-flex align-items-center gap-3">
          <button type="submit" class="btn btn-primary">Save Config</button>
          <span class="config-form__message" role="status" aria-live="polite"></span>
        </div>
      </form>
    </div>
  `;

  container.querySelector('[data-action="back"]')?.addEventListener("click", () => onBack?.());

  const form = container.querySelector("#zone-config-form");
  const message = container.querySelector(".config-form__message");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Saving…";
    message.classList.remove("text-danger", "text-success");
    try {
      await putZoneConfig(zoneId, readFormValues(form));
      message.textContent = "Saved successfully.";
      message.classList.add("text-success");
    } catch (error) {
      message.textContent = "Save failed. Please retry.";
      message.classList.add("text-danger");
    }
  });
}
