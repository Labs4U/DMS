# Requirements Document

## Introduction

This document defines the requirements for the **Electrify! Plus** project initialization feature. The initialization establishes the full scaffold of the application: a React + Vite TypeScript frontend, an AWS Amplify Gen 2 backend (Cognito auth, AppSync/DynamoDB data layer, and a Lambda bill-calculator function), and the wiring that connects them. Upon completion, authenticated users land on a dashboard with placeholder chart and table components; unauthenticated users are gated behind the Amplify sign-in UI.

All requirements are derived from and traceable to the approved design document.

---

## Glossary

- **App**: The Electrify! Plus React + Vite frontend application.
- **Amplify_Client**: The `aws-amplify` SDK instance configured via `Amplify.configure(outputs)`.
- **Amplify_Outputs**: The generated `amplify_outputs.json` artifact produced by `npx ampx sandbox` or `npx ampx generate outputs`.
- **Auth_Resource**: The Amplify Gen 2 auth definition in `amplify/auth/resource.ts` using `defineAuth`.
- **Data_Resource**: The Amplify Gen 2 data definition in `amplify/data/resource.ts` using `defineData`.
- **Bill_Function**: The `calculateBill` Lambda function defined in `amplify/functions/calculateBill/`.
- **Bill_Handler**: The Lambda handler in `amplify/functions/calculateBill/handler.ts`.
- **Backend**: The Amplify Gen 2 root backend defined in `amplify/backend.ts` using `defineBackend`.
- **ConsumptionRecord**: The DynamoDB/AppSync data model representing a single customer electricity reading.
- **Authenticator**: The `<Authenticator>` component from `@aws-amplify/ui-react` used to gate the dashboard.
- **Dashboard**: The authenticated view of the application containing the chart and table components.
- **ConsumptionChart**: The `src/components/ConsumptionChart.tsx` placeholder component rendering a `recharts` `BarChart`.
- **MonthlyDetailTable**: The `src/components/MonthlyDetailTable.tsx` placeholder component rendering an HTML table.
- **FLAT_RATE**: The bill calculation constant of `$0.12` per kWh.
- **Vite**: The build tool and dev server used for the frontend.

---

## Requirements

### Requirement 1: Frontend Project Initialization

**User Story:** As a developer, I want to initialize the React + Vite TypeScript project with the required production and development dependencies, so that the frontend build environment is ready for Amplify integration.

#### Acceptance Criteria

1. THE App SHALL be initialized from the React + Vite TypeScript project template.
2. THE App SHALL include `aws-amplify` as a pinned exact-version production dependency.
3. THE App SHALL include `@aws-amplify/ui-react` as a pinned exact-version production dependency.
4. THE App SHALL include `recharts` as a pinned exact-version production dependency.
5. THE App SHALL include `@types/react` as a pinned exact-version development dependency.
6. THE App SHALL include `@types/react-dom` as a pinned exact-version development dependency.
7. THE App SHALL place all frontend source files strictly within the `src/` directory.
8. IF a dependency outside the canonical list is introduced, THEN THE App SHALL not include it without explicit approval.

---

### Requirement 2: Cognito Authentication Backend

**User Story:** As a developer, I want to define Cognito authentication with email/password sign-in using Amplify Gen 2, so that user identity management is handled by a managed AWS service.

#### Acceptance Criteria

1. THE Auth_Resource SHALL be defined in `amplify/auth/resource.ts` using the `defineAuth` API.
2. THE Auth_Resource SHALL configure `loginWith: { email: true }` as the sole sign-in method.
3. THE Auth_Resource SHALL export a named `auth` constant for registration in `amplify/backend.ts`.
4. THE Auth_Resource SHALL contain no UI code or React imports.

---

### Requirement 3: AppSync/DynamoDB Data Layer

**User Story:** As a developer, I want to define the `ConsumptionRecord` data model using Amplify Gen 2's single-table pattern, so that customer electricity records can be stored and retrieved via AppSync.

#### Acceptance Criteria

1. THE Data_Resource SHALL be defined in `amplify/data/resource.ts` using the `defineData` API.
2. THE Data_Resource SHALL define a `ConsumptionRecord` model within the schema.
3. THE ConsumptionRecord model SHALL include a `customerId` field of type `string` marked as required.
4. THE ConsumptionRecord model SHALL include a `date` field of type `string` marked as required, representing an ISO 8601 date (`YYYY-MM-DD`).
5. THE ConsumptionRecord model SHALL include a `monthYear` field of type `string` marked as required, representing a billing period in `YYYY-MM` format.
6. THE ConsumptionRecord model SHALL include a `kwhUsage` field of type `float` marked as required.
7. THE ConsumptionRecord model SHALL apply `allow.owner()` authorization so that each record is accessible only by its owner.
8. THE Data_Resource SHALL set `defaultAuthorizationMode` to `'userPool'`.
9. THE Data_Resource SHALL export a `Schema` type derived via `ClientSchema` for frontend type safety.
10. THE Data_Resource SHALL export a named `data` constant for registration in `amplify/backend.ts`.
11. THE Data_Resource SHALL contain no UI code or React imports.

---

### Requirement 4: Bill Calculator Lambda Function Definition

**User Story:** As a developer, I want to declare the `calculateBill` Lambda function using Amplify Gen 2's `defineFunction` API, so that it is managed and deployable as part of the backend.

#### Acceptance Criteria

1. THE Bill_Function SHALL be defined in `amplify/functions/calculateBill/resource.ts` using the `defineFunction` API.
2. THE Bill_Function SHALL set `name` to `'calculate-bill'`.
3. THE Bill_Function SHALL set `entry` to `'./handler.ts'`.
4. THE Bill_Function SHALL export a named `calculateBill` constant for registration in `amplify/backend.ts`.
5. THE Bill_Function definition SHALL contain no UI code, React imports, or business logic.

---

### Requirement 5: Bill Calculator Lambda Handler

**User Story:** As a developer, I want the `calculateBill` Lambda handler to compute an estimated electricity bill from an array of usage readings, so that the frontend can request a bill estimate without embedding pricing logic in the UI.

#### Acceptance Criteria

1. THE Bill_Handler SHALL be implemented in `amplify/functions/calculateBill/handler.ts`.
2. THE Bill_Handler SHALL accept an event of shape `{ usageAmounts: number[] }`.
3. THE Bill_Handler SHALL return a response of shape `{ estimatedBill: number }`.
4. WHEN `usageAmounts` contains one or more values, THE Bill_Handler SHALL compute `estimatedBill` as the sum of all values in `usageAmounts` multiplied by the FLAT_RATE of `0.12`.
5. WHEN `usageAmounts` is empty, THE Bill_Handler SHALL return `{ estimatedBill: 0 }`.
6. THE Bill_Handler SHALL round `estimatedBill` to two decimal places.
7. THE Bill_Handler SHALL NOT store, log, or persist the input `usageAmounts` values.
8. THE Bill_Handler SHALL NOT mutate the input `usageAmounts` array.

---

### Requirement 6: Backend Registration

**User Story:** As a developer, I want a single `amplify/backend.ts` entry point that registers all backend resources, so that Amplify Gen 2 can synthesize the complete infrastructure from one file.

#### Acceptance Criteria

1. THE Backend SHALL be defined in `amplify/backend.ts` using the `defineBackend` API.
2. THE Backend SHALL register the `auth` export from `amplify/auth/resource.ts`.
3. THE Backend SHALL register the `data` export from `amplify/data/resource.ts`.
4. THE Backend SHALL register the `calculateBill` export from `amplify/functions/calculateBill/resource.ts`.
5. THE Backend SHALL contain no UI code or React imports.

---

### Requirement 7: Frontend Amplify Configuration

**User Story:** As a developer, I want the frontend to configure the Amplify client using `amplify_outputs.json` before any rendering occurs, so that all Amplify API calls resolve against the correct backend.

#### Acceptance Criteria

1. THE Amplify_Client SHALL be configured by calling `Amplify.configure(outputs)` in `src/main.tsx`.
2. WHEN `src/main.tsx` executes, THE Amplify_Client SHALL call `Amplify.configure(outputs)` before `ReactDOM.createRoot` is called.
3. THE Amplify_Client SHALL import `outputs` from `../amplify_outputs.json`.
4. THE `amplify_outputs.json` file SHALL NOT be committed to source control.
5. IF `amplify_outputs.json` is absent at build time, THE App SHALL fail at the Vite module resolution step with a clear build error rather than silently using unconfigured defaults.

---

### Requirement 8: Authentication Gate

**User Story:** As an end user, I want the entire dashboard to be gated behind the Amplify Authenticator, so that only authenticated users can view consumption data.

#### Acceptance Criteria

1. THE App SHALL wrap all dashboard content in the `<Authenticator>` component from `@aws-amplify/ui-react`.
2. WHILE a user is not authenticated, THE Authenticator SHALL render the Amplify-provided sign-in and sign-up UI instead of the Dashboard.
3. WHEN a user successfully authenticates, THE Authenticator SHALL render the Dashboard.
4. THE App SHALL use the `useAuthenticator` hook to access `user` and `signOut` within the authenticated context.
5. THE App SHALL import `@aws-amplify/ui-react/styles.css` to apply default Authenticator styles.
6. THE App SHALL NOT implement custom authentication logic; all auth is handled by `<Authenticator>`.

---

### Requirement 9: Consumption Chart Placeholder

**User Story:** As a developer, I want a placeholder `ConsumptionChart` component that renders a `recharts` `BarChart` with mock data, so that the chart slot is established for future live-data integration.

#### Acceptance Criteria

1. THE ConsumptionChart SHALL be implemented in `src/components/ConsumptionChart.tsx`.
2. THE ConsumptionChart SHALL render a section heading with the text `"12-Month Consumption Chart"`.
3. THE ConsumptionChart SHALL render a `recharts` `BarChart` component.
4. THE ConsumptionChart SHALL use static or empty mock data (no live data queries).
5. THE ConsumptionChart SHALL NOT import any charting library other than `recharts`.
6. THE ConsumptionChart SHALL NOT import any `amplify/` backend resources directly.

---

### Requirement 10: Monthly Detail Table Placeholder

**User Story:** As a developer, I want a placeholder `MonthlyDetailTable` component that renders an HTML table with the correct column headers, so that the table slot is established for future live-data integration.

#### Acceptance Criteria

1. THE MonthlyDetailTable SHALL be implemented in `src/components/MonthlyDetailTable.tsx`.
2. THE MonthlyDetailTable SHALL render a section heading with the text `"Monthly Detail Table"`.
3. THE MonthlyDetailTable SHALL render an HTML `<table>` element containing a `<thead>` section.
4. THE `<thead>` SHALL contain column headers for: `Month`, `kWh Usage`, and `Estimated Bill`.
5. THE MonthlyDetailTable SHALL use static or empty placeholder data (no live data queries).
6. THE MonthlyDetailTable SHALL NOT import any `amplify/` backend resources directly.

---

### Requirement 11: Directory Boundary Enforcement

**User Story:** As a developer, I want strict enforcement of the `src/` frontend and `amplify/` backend directory boundary, so that the codebase remains maintainable and the architectural rulebook is upheld.

#### Acceptance Criteria

1. THE App SHALL place all React components, hooks, routing, and styles strictly within `src/`.
2. THE Backend SHALL place all Amplify infrastructure definitions (`defineAuth`, `defineData`, `defineFunction`, `defineBackend`) strictly within `amplify/`.
3. IF any file in `src/` imports directly from `amplify/`, THEN that import SHALL be considered a violation of the architectural boundary.
4. IF any file in `amplify/` imports React or UI framework code, THEN that import SHALL be considered a violation of the architectural boundary.
5. WHERE frontend code requires access to backend-generated types, THE App SHALL use the exported `Schema` type from `amplify/data/resource.ts` via the generated client (not direct DynamoDB or AppSync SDK calls).
