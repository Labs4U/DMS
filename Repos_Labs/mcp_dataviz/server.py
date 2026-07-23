"""
MCP Data Visualization Formatting Server
=========================================
AgentCore Gateway / Lambda-hosted MCP endpoint.

This server exposes formatting tools that an LLM agent can call to transform
raw DynamoDB JSON payloads into Recharts-compatible data structures.

Transport: stdio (AgentCore wraps this Lambda in a subprocess and communicates
over stdin/stdout, which is the standard MCP stdio transport pattern).
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from typing import Any

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

# ── MCP Server ────────────────────────────────────────────────────────────────

server = Server("dataviz-formatting-server")


# ── Tool: list_tools ──────────────────────────────────────────────────────────

@server.list_tools()
async def list_tools() -> list[Tool]:
    """Advertise the tools this server exposes to the AgentCore Gateway."""
    return [
        Tool(
            name="format_bar_chart",
            description=(
                "Accepts a raw DynamoDB JSON string (either a GetItem response or a "
                "list of items from a Query/Scan) and returns a JSON array formatted "
                "for direct use as Recharts <BarChart> data. "
                "Each element in the output has the shape: "
                '{"name": "<monthYear>", "kWh": <kwhUsage>, "cost": <statementAmount>}.'
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "raw_dynamodb_json": {
                        "type": "string",
                        "description": (
                            "The raw JSON string as returned by DynamoDB — either a "
                            "single item dict or a list of item dicts. Each item must "
                            "contain at minimum the keys 'monthYear' and 'kwhUsage'. "
                            "The optional key 'statementAmount' is mapped to 'cost'."
                        ),
                    }
                },
                "required": ["raw_dynamodb_json"],
            },
        ),
        Tool(
            name="summarise_usage",
            description=(
                "Accepts the same raw DynamoDB JSON string and returns a plain-text "
                "summary of the user's energy usage: total kWh, average monthly kWh, "
                "highest and lowest consumption months, and total spend."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "raw_dynamodb_json": {
                        "type": "string",
                        "description": "Same format as format_bar_chart.",
                    }
                },
                "required": ["raw_dynamodb_json"],
            },
        ),
    ]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_items(raw_dynamodb_json: str) -> list[dict[str, Any]]:
    """
    Parse the raw JSON string into a normalised list of item dicts.

    Handles three input shapes:
      1. A plain list of items:        [{"monthYear": "2025-08", ...}, ...]
      2. A DynamoDB Query response:    {"Items": [...], "Count": 12}
      3. A single DynamoDB item dict:  {"monthYear": "2025-08", ...}
    """
    data = json.loads(raw_dynamodb_json)

    if isinstance(data, list):
        return data

    if isinstance(data, dict):
        # DynamoDB Query/Scan response envelope
        if "Items" in data:
            return data["Items"]
        # Single item — wrap in list
        return [data]

    raise ValueError(
        f"Unexpected top-level JSON type: {type(data).__name__}. "
        "Expected a list of items or a DynamoDB response object."
    )


def _extract_value(field: Any) -> Any:
    """
    Unwrap a DynamoDB typed value if present.

    DynamoDB low-level API returns values as {"S": "..."} or {"N": "123"}.
    The Amplify AppSync client and boto3 resource API return plain values.
    This helper handles both.
    """
    if not isinstance(field, dict):
        return field
    # DynamoDB type descriptors
    if "S" in field:
        return field["S"]
    if "N" in field:
        # N is always a string in the wire format
        return float(field["N"])
    if "BOOL" in field:
        return field["BOOL"]
    if "NULL" in field:
        return None
    return field  # Unknown shape — return as-is


# ── Tool implementations ──────────────────────────────────────────────────────

@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """Route tool calls to their implementations."""

    if name == "format_bar_chart":
        return await _format_bar_chart(arguments)
    if name == "summarise_usage":
        return await _summarise_usage(arguments)

    return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def _format_bar_chart(arguments: dict[str, Any]) -> list[TextContent]:
    """
    Transform raw DynamoDB records into a Recharts-compatible JSON array.

    Output schema per element:
        {
            "name":  string   — the monthYear value (e.g. "2025-08"),
            "kWh":   number   — kwhUsage rounded to 2 dp,
            "cost":  number   — statementAmount rounded to 2 dp (0.0 if absent)
        }

    Records are sorted ascending by "name" so the Recharts X-axis renders
    the timeline left-to-right chronologically.
    """
    raw = arguments.get("raw_dynamodb_json", "")

    try:
        items = _parse_items(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("format_bar_chart: malformed input — %s", exc)
        return [TextContent(type="text", text=f"Error: malformed input JSON — {exc}")]

    chart_data: list[dict[str, Any]] = []

    for item in items:
        try:
            month_year = _extract_value(item.get("monthYear") or item.get("month_year"))
            kwh_raw = _extract_value(item.get("kwhUsage") or item.get("kwh_usage"))
            cost_raw = _extract_value(
                item.get("statementAmount") or item.get("statement_amount")
            )

            if month_year is None or kwh_raw is None:
                logger.warning(
                    "format_bar_chart: skipping item missing required fields — %s", item
                )
                continue

            chart_data.append(
                {
                    "name": str(month_year),
                    "kWh": round(float(kwh_raw), 2),
                    "cost": round(float(cost_raw), 2) if cost_raw is not None else 0.0,
                }
            )
        except (TypeError, ValueError) as exc:
            logger.warning("format_bar_chart: skipping malformed item %s — %s", item, exc)
            continue

    # Sort ascending by monthYear string (YYYY-MM lexicographic order is correct)
    chart_data.sort(key=lambda x: x["name"])

    if not chart_data:
        return [TextContent(
            type="text",
            text=(
                "Error: no valid records could be extracted from the provided data. "
                "Ensure each item contains 'monthYear' and 'kwhUsage' fields."
            ),
        )]

    return [TextContent(type="text", text=json.dumps(chart_data, indent=2))]


async def _summarise_usage(arguments: dict[str, Any]) -> list[TextContent]:
    """
    Return a plain-text energy usage summary for the LLM to include in its response.
    """
    raw = arguments.get("raw_dynamodb_json", "")

    try:
        items = _parse_items(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("summarise_usage: malformed input — %s", exc)
        return [TextContent(type="text", text=f"Error: malformed input JSON — {exc}")]

    records: list[dict[str, Any]] = []

    for item in items:
        try:
            month_year = _extract_value(item.get("monthYear") or item.get("month_year"))
            kwh_raw = _extract_value(item.get("kwhUsage") or item.get("kwh_usage"))
            cost_raw = _extract_value(
                item.get("statementAmount") or item.get("statement_amount")
            )
            if month_year is None or kwh_raw is None:
                continue
            records.append(
                {
                    "month": str(month_year),
                    "kwh": float(kwh_raw),
                    "cost": float(cost_raw) if cost_raw is not None else 0.0,
                }
            )
        except (TypeError, ValueError):
            continue

    if not records:
        return [TextContent(
            type="text",
            text="Error: no valid records found to summarise.",
        )]

    records.sort(key=lambda x: x["month"])

    total_kwh = sum(r["kwh"] for r in records)
    total_cost = sum(r["cost"] for r in records)
    avg_kwh = total_kwh / len(records)
    peak = max(records, key=lambda x: x["kwh"])
    lowest = min(records, key=lambda x: x["kwh"])

    summary = (
        f"Energy usage summary across {len(records)} month(s):\n"
        f"  • Total consumption : {total_kwh:,.2f} kWh\n"
        f"  • Monthly average   : {avg_kwh:,.2f} kWh\n"
        f"  • Peak month        : {peak['month']} ({peak['kwh']:,.2f} kWh)\n"
        f"  • Lowest month      : {lowest['month']} ({lowest['kwh']:,.2f} kWh)\n"
        f"  • Total spend       : ${total_cost:,.2f}\n"
    )

    return [TextContent(type="text", text=summary)]


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

    AgentCore invokes this function and communicates with the MCP server via
    the stdio transport. The handler runs the async MCP server event loop
    synchronously within the Lambda execution context.

    For AgentCore Gateway deployments, the Gateway manages the subprocess
    lifecycle and pipes stdio. This handler bootstraps that runtime.

    Note: If deploying behind API Gateway (HTTP mode) rather than AgentCore
    stdio mode, swap `run_stdio()` for an HTTP/SSE transport and handle the
    event body as an MCP JSON-RPC request directly.
    """
    logger.info("Lambda invoked — starting MCP stdio server")
    logger.info("Event: %s", json.dumps(event))

    try:
        asyncio.run(run_stdio())
        return {"statusCode": 200, "body": "MCP server completed successfully"}
    except Exception as exc:
        logger.error("MCP server error: %s", exc, exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(exc)}),
        }


# ── CLI entrypoint (local development / testing) ──────────────────────────────

if __name__ == "__main__":
    """
    Run locally with:
        python server.py

    Test with the MCP Inspector:
        npx @modelcontextprotocol/inspector python server.py
    """
    asyncio.run(run_stdio())
