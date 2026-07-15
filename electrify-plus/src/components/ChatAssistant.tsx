import { useState, useRef, useEffect } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'agent'
  content: string
}

interface ChatAssistantProps {
  username?: string
}

// ── Suggested prompts ─────────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  'Why is my bill higher this month?',
  'Compare usage to last year',
  'How can I reduce my bill?',
] as const

// ── Component ─────────────────────────────────────────────────────────────────

export default function ChatAssistant({ username }: ChatAssistantProps) {
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

  // Placeholder — will be replaced with AgentCore API Gateway call
  const sendMessage = async (prompt: string) => {
    const trimmed = prompt.trim()
    if (!trimmed || thinking) return

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
    setInput('')
    setThinking(true)

    // Simulate network latency until real API is wired in
    await new Promise((resolve) => setTimeout(resolve, 1200))

    setMessages((prev) => [
      ...prev,
      {
        role: 'agent',
        content:
          "I'm analysing your energy data now. This response will be powered by the AgentCore API once connected.",
      },
    ])
    setThinking(false)
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
    <aside style={s.panel} aria-label="Energy Assistant chat">
      {/* ── Header ── */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.icon} aria-hidden="true">⚡</span>
          <div>
            <p style={s.title}>Energy Assistant</p>
            <p style={s.subtitle}>Powered by AI</p>
          </div>
        </div>
        <button onClick={clearChat} style={s.clearBtn} type="button">
          Clear chat
        </button>
      </div>

      {/* ── Message list ── */}
      <div style={s.messageList} role="log" aria-live="polite" aria-label="Chat messages">
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...s.bubble,
              ...(msg.role === 'user' ? s.bubbleUser : s.bubbleAgent),
            }}
          >
            {msg.content}
          </div>
        ))}

        {/* Thinking indicator */}
        {thinking && (
          <div style={{ ...s.bubble, ...s.bubbleAgent, ...s.thinking }}>
            <span style={s.dot} />
            <span style={s.dot} />
            <span style={s.dot} />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Suggested prompts ── */}
      {messages.length <= 1 && !thinking && (
        <div style={s.promptRow} role="list" aria-label="Suggested questions">
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p}
              role="listitem"
              style={s.promptPill}
              type="button"
              onClick={() => void sendMessage(p)}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* ── Input area ── */}
      <form onSubmit={handleSubmit} style={s.inputRow} aria-label="Send a message">
        <input
          style={s.input}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your energy usage..."
          disabled={thinking}
          aria-label="Message input"
        />
        <button
          style={{
            ...s.sendBtn,
            ...((!input.trim() || thinking) ? s.sendBtnDisabled : {}),
          }}
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

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    background: '#fff',
    border: '1px solid #e5e4e7',
    borderRadius: 12,
    overflow: 'hidden',
    height: '100%',
    minHeight: 520,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 18px',
    borderBottom: '1px solid #e5e4e7',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  icon: {
    fontSize: 22,
    lineHeight: 1,
  },
  title: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: '#08060d',
  },
  subtitle: {
    margin: 0,
    fontSize: 11,
    color: '#aa3bff',
    fontWeight: 500,
    letterSpacing: '0.3px',
  },
  clearBtn: {
    fontSize: 12,
    padding: '5px 12px',
    borderRadius: 6,
    border: '1px solid #e5e4e7',
    background: '#fff',
    color: '#6b6375',
    cursor: 'pointer',
  },
  messageList: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  bubble: {
    maxWidth: '85%',
    padding: '10px 14px',
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  bubbleAgent: {
    alignSelf: 'flex-start',
    background: '#f4f3ec',
    color: '#08060d',
    borderBottomLeftRadius: 4,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    background: '#aa3bff',
    color: '#fff',
    borderBottomRightRadius: 4,
  },
  thinking: {
    display: 'flex',
    gap: 5,
    alignItems: 'center',
    padding: '12px 16px',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#9ca3af',
    display: 'inline-block',
    animation: 'pulse 1.2s ease-in-out infinite',
  },
  promptRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '0 14px 12px',
    flexShrink: 0,
  },
  promptPill: {
    alignSelf: 'flex-start',
    fontSize: 12,
    padding: '6px 14px',
    borderRadius: 20,
    border: '1px solid #e0d7f7',
    background: 'rgba(170,59,255,0.06)',
    color: '#7c3aed',
    cursor: 'pointer',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  inputRow: {
    display: 'flex',
    gap: 8,
    padding: '12px 14px',
    borderTop: '1px solid #e5e4e7',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    fontSize: 13,
    padding: '9px 14px',
    borderRadius: 8,
    border: '1px solid #e5e4e7',
    background: '#f9f8fc',
    color: '#08060d',
    outline: 'none',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: 'none',
    background: '#aa3bff',
    color: '#fff',
    fontSize: 16,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sendBtnDisabled: {
    background: '#e5e4e7',
    color: '#9ca3af',
    cursor: 'not-allowed',
  },
}
