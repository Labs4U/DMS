"""
Electrify! Plus — Supervisor Agent
====================================
Amazon Bedrock AgentCore entrypoint.

Architecture:
  React frontend
      │  HTTP (streaming SSE)
      ▼
  AgentCore Gateway
      │  invokes
      ▼
  This Supervisor Agent  (Strands SDK + Claude on Bedrock)
      │  MCP tool calls over HTTP/SSE
      ├──▶ Electrify MCP server   (data fetch from DynamoDB)
      └──▶ DataViz MCP server     (Recharts JSON formatting)

Environment variables required at runtime:
  ELECTRIFY_MCP_URL   — AgentCore Gateway URL for the Electrify data MCP server
  DATAVIZ_MCP_URL     — AgentCore Gateway URL for the DataViz formatting MCP server
  AWS_REGION          — AWS region (default: us-east-1)
  BEDROCK_MODEL_ID    — Bedrock model ID (default: us.anthropic.claude-3-5-sonnet-20241022-v2:0)
"""

from __future__ import annotations

import logging
import os
from contextlib import AsyncExitStack
from typing import Any, AsyncGenerator

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.models import BedrockModel
from strands_tools.mcp import MCPClient

# ── Logging ───────────────────────────────────────────────────────────────────

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# ── Configuration from environment ───────────────────────────────────────────

ELECTRIFY_MCP_URL: str = os.environ.get(
    "ELECTRIFY_MCP_URL",
    "https://PLACEHOLDER.execute-api.us-east-1.amazonaws.com/electrify-mcp",
)
DATAVIZ_MCP_URL: str = os.environ.get(
    "DATAVIZ_MCP_URL",
    "https://PLACEHOLDER.execute-api.us-east-1.amazonaws.com/dataviz-mcp",
)
AWS_REGION: str = os.environ.get("AWS_REGION", "us-east-1")
BEDROCK_MODEL_ID: str = os.environ.get(
    "BEDROCK_MODEL_ID",
    "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
)

# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are the Electrify! Plus AI Assistant. You help users understand their energy bills.

If they ask about usage or costs, use the Electrify MCP tool to fetch data.

If they explicitly ask for a chart or graph, fetch the data FIRST, then pass it \
to the DataViz MCP tool to format it as a JSON array, and return ONLY the JSON \
array to the user.

Be concise."""

# ── AgentCore app ─────────────────────────────────────────────────────────────

app = BedrockAgentCoreApp()

# ── AgentCore entrypoint ──────────────────────────────────────────────────────


@app.entrypoint
async def run(payload: dict[str, Any]) -> AsyncGenerator[str, None]:
    """
    AgentCore Gateway entrypoint — handles one turn of the conversation.

    Expected payload fields:
        prompt      (str, required) — the user's message
        customer_id (str, required) — the user's Cognito sub UUID; passed to
                                      the Electrify MCP tool so it queries the
                                      correct DynamoDB partition
        session_id  (str, optional) — conversation session identifier for
                                      multi-turn memory (future use)

    Yields streaming text chunks back to the AgentCore Gateway, which forwards
    them as SSE to the React frontend.
    """
    prompt: str = payload.get("prompt", "")
    customer_id: str = payload.get("customer_id", "")
    session_id: str = payload.get("session_id", "")

    if not prompt:
        yield "Error: no prompt provided in payload."
        return

    if not customer_id:
        yield "Error: customer_id is required so I can look up your energy records."
        return

    logger.info(
        "Entrypoint invoked — session=%s customer=%s prompt=%.80s",
        session_id,
        customer_id,
        prompt,
    )

    # ── Build enriched prompt ─────────────────────────────────────────────────
    # Inject the customer_id into the prompt context so the Electrify MCP tool
    # receives it as part of the conversation. The tool is expected to accept
    # customer_id as a parameter when querying DynamoDB.
    enriched_prompt = (
        f"[Context: customer_id={customer_id}]\n\n{prompt}"
        if customer_id
        else prompt
    )

    # ── Connect to remote MCP servers ─────────────────────────────────────────
    # Both MCP servers are hosted on AgentCore Gateway endpoints and speak the
    # MCP HTTP/SSE transport. MCPClient manages the connection lifecycle.
    async with AsyncExitStack() as stack:
        electrify_client = await stack.enter_async_context(
            MCPClient(
                transport="http",
                url=ELECTRIFY_MCP_URL,
                headers={"X-Customer-Id": customer_id},
            )
        )
        dataviz_client = await stack.enter_async_context(
            MCPClient(
                transport="http",
                url=DATAVIZ_MCP_URL,
            )
        )

        # Collect tools advertised by both MCP servers
        electrify_tools = await electrify_client.list_tools()
        dataviz_tools = await dataviz_client.list_tools()
        all_tools = [*electrify_tools, *dataviz_tools]

        logger.info(
            "Connected — electrify_tools=%d dataviz_tools=%d",
            len(electrify_tools),
            len(dataviz_tools),
        )

        # ── Initialise the Strands agent for this request ─────────────────────
        # A new Agent instance is created per request so session state is clean.
        # For multi-turn conversations, pass a shared memory/session store here.
        model = BedrockModel(
            model_id=BEDROCK_MODEL_ID,
            region_name=AWS_REGION,
        )

        agent = Agent(
            model=model,
            system_prompt=SYSTEM_PROMPT,
            tools=all_tools,
        )

        # ── Stream the response ───────────────────────────────────────────────
        # agent.stream_async yields AgentEvent objects; we extract and yield
        # the text delta from each chunk so the frontend receives a token stream.
        try:
            async for event in agent.stream_async(enriched_prompt):
                # Strands stream events carry a `data` attribute with the text
                # delta when the event type is a content chunk.
                chunk = _extract_text_chunk(event)
                if chunk:
                    yield chunk
        except Exception as exc:
            logger.error("Agent stream error: %s", exc, exc_info=True)
            yield f"\n\n[Error: {exc}]"


# ── Helpers ───────────────────────────────────────────────────────────────────


def _extract_text_chunk(event: Any) -> str:
    """
    Extract a plain-text delta string from a Strands stream event.

    Strands AgentEvent shapes (as of strands-agents 1.x):
      - ContentBlockDelta  → event.delta.text  (the streaming token)
      - text field         → event.text        (some event types)
      - data field         → str(event.data)   (fallback)

    Returns an empty string for non-text events (tool calls, metadata, etc.)
    so the caller can skip them cleanly.
    """
    # ContentBlockDelta (most common streaming event)
    if hasattr(event, "delta") and hasattr(event.delta, "text"):
        return event.delta.text or ""

    # Some Strands versions surface text directly
    if hasattr(event, "text") and isinstance(event.text, str):
        return event.text

    # Generic data field fallback
    if hasattr(event, "data") and isinstance(event.data, str):
        return event.data

    return ""


# ── CLI entrypoint (local testing) ────────────────────────────────────────────

if __name__ == "__main__":
    """
    Run locally with:
        python app_core.py

    The AgentCore runtime will start a local HTTP server for testing.
    Set ELECTRIFY_MCP_URL and DATAVIZ_MCP_URL to point at locally running
    MCP servers (or use the MCP Inspector to mock them).

    Example:
        ELECTRIFY_MCP_URL=http://localhost:8001 \\
        DATAVIZ_MCP_URL=http://localhost:8002 \\
        python app_core.py
    """
    app.run()
