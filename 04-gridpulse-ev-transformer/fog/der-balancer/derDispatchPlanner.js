const TARIFF_WINDOW_SIZE = 20;
const SUMMARY_INTERVAL = 5;
const SOLAR_CHARGE_THRESHOLD_KW = 2;
const BATTERY_CHARGE_CEILING_PCT = 95;
const BATTERY_DISCHARGE_FLOOR_PCT = 20;

class DerBalancerAgent {
  constructor() {
    this.solarKw = null;
    this.batterySoc = null;
    this.tariffPrice = null;
    this.tariffWindow = [];
    this.mode = 'idle';
    this.readingCount = 0;
  }

  pushTariffSample(price) {
    this.tariffWindow.push(price);
    if (this.tariffWindow.length > TARIFF_WINDOW_SIZE) {
      this.tariffWindow.shift();
    }
  }

  // Sorted-copy quantile lookup against the rolling window (including the current sample).
  quantile(q) {
    const sorted = [...this.tariffWindow].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
    return sorted[idx];
  }

  computeMode() {
    if (this.solarKw === null || this.batterySoc === null || this.tariffPrice === null) {
      return 'idle';
    }
    if (this.solarKw > SOLAR_CHARGE_THRESHOLD_KW && this.batterySoc < BATTERY_CHARGE_CEILING_PCT) {
      return 'charge_battery_from_solar';
    }
    const topQuartileThreshold = this.quantile(0.75);
    const bottomQuartileThreshold = this.quantile(0.25);
    if (this.tariffPrice >= topQuartileThreshold && this.batterySoc > BATTERY_DISCHARGE_FLOOR_PCT) {
      return 'discharge_to_grid';
    }
    if (this.tariffPrice <= bottomQuartileThreshold && this.batterySoc < BATTERY_CHARGE_CEILING_PCT) {
      return 'opportunistic_charge';
    }
    return 'idle';
  }

  onReading(reading) {
    const { hubId, metric, value, timestamp } = reading;
    if (metric === 'der/solar-generation') {
      this.solarKw = value;
    } else if (metric === 'der/battery-soc') {
      this.batterySoc = value;
    } else if (metric === 'der/tariff-price') {
      this.tariffPrice = value;
      this.pushTariffSample(value);
    } else {
      return [];
    }

    this.readingCount += 1;
    const events = [];

    const newMode = this.computeMode();
    if (newMode !== this.mode) {
      this.mode = newMode;
      events.push({
        type: 'der_mode',
        hubId,
        mode: this.mode,
        solarKw: this.solarKw,
        batterySoc: this.batterySoc,
        tariffPrice: this.tariffPrice,
        timestamp,
      });
    }

    if (this.readingCount % SUMMARY_INTERVAL === 0) {
      events.push({
        type: 'der_summary',
        hubId,
        mode: this.mode,
        solarKw: this.solarKw,
        batterySoc: this.batterySoc,
        tariffPrice: this.tariffPrice,
        timestamp,
      });
    }

    return events;
  }
}

module.exports = { DerBalancerAgent };
