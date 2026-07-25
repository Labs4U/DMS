import { defineFunction } from '@aws-amplify/backend'

export const lamdafnDms = defineFunction({
  name: 'lamdafn_dms',
  entry: './handler.ts',
  environment: {
    // Replace with your Bedrock KB & Data Source IDs after creating the KB
    KNOWLEDGE_BASE_ID: 'YOUR_BEDROCK_KB_ID',
    DATA_SOURCE_ID: 'YOUR_BEDROCK_DATA_SOURCE_ID',
  },
})