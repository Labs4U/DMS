import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

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
    // 👇 Tell Amplify to use 'customerId' as the owner field
    .authorization((allow) => [allow.ownerDefinedIn('customerId')]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
