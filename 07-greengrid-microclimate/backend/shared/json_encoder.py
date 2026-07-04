import json
from decimal import Decimal


class DecimalEncoder(json.JSONEncoder):
    # DynamoDB returns numbers as Decimal; json can't serialize those natively
    def default(self, obj):
        if isinstance(obj, Decimal):
            if obj % 1 == 0:
                return int(obj)
            return float(obj)
        return super().default(obj)


def dumps(payload) -> str:
    return json.dumps(payload, cls=DecimalEncoder)
