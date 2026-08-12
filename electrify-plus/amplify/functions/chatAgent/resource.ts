import { defineFunction } from '@aws-amplify/backend';

export const chatAgent = defineFunction({
  name: 'chatAgent',
  entry: './handler.ts',
  timeoutSeconds: 900,
  resourceGroupName: 'data',
  environment: {
    AGENT_RUNTIME_ARN: 'arn:aws:bedrock-agentcore:us-east-1:559846026818:runtime/AgentWks_McpServer-KsKAQnGnqi',
  },
});
