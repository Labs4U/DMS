# Implementation Plan: Auto DB Seeding

## Overview

Implement the automatic database seeding feature by creating a new `src/utils/seedDatabase.ts` module and wiring it into `src/App.tsx`. Set up Vitest with fast-check for property-based and example-based tests. No `amplify/` infrastructure changes are required.

## Tasks

- [x] 1. Create `src/utils/seedDatabase.ts`
  - [x] 1.1 Create the seeder module with types, helper, and exported function
    - Create `src/utils/seedDatabase.ts`
    - Add module-scope `const client = generateClient<Schema>()` (same pattern as `src/App.tsx`)
    - Import `Schema` type from `../amplify/data/resource` (type-only import, required for `generateClient<Schema>()`)
    - Define internal `SeedRecord` type with fields: `customerId`, `date`, `monthYear`, `kwhUsage`, `statementAmount`, `ratePlan`
    - Implement internal pure function `generateSeedRecords(customerId: string): SeedRecord[]`
      - Constants: `RATE_PLANS = ['Day Rate', 'Evening Rate', 'Night Rate'] as const`, `START_YEAR = 2025`, `START_MONTH = 8`, `RECORD_COUNT = 12`
      - Use `Array.from({ length: 12 }, (_, i) => { ... })` with `totalMonth = START_MONTH + i`, `year = START_YEAR + Math.floor((totalMonth - 1) / 12)`, `month = ((totalMonth - 1) % 12) + 1`
      - `kwhUsage`: `Math.round((200 + Math.random() * 300) * 100) / 100`
      - `statementAmount`: `Math.round(kwhUsage * 0.15 * 100) / 100`
      - `ratePlan`: random pick from `RATE_PLANS`
    - Implement exported async function `checkAndSeedDatabase(customerId: string): Promise<void>`
      - Step 1: call `client.models.ConsumptionRecord.listByCustomerAndMonth({ customerId })`
      - Error path: `console.error('[Seeder] GSI query failed:', errors)` → return
      - Existing data path: `console.log('[Seeder] Data already exists...')` → return
      - Step 2: call `generateSeedRecords(customerId)` to build 12 `SeedRecord` objects
      - Step 3: `Promise.all(records.map(async (record) => { try { ... } catch { ... } }))` with per-record fault isolation
        - Success log: `` `[Seeder] ✅ ${record.monthYear} | ${record.kwhUsage} kWh | $${record.statementAmount}` ``
        - Failure log: `` `[Seeder] ❌ Failed ${record.monthYear}:` `` + error
    - Also export `generateSeedRecords` as a named export so it is independently testable
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 2. Update `src/App.tsx` — wire in the seeder
  - [x] 2.1 Add seeder import and session-guarded `useEffect` to `Dashboard`
    - Add `import { checkAndSeedDatabase } from './utils/seedDatabase'` at the top of `src/App.tsx`
    - Add `const [hasCheckedData, setHasCheckedData] = useState(false)` inside `Dashboard` alongside existing state declarations
    - Add the following `useEffect` after the existing `fetchRecords` effect:
      ```typescript
      useEffect(() => {
        if (!userSub || hasCheckedData) return
        setHasCheckedData(true)
        void checkAndSeedDatabase(userSub).then(() => fetchRecords())
      }, [userSub, hasCheckedData, fetchRecords])
      ```
    - All existing code (state, callbacks, JSX) must remain unchanged
    - _Requirements: 1.1, 1.4, 4.2, 4.3, 5.1, 5.2_

- [x] 3. Set up the test framework
  - [x] 3.1 Install test devDependencies and configure Vitest
    - Install `vitest@^2.0.0`, `@vitest/coverage-v8@^2.0.0`, `fast-check@^3.22.0`, `@testing-library/react@^16.0.0`, `@testing-library/jest-dom@^6.0.0` as devDependencies
    - Add a `test` script to `package.json`: `"test": "vitest --run"`
    - Extend `vite.config.ts` with a `test` block:
      ```typescript
      test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test-setup.ts'],
      }
      ```
    - Create `src/test-setup.ts` with `import '@testing-library/jest-dom'`
    - _Requirements: 6.1_

- [x] 4. Write tests for `generateSeedRecords` (property-based) and `checkAndSeedDatabase` (example-based)
  - [x] 4.1 Create `src/utils/seedDatabase.test.ts` with example-based tests for `checkAndSeedDatabase`
    - Mock `aws-amplify/data` so `generateClient` returns a controllable mock client
    - Test: GSI returns 0 items → exactly 12 `create` calls are made
    - Test: GSI returns ≥1 items → 0 `create` calls are made
    - Test: GSI returns errors array → 0 `create` calls are made, `console.error` is called
    - Test: one `create` call throws → the other 11 slots are still attempted (total `create` calls = 12)
    - _Requirements: 1.2, 1.3, 2.1, 3.2, 3.3_

  - [x]* 4.2 Write property test for Property 1 — customerId propagation
    - Use `fc.assert(fc.property(fc.string({ minLength: 1 }), (customerId) => { ... }), { numRuns: 100 })`
    - Assert every record in `generateSeedRecords(customerId)` has `r.customerId === customerId`
    - **Property 1: customerId propagation**
    - **Validates: Requirements 2.2**

  - [x]* 4.3 Write property test for Property 2 — field format and domain invariants
    - Use `fc.assert(fc.property(fc.string({ minLength: 1 }), (customerId) => { ... }), { numRuns: 100 })`
    - Assert for every record: `monthYear` matches `/^\d{4}-\d{2}$/`, `date` matches `/^\d{4}-\d{2}-15$/`, `date.startsWith(monthYear)`, `kwhUsage` in `[200.0, 500.0]`, `Math.round(kwhUsage * 100) / 100 === kwhUsage`, `ratePlan` is one of the three allowed strings
    - **Property 2: field format and domain invariants**
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.7**

  - [x]* 4.4 Write property test for Property 3 — statementAmount derivation
    - Use `fc.assert(fc.property(fc.string({ minLength: 1 }), (customerId) => { ... }), { numRuns: 100 })`
    - Assert for every record: `r.statementAmount === Math.round(r.kwhUsage * 0.15 * 100) / 100`
    - **Property 3: statementAmount derivation**
    - **Validates: Requirements 2.6**

  - [x]* 4.5 Write property test for Property 4 — batch fault isolation
    - Use `fc.assert(fc.property(fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }), async (failurePattern) => { ... }), { numRuns: 100 })`
    - For each arbitrary failure pattern, mock `client.models.ConsumptionRecord.create` to throw when `failurePattern[slotIndex]` is `true`, track total calls, assert `callCount === 12`
    - **Property 4: batch fault isolation**
    - **Validates: Requirements 3.3**

- [x] 5. TypeScript and test verification checkpoint
  - [x] 5.1 Run TypeScript compilation and verify no type errors
    - Run `tsc --noEmit` from the `electrify-plus/` directory; fix any reported type errors
    - Confirm `src/utils/seedDatabase.ts` contains no `aws-sdk` or `@aws-sdk/*` imports
    - _Requirements: 3.1, 6.5_

  - [x]* 5.2 Run the full test suite
    - Run `npx vitest --run` from the `electrify-plus/` directory
    - All property tests and example-based tests must pass
    - _Requirements: 1.2, 1.3, 2.1–2.7, 3.2, 3.3_

- [x] 6. Final checkpoint — Ensure all tests pass
  - Ensure `tsc --noEmit` reports zero errors, ask the user if any questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery
- `generateSeedRecords` must be exported from `seedDatabase.ts` (in addition to `checkAndSeedDatabase`) to allow direct unit and property testing without mocking the full Amplify client
- The `../amplify/data/resource` import in `src/utils/seedDatabase.ts` is a **type-only** import (`import type { Schema }`) — this satisfies the architecture rule that `src/` must not import runtime `amplify/` code
- Vitest is the correct choice: it integrates with the existing Vite build pipeline with minimal config
- The `hasCheckedData` guard does not need an explicit reset on sign-out; the `<Authenticator>` wrapper unmounts `Dashboard` on sign-out, so the flag resets naturally on the next sign-in
- Each checkpoint ensures incremental validation before moving to the next concern

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4", "4.5"] },
    { "id": 4, "tasks": ["5.1", "5.2"] }
  ]
}
```
