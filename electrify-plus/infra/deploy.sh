#!/bin/bash
# Deploy the AgentCore proxy API Gateway stack.
# Run from any directory — script resolves its own location.
#
# Usage:
#   ./infra/deploy.sh                          # deploy with defaults
#   ./infra/deploy.sh "https://myapp.com"      # add a production origin

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_NAME="agentcore-proxy"
REGION="us-east-1"
TEMPLATE="$SCRIPT_DIR/agentcore-proxy.yaml"

# Optional: pass a production origin as $1
EXTRA_ORIGIN="${1:-}"
ORIGINS="http://localhost:5173,http://localhost:3000"
if [[ -n "$EXTRA_ORIGIN" ]]; then
  ORIGINS="$ORIGINS,$EXTRA_ORIGIN"
fi

echo "▶ Deploying stack: $STACK_NAME"
echo "  Template : $TEMPLATE"
echo "  Region   : $REGION"
echo "  Origins  : $ORIGINS"
echo ""

aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$TEMPLATE" \
  --region "$REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    AllowedOrigins="$ORIGINS" \
  --no-fail-on-empty-changeset

echo ""
echo "✅ Stack deployed. Fetching endpoint URL..."
echo ""

API_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue" \
  --output text)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  API Gateway URL:"
echo "  $API_URL"
echo ""
echo "  Add this to electrify-plus/.env:"
echo "  VITE_AGENT_GATEWAY_URL=$API_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
