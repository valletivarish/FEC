const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/dynamoClient');

const TABLE_NAME = process.env.PARKFOG_EVENTS_TABLE;

// dashboard is always served from a different origin than the API, so every response needs this
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

// single-table design partitions by entityId, and bay-scoped events (bay_state_event,
// overstay_event, ev_fault_event) are stored with the bayId as entityId, not the zoneId -- so
// a zone's status has to fan out over the zone's own entityId plus every one of its bays'
// entityIds. Config-only, same pattern as computeZonePricing's PARKFOG_ZONE_IDS, so adding a
// bay never needs a code change here.
const ZONE_BAY_IDS = (process.env.PARKFOG_ZONE_BAY_IDS || 'bay-01,bay-02,bay-03,bay-04,bay-05,bay-06')
  .split(',')
  .map((b) => b.trim())
  .filter(Boolean);

async function queryEntity(entityId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'entityId = :entityId',
      ExpressionAttributeValues: { ':entityId': entityId },
      ScanIndexForward: false,
    })
  );
  return result.Items || [];
}

// merges the zone's own events with every configured bay's events, then re-sorts newest-first
// since each per-entity query is only ordered within its own partition
async function queryZoneAndBays(zoneId) {
  const entityIds = [zoneId, ...ZONE_BAY_IDS];
  const perEntityResults = await Promise.all(entityIds.map(queryEntity));
  const merged = perEntityResults.flat();
  merged.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  return merged;
}

// fallback for invocation through a bare Lambda Function URL, which never populates
// pathParameters the way an API Gateway route does; rawPath still carries the real segment
function zoneIdFromRawPath(event) {
  const rawPath = event && event.rawPath;
  const match = typeof rawPath === 'string' && rawPath.match(/\/zones\/([^/]+)\/status/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

exports.handler = async (event) => {
  // pathParameters is the real API Gateway contract; the rest are fallbacks for direct Function URL use
  const zoneId =
    (event && event.pathParameters && event.pathParameters.zoneId) ||
    (event && event.queryStringParameters && event.queryStringParameters.zoneId) ||
    zoneIdFromRawPath(event);

  if (!zoneId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: 'zoneId path parameter is required' }),
    };
  }

  try {
    const zoneEvents = await queryZoneAndBays(zoneId);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        zoneId,
        events: zoneEvents,
        count: zoneEvents.length,
      }),
    };
  } catch (err) {
    console.error('failed to query zone status', zoneId, err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: 'failed to query zone status' }),
    };
  }
};
