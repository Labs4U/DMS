"""
MCP Electrify DynamoDB Server — Local stdio transport
=======================================================
Strands orchestrator / local MCP endpoint.

Exposes DynamoDB query tools so a Strands agent can fetch ConsumptionRecord
data without any direct AWS SDK calls in the orchestrator.

Table  : ConsumptionRecord-2ql236iyard5fmfu73m24wsl5q-NONE
GSI    : customerId-monthYear-index
         Partition key : customerId  (also the Amplify owner field)
         Sort key      : monthYear   (YYYY-MM strings, lexicographic order)
Region : us-east-1

Transport: stdio  — run with `python server.py` or test with:
    npx @modelcontextprotocol/inspector python server.py
"""

from __future__ import annotations

import json
import logging
import sys
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from mcp.server.fastmcp import FastMCP

# ── Logging ───────────────────────────────────────────────────────────────────

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,  # stdio transport uses stdout; keep logs on stderr
)

# ── Configuration ─────────────────────────────────────────────────────────────

# New sandbox table — updated from mockupData.py
TABLE_NAME = "ConsumptionRecord-2ql236iyard5fmfu73m24wsl5q-NONE"

# GSI created by:
#   index("customerId").sortKeys(["monthYear"]).queryField("listByCustomerAndMonth")
# Amplify Gen 2 names this index: <partitionKey>-<sortKey>-index
GSI_NAME = "consumptionRecordsByCustomerIdAndMonthYear"

TABLE_REGION = "us-east-1"

# ── DynamoDB resource (module-level — reused across tool calls) ───────────────

_dynamodb = boto3.resource("dynamodb", region_name=TABLE_REGION)
_table = _dynamodb.Table(TABLE_NAME)

# ── MCP server ────────────────────────────────────────────────────────────────

# FastMCP provides the @server.tool() high-level decorator API
server = FastMCP("electrify-dynamo-server")


# ── Tool: get_customer_bills ──────────────────────────────────────────────────

@server.tool()
def get_customer_bills(customerId: str, limit: int = 10) -> str:
    """
    Fetch energy bill records for a customer from DynamoDB.

    Queries the ConsumptionRecord table via the customerId-monthYear GSI.
    Results are returned in descending monthYear order (most recent first)
    and truncated to `limit` items.

    Args:
        customerId: The Cognito sub UUID of the authenticated user.
                    This is the partition key on the customerId-monthYear-index GSI
                    and also the Amplify owner field (ownerDefinedIn('customerId')).
        limit:      Maximum number of records to return. Defaults to 10.
                    Use a higher value to retrieve a full 12-month history.

    Returns:
        A JSON string containing the Items array. Each item has the fields:
        id, customerId, monthYear, date, kwhUsage, statementAmount, ratePlan,
        createdAt, updatedAt.

        Returns an error string if the query fails or customerId is empty.
    """
    customerId = customerId.strip()
    if not customerId:
        return json.dumps({"error": "customerId is required and must not be empty."})

    if limit < 1:
        limit = 1
    if limit > 100:
        limit = 100  # guard against accidentally large requests

    logger.info("get_customer_bills — customer=%s limit=%d", customerId, limit)

    try:
        # Query the GSI with ScanIndexForward=False → descending monthYear order
        # (most recent bill first). Fetch up to `limit` items in one request.
        response = _table.query(
            IndexName=GSI_NAME,
            KeyConditionExpression=Key("customerId").eq(customerId),
            ScanIndexForward=False,  # descending: 2026-07 → 2025-08
            Limit=limit,
        )

        items: list[dict[str, Any]] = response.get("Items", [])

        logger.info(
            "get_customer_bills — returned %d record(s) for customer=%s",
            len(items),
            customerId,
        )

        if not items:
            return json.dumps({
                "items": [],
                "message": (
                    f"No records found for customerId: {customerId}. "
                    "Ensure the table has been seeded and the customerId matches "
                    "the Cognito sub UUID used during seeding."
                ),
            })

        # Convert Decimal → float/int for JSON serialisation
        serialisable = _serialise_items(items)
        return json.dumps({"items": serialisable}, indent=2)

    except Exception as exc:
        logger.error(
            "get_customer_bills — DynamoDB error for customer=%s: %s",
            customerId,
            exc,
            exc_info=True,
        )
        return json.dumps({"error": f"DynamoDB query failed: {exc}"})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialise_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Recursively convert Decimal values to float/int for JSON serialisation."""
    return [_serialise_value(item) for item in items]


def _serialise_value(value: Any) -> Any:
    """Convert a single value to a JSON-serialisable type, recursively."""
    if isinstance(value, dict):
        return {k: _serialise_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_serialise_value(v) for v in value]
    if isinstance(value, Decimal):
        # Preserve integer precision: 300.00 → 300, 222.38 → 222.38
        return int(value) if value == value.to_integral_value() else float(value)
    return value


# ── stdio transport entrypoint ────────────────────────────────────────────────

if __name__ == "__main__":
    """
    Run locally:
        python server.py

    Test with the MCP Inspector:
        npx @modelcontextprotocol/inspector python server.py

    Required AWS credentials:
        dynamodb:Query on:
          arn:aws:dynamodb:us-east-1:*:table/ConsumptionRecord-*
          arn:aws:dynamodb:us-east-1:*:table/ConsumptionRecord-*/index/*
    """
    server.run(transport="stdio")
