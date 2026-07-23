import os
import json
import logging
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from mcp.server.fastmcp import FastMCP

# ── Silence noisy loggers ────────────────────────────────────────────────────
os.environ["OTEL_SDK_DISABLED"] = "true"
logging.getLogger("botocore").setLevel(logging.ERROR)
logging.getLogger("urllib3").setLevel(logging.ERROR)
logging.getLogger("opentelemetry").setLevel(logging.ERROR)

# ── FastMCP init ─────────────────────────────────────────────────────────────
# AgentCore MCP protocol health-checks 0.0.0.0:8000/mcp — host and port are
# set here so the server always binds the correct address regardless of env vars.
mcp = FastMCP(
    "Electrify_DynamoDB_Server",
    host="0.0.0.0",
    port=8000,
    stateless_http=True,
)

# ── DynamoDB config ───────────────────────────────────────────────────────────
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
TABLE_NAME = os.environ.get(
    "DYNAMODB_TABLE_NAME",
    "ConsumptionRecord-i6dt7ha4gvc6ph22qnhi2qopua-NONE",
)
GSI_NAME = "consumptionRecordsByCustomerIdAndMonthYear"

_table = None


def get_table():
    """Lazy-init DynamoDB — never touches AWS during module import."""
    global _table
    if _table is None:
        dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
        _table = dynamodb.Table(TABLE_NAME)
    return _table


def serialize_item(item: dict) -> dict:
    return {
        k: (int(v) if v % 1 == 0 else float(v)) if isinstance(v, Decimal) else v
        for k, v in item.items()
    }


# ── Tool ──────────────────────────────────────────────────────────────────────
@mcp.tool()
def get_customer_bills(customerId: str, limit: int = 12) -> str:
    """
    Retrieves historical energy consumption bills for a customer from DynamoDB.

    Args:
        customerId: The exact hyphenated UUID string of the customer.
        limit: Maximum number of monthly bills to retrieve (default 12).
    """
    customerId = customerId.strip()
    if not customerId:
        return json.dumps({"error": "customerId is required."})

    try:
        response = get_table().query(
            IndexName=GSI_NAME,
            KeyConditionExpression=Key("customerId").eq(customerId),
            ScanIndexForward=False,
            Limit=limit,
        )
        items = response.get("Items", [])
        if not items:
            return json.dumps({"message": f"No records found for customerId: {customerId}."})

        return json.dumps({"items": [serialize_item(i) for i in items]}, indent=2)

    except Exception as exc:
        return json.dumps({"error": f"DynamoDB query failed: {str(exc)}"})


# ── Entry point ───────────────────────────────────────────────────────────────
# mcp.run() MUST be called unconditionally at module level.
# AgentCore CodeZip executes server.py as a script (not an import), so the
# __main__ guard is irrelevant — the runtime runs `python server.py` directly.
# The server must be listening on 0.0.0.0:8000/mcp before the 30s timeout.
mcp.run(transport="streamable-http")
