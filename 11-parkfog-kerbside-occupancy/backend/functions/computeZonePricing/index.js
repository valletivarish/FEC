const { QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/dynamoClient');

const TABLE_NAME = process.env.PARKFOG_EVENTS_TABLE;
// config-only zone list (comma-separated) so adding a zone never touches this handler's code
const ZONE_IDS = (process.env.PARKFOG_ZONE_IDS || 'zone-01').split(',').map((z) => z.trim());

const BASE_TARIFF = 2.0;
const NEUTRAL_EWMA = 5;
const DEMAND_RATE_PER_UNIT = 0.1;
const MIN_TARIFF = 1.0;
const MAX_TARIFF = 6.0;
const TARIFF_CHANGE_THRESHOLD = 0.05;

// tariff = base rate plus a flat amount per EWMA unit above the neutral baseline (roughly the
// low end of typical demand for this sensor pair), clamped so the rate never dips or spikes
// past a sane band; rounded to the penny since this is a real-money figure
function computeTariff(entryPressureEwma) {
  const raw = BASE_TARIFF + DEMAND_RATE_PER_UNIT * (entryPressureEwma - NEUTRAL_EWMA);
  const clamped = Math.min(MAX_TARIFF, Math.max(MIN_TARIFF, raw));
  return Math.round(clamped * 100) / 100;
}

async function fetchLatestByType(zoneId, type) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'entityId = :entityId AND begins_with(eventTypeTimestamp, :typePrefix)',
      ExpressionAttributeValues: {
        ':entityId': zoneId,
        ':typePrefix': `${type}#`,
      },
      ScanIndexForward: false,
      Limit: 1,
    })
  );
  const items = result.Items || [];
  return items[0] || null;
}

async function processZone(zoneId, now) {
  const latestPressure = await fetchLatestByType(zoneId, 'zone_pressure_event');
  if (!latestPressure) {
    return null;
  }

  const latestTariff = await fetchLatestByType(zoneId, 'tariff_changed');
  const previousTariff = latestTariff ? latestTariff.newTariff : BASE_TARIFF;

  const newTariff = computeTariff(latestPressure.entryPressureEwma);

  // only dispatch when the tariff genuinely moved, so a stable demand signal never spams events
  if (Math.abs(newTariff - previousTariff) < TARIFF_CHANGE_THRESHOLD) {
    return null;
  }

  const event = {
    type: 'tariff_changed',
    entityId: zoneId,
    previousTariff,
    newTariff,
    demandSignal: latestPressure.entryPressureEwma,
    timestamp: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...event, eventTypeTimestamp: `tariff_changed#${now}` },
    })
  );

  return event;
}

async function handler() {
  const now = new Date().toISOString();
  const written = [];

  for (const zoneId of ZONE_IDS) {
    try {
      const event = await processZone(zoneId, now);
      if (event) {
        written.push(event);
      }
    } catch (err) {
      // one zone's failure must not block pricing for the rest of the portfolio
      console.error('failed to compute zone pricing', zoneId, err);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ tariffsChanged: written.length, events: written }) };
}

module.exports = { handler, computeTariff };
