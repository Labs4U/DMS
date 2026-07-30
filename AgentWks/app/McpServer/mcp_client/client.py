import os
import httpx
import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from datetime import datetime, timezone
from typing import Generator
from strands.tools.mcp.mcp_client import MCPClient
from mcp.client.streamable_http import streamablehttp_client

# 1. AWS SigV4 Authentication Class
class SigV4HttpxAuth(httpx.Auth):
    def __init__(self, region: str, service: str) -> None:
        self._region = region
        self._service = service

    def auth_flow(self, request: httpx.Request) -> Generator[httpx.Request, httpx.Response, None]:
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
        
        for key, value in aws_request.headers.items():
            request.headers[key] = value
            
        yield request

def get_streamable_http_mcp_client():
    # 🛑 THE FIX: Updated to your newly deployed sandbox MCP Server ARN
    AGENT_ARN = "arn:aws:bedrock-agentcore:us-east-1:559846026818:runtime/AgentWks_elecMcpServer-ha471HFJzt"
    encoded_arn = AGENT_ARN.replace(":", "%3A").replace("/", "%2F")
    mcp_url = f"https://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/{encoded_arn}/invocations?qualifier=DEFAULT"

    # Initialize our AWS Auth flow
    auth = SigV4HttpxAuth("us-east-1", "bedrock-agentcore")

    # 2. Correct syntax: Pass the auth and timeout parameters directly 
    # into the streamablehttp_client factory
    return MCPClient(
        lambda: streamablehttp_client(
            mcp_url,
            auth=auth,
            timeout=60.0
        )
    )