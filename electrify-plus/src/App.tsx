import { useState, useEffect, useCallback } from 'react'
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react'
import { generateClient } from 'aws-amplify/data'
import { fetchAuthSession } from 'aws-amplify/auth'
import type { Schema } from '../amplify/data/resource'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import ChatAssistant from './components/ChatAssistant'

// ── Types ─────────────────────────────────────────────────────────────────────

type ConsumptionRecord = Schema['ConsumptionRecord']['type']

// ── Amplify data client ───────────────────────────────────────────────────────

const client = generateClient<Schema>()

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard() {
  const { signOut } = useAuthenticator()

  const [records, setRecords] = useState<ConsumptionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [userSub, setUserSub] = useState<string | null>(null)
  const [username, setUsername] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const fetchRecords = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const session = await fetchAuthSession()
      const payload = session.tokens?.idToken?.payload
      const sub = payload?.sub as string | undefined
      // Prefer the email prefix or Cognito preferred_username as display name
      const email = payload?.email as string | undefined
      setUsername(email ? email.split('@')[0] : undefined)

      if (!sub) {
        setError('Could not resolve Cognito user identity. Please sign out and sign back in.')
        return
      }

      setUserSub(sub)

      const { data: items, errors } = await client.models.ConsumptionRecord.listByCustomerAndMonth(
        { customerId: sub }
      )

      if (errors && errors.length > 0) {
        setError(errors.map((e) => e.message).join(', '))
        return
      }

      const sorted = [...(items ?? [])].sort((a, b) =>
        (a.monthYear ?? '').localeCompare(b.monthYear ?? '')
      )
      setRecords(sorted)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load records')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchRecords()
  }, [fetchRecords])

  const totalKwh = records.reduce((sum, r) => sum + (r.kwhUsage ?? 0), 0)
  const totalSpend = records.reduce((sum, r) => sum + (r.statementAmount ?? 0), 0)
  const avgKwh = records.length > 0 ? Math.round(totalKwh / records.length) : 0

  return (
    <div style={styles.page}>
      {/* ── Header ── */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.headerTitle}>Electrify! Plus Dashboard</h1>
          <p style={styles.headerSubtitle}>12-month energy consumption overview</p>
        </div>
        <button onClick={signOut} style={styles.signOutBtn} type="button">
          Sign Out
        </button>
      </header>

      <main style={styles.main}>
        {/* Error banner */}
        {error && (
          <div role="alert" style={styles.errorBanner}>
            {error}
          </div>
        )}

        {/* ── Two-column grid: data (60%) + chat (40%) ── */}
        <div style={styles.contentGrid}>

          {/* ── Left column: KPIs + Chart + Table ── */}
          <div style={styles.leftCol}>

            {/* KPI Cards */}
            <section style={styles.kpiRow} aria-label="Key metrics">
              <div style={styles.kpiCard}>
                <span style={styles.kpiLabel}>Total Consumption</span>
                <span style={styles.kpiValue}>
                  {loading ? '—' : `${totalKwh.toLocaleString()} kWh`}
                </span>
              </div>
              <div style={styles.kpiCard}>
                <span style={styles.kpiLabel}>Monthly Average</span>
                <span style={styles.kpiValue}>
                  {loading ? '—' : `${avgKwh} kWh`}
                </span>
              </div>
              <div style={styles.kpiCard}>
                <span style={styles.kpiLabel}>Total Spend</span>
                <span style={styles.kpiValue}>
                  {loading ? '—' : `$${totalSpend.toFixed(2)}`}
                </span>
              </div>
            </section>

            {/* Chart */}
            <section style={styles.card} aria-labelledby="chart-heading">
              <h2 id="chart-heading" style={styles.sectionTitle}>
                12-Month Consumption Chart
              </h2>
              {loading ? (
                <div style={styles.emptyState}>Connecting to Electrify Grid…</div>
              ) : records.length === 0 ? (
                <div style={styles.emptyState}>
                  <p style={{ margin: '0 0 8px' }}>No data found for Customer ID:</p>
                  <code style={styles.subCode}>{userSub ?? '—'}</code>
                  <p style={{ margin: '12px 0 0', fontSize: 13 }}>
                    Ensure your seed script uses this exact ID as <strong>customerId</strong>.
                  </p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={records}
                    margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e4e7" />
                    <XAxis dataKey="monthYear" tick={{ fontSize: 11 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} unit=" kWh" />
                    <Tooltip
                      formatter={(value: number) => [`${value} kWh`, 'Usage']}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e5e4e7' }}
                    />
                    <Legend />
                    <Bar dataKey="kwhUsage" name="kWh Usage" fill="#aa3bff" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </section>

            {/* Table */}
            <section style={styles.card} aria-labelledby="table-heading">
              <h2 id="table-heading" style={styles.sectionTitle}>
                Monthly Detail Table
              </h2>
              <div style={styles.tableWrapper}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Month</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>kWh Consumed</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Statement Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={3} style={{ ...styles.td, textAlign: 'center', color: '#6b6375' }}>
                          Connecting to Electrify Grid…
                        </td>
                      </tr>
                    ) : records.length === 0 ? (
                      <tr>
                        <td colSpan={3} style={{ ...styles.td, textAlign: 'center', color: '#6b6375' }}>
                          No records found.
                        </td>
                      </tr>
                    ) : (
                      records.map((row) => (
                        <tr key={row.id} style={styles.tr}>
                          <td style={styles.td}>{row.monthYear}</td>
                          <td style={{ ...styles.td, textAlign: 'right' }}>
                            {(row.kwhUsage ?? 0).toLocaleString()}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'right' }}>
                            ${(row.statementAmount ?? 0).toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {records.length > 0 && !loading && (
                    <tfoot>
                      <tr>
                        <td style={{ ...styles.td, fontWeight: 600 }}>Total</td>
                        <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>
                          {totalKwh.toLocaleString()}
                        </td>
                        <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>
                          ${totalSpend.toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>
          </div>

          {/* ── Right column: Chat Assistant ── */}
          <div style={styles.rightCol}>
            <ChatAssistant username={username} />
          </div>
        </div>
      </main>
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────────────────

export default function App() {
  return (
    <Authenticator>
      <Dashboard />
    </Authenticator>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100svh',
    background: '#f9f8fc',
    fontFamily: 'system-ui, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 32px',
    background: '#fff',
    borderBottom: '1px solid #e5e4e7',
  },
  headerTitle: {
    margin: 0,
    fontSize: 24,
    fontWeight: 600,
    color: '#08060d',
    letterSpacing: '-0.4px',
  },
  headerSubtitle: {
    margin: '4px 0 0',
    fontSize: 14,
    color: '#6b6375',
  },
  signOutBtn: {
    padding: '8px 18px',
    fontSize: 14,
    fontWeight: 500,
    borderRadius: 8,
    border: '1px solid #e5e4e7',
    background: '#fff',
    color: '#08060d',
    cursor: 'pointer',
  },
  main: {
    maxWidth: 1400,
    margin: '0 auto',
    padding: '28px 24px 48px',
  },
  errorBanner: {
    background: '#fff0f0',
    border: '1px solid #fca5a5',
    borderRadius: 8,
    padding: '12px 16px',
    color: '#b91c1c',
    fontSize: 14,
    marginBottom: 24,
  },
  contentGrid: {
    display: 'grid',
    gridTemplateColumns: '3fr 2fr',
    gap: 24,
    alignItems: 'start',
  },
  leftCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    minWidth: 0,  // prevents grid blowout on narrow screens
  },
  rightCol: {
    position: 'sticky' as const,
    top: 24,
    minWidth: 0,
  },
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 16,
  },
  kpiCard: {
    background: '#fff',
    border: '1px solid #e5e4e7',
    borderRadius: 12,
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  kpiLabel: {
    fontSize: 13,
    color: '#6b6375',
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  kpiValue: {
    fontSize: 28,
    fontWeight: 700,
    color: '#08060d',
    letterSpacing: '-0.5px',
  },
  card: {
    background: '#fff',
    border: '1px solid #e5e4e7',
    borderRadius: 12,
    padding: '24px 28px',
  },
  sectionTitle: {
    margin: '0 0 20px',
    fontSize: 17,
    fontWeight: 600,
    color: '#08060d',
    letterSpacing: '-0.2px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '48px 0',
    color: '#6b6375',
    fontSize: 14,
  },
  subCode: {
    display: 'inline-block',
    fontFamily: 'ui-monospace, Consolas, monospace',
    fontSize: 13,
    padding: '4px 10px',
    background: '#f4f3ec',
    borderRadius: 6,
    color: '#08060d',
    wordBreak: 'break-all',
  },
  tableWrapper: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
  },
  th: {
    padding: '10px 16px',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 600,
    color: '#6b6375',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    borderBottom: '2px solid #e5e4e7',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '12px 16px',
    color: '#08060d',
    borderBottom: '1px solid #f3f2f5',
  },
  tr: {
    transition: 'background 0.15s',
  },
}
