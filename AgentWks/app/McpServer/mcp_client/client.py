import os
import logging
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp.mcp_client import MCPClient

logger = logging.getLogger(__name__)

# Replaced the ExaAI example with your local elecMcpServer endpoint
LOCAL_MCP_ENDPOINT = os.environ.get("MCP_SERVER_URL", "http://127.0.0.1:8000/mcp")

def get_streamable_http_mcp_client() -> MCPClient:
    """Returns an MCP Client compatible with Strands"""
    return MCPClient(lambda: streamablehttp_client(LOCAL_MCP_ENDPOINT))