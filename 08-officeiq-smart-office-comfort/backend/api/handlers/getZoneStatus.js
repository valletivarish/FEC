'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.OFFICEIQ_READINGS_TABLE;
const RECENT_EVENTS_LIMIT = 20;

// Fargate desired/running counts stand in for a live ECS DescribeServices call - env-driven keeps this unit-testable
function getServiceScaleInfo() {
  return {
    desiredCount: Number(process.env.OFFICEIQ_WORKER_DESIRED_COUNT || 1),
    runningCount: Number(process.env.OFFICEIQ_WORKER_RUNNING_COUNT || 1),
  };
}

// eventTypeTimestamp sorts as "type#timestamp", so a begins_with query per type is the only
// way to get that type's own latest/recent events instead of whichever type sorts last overall
async function queryEventsByType(zoneId, eventType) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'zoneId = :zoneId AND begins_with(eventTypeTimestamp, :typePrefix)',
    ExpressionAttributeValues: { ':zoneId': zoneId, ':typePrefix': `${eventType}#` },
    ScanIndexForward: false,
    Limit: RECENT_EVENTS_LIMIT,
  }));
  return result.Items || [];
}

// mirrors ComfortFog's own severity grading — an active fault outranks a merely elevated one
function deriveZoneStatus(latestComfort) {
  if (!latestComfort) return 'nominal';
  if (latestComfort.verdict === 'PRESSURE_FAULT') return 'critical';
  return latestComfort.severity || 'nominal';
}

exports.handler = async (event) => {
  const zoneId = event.pathParameters && event.pathParameters.zoneId;

  if (!zoneId) {
    return { statusCode: 400, body: JSON.stringify({ message: 'zoneId is required' }) };
  }

  const [occupancyEvents, comfortEvents, usageEvents] = await Promise.all([
    queryEventsByType(zoneId, 'occupancy_event'),
    queryEventsByType(zoneId, 'comfort_event'),
    queryEventsByType(zoneId, 'usage_event'),
  ]);

  // each list is newest-first, so index 0 is the zone's latest reading for that context field
  const latestComfort = comfortEvents[0] || null;
  const deskOccupancy = occupancyEvents[0] ? occupancyEvents[0].deskOccupiedCount : null;
  const roomCo2 = latestComfort ? latestComfort.roomCo2 : null;
  const roomTemperature = latestComfort ? latestComfort.temperature : null;

  return {
    statusCode: 200,
    body: JSON.stringify({
      zoneId,
      deskOccupancy,
      roomCo2,
      roomTemperature,
      status: deriveZoneStatus(latestComfort),
      occupancyEvents,
      comfortEvents,
      usageEvents,
      scalingStatus: getServiceScaleInfo(),
    }),
  };
};
