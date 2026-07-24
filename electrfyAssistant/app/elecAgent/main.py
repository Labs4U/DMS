from strands import Agent, tool
from strands.agent.conversation_manager.sliding_window_conversation_manager import (
    SlidingWindowConversationManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from model.load import load_model
from mcp_client.client import get_streamable_http_mcp_client
from memory.session import get_memory_session_manager

app = BedrockAgentCoreApp()
log = app.logger

# ── MCP tool client ───────────────────────────────────────────────────────────
mcp_clients = [get_streamable_http_mcp_client()]

# ── System prompt ─────────────────────────────────────────────────────────────
DEFAULT_SYSTEM_PROMPT = """
You are a helpful energy billing assistant for Electrify.
Use the provided tools to query customer energy consumption records and bills.

CRITICAL RULE 1: When summarizing bill history or presenting ANY data pulled from a database, you MUST format the data as a strict Markdown table. 
You MUST include proper line breaks (newlines) between the header, the separator, and every data row. Do NOT output the table on a single continuous line.
Example format:
| Billing Year/Month | kWh Usage | Total Statement Amount |
| :--- | :--- | :--- |
| [Year/Month] | [Usage] | [Amount] |

CRITICAL RULE 2: When the user asks for a chart, graph, or visual plot, use the chart tool and output the resulting ```chart JSON block EXACTLY as it is returned to you. Do not alter the JSON.
"""

# ── Tool registration ─────────────────────────────────────────────────────────
tools: list = []

for mcp_client in mcp_clients:
    if mcp_client:
        tools.append(mcp_client)


# ── Agent cache (one Agent instance per session so the sliding window persists) ──
def agent_factory():
    cache: dict = {}

    def get_or_create_agent(session_id: str, user_id: str) -> Agent:
        key = f"{session_id}/{user_id}"
        if key not in cache:
            cache[key] = Agent(
                model=load_model(),
                session_manager=get_memory_session_manager(session_id, user_id),
                # SlidingWindowConversationManager keeps the last `window_size` turns
                # in the LLM context window — this is what gives the agent memory
                # within a session without the frontend needing to replay history.
                conversation_manager=SlidingWindowConversationManager(window_size=40),
                system_prompt=DEFAULT_SYSTEM_PROMPT,
                tools=tools,
            )
            log.info(f"Created new agent for session={session_id} user={user_id}")
        return cache[key]

    return get_or_create_agent


get_or_create_agent = agent_factory()


# ── Payload extraction ────────────────────────────────────────────────────────
def _extract_prompt(payload: dict) -> str | list:
    """
    Extract the user prompt from the incoming payload.

    Supported formats:
      - { "prompt": "plain string" }          ← standard frontend format
      - { "messages": [...] }                  ← Bedrock messages array (harness/testing)
      - { "tool_results": [...] }              ← AgentCore harness tool-result continuation

    Returns a plain string for the first two cases so the agent receives a
    clean text prompt. Returns a list only for tool_results continuations.
    """
    # Harness tool-result continuation — pass through as-is
    if "tool_results" in payload:
        return [
            {
                "role": "user",
                "content": [
                    {
                        "toolResult": {
                            "toolUseId": tr["toolUseId"],
                            "status": tr.get("status", "success"),
                            "content": tr.get("content", []),
                        }
                    }
                ],
            }
            for tr in payload["tool_results"]
        ]

    # Bedrock messages array — extract the text from the last user message
    # rather than forwarding the full array. The sliding window manager owns
    # the in-context history; replaying the full frontend history causes
    # ValidationException (blank text, wrong role ordering, missing tool turns).
    if "messages" in payload:
        messages = payload["messages"]
        for msg in reversed(messages):
            if msg.get("role") == "user":
                content = msg.get("content", [])
                if isinstance(content, str):
                    return content.strip()
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict):
                            text = block.get("text", "").strip()
                            if text:
                                return text
        # Fallback: return the raw list and let Strands handle it
        return messages

    # Plain string prompt (standard frontend format)
    prompt = payload.get("prompt", "")
    return prompt.strip() if isinstance(prompt, str) else prompt


# ── Entrypoint ────────────────────────────────────────────────────────────────
@app.entrypoint
async def invoke(payload, context):
    log.info("Invoking Agent...")

    # session_id comes from the payload (sent by the frontend), not context.
    # context.session_id is the AgentCore transport-level session, which changes
    # on every cold start and cannot be used for user-level continuity.
    session_id = payload.get("sessionId") or getattr(context, "session_id", None) or "default-session"
    user_id = getattr(context, "user_id", None) or "default-user"

    agent = get_or_create_agent(session_id, user_id)
    prompt = _extract_prompt(payload)

    if not prompt:
        log.warning("Empty prompt received — skipping agent invocation")
        return

    log.info(f"session={session_id} user={user_id} prompt_type={type(prompt).__name__}")

    async for event in agent.stream_async(prompt):
        if not isinstance(event, dict) or "event" not in event:
            continue
        cbs = event["event"].get("contentBlockStart")
        if cbs is not None and not cbs.get("start"):
            continue
        yield event


if __name__ == "__main__":
    app.run()