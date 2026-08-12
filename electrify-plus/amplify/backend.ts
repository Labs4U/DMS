import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { chatAgent } from './functions/chatAgent/resource';
import * as iam from 'aws-cdk-lib/aws-iam';

export const backend = defineBackend({
  auth,
  data,
  chatAgent,
});

// Grant the chatAgent Lambda permission to invoke the AgentCore runtime
backend.chatAgent.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'bedrock-agentcore:InvokeAgentRuntime',
      'bedrock-agentcore:InvokeAgentRuntimeForUser',
    ],
    resources: ['*'],
  })
);
