import type { S3Handler } from 'aws-lambda'
import { BedrockAgentClient, StartIngestionJobCommand } from '@aws-sdk/client-bedrock-agent'

const bedrockClient = new BedrockAgentClient({
  region: process.env.AWS_REGION || 'us-east-1',
})

export const handler: S3Handler = async (event) => {
  const knowledgeBaseId = process.env.KNOWLEDGE_BASE_ID
  const dataSourceId = process.env.DATA_SOURCE_ID

  if (!knowledgeBaseId || !dataSourceId) {
    console.error('🛑 Missing KNOWLEDGE_BASE_ID or DATA_SOURCE_ID environment variables.')
    return
  }

  console.log(`S3 Event Received. Triggering Bedrock KB Sync for KB: ${knowledgeBaseId}`)

  try {
    const command = new StartIngestionJobCommand({
      knowledgeBaseId,
      dataSourceId,
    })

    const response = await bedrockClient.send(command)
    console.log(`✅ Bedrock Ingestion Job Started Successfully. Job ID: ${response.ingestionJob?.ingestionJobId}`)
  } catch (error) {
    console.error('🛑 Error starting Bedrock ingestion job:', error)
    throw error
  }
}