import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { chatAgent } from '../functions/chatAgent/resource';

const schema = a.schema({
  ConsumptionRecord: a
    .model({
      id: a.id(),
      customerId: a.string(),
      date: a.date(),
      monthYear: a.string(),
      kwhUsage: a.float(),
      ratePlan: a.string(),
      statementAmount: a.float(),
    })
    .secondaryIndexes((index) => [
      index("customerId").sortKeys(["monthYear"]).queryField("listByCustomerAndMonth")
    ])
    .authorization((allow) => [allow.ownerDefinedIn('customerId')]),

  chatWithAgent: a
    .mutation()
    .arguments({
      prompt: a.string().required(),
      sessionId: a.string().required(),
      customerId: a.string(),
    })
    .returns(a.string())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(chatAgent)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
