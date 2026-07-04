"""Local-only floci workaround: registers the PondQueryFn Function URL directly via the Lambda
API. floci's CloudFormation provisioner accepts an AWS::Lambda::Url resource and reports
CREATE_COMPLETE but never actually calls into its own LambdaService to create the URL config
(no matching log line appears, unlike every other resource type), so the CDK-managed Function
URL never becomes invokable. Real AWS provisions AWS::Lambda::Url correctly via CloudFormation,
so this script is never run there and the CDK stack is unchanged either way.

Usage (after `cdk deploy` with AQUASENTINEL_LOCAL_FALLBACK=1):
    AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
    AWS_DEFAULT_REGION=us-east-1 python3 floci_function_url_bootstrap.py
"""
import os

import boto3

FUNCTION_NAME = "aquasentinel-pond-query-fn"


def main() -> None:
    client = boto3.client("lambda", endpoint_url=os.environ.get("AWS_ENDPOINT_URL"))

    try:
        config = client.create_function_url_config(
            FunctionName=FUNCTION_NAME,
            AuthType="NONE",
            Cors={"AllowOrigins": ["*"], "AllowMethods": ["GET"]},
        )
    except client.exceptions.ResourceConflictException:
        config = client.get_function_url_config(FunctionName=FUNCTION_NAME)

    try:
        client.add_permission(
            FunctionName=FUNCTION_NAME,
            StatementId="FunctionUrlAllowPublicAccess",
            Action="lambda:InvokeFunctionUrl",
            Principal="*",
            FunctionUrlAuthType="NONE",
        )
    except client.exceptions.ResourceConflictException:
        pass

    print(config["FunctionUrl"])


if __name__ == "__main__":
    main()
