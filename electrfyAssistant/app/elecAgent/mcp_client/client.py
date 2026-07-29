import os
import boto3
import httpx
from datetime import datetime, timezone
from typing import Generator
from strands.tools.mcp.mcp_client import MCPClient
from mcp.client.streamable_http import streamablehttp_client


# ── SigV4 auth ────────────────────────────────────────────────────────────────
# AgentCore runtime invocations require AWS SigV4 on every request, including
# every MCP JSON-RPC call. We inject a custom httpx.Auth so the MCP SDK's
# underlying httpx client signs transparently before each request is sent.
class SigV4HttpxAuth(httpx.Auth):
    def __init__(self, region: str, service: str) -> None:
        self._region = region
        self._service = service

    def auth_flow(self, request: httpx.Request) -> Generator[httpx.Request, httpx.Response, None]:
        # Re-fetch credentials on every call so short-lived STS tokens stay fresh.
        from botocore.auth import SigV4Auth
        from botocore.awsrequest import AWSRequest

        session = boto3.Session()
        creds = session.get_credentials().get_frozen_credentials()

        aws_request = AWSRequest(
            method=request.method,
            url=str(request.url),
            data=request.content,
            headers={
                "Content-Type": request.headers.get("Content-Type", "application/json"),
                "X-Amz-Date": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
            },
        )
        SigV4Auth(creds, self._service, self._region).add_auth(aws_request)

        # Copy all headers botocore produced (Authorization, X-Amz-Date, etc.)
        # back onto the httpx request.
        for key, value in aws_request.headers.items():
            request.headers[key] = value

        yield request


# ── MCP client factory ────────────────────────────────────────────────────────
def get_streamable_http_mcp_client():
    AGENT_ARN = "arn:aws:bedrock-agentcore:us-east-1:559846026818:runtime/electrifyMCPserver_Agent1-z6XBLwEBS7"
    REGION = "us-east-1"
    SERVICE = "bedrock-agentcore"

    encoded_arn = AGENT_ARN.replace(":", "%3A").replace("/", "%2F")
    mcp_url = (
        f"https://bedrock-agentcore.{REGION}.amazonaws.com"
        f"/runtimes/{encoded_arn}/invocations?qualifier=DEFAULT"
    )

    auth = SigV4HttpxAuth(REGION, SERVICE)

    # IMPORTANT: auth must be attached to the httpx.AsyncClient and passed as
    # http_client= to streamablehttp_client. Passing auth= directly to
    # streamablehttp_client is silently ignored by the MCP SDK, which causes
    # every request to go unsigned → 403 → 30s connection timeout.
    http_client = httpx.AsyncClient(auth=auth, timeout=60.0)

    return MCPClient(
        lambda: streamablehttp_client(
            mcp_url,
            http_client=http_client,
            terminate_on_close=False,
        )
    )
