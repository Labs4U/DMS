# Implementation Plan: Project Initialization — Electrify! Plus

## Overview

Scaffold the complete Electrify! Plus application in three incremental steps: (1) initialize the React + Vite TypeScript frontend with pinned dependencies, (2) scaffold the Amplify Gen 2 backend (auth, data, and Lambda function), and (3) connect the frontend to the backend via `Amplify.configure` and implement the authenticated dashboard shell with placeholder components.

All code is TypeScript. Frontend files live in `src/`; backend infrastructure lives in `amplify/`. The `amplify_outputs.json` artifact must be excluded from source control.

---

## Tasks

- [ ] 1. Initialize the React + Vite TypeScript frontend
  - Run `npm create vite@latest . -- --template react-ts` in the project root to scaffold the project.
  - Install pinned exact production dependencies: `aws-amplify`, `@aws-amplify/ui-react`, `recharts`.
    - Use `npm install --save-exact aws-amplify @aws-amplify/ui-react recharts`
  - Install pinned exact dev dependencies: `@types/react`, `@types/react-dom`.
    - Use `npm install --save-dev --save-exact @types/react @types/react-dom`
  - Verify `package.json` lists all six dependencies with exact versions (no `^` or `~` prefixes).
  - Add `amplify_outputs.json` to `.gitignore` so it is never committed to source control.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 7.4_

- [ ] 2. Scaffold the Amplify Gen 2 backend
  - [ ] 2.1 Create `amplify/auth/resource.ts` — Cognito email/password auth
    - Create the file at `amplify/auth/resource.ts`.
    - Import `defineAuth` from `@aws-amplify/backend`.
    - Export a named `auth` constant using `defineAuth({ loginWith: { email: true } })`.
    - The file must contain no React or UI imports.
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 2.2 Create `amplify/data/resource.ts` — AppSync/DynamoDB `ConsumptionRecord` model
    - Create the file at `amplify/data/resource.ts`.
    - Import `a`, `defineData`, and `type ClientSchema` from `@aws-amplify/backend`.
    - Define the `ConsumptionRecord` model in the schema with fields: `customerId` (string, required), `date` (string, required), `monthYear` (string, required), `kwhUsage` (float, required).
    - Apply `.authorization((allow) => [allow.owner()])` to the model.
    - Configure `defineData` with `authorizationModes: { defaultAuthorizationMode: 'userPool' }`.
    - Export `Schema` type via `ClientSchema<typeof schema>` and a named `data` constant.
    - The file must contain no React or UI imports.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

  - [ ] 2.3 Create `amplify/functions/calculateBill/resource.ts` — Lambda function definition
    - Create the file at `amplify/functions/calculateBill/resource.ts`.
    - Import `defineFunction` from `@aws-amplify/backend`.
    - Export a named `calculateBill` constant using `defineFunction({ name: 'calculate-bill', entry: './handler.ts' })`.
    - The file must contain no business logic, UI code, or React imports.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ] 2.4 Create `amplify/functions/calculateBill/handler.ts` — bill calculation Lambda handler
    - Create the file at `amplify/functions/calculateBill/handler.ts`.
    - Define `BillCalculatorInput` interface: `{ usageAmounts: number[] }`.
    - Define `BillCalculatorOutput` interface: `{ estimatedBill: number }`.
    - Implement `export const handler = async (event: BillCalculatorInput): Promise<BillCalculatorOutput>`.
    - Sum all values in `event.usageAmounts` (default to `[]` via `?? []`).
    - Multiply the sum by `0.12` (FLAT_RATE).
    - Round to 2 decimal places using `Math.round(total * FLAT_RATE * 100) / 100`.
    - Return `{ estimatedBill }`.
    - The handler must not mutate the input array, and must not log or persist `usageAmounts`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [ ]* 2.5 Write unit tests for `Bill_Handler`
    - Test empty array → `{ estimatedBill: 0 }`.
    - Test single value `[100]` → `{ estimatedBill: 12.00 }`.
    - Test multiple values `[300, 450, 210]` → `{ estimatedBill: 115.20 }`.
    - Test floating-point inputs `[100.5, 99.5]` → `{ estimatedBill: 24.00 }`.
    - Test that the input array is not mutated after the call.
    - _Requirements: 5.4, 5.5, 5.6, 5.8_

  - [ ]* 2.6 Write property test for bill flat-rate correctness
    - **Property 1: Bill flat-rate correctness**
    - **Validates: Requirements 5.4, 5.6**
    - Use `fast-check` to generate arbitrary arrays of non-negative floats.
    - Assert `estimatedBill === Math.round(sum(usageAmounts) * 0.12 * 100) / 100`.
    - Assert `estimatedBill >= 0` for all inputs.

  - [ ]* 2.7 Write property test for two-decimal rounding invariant
    - **Property 3: Two-decimal rounding invariant**
    - **Validates: Requirements 5.6**
    - Use `fast-check` to generate arbitrary arrays of non-negative floats.
    - Assert `Math.round(estimatedBill * 100) / 100 === estimatedBill` for all inputs.

  - [ ]* 2.8 Write property test for non-mutation of input array
    - **Property 4: Non-mutation of input array**
    - **Validates: Requirements 5.8**
    - Use `fast-check` to generate arbitrary arrays of non-negative numbers.
    - Snapshot the array before the handler call and compare after the call.
    - Assert the array contents and length are unchanged.

  - [ ] 2.9 Create `amplify/backend.ts` — backend root registration
    - Create the file at `amplify/backend.ts`.
    - Import `defineBackend` from `@aws-amplify/backend`.
    - Import `auth` from `./auth/resource`.
    - Import `data` from `./data/resource`.
    - Import `calculateBill` from `./functions/calculateBill/resource`.
    - Export `backend` using `defineBackend({ auth, data, calculateBill })`.
    - The file must contain no UI code or React imports.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 3. Checkpoint — verify backend structure
  - Ensure all five `amplify/` files exist with correct exports.
  - Ensure all unit and property tests pass (if written).
  - Ask the user if there are any questions before proceeding to frontend wiring.

- [ ] 4. Connect the frontend to the backend
  - [ ] 4.1 Update `src/main.tsx` — configure Amplify before render
    - Import `Amplify` from `aws-amplify`.
    - Import `outputs` from `../amplify_outputs.json` (TypeScript: add `resolveJsonModule: true` to `tsconfig.json` if not already present).
    - Call `Amplify.configure(outputs)` as the first statement before `ReactDOM.createRoot`.
    - Ensure the existing React StrictMode render is preserved.
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 4.2 Write unit test for Amplify configure ordering
    - Mock `Amplify.configure` and `ReactDOM.createRoot`.
    - Import `src/main.tsx` and assert that `Amplify.configure` was called before `ReactDOM.createRoot`.
    - _Requirements: 7.2_

  - [ ] 4.3 Create `src/components/ConsumptionChart.tsx` — recharts BarChart placeholder
    - Create the file at `src/components/ConsumptionChart.tsx`.
    - Import `BarChart`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip` from `recharts`.
    - Define and export a `ConsumptionChart` React functional component.
    - Render a `<section>` (or equivalent) with an `<h2>` heading reading `"12-Month Consumption Chart"`.
    - Render a `<BarChart>` with static mock data (e.g., 12 months of sample kWh readings).
    - Do not import any charting library other than `recharts`.
    - Do not import any `amplify/` resources.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [ ]* 4.4 Write property test for ConsumptionChart structural completeness
    - **Property 6: ConsumptionChart structural completeness**
    - **Validates: Requirements 9.2, 9.3**
    - Use `@testing-library/react` to render `<ConsumptionChart />`.
    - Assert the heading `"12-Month Consumption Chart"` is present in the output.
    - Assert a `BarChart` (or its rendered SVG equivalent) is present in the output.

  - [ ] 4.5 Create `src/components/MonthlyDetailTable.tsx` — HTML table placeholder
    - Create the file at `src/components/MonthlyDetailTable.tsx`.
    - Define and export a `MonthlyDetailTable` React functional component.
    - Render a `<section>` (or equivalent) with an `<h2>` heading reading `"Monthly Detail Table"`.
    - Render an HTML `<table>` with a `<thead>` containing a `<tr>` with three `<th>` elements: `Month`, `kWh Usage`, `Estimated Bill`.
    - Render an empty `<tbody>` (no live data queries).
    - Do not import any `amplify/` resources.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ]* 4.6 Write property test for MonthlyDetailTable structural completeness
    - **Property 7: MonthlyDetailTable structural completeness**
    - **Validates: Requirements 10.2, 10.3, 10.4**
    - Use `@testing-library/react` to render `<MonthlyDetailTable />`.
    - Assert the heading `"Monthly Detail Table"` is present.
    - Assert a `<table>` element is present.
    - Assert `<th>` elements for `Month`, `kWh Usage`, and `Estimated Bill` are all present.

  - [ ] 4.7 Update `src/App.tsx` — wrap dashboard in `<Authenticator>`
    - Import `Authenticator` and `useAuthenticator` from `@aws-amplify/ui-react`.
    - Import `@aws-amplify/ui-react/styles.css`.
    - Import `ConsumptionChart` from `./components/ConsumptionChart`.
    - Import `MonthlyDetailTable` from `./components/MonthlyDetailTable`.
    - Create an inner `Dashboard` component that calls `useAuthenticator()` to get `user` and `signOut`, renders a header with the username and a "Sign Out" button, and renders `<ConsumptionChart />` and `<MonthlyDetailTable />`.
    - The default exported `App` component must wrap `<Dashboard />` in `<Authenticator>`.
    - Do not implement any custom authentication logic.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 4.8 Write property test for authentication gate invariant
    - **Property 5: Authentication gate invariant**
    - **Validates: Requirements 8.1, 8.2, 8.3**
    - Use `@testing-library/react` with mocked `useAuthenticator`.
    - When auth state is unauthenticated: assert dashboard content (`ConsumptionChart`, `MonthlyDetailTable` headings) is NOT rendered.
    - When auth state is authenticated: assert dashboard content IS rendered inside the `<Authenticator>` tree.

- [ ] 5. Final checkpoint — ensure all tests pass
  - Ensure all unit tests pass with `npm test -- --run` (or equivalent single-run command).
  - Ensure TypeScript compiles without errors: `npx tsc --noEmit`.
  - Verify `amplify_outputs.json` is listed in `.gitignore`.
  - Ensure no `src/` file imports directly from `amplify/` and no `amplify/` file imports React.
  - Ask the user if there are any questions or adjustments needed.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP scaffold.
- Each task references specific requirements for full traceability.
- `amplify_outputs.json` must exist before running the frontend dev server (`npx ampx sandbox` generates it).
- Property tests use `fast-check` for the Lambda handler and `@testing-library/react` for component structural properties.
- The `recharts` `BarChart` renders into SVG; component tests may need to query SVG elements or use `role` queries.
