import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'dmsLibrary',
  access: (allow) => ({
    // Grants authenticated users permission to upload and read documents
    'public/documents/*': [
      allow.authenticated.to(['read', 'write', 'delete']),
    ],
  }),
});