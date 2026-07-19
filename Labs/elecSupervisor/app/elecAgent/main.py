"""
Electrify! Plus — Unified Supervisor Agent
==========================================
AgentCore entrypoint running locally via Ollama.
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
from strands.models import OllamaModel
from strands.models.openai import OpenAIModel

# ── Logging ───────────────────────────────────────────────────────────────────
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# ── Configuration ─────────────────────────────────────────────────────────────
AWS_REGION: str = os.environ.get("AWS_REGION", "us-east-1")
TABLE_NAME = "ConsumptionRecord-i6dt7ha4gvc6ph22qnhi2qopua-NONE"
GSI_NAME = "consumptionRecordsByCustomerIdAndMonthYear" 

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
    # Extract the chat message directly from the payload
    user_message = payload.get("prompt", "")
    
    if not user_message:
        user_message = payload.get("input", "")
        
    if not user_message:
        yield "Error: No input message provided."
        return

    # Initialize the local free model
    model = OpenAIModel(
        model_id="llama-3.1-8b-instant", 
        client_args={
            "api_key": "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",
            "base_url": "https://api.groq.com/openai/v1"
        }
    )
    
    agent = Agent(
        model=model,
        system_prompt=SYSTEM_PROMPT,
        tools=[get_customer_bills], 
    )

    try:
        async for event in agent.stream_async(user_message):
            if hasattr(event, "delta") and hasattr(event.delta, "text"):
                yield event.delta.text or ""
            elif hasattr(event, "text") and isinstance(event.text, str):
                yield event.text
    except Exception as exc:
        logger.error("Agent stream error: %s", exc)
        yield f"\n\n[System Error: {exc}]"

if __name__ == "__main__":
    app.run()