import { useState, useRef, useEffect } from 'react'
import './ChatAssistant.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'agent'
  content: string
}

interface ChatAssistantProps {
  username?: string
  customerId?: string | null
}

// ── Suggested prompts ─────────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  'Why is my bill higher this month?',
  'Compare usage to last year',
  'How can I reduce my bill?',
] as const

// ── Component ─────────────────────────────────────────────────────────────────

export default function ChatAssistant({ username, customerId }: ChatAssistantProps) {
  const displayName = username ?? 'there'

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'agent',
      content: `Hi ${displayName}! I can help you understand your energy usage, compare bills, or spot savings opportunities.`,
    },
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Scroll to latest message whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  // ── Real AgentCore API Integration ───────────────────────────────────────────
  const sendMessage = async (prompt: string) => {
    const trimmed = prompt.trim()
    if (!trimmed || thinking) return

    // 1. Add user message to UI immediately (exactly as they typed it)
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
    setInput('')
    setThinking(true)

    // 2. Invisible Context Injection
    // We append the secure Cognito ID behind the scenes so the Waiter
    // and the Agent explicitly know who is asking.
    const enrichedMessage = `${trimmed}\n\n[SYSTEM CONTEXT: The currently authenticated user has customerId: ${customerId || 'unknown'}]`

    try {
      const response = await fetch('/api/invocations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agentcore-Local': 'true',
        },
        body: JSON.stringify({
          message: enrichedMessage,
          sessionId: customerId || 'guest-session',
        }),
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error(`AgentCore HTTP error! status: ${response.status} - ${err}`)
      }

      // 3. Parse the Server-Sent Events (SSE) stream
      const rawText = await response.text()
      let combinedText = ''

      const lines = rawText.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const chunk = line.slice(6).trim()
          if (chunk === '[DONE]') continue

          try {
            const parsed = JSON.parse(chunk)
            if (typeof parsed === 'string') {
              combinedText += parsed
            } else {
              combinedText += parsed.text || parsed.message || parsed.content || ''
            }
          } catch {
            combinedText += chunk
          }
        }
      }

      // 4. Update the UI with the clean, combined text
      setMessages((prev) => [
        ...prev,
        {
          role: 'agent',
          content: combinedText.trim() || 'Sorry, I received an empty response format.',
        },
      ])
    } catch (error) {
      console.error('Agent API Connection Error:', error)
      setMessages((prev) => [
        ...prev,
        {
          role: 'agent',
          content: "⚠️ I couldn't reach the brain! Make sure the `agentcore dev` server is currently running in your terminal.",
        },
      ])
    } finally {
      setThinking(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void sendMessage(input)
  }

  const clearChat = () => {
    setMessages([
      {
        role: 'agent',
        content: `Hi ${displayName}! I can help you understand your energy usage, compare bills, or spot savings opportunities.`,
      },
    ])
    setInput('')
  }

  return (
    <aside className="ca-panel" aria-label="Energy Assistant chat">
      {/* ── Header ── */}
      <div className="ca-header">
        <div className="ca-header-left">
          <span className="ca-icon" aria-hidden="true">⚡</span>
          <div>
            <p className="ca-title">Energy Assistant</p>
            <p className="ca-subtitle">Powered by AI</p>
          </div>
        </div>
        <button onClick={clearChat} className="ca-clear-btn" type="button">
          Clear chat
        </button>
      </div>

      {/* ── Message list ── */}
      <div className="ca-message-list" role="log" aria-live="polite" aria-label="Chat messages">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`ca-bubble ${msg.role === 'user' ? 'ca-bubble--user' : 'ca-bubble--agent'}`}
          >
            {msg.content}
          </div>
        ))}

        {/* Thinking indicator */}
        {thinking && (
          <div className="ca-bubble ca-bubble--agent ca-bubble--thinking">
            <span className="ca-dot" />
            <span className="ca-dot" />
            <span className="ca-dot" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Suggested prompts ── */}
      {messages.length <= 1 && !thinking && (
        <div className="ca-prompt-row" role="list" aria-label="Suggested questions">
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p}
              role="listitem"
              className="ca-prompt-pill"
              type="button"
              onClick={() => void sendMessage(p)}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* ── Input area ── */}
      <form onSubmit={handleSubmit} className="ca-input-row" aria-label="Send a message">
        <input
          className="ca-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your energy usage..."
          disabled={thinking}
          aria-label="Message input"
        />
        <button
          className="ca-send-btn"
          type="submit"
          disabled={!input.trim() || thinking}
          aria-label="Send message"
        >
          ↑
        </button>
      </form>
    </aside>
  )
}
