# Electrify! Plus — Architectural Rulebook

## 1. Workspace Topology

This project is a standard **React + Vite** workspace backed by **AWS Amplify Gen 2** (Code-First TypeScript).

| Area | Directory | Contents |
|---|---|---|
| Frontend | `src/` | All UI components, hooks, routing, styles, and assets |
| Backend | `amplify/` | All AWS infrastructure — Auth, Data, and Functions |

**Hard rules:**
- UI components, hooks, and routing live **strictly** in `src/`. No infrastructure code may appear here.
- AWS infrastructure definitions live **strictly** in `amplify/`. No UI code may appear here.
- Never mix frontend and backend concerns across directory boundaries.

---

## 2. Backend Infrastructure Rules

### 2.1 Authentication — Amazon Cognito

- Auth is handled via **Amazon Cognito** with **Email/Password** as the sign-in method.
- Defined in `amplify/auth/resource.ts` using the Amplify Gen 2 `defineAuth` API.
- Example skeleton:

```typescript
// amplify/auth/resource.ts
import { defineAuth } from '@aws-amplify/backend';

export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
```

### 2.2 Data — AppSync GraphQL + DynamoDB

- A **single DynamoDB table** approach is used, managed through **AppSync GraphQL**.
- The data model is defined in `amplify/data/resource.ts` using the Amplify Gen 2 `defineData` API with a `schema`.
- All data models are defined as part of this single schema; do not create separate DynamoDB tables outside of this pattern.
- Example skeleton:

```typescript
// amplify/data/resource.ts
import { a, defineData, type ClientSchema } from '@aws-amplify/backend';

const schema = a.schema({
  // Define models here
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
```

### 2.3 Compute — Lambda Functions

- Custom business logic (e.g., bill calculation, data processing) **must** be implemented as **Lambda functions**.
- Functions are defined in `amplify/functions/<function-name>/` using the Amplify Gen 2 `defineFunction` API.
- Register every function in `amplify/backend.ts`.
- Example skeleton:

```typescript
// amplify/functions/bill-calculator/resource.ts
import { defineFunction } from '@aws-amplify/backend';

export const billCalculator = defineFunction({
  name: 'bill-calculator',
  entry: './handler.ts',
});
```

---

## 3. UI & Styling Rules

### 3.1 Authentication UI — @aws-amplify/ui-react

- The frontend **must** wrap the application with the `<Authenticator>` component from `@aws-amplify/ui-react`.
- Use `@aws-amplify/ui-react` components for baseline UI patterns (forms, buttons, etc.) wherever they are available before reaching for custom or third-party alternatives.
- The `Amplify.configure(outputs)` call (using the generated `amplify_outputs.json`) must occur at the app entry point (`src/main.tsx` or `src/App.tsx`) before any other Amplify API call.

### 3.2 Data Visualization — Recharts

- All charts, graphs, and data visualizations **must** use the **`recharts`** library.
- Do not introduce alternative charting libraries (Chart.js, Victory, D3 direct usage, etc.).

---

## 4. Key Dependencies (Canonical List)

| Package | Purpose |
|---|---|
| `react`, `react-dom` | UI framework |
| `vite` | Build tool & dev server |
| `@aws-amplify/backend` | Amplify Gen 2 backend definitions |
| `@aws-amplify/backend-cli` | Amplify Gen 2 CLI tooling |
| `aws-amplify` | Frontend Amplify client |
| `@aws-amplify/ui-react` | Amplify UI component library |
| `recharts` | Data visualization / charting |

---

## 5. Summary of Absolute Rules

1. **`src/` = frontend only.** No `amplify/` imports or AWS SDK calls in UI code (use the generated `client` from `amplify/data/resource.ts` via `generateClient()`).
2. **`amplify/` = backend only.** No React or UI imports.
3. **Auth = Cognito via `defineAuth`.** No custom auth logic.
4. **Data = single-table AppSync/DynamoDB via `defineData`.** No ad-hoc DynamoDB or raw API Gateway calls.
5. **Business logic = Lambda via `defineFunction`.** No inline compute in the frontend.
6. **Auth UI = `<Authenticator>` from `@aws-amplify/ui-react`.**
7. **Charts = `recharts` only.**
