import { useState, useRef, useEffect } from 'react'
import { fetchAuthSession } from 'aws-amplify/auth'
import { v4 as uuidv4 } from 'uuid'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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

// ── Environment config ────────────────────────────────────────────────────────

const GATEWAY_URL = import.meta.env.VITE_AGENT_GATEWAY_URL || '/api/invocations'
const IS_LOCAL = !import.meta.env.VITE_AGENT_GATEWAY_URL

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getCognitoToken(): Promise<string | null> {
  if (IS_LOCAL) return null
  try {
    const session = await fetchAuthSession()
    return session.tokens?.accessToken?.toString() ?? null
  } catch {
    return null
  }
}

// ── SSE / JSON response parser ────────────────────────────────────────────────

// ── SSE / JSON response parser ────────────────────────────────────────────────

function parseAgentResponse(rawText: string): string {
  try {
    // 1. Unwrap the Lambda proxy wrapper
    const outer = JSON.parse(rawText);
    
    // Check for Lambda-level errors
    if (outer.statusCode && outer.statusCode >= 400) {
      return `⚠️ API Error: ${outer.body}`;
    }

    // Extract the inner payload (the SSE stream or flat JSON)
    const bodyContent = outer.body ?? rawText;

    // 2. Parse SSE Stream
    if (typeof bodyContent === 'string' && bodyContent.includes('data:')) {
      let text = '';
      for (const line of bodyContent.split('\n')) {
        const trimmedLine = line.trim();
        if (!trimmedLine.startsWith('data:')) continue;
        
        const chunk = trimmedLine.slice(5).trim();
        if (!chunk || chunk === '[DONE]') continue;
        
        try {
          const parsedChunk = JSON.parse(chunk);
          // Extract text from Bedrock's contentBlockDelta stream
          text += parsedChunk?.event?.contentBlockDelta?.delta?.text ?? '';
        } catch {
          // Skip unparseable chunks
        }
      }
      // If we successfully extracted text from the stream, return it
      if (text) {
        // 🛑 NEW: Strip out the internal <thinking> block so the customer doesn't see it
        return text.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '').trim();
      }
    }

    // 3. Parse Flat JSON (if it wasn't a stream)
    const candidate = typeof bodyContent === 'string' ? JSON.parse(bodyContent) : bodyContent;
    if (candidate?.error || candidate?.errorMessage) {
      return `⚠️ Agent error: ${candidate.error ?? candidate.errorMessage}`;
    }
    return (
      candidate?.message ??
      candidate?.response ??
      candidate?.result ??
      candidate?.content ??
      rawText
    );
  } catch {
    // Fallback if parsing fails completely
    return rawText;
  }
}

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

  // Stable session ID: use customerId when authenticated, otherwise a UUID
  // that persists for the lifetime of this page load. The backend agent cache
  // uses this to find the right SlidingWindowConversationManager instance.
  const [guestSessionId] = useState(() => `guest-${uuidv4()}`)
  const sessionId = customerId ?? guestSessionId

  // Hardcoded test customer for local dev when no auth session exists
  const TEST_CUSTOMER_ID = '1478d408-e001-7050-632c-dc39d95ccff2'
  const activeCustomerId = customerId ?? TEST_CUSTOMER_ID

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = async (userPrompt: string) => {
    const trimmed = userPrompt.trim()
    if (!trimmed || thinking) return

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
    setInput('')
    setThinking(true)

    // Inject customerId so the agent never needs to ask for it.
    // The server's SlidingWindowConversationManager retains this context
    // across turns — the frontend does NOT send history.
    const enrichedPrompt = `${trimmed}\n\n[SYSTEM CONTEXT: The authenticated customerId is ${activeCustomerId}. CRITICAL RULE: You MUST format all billing data as a strict Markdown table using | Month | Usage | Amount |. Do NOT use bullet points.]`
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }

      if (IS_LOCAL) {
        headers['X-Agentcore-Local'] = 'true'
      } else {
        const token = await getCognitoToken()
        if (token) headers['Authorization'] = `Bearer ${token}`
      }

      // Send only the current prompt + sessionId.
      // Conversation history is managed server-side by SlidingWindowConversationManager.
      // The agent cache key is sessionId, so the same window is reused across turns.
      const response = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: enrichedPrompt,
          sessionId,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }

      const replyText = parseAgentResponse(await response.text())

      setMessages((prev) => [
        ...prev,
        {
          role: 'agent',
          content: replyText.trim() || 'Received an empty response from the assistant.',
        },
      ])
    } catch (error) {
      console.error('Agent error:', error)
      setMessages((prev) => [
        ...prev,
        {
          role: 'agent',
          content: IS_LOCAL
            ? '⚠️ Unable to reach local agent. Make sure `uv run agentcore dev` is active.'
            : '⚠️ Unable to connect to the Energy Assistant. Please try again.',
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
            style={msg.role === 'user' ? { whiteSpace: 'pre-wrap' } : {}}
          >
            {msg.role === 'agent' ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {msg.content}
              </ReactMarkdown>
            ) : (
              msg.content
            )}
          </div>
        ))}

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

      {/* ── Input ── */}
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