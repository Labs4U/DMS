import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// ── Mock aws-amplify/data at module level ─────────────────────────────────────
// vi.hoisted ensures these variables are initialized before the vi.mock factory
// runs, which itself is hoisted above all imports.

const { mockListByCustomerAndMonth, mockCreate } = vi.hoisted(() => ({
  mockListByCustomerAndMonth: vi.fn(),
  mockCreate: vi.fn(),
}))

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      ConsumptionRecord: {
        listByCustomerAndMonth: mockListByCustomerAndMonth,
        create: mockCreate,
      },
    },
  }),
}))

// Import after mock is registered
import { checkAndSeedDatabase, generateSeedRecords } from './seedDatabase'

// ── Example-based tests ───────────────────────────────────────────────────────

describe('checkAndSeedDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('makes exactly 12 create calls when GSI returns 0 items', async () => {
    mockListByCustomerAndMonth.mockResolvedValue({ data: [], errors: null })
    mockCreate.mockResolvedValue({ data: { id: 'test-id' }, errors: null })

    await checkAndSeedDatabase('user-123')

    expect(mockCreate).toHaveBeenCalledTimes(12)
  })

  it('makes 0 create calls when GSI returns ≥1 items', async () => {
    mockListByCustomerAndMonth.mockResolvedValue({
      data: [{ id: 'existing-record', customerId: 'user-123' }],
      errors: null,
    })

    await checkAndSeedDatabase('user-123')

    expect(mockCreate).toHaveBeenCalledTimes(0)
  })

  it('makes 0 create calls and calls console.error when GSI returns an errors array', async () => {
    mockListByCustomerAndMonth.mockResolvedValue({
      data: null,
      errors: [{ message: 'GSI query error' }],
    })

    await checkAndSeedDatabase('user-123')

    expect(mockCreate).toHaveBeenCalledTimes(0)
    expect(console.error).toHaveBeenCalled()
  })

  it('still attempts all 12 create calls even when one throws', async () => {
    mockListByCustomerAndMonth.mockResolvedValue({ data: [], errors: null })

    // Slot for 2026-01 throws; all others succeed
    mockCreate.mockImplementation(async (record: { monthYear: string }) => {
      if (record.monthYear === '2026-01') {
        throw new Error('network error')
      }
      return { data: { id: 'ok' }, errors: null }
    })

    await checkAndSeedDatabase('user-123')

    // All 12 slots must be attempted despite the one failure
    expect(mockCreate).toHaveBeenCalledTimes(12)
    // The failed slot should have been logged as an error
    expect(console.error).toHaveBeenCalled()
  })

  /**
   * Property 4: batch fault isolation
   * Validates: Requirements 3.3
   */
  it('Property 4: always attempts all 12 create calls regardless of failure pattern', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
        async (failurePattern) => {
          // Reset mocks between runs
          mockListByCustomerAndMonth.mockReset()
          mockCreate.mockReset()
          vi.spyOn(console, 'error').mockImplementation(() => {})
          vi.spyOn(console, 'log').mockImplementation(() => {})

          mockListByCustomerAndMonth.mockResolvedValue({ data: [], errors: null })

          let callCount = 0
          mockCreate.mockImplementation(async () => {
            const idx = callCount++
            if (failurePattern[idx]) throw new Error('mock failure')
            return { data: { id: 'ok' }, errors: null }
          })

          await checkAndSeedDatabase('test-user')

          return callCount === 12
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ── Property-based tests ──────────────────────────────────────────────────────

describe('generateSeedRecords — property tests', () => {
  /**
   * Property 1: customerId propagation
   * Validates: Requirements 2.2
   */
  it('Property 1: every record has customerId === the input customerId', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (customerId) => {
        const records = generateSeedRecords(customerId)
        return records.every((r) => r.customerId === customerId)
      }),
      { numRuns: 100 }
    )
  })

  /**
   * Property 2: field format and domain invariants hold for all records
   * Validates: Requirements 2.3, 2.4, 2.5, 2.7
   */
  it('Property 2: field format and domain invariants hold for all records', () => {
    const RATE_PLANS = ['Day Rate', 'Evening Rate', 'Night Rate']
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (customerId) => {
        const records = generateSeedRecords(customerId)
        return records.every((r) =>
          /^\d{4}-\d{2}$/.test(r.monthYear) &&
          /^\d{4}-\d{2}-15$/.test(r.date) &&
          r.date.startsWith(r.monthYear) &&
          r.kwhUsage >= 200.0 &&
          r.kwhUsage <= 500.0 &&
          Math.round(r.kwhUsage * 100) / 100 === r.kwhUsage &&
          RATE_PLANS.includes(r.ratePlan)
        )
      }),
      { numRuns: 100 }
    )
  })

  /**
   * Property 3: statementAmount derivation
   * Validates: Requirements 2.6
   */
  it('Property 3: statementAmount === Math.round(kwhUsage * 0.15 * 100) / 100 for every record', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (customerId) => {
        const records = generateSeedRecords(customerId)
        return records.every(
          (r) => r.statementAmount === Math.round(r.kwhUsage * 0.15 * 100) / 100
        )
      }),
      { numRuns: 100 }
    )
  })
})
