"""
MCP Electrify DynamoDB Server
==============================
AgentCore Gateway / Lambda-hosted MCP endpoint.

This server exposes a tool that queries the ConsumptionRecord DynamoDB table
using the customerId-monthYear GSI, returning the raw records as a JSON string
for the Supervisor Agent (or DataViz server) to process.

Table  : ConsumptionRecord-o6wktlvbrvgydojj56vajcbiwy-NONE
GSI    : customerId-monthYear-index  (partition key: customerId, sort key: monthYear)
Region : us-east-1 (override via TABLE_REGION env var)

Transport: stdio (AgentCore Runtime wraps this as a subprocess and communicates
over stdin/stdout — the standard MCP stdio transport pattern).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

# ── Logging ───────────────────────────────────────────────────────────────────

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,  # MCP stdio uses stdout; keep logs on stderr
)

# ── Configuration ─────────────────────────────────────────────────────────────

# The full Amplify Gen 2 sandbox table name.
# Override via TABLE_NAME env var if the sandbox ID changes.
TABLE_NAME: str = os.environ.get(
    "TABLE_NAME",
    "ConsumptionRecord-o6wktlvbrvgydojj56vajcbiwy-NONE",
)

# The GSI name created by:
#   index("customerId").sortKeys(["monthYear"]).queryField("listByCustomerAndMonth")
# Amplify Gen 2 names this index: customerId-monthYear-index
GSI_NAME: str = os.environ.get(
    "GSI_NAME",
    "customerId-monthYear-index",
)

TABLE_REGION: str = os.environ.get("TABLE_REGION", "us-east-1")

# ── DynamoDB client (module-level for Lambda container reuse) ─────────────────

_dynamodb = boto3.resource("dynamodb", region_name=TABLE_REGION)
_table = _dynamodb.Table(TABLE_NAME)

# ── MCP Server ────────────────────────────────────────────────────────────────

server = Server("electrify-dynamo-server")

# ── Tool registry ─────────────────────────────────────────────────────────────


@server.list_tools()
async def list_tools() -> list[Tool]:
    """Advertise the tools this server exposes to the AgentCore Gateway."""
    return [
        Tool(
            name="get_historical_usage",
            description=(
                "Queries the ConsumptionRecord DynamoDB table for all energy usage "
                "records belonging to the given customer, ordered chronologically by "
                "monthYear. Returns a JSON array of record objects. "
                "Each object contains: id, customerId, monthYear, date, kwhUsage, "
                "statementAmount, and ratePlan."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "customer_id": {
                        "type": "string",
                        "description": (
                            "The Cognito sub UUID of the authenticated user. "
                            "This is the partition key on the customerId-monthYear-index GSI."
                        ),
                    },
                    "start_month": {
                        "type": "string",
                        "description": (
                            "Optional. Earliest monthYear to include (inclusive), "
                            "in YYYY-MM format (e.g. '2025-01'). "
                            "If omitted, all records for the customer are returned."
                        ),
                    },
                    "end_month": {
                        "type": "string",
                        "description": (
                            "Optional. Latest monthYear to include (inclusive), "
                            "in YYYY-MM format (e.g. '2026-07'). "
                            "If omitted, all records for the customer are returned."
                        ),
                    },
                },
                "required": ["customer_id"],
            },
        ),
    ]


# ── Tool dispatcher ───────────────────────────────────────────────────────────


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """Route incoming tool calls to their implementations."""
    if name == "get_historical_usage":
        return await _get_historical_usage(arguments)
    return [TextContent(type="text", text=f"Unknown tool: {name}")]


# ── Tool implementation ───────────────────────────────────────────────────────


async def _get_historical_usage(arguments: dict[str, Any]) -> list[TextContent]:
    """
    Query the ConsumptionRecord table via the customerId-monthYear GSI.

    Uses a KeyConditionExpression with the partition key only (returns all months)
    or with a sort key range when start_month / end_month are provided.

    DynamoDB Query is used throughout — no Scan operations.

    Returns a JSON array sorted ascending by monthYear.
    Each item has Decimal values converted to float for JSON serialisation.
    """
    customer_id: str = arguments.get("customer_id", "").strip()
    start_month: str | None = arguments.get("start_month")
    end_month: str | None = arguments.get("end_month")

    if not customer_id:
        return [TextContent(
            type="text",
            text="Error: customer_id is required and must not be empty.",
        )]

    logger.info(
        "get_historical_usage — customer=%s start=%s end=%s",
        customer_id,
        start_month,
        end_month,
    )

    try:
        key_condition = Key("customerId").eq(customer_id)

        # Add sort key range conditions if either bound is provided
        if start_month and end_month:
            key_condition = key_condition & Key("monthYear").between(
                start_month, end_month
            )
        elif start_month:
            key_condition = key_condition & Key("monthYear").gte(start_month)
        elif end_month:
            key_condition = key_condition & Key("monthYear").lte(end_month)

        # Paginate through all results — DynamoDB limits each response to 1 MB
        items: list[dict[str, Any]] = []
        query_kwargs: dict[str, Any] = {
            "IndexName": GSI_NAME,
            "KeyConditionExpression": key_condition,
            # ScanIndexForward=True gives ascending monthYear order from the GSI
            "ScanIndexForward": True,
        }

        while True:
            response = _table.query(**query_kwargs)
            items.extend(response.get("Items", []))

            # Follow the pagination token if present
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            query_kwargs["ExclusiveStartKey"] = last_key

        logger.info(
            "get_historical_usage — returned %d record(s) for customer=%s",
            len(items),
            customer_id,
        )

        if not items:
            return [TextContent(
                type="text",
                text=(
                    f"No energy records found for customer_id: {customer_id}. "
                    "Ensure the table has been seeded and the customer_id matches "
                    "the Cognito sub UUID used during seeding."
                ),
            )]

        # Serialise: convert Decimal → float so json.dumps works cleanly
        serialisable = _serialise_items(items)
        return [TextContent(type="text", text=json.dumps(serialisable, indent=2))]

    except Exception as exc:
        logger.error(
            "get_historical_usage — DynamoDB error for customer=%s: %s",
            customer_id,
            exc,
            exc_info=True,
        )
        return [TextContent(
            type="text",
            text=f"Error querying DynamoDB: {exc}",
        )]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _serialise_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Recursively convert Decimal values to float/int for JSON serialisation.

    boto3's DynamoDB resource returns numeric attributes as Decimal, which
    json.dumps cannot serialise by default.
    """
    result = []
    for item in items:
        result.append(_serialise_value(item))
    return result


def _serialise_value(value: Any) -> Any:
    """Recursively convert a value to a JSON-serialisable type."""
    if isinstance(value, dict):
        return {k: _serialise_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_serialise_value(v) for v in value]
    if isinstance(value, Decimal):
        # Preserve integer precision where possible
        if value == value.to_integral_value():
            return int(value)
        return float(value)
    return value


# ── Async entrypoint ──────────────────────────────────────────────────────────


async def run_stdio() -> None:
    """Run the MCP server over stdio transport."""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )


# ── Lambda handler ────────────────────────────────────────────────────────────


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    AWS Lambda entry point for the AgentCore Gateway.

    The AgentCore Runtime manages this function as a subprocess and communicates
    via the MCP stdio transport (stdin/stdout). This handler bootstraps the async
    event loop for that stdio session.

    IAM permissions required on this Lambda's execution role:
        dynamodb:Query on:
          arn:aws:dynamodb:us-east-1:<account>:table/ConsumptionRecord-*
          arn:aws:dynamodb:us-east-1:<account>:table/ConsumptionRecord-*/index/*
    """
    logger.info("Lambda invoked — starting electrify-dynamo-server")
    logger.info("Event keys: %s", list(event.keys()))

    try:
        asyncio.run(run_stdio())
        return {"statusCode": 200, "body": "MCP server completed successfully"}
    except Exception as exc:
        logger.error("MCP server error: %s", exc, exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(exc)}),
        }


# ── CLI / local dev entrypoint ────────────────────────────────────────────────

if __name__ == "__main__":
    """
    Run locally:
        python server.py

    Test interactively with the MCP Inspector:
        npx @modelcontextprotocol/inspector python server.py

    Requires AWS credentials with dynamodb:Query on the table.
    Override table/GSI via env vars:
        TABLE_NAME=MyTable GSI_NAME=myIndex python server.py
    """
    asyncio.run(run_stdio())
