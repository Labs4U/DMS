import { defineBackend } from '@aws-amplify/backend'
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam'
import { EventType } from 'aws-cdk-lib/aws-s3'
import { LambdaDestination } from 'aws-cdk-lib/aws-s3-notifications'
import { auth } from './auth/resource'
import { storage } from './storage/resource'
import { lamdafnDms } from './functions/lamdafn_dms/resource'

const backend = defineBackend({
  auth,
  storage,
  lamdafnDms,
})

// 1. Get CDK references
const s3Bucket = backend.storage.resources.bucket
const lambdaFunction = backend.lamdafnDms.resources.lambda

// 2. Add S3 Object Created Event Notification -> Triggers Lambda
s3Bucket.addEventNotification(
  EventType.OBJECT_CREATED,
  new LambdaDestination(lambdaFunction),
  { prefix: 'public/documents/' }
)

// 3. Grant IAM Permission to Lambda to trigger Bedrock KB sync
lambdaFunction.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['bedrock:StartIngestionJob', 'bedrock:GetIngestionJob'],
    resources: ['*'], // Or scope strictly to your Bedrock KB ARN
  })
)