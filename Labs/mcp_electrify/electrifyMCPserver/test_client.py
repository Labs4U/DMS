"""
Test client for the deployed AgentCore MCP server.

Usage:
    # List tools only (confirms server healthy + shows registered tools)
    uv run python test_client.py

    # Call get_customer_bills with a real customerId
    uv run python test_client.py <customerId>

How auth works:
    AgentCore requires AWS SigV4 on every request — including every MCP
    JSON-RPC call. The signature covers the request body hash, so it must be
    recomputed per-request. We inject a custom httpx.Auth subclass into the
    MCP SDK's underlying httpx client so every outbound request is signed
    transparently before it leaves the process.
"""
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
from typing import Generator

import boto3
import httpx
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

# ── Config ────────────────────────────────────────────────────────────────────
AGENT_ARN = "arn:aws:bedrock-agentcore:us-east-1:559846026818:runtime/electrifyMCPserver_Agent1-z6XBLwEBS7"
REGION    = "us-east-1"
SERVICE   = "bedrock-agentcore"

encoded_arn = AGENT_ARN.replace(":", "%3A").replace("/", "%2F")
MCP_URL = (
    f"https://bedrock-agentcore.{REGION}.amazonaws.com"
    f"/runtimes/{encoded_arn}/invocations?qualifier=DEFAULT"
)


class SigV4HttpxAuth(httpx.Auth):
    """
    httpx.Auth implementation that signs every request with AWS SigV4.

    httpx calls auth_flow(request) before sending — we re-sign the actual
    request object (with its real body) so the body hash in the signature
    is always correct.
    """

    def __init__(self, region: str, service: str) -> None:
        self._region  = region
        self._service = service

    def auth_flow(self, request: httpx.Request) -> Generator[httpx.Request, httpx.Response, None]:
        # Re-fetch credentials each call so short-lived tokens stay fresh.
        session = boto3.Session()
        creds   = session.get_credentials().get_frozen_credentials()

        body = request.content  # bytes — already serialised by httpx

        # Build a botocore AWSRequest to drive SigV4Auth
        aws_request = AWSRequest(
            method  = request.method,
            url     = str(request.url),
            data    = body,
            headers = {
                "Content-Type": request.headers.get("Content-Type", "application/json"),
                "X-Amz-Date":   datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
            },
        )

        SigV4Auth(creds, self._service, self._region).add_auth(aws_request)

        # Copy every header botocore produced back onto the httpx request
        for key, value in aws_request.headers.items():
            request.headers[key] = value

        yield request  # httpx sends the request and gives us the response
        # (no response inspection needed here)


async def main() -> None:
    customer_id = sys.argv[1] if len(sys.argv) > 1 else None

    print(f"Endpoint: {MCP_URL}\n")

    # Inject the SigV4 auth into every httpx request the MCP SDK makes
    # Inject the SigV4 auth into every httpx request the MCP SDK makes
    auth        = SigV4HttpxAuth(REGION, SERVICE)
    # Increase the default timeout to 60 seconds to accommodate AWS cold starts
    http_client = httpx.AsyncClient(auth=auth, timeout=60.0)

    async with streamable_http_client(
        MCP_URL,
        http_client=http_client,
        terminate_on_close=False,
    ) as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as mcp_session:
            await mcp_session.initialize()
            print("✅  Connected and initialised\n")

            # ── List tools ────────────────────────────────────────────────
            tools_result = await mcp_session.list_tools()
            print("Available tools:")
            for tool in tools_result.tools:
                print(f"  • {tool.name}")
                print(f"    {tool.description}")
            print()

            # ── Call the tool ─────────────────────────────────────────────
            if customer_id:
                print(f"Calling get_customer_bills(customerId={customer_id!r}) ...")
                result = await mcp_session.call_tool(
                    "get_customer_bills",
                    arguments={"customerId": customer_id},
                )
                for content in result.content:
                    try:
                        parsed = json.loads(content.text)
                        print(json.dumps(parsed, indent=2))
                    except (json.JSONDecodeError, AttributeError):
                        print(content)
            else:
                print("Pass a customerId to call the tool:")
                print("  uv run python test_client.py <uuid>")


asyncio.run(main())
