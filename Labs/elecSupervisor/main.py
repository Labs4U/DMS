"""
Electrify! Plus — Unified Supervisor Agent
==========================================
Amazon Bedrock AgentCore entrypoint.

Architecture:
  React frontend
    │ HTTP (streaming SSE)
    ▼
  AgentCore Runtime (MicroVM)
    │
  This Unified Agent (Strands SDK + Claude on Bedrock)
    ├──▶ Native Python Tool (boto3 fetch from DynamoDB)
"""

from __future__ import annotations

import logging
import os
import json
from decimal import Decimal
from typing import Any, AsyncGenerator

import boto3
from boto3.dynamodb.conditions import Key
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent, tool
# from strands.models import BedrockModel
from strands.models import OllamaModel
# ── Logging ───────────────────────────────────────────────────────────────────
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# ── Configuration ─────────────────────────────────────────────────────────────
AWS_REGION: str = os.environ.get("AWS_REGION", "us-east-1")
BEDROCK_MODEL_ID: str = os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-3-5-haiku-20241022-v1:0")
TABLE_NAME = "ConsumptionRecord-i6dt7ha4gvc6ph22qnhi2qopua-NONE"
GSI_NAME = "consumptionRecordsByCustomerIdAndMonthYear" # Replace with your exact AWS Index name

# ── DynamoDB Resource ─────────────────────────────────────────────────────────
_dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
_table = _dynamodb.Table(TABLE_NAME)

# ── Native Agent Tools ────────────────────────────────────────────────────────

@tool
def get_customer_bills(customerId: str, limit: int = 10) -> str:
    """Fetch energy bill records for a customer from DynamoDB."""
    customerId = customerId.strip()
    if not customerId:
        return json.dumps({"error": "customerId is required."})

    try:
        response = _table.query(
            IndexName=GSI_NAME,
            KeyConditionExpression=Key("customerId").eq(customerId),
            ScanIndexForward=False, 
            Limit=limit,
        )
        items = response.get("Items", [])
        if not items:
            return json.dumps({"message": f"No records found for customerId: {customerId}."})
        
        # Serialize Decimals for JSON
        def serialize(val):
            if isinstance(val, dict): return {k: serialize(v) for k, v in val.items()}
            if isinstance(val, list): return [serialize(v) for v in val]
            if isinstance(val, Decimal): return int(val) if val == val.to_integral_value() else float(val)
            return val
            
        return json.dumps({"items": [serialize(i) for i in items]}, indent=2)
    except Exception as exc:
        return json.dumps({"error": f"DynamoDB query failed: {exc}"})

# ── System Prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are the Electrify! Plus AI Energy Assistant. 
You help users understand their energy bills.
When asked about usage or costs, ALWAYS use the get_customer_bills tool to fetch their data.
Be concise, helpful, and format data in easy-to-read markdown tables if comparing multiple months."""

# ── AgentCore App ─────────────────────────────────────────────────────────────
app = BedrockAgentCoreApp()

@app.entrypoint
async def run(payload: dict[str, Any]) -> AsyncGenerator[str, None]:
    prompt: str = payload.get("prompt", "")
    customer_id: str = payload.get("customer_id", "")
    
    if not prompt:
        yield "Error: no prompt provided."
        return
    if not customer_id:
        yield "Error: I need your customer ID to look up your records."
        return

    # Force the LLM to know who it is talking to
    enriched_prompt = f"[System Alert: The current user's customerId is {customer_id}]\n\nUser: {prompt}"

    model = BedrockModel(model_id=BEDROCK_MODEL_ID, region_name=AWS_REGION)
    
    # We pass the native python function directly into the tools array
    agent = Agent(
        model = OllamaModel(model_id="llama3"),
        system_prompt=SYSTEM_PROMPT,
        tools=[get_customer_bills], 
    )

    try:
        async for event in agent.stream_async(enriched_prompt):
            if hasattr(event, "delta") and hasattr(event.delta, "text"):
                yield event.delta.text or ""
            elif hasattr(event, "text") and isinstance(event.text, str):
                yield event.text
    except Exception as exc:
        logger.error("Agent stream error: %s", exc)
        yield f"\n\n[System Error: {exc}]"

if __name__ == "__main__":
    app.run()