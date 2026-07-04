'use strict';

const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const sqsClient = new SQSClient({});

const QUEUE_URL = process.env.OFFICEIQ_EVENT_QUEUE_URL;

// relays the raw POST body straight onto the ingest queue - parsing/validation stays in the worker
exports.handler = async (event) => {
  const body = event.body || '';

  await sqsClient.send(new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: body,
  }));

  return { statusCode: 202, body: JSON.stringify({ accepted: true }) };
};
