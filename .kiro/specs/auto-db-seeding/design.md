# Design Document — Auto DB Seeding

## Overview

The Auto DB Seeding feature replaces the manual Python seed script with an in-browser, fully-automatic seeding flow. When a newly authenticated user opens the Dashboard and no `ConsumptionRecord` items exist for their account, the frontend detects the empty state, generates 12 months of realistic mock billing data (August 2025 – July 2026), and writes all records through the existing Amplify Gen 2 AppSync client. After seeding completes the Dashboard re-fetches and renders immediately — the user sees a fully populated chart and table with zero manual steps.

The feature introduces one new file (`src/utils/seedDatabase.ts`) and makes additive changes to `src/App.tsx`. No new dependencies are required and no `amplify/` infrastructure changes are needed.

---

## Architecture

### Component / Module Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  src/App.tsx                                                    │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Dashboard (React component)                             │   │
│  │                                                          │   │
│  │  State: records, loading, userSub, hasCheckedData        │   │
│  │                                                          │   │
│  │  useEffect ──► checkAndSeedDatabase(userSub)             │   │
│  │                │      (guarded by hasCheckedData)        │   │
│  │                │                                         │   │
│  │                ▼                                         │   │
│  │          fetchRecords()   ◄── called after seed          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  const client = generateClient<Schema>()  ◄── module scope     │
└────────────────────────────────┬────────────────────────────────┘
                                 │ imports
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  src/utils/seedDatabase.ts                                      │
│                                                                 │
│  const client = generateClient<Schema>()  ◄── module scope     │
│                                                                 │
│  export async function checkAndSeedDatabase(customerId: string) │
│    │                                                            │
│    ├─► 1. GSI_Query: listByCustomerAndMonth({ customerId })     │
│    │      └── error?  → log + return                           │
│    │      └── items > 0?  → return (no-op)                     │
│    │                                                            │
│    ├─► 2. generateSeedRecords(customerId) → SeedRecord[12]     │
│    │                                                            │
│    └─► 3. Promise.all(records.map(create with fault isolation)) │
│                                                                 │
│  function generateSeedRecords(customerId: string): SeedRecord[] │
└─────────────────────────────────────────────────────────────────┘
          │ AppSync (userPool auth)
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  AWS AppSync → DynamoDB                                         │
│  ConsumptionRecord (ownerDefinedIn: 'customerId')               │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow Sequence

```
Dashboard mounts
      │
      ▼
fetchAuthSession() resolves → userSub set
      │
      ▼ (useEffect fires: userSub truthy AND hasCheckedData === false)
setHasCheckedData(true)
      │
      ▼
checkAndSeedDatabase(userSub)
      │
      ├──► listByCustomerAndMonth({ customerId: userSub })
      │         │
      │         ├── Error returned  → console.error → return
      │         │
      │         ├── items.length > 0 → return (skip seeding)
      │         │
      │         └── items.length === 0
      │                   │
      │                   ▼
      │             generateSeedRecords(userSub)  →  SeedRecord[12]
      │                   │
      │                   ▼
      │             Promise.all([
      │               create(record[0]),  // each wrapped in try/catch
      │               create(record[1]),
      │               …
      │               create(record[11])
      │             ])
      │                   │
      │                   └── per-record: success → console.log
      │                                   failure → console.error (continue)
      │
      ▼
checkAndSeedDatabase() resolves (void)
      │
      ▼
fetchRecords() → setRecords(sorted) → setLoading(false)
      │
      ▼
Dashboard renders: chart + table populated
```

---

## Components and Interfaces

### `src/utils/seedDatabase.ts`

#### Types

```typescript
/** Subset of ConsumptionRecord fields supplied by the seeder (Amplify adds id, createdAt, updatedAt) */
type SeedRecord = {
  customerId: string
  date: string        // "YYYY-MM-15"
  monthYear: string   // "YYYY-MM"
  kwhUsage: number    // [200.0, 500.0] rounded to 2dp
  statementAmount: number  // kwhUsage × 0.15 rounded to 2dp
  ratePlan: string    // "Day Rate" | "Evening Rate" | "Night Rate"
}
```

#### Exported interface

```typescript
/**
 * Checks whether the authenticated user already has ConsumptionRecord data.
 * If none is found, generates 12 months of mock billing records and inserts
 * them via the Amplify AppSync client.
 *
 * @param customerId - Cognito user sub, used as the owner field on every record.
 * @returns Promise<void> — resolves after all insertions complete (or are skipped).
 */
export async function checkAndSeedDatabase(customerId: string): Promise<void>
```

#### Internal helper (not exported)

```typescript
/**
 * Pure function: generates exactly 12 SeedRecord objects for months Aug 2025 – Jul 2026.
 * Extracting this as a pure function makes it independently unit/property-testable.
 *
 * @param customerId - Cognito user sub to stamp on every record.
 * @returns Array of 12 SeedRecord objects in chronological order.
 */
function generateSeedRecords(customerId: string): SeedRecord[]
```

### `src/App.tsx` additions

Two new state flags and one new `useEffect` are added to `Dashboard`. All existing state and callbacks are preserved unchanged.

```typescript
// New state (added alongside existing useState declarations)
const [hasCheckedData, setHasCheckedData] = useState(false)

// New effect (added after the existing fetchRecords useEffect)
useEffect(() => {
  if (!userSub || hasCheckedData) return
  setHasCheckedData(true)
  void checkAndSeedDatabase(userSub).then(() => fetchRecords())
}, [userSub, hasCheckedData, fetchRecords])
```

> **Note on session reset:** `hasCheckedData` does not need an explicit reset on sign-out. The `<Authenticator>` wrapper unmounts `Dashboard` on sign-out and mounts a fresh instance on the next sign-in, so `hasCheckedData` is always `false` on a new session.

---

## Data Models

### `SeedRecord` field specification

| Field | Type | Value / Range | Format |
|---|---|---|---|
| `customerId` | `string` | Cognito user `sub` passed as parameter | UUID-like string |
| `monthYear` | `string` | Sequential months Aug 2025 – Jul 2026 | `"YYYY-MM"` |
| `date` | `string` | 15th of each record's month | `"YYYY-MM-15"` |
| `kwhUsage` | `number` | Random float in `[200.0, 500.0]` | Rounded to 2 decimal places |
| `statementAmount` | `number` | `kwhUsage × 0.15` | Rounded to 2 decimal places |
| `ratePlan` | `string` | Random pick from allowed set | `"Day Rate"` \| `"Evening Rate"` \| `"Night Rate"` |

### Month generation algorithm

The algorithm translates the Python seed script's date logic directly into TypeScript:

```typescript
const RATE_PLANS = ['Day Rate', 'Evening Rate', 'Night Rate'] as const
const START_YEAR = 2025
const START_MONTH = 8   // August (1-based)
const RECORD_COUNT = 12

function generateSeedRecords(customerId: string): SeedRecord[] {
  return Array.from({ length: RECORD_COUNT }, (_, i) => {
    const totalMonth = START_MONTH + i          // 8..19
    const year = START_YEAR + Math.floor((totalMonth - 1) / 12)
    const month = ((totalMonth - 1) % 12) + 1   // 1..12
    const mm = String(month).padStart(2, '0')

    const monthYear = `${year}-${mm}`           // "2025-08" .. "2026-07"
    const date = `${year}-${mm}-15`             // "2025-08-15" .. "2026-07-15"

    const kwhUsage = Math.round((200 + Math.random() * 300) * 100) / 100
    const statementAmount = Math.round(kwhUsage * 0.15 * 100) / 100
    const ratePlan = RATE_PLANS[Math.floor(Math.random() * RATE_PLANS.length)]

    return { customerId, monthYear, date, kwhUsage, statementAmount, ratePlan }
  })
}
```

**Why `(totalMonth - 1) / 12` and `(totalMonth - 1) % 12 + 1`?**
Month 8 (August) is 1-based, so subtracting 1 converts to a 0-based index before the modulo. This is a direct translation of the Python script's `(current_month - 1) // 12` logic and handles the December→January wrap correctly.

### Full `checkAndSeedDatabase` implementation outline

```typescript
export async function checkAndSeedDatabase(customerId: string): Promise<void> {
  // 1. Check for existing data
  const { data: existing, errors } = await client.models.ConsumptionRecord
    .listByCustomerAndMonth({ customerId })

  if (errors?.length) {
    console.error('[Seeder] GSI query failed:', errors)
    return
  }

  if ((existing ?? []).length > 0) {
    console.log(`[Seeder] Data already exists (${existing!.length} records). Skipping.`)
    return
  }

  // 2. Generate records
  const records = generateSeedRecords(customerId)

  // 3. Insert concurrently with per-record fault isolation
  await Promise.all(
    records.map(async (record) => {
      try {
        const { data, errors: createErrors } = await client.models.ConsumptionRecord.create(record)
        if (createErrors?.length) throw new Error(createErrors[0].message)
        console.log(`[Seeder] ✅ ${record.monthYear} | ${record.kwhUsage} kWh | $${record.statementAmount}`)
        return data
      } catch (err) {
        console.error(`[Seeder] ❌ Failed ${record.monthYear}:`, err)
        return null
      }
    })
  )
}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The `generateSeedRecords` function is a **pure function** (no I/O, deterministic structure with controlled randomness) making it an ideal candidate for property-based testing. The Amplify client calls are side-effectful and are covered by example-based and integration tests instead.

### Property 1: customerId propagation

*For any* non-empty string used as `customerId`, every record in the array returned by `generateSeedRecords(customerId)` SHALL have its `customerId` field equal to the input string.

**Validates: Requirements 2.2**

---

### Property 2: Record field format and domain invariants

*For any* record in the array returned by `generateSeedRecords(customerId)`:

- `monthYear` SHALL match the pattern `/^\d{4}-\d{2}$/`
- `date` SHALL match the pattern `/^\d{4}-\d{2}-15$/`
- `date` SHALL be consistent with `monthYear` (i.e., `date.startsWith(monthYear)`)
- `kwhUsage` SHALL satisfy `200.0 <= kwhUsage <= 500.0`
- `kwhUsage` SHALL have at most 2 decimal places (i.e., `Math.round(kwhUsage * 100) / 100 === kwhUsage`)
- `ratePlan` SHALL be one of `["Day Rate", "Evening Rate", "Night Rate"]`

**Validates: Requirements 2.3, 2.4, 2.5, 2.7**

---

### Property 3: statementAmount derivation

*For any* record in the array returned by `generateSeedRecords(customerId)`, the `statementAmount` field SHALL equal `Math.round(record.kwhUsage * 0.15 * 100) / 100`.

**Validates: Requirements 2.6**

---

### Property 4: Batch fault isolation

*For any* pattern of failures across the 12 concurrent `ConsumptionRecord.create` calls (i.e., any arbitrary subset of calls may throw), the total number of `create` calls attempted SHALL always equal 12 — no failure in one slot SHALL prevent the remaining slots from being attempted.

**Validates: Requirements 3.3**

---

### Property 5: Session guard idempotence

*For any* number of re-renders or state updates to `userSub` within the same mounted `Dashboard` instance, `checkAndSeedDatabase` SHALL be called **at most once** — the `hasCheckedData` guard SHALL prevent re-invocation after the first call.

**Validates: Requirements 5.2**

---

## Error Handling

| Scenario | Handler | Observable behaviour |
|---|---|---|
| `listByCustomerAndMonth` returns `errors` array | Log `errors` to `console.error`, return early | No records inserted; Dashboard re-fetches (finds 0 records, shows empty state) |
| Individual `create` call throws or returns `errors` | Catch in per-record try/catch; log `monthYear` + error to `console.error`; return `null` | Other 11 records still attempted; partial seeding possible |
| All 12 `create` calls succeed | — | Dashboard re-fetches; 12 records displayed |
| Data already exists (`items.length > 0`) | Log skip message to `console.log`, return early | No mutation; existing data preserved |
| `fetchAuthSession` fails (no `sub`) | Existing `fetchRecords` handler sets `error` state | Error banner shown; `userSub` remains `null`; `useEffect` guard never fires |
| Network error during `Promise.all` | Caught per-record | Partial set of records inserted; no crash |

**Rationale for per-record isolation over an all-or-nothing approach:** The seeding operation is best-effort mock data generation, not a financial transaction. A partial seed is preferable to a full abort — the user still gets most of their data, and DynamoDB's `put_item` is idempotent by key so a future retry (sign-out + sign-in) only risks duplicate records for the already-succeeded months. The existing schema's GSI query check prevents a full re-seed, so partial seeds are the primary concern. This is an acceptable trade-off for a mock-data feature.

---

## Testing Strategy

### Approach

This feature uses a **dual testing approach**:

- **Unit / property-based tests** for the pure `generateSeedRecords` function (verifying invariants across many generated inputs)
- **Example-based unit tests** for the orchestration logic in `checkAndSeedDatabase` (mocking the Amplify client)
- **Component tests** for the `Dashboard` lifecycle integration (mocking the seeder module)

Since no test framework is currently in `package.json`, the recommended setup is **Vitest** (already consistent with the Vite build tool) with **fast-check** for property-based tests.

```json
// devDependencies to add
"vitest": "^2.0.0",
"@vitest/coverage-v8": "^2.0.0",
"fast-check": "^3.22.0",
"@testing-library/react": "^16.0.0",
"@testing-library/jest-dom": "^6.0.0"
```

Run tests: `npx vitest --run`

### Property-Based Tests (`generateSeedRecords`)

Each property test uses **fast-check** with a minimum of **100 iterations**. The module under test is `generateSeedRecords` — exported separately or tested via its parent module with the client mocked.

```typescript
// Feature: auto-db-seeding, Property 1: customerId propagation
fc.assert(fc.property(fc.string({ minLength: 1 }), (customerId) => {
  const records = generateSeedRecords(customerId)
  return records.every((r) => r.customerId === customerId)
}), { numRuns: 100 })

// Feature: auto-db-seeding, Property 2: field format and domain invariants
fc.assert(fc.property(fc.string({ minLength: 1 }), (customerId) => {
  const records = generateSeedRecords(customerId)
  const RATE_PLANS = ['Day Rate', 'Evening Rate', 'Night Rate']
  return records.every((r) =>
    /^\d{4}-\d{2}$/.test(r.monthYear) &&
    /^\d{4}-\d{2}-15$/.test(r.date) &&
    r.date.startsWith(r.monthYear) &&
    r.kwhUsage >= 200.0 && r.kwhUsage <= 500.0 &&
    Math.round(r.kwhUsage * 100) / 100 === r.kwhUsage &&
    RATE_PLANS.includes(r.ratePlan)
  )
}), { numRuns: 100 })

// Feature: auto-db-seeding, Property 3: statementAmount derivation
fc.assert(fc.property(fc.string({ minLength: 1 }), (customerId) => {
  const records = generateSeedRecords(customerId)
  return records.every((r) =>
    r.statementAmount === Math.round(r.kwhUsage * 0.15 * 100) / 100
  )
}), { numRuns: 100 })

// Feature: auto-db-seeding, Property 4: batch fault isolation
fc.assert(fc.property(
  fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }), // true = fail this slot
  async (failurePattern) => {
    let callCount = 0
    const mockCreate = vi.fn(async (_, i) => {
      callCount++
      if (failurePattern[callCount - 1]) throw new Error('mock failure')
      return { data: {}, errors: null }
    })
    // inject mockCreate into the seeder and verify callCount === 12
  }
), { numRuns: 100 })

// Feature: auto-db-seeding, Property 5: session guard idempotence
// Verify that re-rendering Dashboard with same userSub calls checkAndSeedDatabase once
```

### Example-Based Unit Tests (`checkAndSeedDatabase`)

| Scenario | What is verified |
|---|---|
| GSI returns 0 items | 12 `create` calls are made |
| GSI returns ≥1 items | 0 `create` calls are made |
| GSI returns errors | 0 `create` calls, `console.error` is called |
| One `create` returns errors | That `create` is logged as failure, 11 others still run |
| All `create` calls succeed | `console.log` called 12 times with correct fields |

### Component Tests (`Dashboard`)

| Scenario | What is verified |
|---|---|
| Mount with `userSub` available | `checkAndSeedDatabase` called once with correct sub |
| Mount with `userSub` available | `fetchRecords` called after seed completes |
| Mount then state update with same `userSub` | `checkAndSeedDatabase` NOT called a second time |
| Loading state | Spinner appears in chart and table sections while `loading` is `true` |
| Loaded state with records | Chart and table render with record data |

### Static / Smoke Checks

- TypeScript compilation verifies the `checkAndSeedDatabase(customerId: string): Promise<void>` signature
- No `amplify/` imports appear in `src/utils/seedDatabase.ts` (enforced by the linter / import analysis)
- No `aws-sdk` or `@aws-sdk/*` imports appear in any `src/` file
