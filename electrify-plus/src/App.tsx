import { useState, useEffect, useCallback } from 'react'
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react'
import { StorageManager } from '@aws-amplify/ui-react-storage'
import { fetchAuthSession } from 'aws-amplify/auth'
import ChatAssistant from './components/ChatAssistant'
import '@aws-amplify/ui-react/styles.css'
import './App.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DocStats {
  pdf: number
  word: number
  spreadsheet: number
  text: number
}

// ── DMS Dashboard ─────────────────────────────────────────────────────────────

function Dashboard() {
  const { signOut } = useAuthenticator()

  const [userSub, setUserSub] = useState<string | null>(null)
  const [username, setUsername] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  // Document Stats (Can be dynamically tied to DynamoDB)
  const [stats, setStats] = useState<DocStats>({
    pdf: 10,
    word: 11,
    spreadsheet: 3,
    text: 5,
  })

  const initUserSession = useCallback(async () => {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve user session')
    }
  }, [])

  useEffect(() => {
    void initUserSession()
  }, [initUserSession])

  return (
    <div className="app-page">
      {/* ── Header ── */}
      <header className="app-header">
        <div>
          <h1 className="app-header-title">Corporate Document Management System</h1>
          <p className="app-header-subtitle">
            Welcome {username ? `, ${username}` : ''}! Upload documents to expand AI Knowledge Base.
          </p>
        </div>
        <button onClick={signOut} className="app-sign-out-btn" type="button">
          Sign Out
        </button>
      </header>

      <main className="app-main">
        {error && (
          <div role="alert" className="app-error-banner">
            {error}
          </div>
        )}

        {/* ── Two-column grid: Document Stats & Upload (35%) + Chat (65%) ── */}
        <div className="app-content-grid">

          {/* ── Left Column: Document Stats + Storage Dropzone ── */}
          <div className="app-left-col">
            
            {/* Stats Card */}
            <section className="app-card" aria-labelledby="stats-heading">
              <h2 id="stats-heading" className="app-section-title">
                📚 Document Library Overview
              </h2>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-number">{stats.pdf}</div>
                  <div className="stat-label">PDFs</div>
                </div>
                <div className="stat-item">
                  <div className="stat-number">{stats.word}</div>
                  <div className="stat-label">Word (.docx)</div>
                </div>
                <div className="stat-item">
                  <div className="stat-number">{stats.spreadsheet}</div>
                  <div className="stat-label">Spreadsheets</div>
                </div>
                <div className="stat-item">
                  <div className="stat-number">{stats.text}</div>
                  <div className="stat-label">TXT / CSV</div>
                </div>
              </div>
            </section>

            {/* Amplify Storage Manager Dropzone */}
            <section className="app-card" aria-labelledby="upload-heading">
              <h2 id="upload-heading" className="app-section-title">
                📤 Upload New Document
              </h2>
              <p className="upload-subtitle">
                Drag and drop office files. The AI will chunk and index new paragraphs automatically.
              </p>
              
              <div className="storage-uploader-container">
                <StorageManager
                  acceptedFileTypes={['.pdf', '.docx', '.xlsx', '.csv', '.txt']}
                  path="public/documents/"
                  maxFileCount={5}
                  isResumable
                  onUploadSuccess={({ key }) => {
                    console.log(`Successfully uploaded: ${key}`)
                    // Increment text stat on success (mocking immediate UI update)
                    setStats((prev) => ({ ...prev, pdf: prev.pdf + 1 }))
                  }}
                />
              </div>

              <blockquote className="sync-note">
                ⚡ <strong>Auto-Sync Active:</strong> After uploading, please wait ~60 seconds before querying the assistant for newly uploaded content.
              </blockquote>
            </section>

          </div>

          {/* ── Right Column: RAG Chat Assistant ── */}
          <div className="app-right-col">
            <ChatAssistant username={username} customerId={userSub ?? undefined} />
          </div>

        </div>
      </main>
    </div>
  )
}

// ── Root Component ────────────────────────────────────────────────────────────

export default function App() {
  return (
    <Authenticator>
      <Dashboard />
    </Authenticator>
  )
}