import type { AppSyncResolverHandler } from 'aws-lambda';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';

const agentClient = new BedrockAgentCoreClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

interface ChatAgentArguments {
  prompt: string;
  sessionId: string;
  customerId?: string;
}

/**
 * Parses raw AgentCore SSE wire format into clean text.
 *
 * AgentCore streams newline-delimited SSE events:
 *   data: {"event":{"contentBlockDelta":{"delta":{"text":"Hello"}}}}
 *   data: [DONE]
 */
function parseSseStream(raw: string): string {
  let text = '';
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const chunk = trimmed.slice(5).trim();
    if (!chunk || chunk === '[DONE]') continue;
    try {
      const parsed = JSON.parse(chunk);
      text += parsed?.event?.contentBlockDelta?.delta?.text ?? '';
    } catch {
      // unparseable chunk — skip
    }
  }
  // Strip internal reasoning blocks that must not reach the user
  return text.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '').trim();
}

export const handler: AppSyncResolverHandler<ChatAgentArguments, string> = async (event) => {
  const { prompt, sessionId, customerId } = event.arguments;

  const agentRuntimeArn = process.env.AGENT_RUNTIME_ARN ?? '';
  if (!agentRuntimeArn) {
    throw new Error('AGENT_RUNTIME_ARN environment variable is required.');
  }

  // AgentCore expects the body as a UTF-8 encoded JSON object
  const payload = new TextEncoder().encode(
    JSON.stringify({ prompt })
  );

  const command = new InvokeAgentRuntimeCommand({
    agentRuntimeArn,
    qualifier: 'DEFAULT',
    runtimeSessionId: sessionId,
    payload,
  });

  const agentResponse = await agentClient.send(command);

  if (!agentResponse.response) {
    return 'The agent returned an empty response.';
  }

  const rawSse = await agentResponse.response.transformToString('utf-8');
  const cleanText = parseSseStream(rawSse);
  return cleanText || 'The agent returned an empty response.';
};
