'use strict';

const bayMagnetometer = require('../generators/bayMagnetometerGenerator');
const bayInfrared = require('../generators/bayInfraredGenerator');
const anprPermitCheck = require('../generators/anprPermitCheckGenerator');
const meterPayment = require('../generators/meterPaymentGenerator');
const evChargeState = require('../generators/evChargeStateGenerator');
const disabledBayBadgeScan = require('../generators/disabledBayBadgeScanGenerator');
const barrierEntryCount = require('../generators/barrierEntryCountGenerator');
const kerbFloodLevel = require('../generators/kerbFloodLevelGenerator');
const approachInboundCount = require('../generators/approachInboundCountGenerator');
const cameraFreeSpaceCount = require('../generators/cameraFreeSpaceCountGenerator');

const ITERATIONS = 500;

function runWalk(generator, seed) {
  let value = seed;
  for (let i = 0; i < ITERATIONS; i += 1) {
    value = generator.nextValue(value);
  }
  return value;
}

describe('bayMagnetometerGenerator', () => {
  it('stays within -150..150 across many iterations', () => {
    let value = 0;
    for (let i = 0; i < ITERATIONS; i += 1) {
      value = bayMagnetometer.nextValue(value);
      expect(value).toBeGreaterThanOrEqual(bayMagnetometer.MIN);
      expect(value).toBeLessThanOrEqual(bayMagnetometer.MAX);
    }
  });
});

describe('bayInfraredGenerator', () => {
  it('stays within 0.0..1.0 across many iterations', () => {
    let value = 0.5;
    for (let i = 0; i < ITERATIONS; i += 1) {
      value = bayInfrared.nextValue(value);
      expect(value).toBeGreaterThanOrEqual(bayInfrared.MIN);
      expect(value).toBeLessThanOrEqual(bayInfrared.MAX);
    }
  });
});

describe('anprPermitCheckGenerator', () => {
  it('stays within 60..99 across many iterations', () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const value = anprPermitCheck.nextValue(undefined);
      expect(value).toBeGreaterThanOrEqual(anprPermitCheck.MIN);
      expect(value).toBeLessThanOrEqual(anprPermitCheck.MAX);
    }
  });
});

describe('meterPaymentGenerator', () => {
  it('stays within 0..180 across many iterations', () => {
    let value = 180;
    for (let i = 0; i < ITERATIONS; i += 1) {
      value = meterPayment.nextValue(value);
      expect(value).toBeGreaterThanOrEqual(meterPayment.MIN);
      expect(value).toBeLessThanOrEqual(meterPayment.MAX);
    }
  });

  it('never goes negative even starting from zero', () => {
    const value = runWalk(meterPayment, 0);
    expect(value).toBeGreaterThanOrEqual(0);
  });
});

describe('evChargeStateGenerator', () => {
  it('only produces values from the enum across many iterations', () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const value = evChargeState.nextValue(undefined);
      expect(evChargeState.STATES).toContain(value);
    }
  });

  it('stays mostly idle/charging with fault being rare', () => {
    let faultCount = 0;
    for (let i = 0; i < ITERATIONS; i += 1) {
      if (evChargeState.nextValue(undefined) === 'fault') faultCount += 1;
    }
    expect(faultCount).toBeLessThan(ITERATIONS * 0.15);
  });
});

describe('disabledBayBadgeScanGenerator', () => {
  it('only produces boolean values', () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const value = disabledBayBadgeScan.nextValue(undefined);
      expect(typeof value).toBe('boolean');
    }
  });

  it('fires true roughly every 15th call', () => {
    let trueCount = 0;
    for (let i = 0; i < disabledBayBadgeScan.SCAN_EVERY_N_TICKS * 10; i += 1) {
      if (disabledBayBadgeScan.nextValue(undefined)) trueCount += 1;
    }
    expect(trueCount).toBe(10);
  });
});

describe('barrierEntryCountGenerator', () => {
  it('stays within -5..20 across many iterations', () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const value = barrierEntryCount.nextValue(undefined);
      expect(value).toBeGreaterThanOrEqual(barrierEntryCount.MIN);
      expect(value).toBeLessThanOrEqual(barrierEntryCount.MAX);
    }
  });
});

describe('kerbFloodLevelGenerator', () => {
  it('stays within 0..300 across many iterations', () => {
    let value = 10;
    for (let i = 0; i < ITERATIONS; i += 1) {
      value = kerbFloodLevel.nextValue(value);
      expect(value).toBeGreaterThanOrEqual(kerbFloodLevel.MIN);
      expect(value).toBeLessThanOrEqual(kerbFloodLevel.MAX);
    }
  });
});

describe('approachInboundCountGenerator', () => {
  it('stays within 0..30 across many iterations', () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const value = approachInboundCount.nextValue(undefined);
      expect(value).toBeGreaterThanOrEqual(approachInboundCount.MIN);
      expect(value).toBeLessThanOrEqual(approachInboundCount.MAX);
    }
  });
});

describe('cameraFreeSpaceCountGenerator', () => {
  it('keeps count within 0..6 and occlusionPercent within 0..40', () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const { count, occlusionPercent } = cameraFreeSpaceCount.nextValue(undefined);
      expect(count).toBeGreaterThanOrEqual(cameraFreeSpaceCount.MIN);
      expect(count).toBeLessThanOrEqual(cameraFreeSpaceCount.MAX);
      expect(occlusionPercent).toBeGreaterThanOrEqual(cameraFreeSpaceCount.OCCLUSION_MIN);
      expect(occlusionPercent).toBeLessThanOrEqual(cameraFreeSpaceCount.OCCLUSION_MAX);
    }
  });
});
