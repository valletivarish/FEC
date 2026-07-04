export const POPULATED_DEPOT_STATUS = {
  clusterVerdicts: [
    {
      type: "cluster_verdict",
      binId: "bin-01",
      verdict: "NORMAL",
      fillLevelPct: 42,
      binWeightKg: 100.8,
      expectedWeightKg: 100.8,
      timestamp: "2026-07-02T09:00:00.000Z",
    },
    {
      type: "cluster_verdict",
      binId: "bin-02",
      verdict: "POSSIBLE_FALSE_FULL",
      fillLevelPct: 91,
      binWeightKg: 4.2,
      expectedWeightKg: 218.4,
      timestamp: "2026-07-02T09:05:00.000Z",
    },
    {
      type: "cluster_verdict",
      binId: "bin-03",
      verdict: "INCONSISTENT",
      fillLevelPct: 65,
      binWeightKg: 200.0,
      expectedWeightKg: 156.0,
      timestamp: "2026-07-02T09:10:00.000Z",
    },
  ],
  fireRiskEvents: [
    {
      type: "fire_risk_alert",
      binId: "bin-01",
      riskStatus: "NORMAL",
      riskScore: 12.5,
      medianMethanePpm: 300,
      medianInternalTempC: 22,
      tiltDegrees: 2,
      timestamp: "2026-07-02T09:01:00.000Z",
    },
    {
      type: "fire_risk_alert",
      binId: "bin-02",
      riskStatus: "WATCH",
      riskScore: 48.0,
      medianMethanePpm: 2200,
      medianInternalTempC: 40,
      tiltDegrees: 5,
      timestamp: "2026-07-02T09:06:00.000Z",
    },
    {
      type: "fire_risk_alert",
      binId: "bin-03",
      riskStatus: "CRITICAL",
      riskScore: 78.3,
      medianMethanePpm: 6000,
      medianInternalTempC: 60,
      tiltDegrees: 50,
      timestamp: "2026-07-02T09:11:00.000Z",
    },
  ],
  latestWorkList: {
    type: "work_list_event",
    depotId: "depot-01",
    items: [
      {
        binId: "bin-03",
        priorityScore: 5.15,
        dueReasons: ["SAFETY_RISK", "HIGH_FILL"],
        assignedTruckId: "truck-01",
        dataQualityFlag: "INCONSISTENT",
      },
      {
        binId: "bin-02",
        priorityScore: 2.91,
        dueReasons: ["SAFETY_RISK", "HIGH_FILL"],
        assignedTruckId: "truck-01",
        dataQualityFlag: "POSSIBLE_FALSE_FULL",
      },
    ],
    latestWeighbridgeTonnage: 7.42,
    timestamp: "2026-07-02T09:12:00.000Z",
  },
  // hopper-fill/fuel-level/truck GPS aren't part of the documented QueryDepotStatusHandler
  // response shape — modelled here as optional extras a real backend could add without
  // breaking the contract, so the dashboard has something concrete to render/test against.
  truckHopperFillPct: 63.5,
  truckFuelLevelPct: 81.2,
  truckLastRecordedPosition: { lat: 53.351, lon: -6.255, truckId: "truck-01" },
};

export const EMPTY_DEPOT_STATUS = {
  clusterVerdicts: [],
  fireRiskEvents: [],
  latestWorkList: null,
};
