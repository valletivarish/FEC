import boto3

# No endpoint/region override: boto3 picks these up from the environment, so
# local (emulator) and real AWS runs share this exact line, config differs outside code.
dynamodb = boto3.resource("dynamodb")
