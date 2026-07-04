import os

import boto3

sqs = boto3.client("sqs")


def handler(event, context):
    queue_url = os.environ["HARBORPULSE_TARGET_QUEUE_URL"]

    # relay verbatim: the fog dispatcher already shaped the JSON body, no re-parsing needed here
    sqs.send_message(QueueUrl=queue_url, MessageBody=event["body"])

    return {
        "statusCode": 202,
        "headers": {"Content-Type": "application/json"},
        "body": '{"relayed": true}',
    }
