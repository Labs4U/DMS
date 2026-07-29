# Bugfix Requirements Document

## Introduction

AWS Amplify Gen 2 (`npx ampx sandbox`) generates a new DynamoDB table name on every sandbox creation, following the pattern `ConsumptionRecord-<hash>-<env>`. Across the project, multiple components have the table name burned in as a hardcoded string literal. When the sandbox is recreated — which happens routinely during development — every hardcoded reference instantly becomes stale, causing `ResourceNotFoundException` errors and bringing down every consumer of the table: the local seeding script, the cloud MCP servers, and the AgentCore deployment config.

The fix has two distinct surface areas:

- **Local scripts** (`mockupData.py`): should resolve the active table name at runtime by parsing `amplify_outputs.json`, which Amplify regenerates on every sandbox creation.
- **Cloud/Lambda resources** (`electrifySwarm/Labs/mcp_electrify/server.py`, `Repos_Labs/mcp_electrify/server.py`, `Labs/mcp_electrify/electrifyMCPserver/server.py`, and `electrifySwarm/agentcore/agentcore.json`): should receive the table name exclusively through an environment variable injected by the Amplify resource-linking mechanism, never from a local file or a hardcoded fallback.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `npx ampx sandbox` creates a new sandbox environment THEN the system assigns a new unique hash to the DynamoDB table name (e.g., `ConsumptionRecord-<new-hash>-NONE`), invalidating all previously hardcoded references.

1.2 WHEN `mockupData.py` is executed after sandbox recreation THEN the system throws `ResourceNotFoundException` because `TABLE_NAME` is a hardcoded string literal (`ConsumptionRecord-2ql236iyard5fmfu73m24wsl5q-NONE`) that no longer matches any existing table.

1.3 WHEN the `electrifySwarm/Labs/mcp_electrify/server.py` MCP server handles a `get_historical_usage` tool call after sandbox recreation THEN the system throws `ResourceNotFoundException` because `TABLE_NAME` falls back to the hardcoded string `ConsumptionRecord-2ql236iyard5fmfu73m24wsl5q-NONE`.

1.4 WHEN the `Repos_Labs/mcp_electrify/server.py` MCP server handles a `get_customer_bills` tool call after sandbox recreation THEN the system throws `ResourceNotFoundException` because `TABLE_NAME` is assigned directly as the hardcoded string `ConsumptionRecord-2ql236iyard5fmfu73m24wsl5q-NONE` with no environment variable override path.

1.5 WHEN the `Labs/mcp_electrify/electrifyMCPserver/server.py` MCP server handles a `get_customer_bills` tool call after sandbox recreation THEN the system throws `ResourceNotFoundException` because the `DYNAMODB_TABLE_NAME` environment variable falls back to the hardcoded string `ConsumptionRecord-2ql236iyard5fmfu73m24wsl5q-NONE`.

1.6 WHEN the `electrifySwarm/agentcore/agentcore.json` deployment config is used after sandbox recreation THEN the system deploys the AgentCore runtime with a stale hardcoded `TABLE_NAME` environment variable value and a stale hardcoded IAM resource ARN, both containing `ConsumptionRecord-2ql236iyard5fmfu73m24wsl5q-NONE`.

### Expected Behavior (Correct)

2.1 WHEN `npx ampx sandbox` creates a new sandbox environment THEN the system regenerates `amplify_outputs.json` at the project root with the current active table name embedded in the data model metadata.

2.2 WHEN `mockupData.py` is executed after sandbox recreation THEN the system SHALL dynamically read `amplify_outputs.json` from the project root, extract the active DynamoDB table name from the data model metadata, and use that resolved name to connect to DynamoDB — succeeding without any hardcoded string or manual `.env` update.

2.3 WHEN `mockupData.py` is executed and `amplify_outputs.json` is absent or the table name cannot be extracted THEN the system SHALL log a clear, actionable error message instructing the developer to run `npx ampx sandbox` and exit without attempting any DynamoDB operations.

2.4 WHEN the cloud MCP servers (`electrifySwarm/Labs/mcp_electrify/server.py`, `Labs/mcp_electrify/electrifyMCPserver/server.py`) handle a tool call THEN the system SHALL read the table name strictly from a runtime environment variable (e.g., `CONSUMPTION_RECORD_TABLE_NAME` or `DYNAMODB_TABLE_NAME`) and SHALL NOT fall back to any hardcoded string.

2.5 WHEN `amplify/backend.ts` links the `ConsumptionRecord` table resource to Lambda functions THEN the system SHALL use Amplify's native resource-linking API so the active table name is automatically injected as an environment variable into the Lambda execution environment on every sandbox or deployment.

2.6 WHEN the `electrifySwarm/agentcore/agentcore.json` deployment config is updated THEN the system SHALL reference the table name through a resolvable configuration mechanism (parameterised value or post-deploy script) rather than a literal hash-based string, so re-deploying after sandbox recreation does not require manual JSON edits.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `mockupData.py` is executed with a valid `amplify_outputs.json` present and all other inputs (valid `CUSTOMER_ID`, positive month counts) are correct THEN the system SHALL CONTINUE TO generate and insert 12 months of mock `ConsumptionRecord` items into DynamoDB, producing the same item structure as before the fix.

3.2 WHEN a cloud MCP server receives a `get_customer_bills` or `get_historical_usage` tool call with a valid `customerId` and the `CONSUMPTION_RECORD_TABLE_NAME` (or `DYNAMODB_TABLE_NAME`) environment variable is correctly set THEN the system SHALL CONTINUE TO query the DynamoDB GSI (`consumptionRecordsByCustomerIdAndMonthYear`) and return the JSON-serialised records in the same format as before the fix.

3.3 WHEN the `amplify/data/resource.ts` schema is reviewed after the backend-linking change THEN the system SHALL CONTINUE TO define `ConsumptionRecord` with the same fields, secondary index, and `ownerDefinedIn('customerId')` authorization rule — no schema changes are required by this fix.

3.4 WHEN the AgentCore supervisor (`electrifySwarm/Labs/swarm_supervisor/app_core.py`) handles a user request THEN the system SHALL CONTINUE TO read all its configuration exclusively from environment variables (`ELECTRIFY_MCP_URL`, `DATAVIZ_MCP_URL`, `AWS_REGION`, `BEDROCK_MODEL_ID`) without any change to its behavior.

3.5 WHEN `Labs/mcp_electrify/electrifyMCPserver/server.py` is deployed to AgentCore with a correctly populated `DYNAMODB_TABLE_NAME` environment variable THEN the system SHALL CONTINUE TO serve `get_customer_bills` and `get_billing_chart` tool calls using the same FastMCP transport and response format as before the fix.
