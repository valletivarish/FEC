const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

// no endpoint/region here: SDK reads AWS_ENDPOINT_URL/AWS_REGION from env so
// the same code path works against the local emulator and real AWS
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

module.exports = { docClient, ddbClient };
