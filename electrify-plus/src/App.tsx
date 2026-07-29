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
import './App.css'
import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json'; // adjust path as needed

Amplify.configure(outputs);
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
    <div className="app-page">
      {/* ── Header ── */}
      <header className="app-header">
        <div>
          <h1 className="app-header-title">Electrify! Plus Dashboard</h1>
          <p className="app-header-subtitle">12-month energy consumption overview</p>
        </div>
        <button onClick={signOut} className="app-sign-out-btn" type="button">
          Sign Out
        </button>
      </header>

      <main className="app-main">
        {/* Error banner */}
        {error && (
          <div role="alert" className="app-error-banner">
            {error}
          </div>
        )}

        {/* ── Two-column grid: data (60%) + chat (40%) ── */}
        <div className="app-content-grid">

          {/* ── Left column: KPIs + Chart + Table ── */}
          <div className="app-left-col">

            {/* KPI Cards */}
            <section className="app-kpi-row" aria-label="Key metrics">
              <div className="app-kpi-card">
                <span className="app-kpi-label">Total Consumption</span>
                <span className="app-kpi-value">
                  {loading ? '—' : `${totalKwh.toLocaleString()} kWh`}
                </span>
              </div>
              <div className="app-kpi-card">
                <span className="app-kpi-label">Monthly Average</span>
                <span className="app-kpi-value">
                  {loading ? '—' : `${avgKwh} kWh`}
                </span>
              </div>
              <div className="app-kpi-card">
                <span className="app-kpi-label">Total Spend</span>
                <span className="app-kpi-value">
                  {loading ? '—' : `$${totalSpend.toFixed(2)}`}
                </span>
              </div>
            </section>

            {/* Chart */}
            <section className="app-card" aria-labelledby="chart-heading">
              <h2 id="chart-heading" className="app-section-title">
                12-Month Consumption Chart
              </h2>
              {loading ? (
                <div className="app-empty-state">Connecting to Electrify Grid…</div>
              ) : records.length === 0 ? (
                <div className="app-empty-state">
                  <p style={{ margin: '0 0 8px' }}>No data found for Customer ID:</p>
                  <code className="app-sub-code">{userSub ?? '—'}</code>
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
            <section className="app-card" aria-labelledby="table-heading">
              <h2 id="table-heading" className="app-section-title">
                Monthly Detail Table
              </h2>
              <div className="app-table-wrapper">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th className="app-th">Month</th>
                      <th className="app-th app-th--right">kWh Consumed</th>
                      <th className="app-th app-th--right">Statement Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={3} className="app-td app-td--right" style={{ color: '#6b6375', textAlign: 'center' }}>
                          Connecting to Electrify Grid…
                        </td>
                      </tr>
                    ) : records.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="app-td" style={{ textAlign: 'center', color: '#6b6375' }}>
                          No records found.
                        </td>
                      </tr>
                    ) : (
                      records.map((row) => (
                        <tr key={row.id} className="app-tr">
                          <td className="app-td">{row.monthYear}</td>
                          <td className="app-td app-td--right">
                            {(row.kwhUsage ?? 0).toLocaleString()}
                          </td>
                          <td className="app-td app-td--right">
                            ${(row.statementAmount ?? 0).toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {records.length > 0 && !loading && (
                    <tfoot>
                      <tr>
                        <td className="app-td app-td--bold">Total</td>
                        <td className="app-td app-td--right app-td--bold">
                          {totalKwh.toLocaleString()}
                        </td>
                        <td className="app-td app-td--right app-td--bold">
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
          <div className="app-right-col">
            <ChatAssistant username={username} customerId={userSub ?? undefined} />
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
