import { generateClient } from 'aws-amplify/data'
import type { Schema } from '../../amplify/data/resource'

// ── Amplify data client ───────────────────────────────────────────────────────

const client = generateClient<Schema>()

// ── Types ─────────────────────────────────────────────────────────────────────

/** Subset of ConsumptionRecord fields supplied by the seeder (Amplify adds id, createdAt, updatedAt) */
type SeedRecord = {
  customerId: string
  date: string          // "YYYY-MM-15"
  monthYear: string     // "YYYY-MM"
  kwhUsage: number      // [200.0, 500.0] rounded to 2dp
  statementAmount: number // kwhUsage × 0.15 rounded to 2dp
  ratePlan: string      // "Day Rate" | "Evening Rate" | "Night Rate"
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RATE_PLANS = ['Day Rate', 'Evening Rate', 'Night Rate'] as const
const START_YEAR = 2025
const START_MONTH = 8   // August (1-based)
const RECORD_COUNT = 12

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Pure function: generates exactly 12 SeedRecord objects for months Aug 2025 – Jul 2026.
 * Exported for independent unit and property testing.
 *
 * @param customerId - Cognito user sub to stamp on every record.
 * @returns Array of 12 SeedRecord objects in chronological order.
 */
export function generateSeedRecords(customerId: string): SeedRecord[] {
  return Array.from({ length: RECORD_COUNT }, (_, i) => {
    const totalMonth = START_MONTH + i                          // 8..19
    const year = START_YEAR + Math.floor((totalMonth - 1) / 12)
    const month = ((totalMonth - 1) % 12) + 1                  // 1..12
    const mm = String(month).padStart(2, '0')

    const monthYear = `${year}-${mm}`   // "2025-08" .. "2026-07"
    const date = `${year}-${mm}-15`     // "2025-08-15" .. "2026-07-15"

    const kwhUsage = Math.round((200 + Math.random() * 300) * 100) / 100
    const statementAmount = Math.round(kwhUsage * 0.15 * 100) / 100
    const ratePlan = RATE_PLANS[Math.floor(Math.random() * RATE_PLANS.length)]

    return { customerId, monthYear, date, kwhUsage, statementAmount, ratePlan }
  })
}

// ── Exported function ─────────────────────────────────────────────────────────

/**
 * Checks whether the authenticated user already has ConsumptionRecord data.
 * If none is found, generates 12 months of mock billing records and inserts
 * them via the Amplify AppSync client.
 *
 * @param customerId - Cognito user sub, used as the owner field on every record.
 * @returns Promise<void> — resolves after all insertions complete (or are skipped).
 */
export async function checkAndSeedDatabase(customerId: string): Promise<void> {
  // 1. Check for existing data via GSI
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

  // 2. Generate 12 seed records
  const records = generateSeedRecords(customerId)

  // 3. Insert concurrently with per-record fault isolation
  await Promise.all(
  records.map(async (record) => {
    try {
      // ❌ Failing line:
      // const { data, errors: createErrors } = await client.models.ConsumptionRecord.create(record)

      // ✅ Fix: Add 'as any' to bypass the strict generated type mismatch
      const { data, errors: createErrors } = await client.models.ConsumptionRecord.create(record as any)
      
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
