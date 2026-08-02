# Requirements Document

## Introduction

The **Auto DB Seeding** feature eliminates the manual step of running a Python seed script for new Electrify! Plus users. When an authenticated user opens the dashboard for the first time and no consumption data exists for their account, the frontend automatically generates and inserts 12 months of mock billing data (August 2025 – July 2026) via the existing Amplify Gen 2 AppSync client. The dashboard then re-fetches records immediately, so the user sees a populated chart and table without any manual intervention — and can immediately interact with the Chat Assistant.

---

## Glossary

- **Seeder**: The `checkAndSeedDatabase` async function exported from `src/utils/seedDatabase.ts` that checks for existing records and inserts mock data if none are found.
- **Dashboard**: The `Dashboard` React component in `src/App.tsx` that renders KPI cards, the bar chart, the monthly table, and the Chat Assistant.
- **ConsumptionRecord**: The Amplify Gen 2 data model defined in `amplify/data/resource.ts`, persisted via AppSync/DynamoDB.
- **Amplify_Client**: The typed AppSync client instance created by `generateClient<Schema>()` from `aws-amplify/data`, used for all data operations within `src/`.
- **UserSub**: The Cognito user sub (`sub` claim from the ID token) that serves as the `customerId` owner field on every `ConsumptionRecord`.
- **GSI_Query**: The `listByCustomerAndMonth` secondary-index query on `ConsumptionRecord`, keyed by `customerId` and sorted by `monthYear`.
- **Empty_State**: The condition where a `GSI_Query` for a given `UserSub` returns zero items.
- **Seed_Batch**: The set of 12 `ConsumptionRecord` items generated for the months August 2025 through July 2026.
- **hasCheckedData**: A boolean React state flag in `Dashboard` that prevents the Seeder from running more than once per session.
- **Loading_Spinner**: The "Connecting to Electrify Grid…" placeholder rendered in the chart and table while `loading` is `true`.

---

## Requirements

### Requirement 1: Detect Empty State

**User Story:** As a new authenticated user, I want the application to detect that I have no billing data, so that the seeding process can be triggered automatically without any manual action on my part.

#### Acceptance Criteria

1. WHEN `userSub` becomes available in `Dashboard` AND `hasCheckedData` is `false`, THE `Seeder` SHALL invoke `checkAndSeedDatabase` with the resolved `UserSub`.
2. THE `Seeder` SHALL execute a `GSI_Query` using `Amplify_Client` with `customerId` equal to the provided `UserSub` to determine whether existing records are present.
3. IF the `GSI_Query` returns an error, THEN THE `Seeder` SHALL log the error to the console and abort without inserting any records.
4. THE `Dashboard` SHALL set `hasCheckedData` to `true` after `checkAndSeedDatabase` is called, regardless of whether seeding was performed, to prevent duplicate invocations within the same session.

---

### Requirement 2: Generate Mock Billing Records

**User Story:** As a new authenticated user, I want 12 months of realistic mock billing data to be generated for my account, so that I can explore the dashboard and interact with the Chat Assistant immediately after sign-in.

#### Acceptance Criteria

1. WHEN the `GSI_Query` returns zero items, THE `Seeder` SHALL generate exactly 12 `ConsumptionRecord` items covering the months August 2025 through July 2026 in sequential order.
2. THE `Seeder` SHALL assign `customerId` on each generated record to the `UserSub` passed into `checkAndSeedDatabase`.
3. THE `Seeder` SHALL set `monthYear` on each record to a string formatted as `"YYYY-MM"` representing that record's calendar month.
4. THE `Seeder` SHALL set `date` on each record to a string formatted as `"YYYY-MM-15"`, placing each record on the 15th of its respective month.
5. THE `Seeder` SHALL set `kwhUsage` on each record to a random floating-point value in the range `[200.0, 500.0]` rounded to 2 decimal places.
6. THE `Seeder` SHALL set `statementAmount` on each record to `kwhUsage × 0.15` rounded to 2 decimal places.
7. THE `Seeder` SHALL set `ratePlan` on each record to one value chosen at random from the set `["Day Rate", "Evening Rate", "Night Rate"]`.
8. WHEN the `GSI_Query` returns one or more items, THE `Seeder` SHALL not insert any records and SHALL return without modifying existing data.

---

### Requirement 3: Insert Records via Amplify Client

**User Story:** As a developer, I want all data writes to go through the Amplify Gen 2 client so that Cognito ownership rules are enforced and no AWS SDK dependencies are introduced into the frontend.

#### Acceptance Criteria

1. THE `Seeder` SHALL use `Amplify_Client` (the `generateClient<Schema>()` instance) to create each `ConsumptionRecord`, without using the AWS SDK, direct DynamoDB calls, or any imports from the `amplify/` directory.
2. THE `Seeder` SHALL submit all 12 record-creation calls concurrently using `Promise.all`.
3. IF an individual record creation call fails, THEN THE `Seeder` SHALL log the failure (including the `monthYear` of the failed record) to the console and SHALL continue processing the remaining records without aborting the batch.
4. WHEN a record is created successfully, THE `Seeder` SHALL log a success message including the `monthYear`, `kwhUsage`, and `statementAmount` values to the console.

---

### Requirement 4: Non-Blocking UI Integration

**User Story:** As a user, I want the dashboard to remain responsive during the data check and seeding process, so that I see immediate visual feedback rather than a frozen or blank screen.

#### Acceptance Criteria

1. THE `Dashboard` SHALL render the `Loading_Spinner` immediately on mount while the initial data fetch and any seeding occur in the background.
2. THE `Dashboard` SHALL invoke `checkAndSeedDatabase` inside a `useEffect` hook so that the seeding process does not block the initial UI render.
3. WHEN `checkAndSeedDatabase` completes (whether seeding occurred or not), THE `Dashboard` SHALL call `fetchRecords` to re-fetch all `ConsumptionRecord` items for the current `UserSub` and update the displayed data.
4. WHILE `loading` is `true`, THE `Dashboard` SHALL display the `Loading_Spinner` in both the chart section and the table section in place of data.
5. WHEN `loading` becomes `false` and records are present, THE `Dashboard` SHALL render the bar chart and monthly detail table populated with the fetched `ConsumptionRecord` items.

---

### Requirement 5: Session-Scoped Guard

**User Story:** As a returning user with existing data, I want the seeder to run at most once per browser session, so that duplicate records are never inserted and the dashboard performance is not degraded by redundant checks.

#### Acceptance Criteria

1. THE `Dashboard` SHALL initialise `hasCheckedData` to `false` on component mount.
2. WHEN `checkAndSeedDatabase` has been called once during a session, THE `Dashboard` SHALL set `hasCheckedData` to `true` and SHALL NOT call `checkAndSeedDatabase` again for the remainder of that session.
3. WHEN `userSub` changes (e.g., after a sign-out and sign-in of a different user), THE `Dashboard` SHALL re-evaluate the `hasCheckedData` guard based on the new session state.

---

### Requirement 6: Seeder Module Isolation

**User Story:** As a developer, I want the seeding logic encapsulated in its own module, so that it can be tested and maintained independently of the Dashboard component.

#### Acceptance Criteria

1. THE `Seeder` SHALL be implemented as an exported async function named `checkAndSeedDatabase` in the file `src/utils/seedDatabase.ts`.
2. THE `Seeder` SHALL accept exactly one parameter: `customerId` of type `string`.
3. THE `Seeder` SHALL return a `Promise<void>`.
4. THE `src/utils/seedDatabase.ts` module SHALL import `Amplify_Client` from the module-level `generateClient<Schema>()` call, following the same pattern already established in `src/App.tsx`.
5. THE `src/utils/seedDatabase.ts` module SHALL NOT import from `amplify/` directly, SHALL NOT use `aws-sdk` or `@aws-sdk/*` packages, and SHALL NOT introduce any third-party dependencies beyond those already listed in the project's canonical dependency list.
