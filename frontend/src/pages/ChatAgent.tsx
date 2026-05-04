// src/pages/ChatAgent.tsx — Full streaming AI agent with animated thinking, citations, history
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  createSSEStream, getAgentSuggestions, getAgentHistory, clearAgentHistory,
  type StreamingChunk, type ChatHistoryEntry, type CitationItem,
} from '../api/client'
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
// ── Types ─────────────────────────────────────────────────────────────────
type ChunkType = StreamingChunk['chunk_type']

interface MessageChunk {
  type: ChunkType
  content: string
  metadata?: Record<string, unknown>
}

type MessageRole = 'user' | 'assistant'

interface Message {
  id: string
  role: MessageRole
  text: string
  chunks: MessageChunk[]
  citations?: CitationItem[]
  processingMs?: number
  queryType?: string
  isStreaming?: boolean
  error?: string
  timestamp: number
}

// ── Config ────────────────────────────────────────────────────────────────
const CHUNK_CONFIG: Record<ChunkType, { label: string; icon: string; color: string; show: boolean }> = {
  thinking:         { label: 'Reasoning',       icon: '🧠', color: '#8B7CF7', show: true  },
  planning:         { label: 'Planning',         icon: '📋', color: '#38BDF8', show: true  },
  sql_result:       { label: 'SQL Query',        icon: '🗄️',  color: '#00D4B1', show: true  },
  rag_result:       { label: 'Semantic Search',  icon: '🔍', color: '#FFB600', show: true  },
  geo_result:       { label: 'Geo Analysis',     icon: '🗺️',  color: '#34D399', show: true  },
  anomaly_result:   { label: 'Anomaly Check',    icon: '⚠️',  color: '#FF7423', show: true  },
  desert_result:    { label: 'Desert Scoring',   icon: '🏜️',  color: '#D4A017', show: true  },
  medical_reasoning:{ label: 'Medical Reasoning',icon: '🏥', color: '#38BDF8', show: true  },
  final_answer:     { label: 'Answer',           icon: '✅', color: '#00D4B1', show: false },
  citations:        { label: 'Citations',        icon: '📚', color: '#8B7CF7', show: false },
  done:             { label: 'Done',             icon: '✓',  color: '#4A5E82', show: false },
  error:            { label: 'Error',            icon: '✗',  color: '#FF3B3B', show: false },
}

const QUERY_TYPE_LABELS: Record<string, string> = {
  hybrid:     '🔀 Hybrid',
  analytical: '📊 Analytical',
  geographic: '🗺️ Geographic',
  clinical:   '🏥 Clinical',
  anomaly:    '⚠️ Anomaly',
  rag:        '🔍 RAG Search',
  general:    '💬 General',
}

const DESERT_BADGE_COLORS: Record<string, string> = {
  'Critical Desert':   '#FF3B3B',
  'Severe Desert':     '#FF7423',
  'Moderate Desert':   '#FFB600',
  'Adequate Coverage': '#00D4B1',
  'At Risk':           '#D4A017',
}

// ── Helpers ───────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2)
const fmtTime = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
const fmtDate = (ts: number) => {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── Sub-components ────────────────────────────────────────────────────────

function ThinkingPulse({ type, content }: { type: ChunkType; content: string }) {
  const cfg = CHUNK_CONFIG[type]
  if (!cfg.show) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '8px 12px',
      borderRadius: 10,
      background: `${cfg.color}0D`,
      border: `1px solid ${cfg.color}22`,
      animation: 'fadeInUp 200ms both',
      fontSize: 12,
    }}>
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{cfg.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 700,
          color: cfg.color, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3,
        }}>
          {cfg.label}
        </div>
        <div style={{
          color: 'var(--text-secondary)', lineHeight: 1.55, fontSize: 12,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {content}
        </div>
      </div>
    </div>
  )
}

function StreamingDots() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 4 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%',
          background: 'var(--accent-teal)',
          animation: `pulse-dot 1.2s ${i * 0.2}s ease-in-out infinite`,
          display: 'inline-block',
        }} />
      ))}
    </span>
  )
}

function CitationCard({ c, index }: { c: CitationItem; index: number }) {
  const desertColor = DESERT_BADGE_COLORS[c.desert_label] || 'var(--text-muted)'
  return (
    <div style={{
      padding: '12px 14px',
      borderRadius: 10,
      background: 'var(--bg-surface)',
      border: '1px solid var(--bg-border)',
      animation: `fadeInUp ${150 + index * 50}ms both`,
      transition: 'all 150ms ease',
      cursor: 'default',
    }}
      onMouseEnter={e => {
        const el = e.currentTarget
        el.style.borderColor = 'var(--bg-border-accent)'
        el.style.transform = 'translateY(-1px)'
        el.style.boxShadow = 'var(--shadow-sm)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget
        el.style.borderColor = 'var(--bg-border)'
        el.style.transform = 'translateY(0)'
        el.style.boxShadow = 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12.5,
            color: 'var(--text-primary)', marginBottom: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {c.facility_name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {c.region} · {c.city}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
            color: 'var(--accent-teal)',
            background: 'rgba(0,212,177,0.1)',
            padding: '2px 6px', borderRadius: 4,
          }}>
            {(c.similarity_score * 100).toFixed(0)}% match
          </span>
          <span style={{ fontSize: 10, color: desertColor, fontWeight: 600 }}>
            {c.desert_label}
          </span>
        </div>
      </div>
      {c.snippet && (
        <div style={{
          marginTop: 8, fontSize: 11.5, color: 'var(--text-secondary)',
          lineHeight: 1.55,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          borderTop: '1px solid var(--bg-border)', paddingTop: 8,
        }}>
          {c.snippet}
        </div>
      )}
    </div>
  )
}

function HistoryItem({
  item, active, onClick,
}: { item: ChatHistoryEntry; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left',
        padding: '10px 12px', borderRadius: 8, border: 'none',
        background: active ? 'rgba(255,78,78,0.1)' : 'transparent',
        borderLeft: active ? '2px solid var(--accent-primary)' : '2px solid transparent',
        cursor: 'pointer', transition: 'all 150ms ease',
        animation: 'fadeInLeft 200ms both',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-card-hover)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{
        fontFamily: 'var(--font-body)', fontSize: 12, color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontWeight: active ? 600 : 400,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        marginBottom: 3,
      }}>
        {item.query}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{fmtDate(item.created_at)}</span>
        <span style={{ fontSize: 10, color: 'var(--accent-teal)', fontFamily: 'var(--font-mono)' }}>
          {fmtTime(item.processing_time_s * 1000)}
        </span>
      </div>
    </button>
  )
}

function AssistantMessage({ msg }: { msg: Message }) {
  const [citationsOpen, setCitationsOpen] = useState(false)
  const thinkingChunks = msg.chunks.filter(c => CHUNK_CONFIG[c.type]?.show)
  const [thinkingOpen, setThinkingOpen] = useState(false)

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', animation: 'fadeInUp 250ms both' }}>
      {/* Avatar */}
      <div style={{
        width: 32, height: 32, borderRadius: 10, flexShrink: 0,
        background: 'linear-gradient(135deg, #8B7CF7, #00D4B1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, boxShadow: '0 2px 8px rgba(139,124,247,0.25)',
        marginTop: 2,
      }}>
        🤖
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Thinking accordion */}
        {thinkingChunks.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <button
              onClick={() => setThinkingOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', borderRadius: 6, border: '1px solid var(--bg-border)',
                background: 'var(--bg-surface)', cursor: 'pointer',
                fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-body)',
                transition: 'all 150ms ease', marginBottom: 6,
              }}
            >
              <span style={{ fontSize: 12 }}>🧠</span>
              <span>{thinkingChunks.length} reasoning step{thinkingChunks.length > 1 ? 's' : ''}</span>
              <span style={{
                marginLeft: 2, transition: 'transform 200ms',
                transform: thinkingOpen ? 'rotate(180deg)' : 'rotate(0)',
                display: 'inline-block',
              }}>▾</span>
            </button>
            {thinkingOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {thinkingChunks.map((c, i) => (
                  <ThinkingPulse key={i} type={c.type} content={c.content} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Main bubble */}
        <div style={{
          padding: '14px 16px',
          borderRadius: '4px 18px 18px 18px',
          background: 'var(--bg-card)',
          border: '1px solid var(--bg-border)',
          fontSize: 13.5, lineHeight: 1.7,
          color: 'var(--text-primary)',
          boxShadow: 'var(--shadow-xs)',
        }}>
          {msg.isStreaming && !msg.text ? (
            <span style={{ color: 'var(--text-muted)' }}>
              Thinking<StreamingDots />
            </span>
          ) : (
            
            <MessageText text={msg.text} />

          )}
          {msg.isStreaming && msg.text && <StreamingDots />}
          {msg.error && (
            <div style={{
              marginTop: 10, padding: '8px 12px', borderRadius: 8,
              background: 'rgba(255,59,59,0.08)', border: '1px solid rgba(255,59,59,0.2)',
              color: '#FF6B6B', fontSize: 12,
            }}>
              ⚠️ {msg.error}
            </div>
          )}
        </div>

        {/* Footer: meta + citations toggle */}
        {!msg.isStreaming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7, flexWrap: 'wrap' }}>
            {msg.queryType && QUERY_TYPE_LABELS[msg.queryType] && (
              <span style={{
                fontSize: 11, color: 'var(--text-muted)',
                padding: '2px 8px', borderRadius: 999,
                background: 'var(--bg-surface)', border: '1px solid var(--bg-border)',
                fontFamily: 'var(--font-display)', fontWeight: 600,
              }}>
                {QUERY_TYPE_LABELS[msg.queryType]}
              </span>
            )}
            {msg.processingMs != null && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                ⏱ {fmtTime(msg.processingMs)}
              </span>
            )}
            {msg.citations && msg.citations.length > 0 && (
              <button
                onClick={() => setCitationsOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '3px 10px', borderRadius: 999, border: 'none',
                  background: citationsOpen ? 'rgba(139,124,247,0.15)' : 'rgba(139,124,247,0.08)',
                  color: '#8B7CF7', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                  fontFamily: 'var(--font-display)',
                  transition: 'all 150ms ease',
                }}
              >
                📚 {msg.citations.length} source{msg.citations.length > 1 ? 's' : ''}
                <span style={{
                  display: 'inline-block', transition: 'transform 200ms',
                  transform: citationsOpen ? 'rotate(180deg)' : 'rotate(0)',
                }}>▾</span>
              </button>
            )}
          </div>
        )}

        {/* Citations panel */}
        {citationsOpen && msg.citations && msg.citations.length > 0 && (
          <div style={{
            marginTop: 10,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 8,
            animation: 'fadeInUp 200ms both',
          }}>
            {msg.citations.map((c, i) => (
              <CitationCard key={c.unique_id || i} c={c} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function UserMessage({ msg }: { msg: Message }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', animation: 'fadeInUp 200ms both' }}>
      <div style={{
        maxWidth: '72%',
        padding: '12px 16px',
        borderRadius: '18px 4px 18px 18px',
        background: 'linear-gradient(135deg, rgba(255,78,78,0.18), rgba(139,124,247,0.14))',
        border: '1px solid rgba(255,78,78,0.22)',
        fontSize: 13.5, lineHeight: 1.6,
        color: 'var(--text-primary)',
        boxShadow: 'var(--shadow-xs)',
      }}>
        {msg.text}
      </div>
    </div>
  )
}

function MessageText({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <div className="msg-container">
      {lines.map((line, i) => {
        const trimmed = line.trim();

        // ── HEADINGS ─────────────────────────
        if (trimmed.startsWith("#### ")) {
          return <h4 key={i} className="msg-h4">{renderInline(trimmed.slice(5))}</h4>;
        }
        if (trimmed.startsWith("### ")) {
          return <h3 key={i} className="msg-h3">{renderInline(trimmed.slice(4))}</h3>;
        }
        if (trimmed.startsWith("## ")) {
          return <h2 key={i} className="msg-h2">{renderInline(trimmed.slice(3))}</h2>;
        }

        // ── BLOCKQUOTE ───────────────────────
        if (trimmed.startsWith("> ")) {
          return (
            <div key={i} className="msg-quote">
              {renderInline(trimmed.slice(2))}
            </div>
          );
        }

        // ── BULLET LIST ──────────────────────
        if (trimmed.startsWith("- ")) {
          return (
            <div key={i} className="msg-li">
              • {renderInline(trimmed.slice(2))}
            </div>
          );
        }

        // ── NUMBERED LIST ────────────────────
        if (/^\d+\.\s/.test(trimmed)) {
          return (
            <div key={i} className="msg-li">
              {renderInline(trimmed)}
            </div>
          );
        }

        // ── HORIZONTAL RULE ──────────────────
        if (trimmed === "---") {
          return <hr key={i} className="msg-hr" />;
        }

        // ── EMPTY LINE ───────────────────────
        if (!trimmed) {
          return <div key={i} className="msg-gap" />;
        }

        // ── NORMAL TEXT ──────────────────────
        return (
          <p key={i} className="msg-p">
            {renderInline(line)}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(text: string) {
  const parts = text.split(
    /(\*\*[^*]+\*\*|`[^`]+`|==[^=]+==|\[[^\]]+\]\([^)]+\)|(?<!\*)\*[^*]+\*(?!\*))/
  );

  return parts.map((part, i) => {
    // BOLD
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="msg-bold">{part.slice(2, -2)}</strong>;
    }

    // ITALIC (safe now)
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={i} className="msg-italic">{part.slice(1, -1)}</em>;
    }

    // CODE
    if (part.startsWith("```") && part.endsWith("```")) {
      return <code key={i} className="msg-code">{part.slice(1, -1)}</code>;
    }

    // HIGHLIGHT
    if (part.startsWith("`") && part.endsWith("`")) {
      return <mark key={i} className="msg-highlight">{part.slice(2, -2)}</mark>;
    }

    // LINK
    const linkMatch = part.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      return (
        <a key={i} href={linkMatch[2]} target="_blank" className="msg-link">
          {linkMatch[1]}
        </a>
      );
    }

    return <span key={i}>{part}</span>;
  });
}
// ── Live streaming step ticker ─────────────────────────────────────────────
function StreamingSteps({ chunks }: { chunks: MessageChunk[] }) {
  const active = chunks.filter(c => CHUNK_CONFIG[c.type]?.show)
  if (active.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {active.map((c, i) => {
        const cfg = CHUNK_CONFIG[c.type]
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 7,
            fontSize: 11.5, color: 'var(--text-secondary)',
            animation: 'fadeInLeft 180ms both',
          }}>
            <span style={{
              width: 18, height: 18, borderRadius: 5, flexShrink: 0,
              background: cfg.color + '1A',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10,
            }}>{cfg.icon}</span>
            <span style={{ color: cfg.color, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em' }}>
              {cfg.label}
            </span>
            <div style={{ flex: 1, height: 1, background: cfg.color + '20' }} />
            {i === active.length - 1 && (
              <span style={{ display: 'flex', gap: 2 }}>
                {[0,1,2].map(j => (
                  <span key={j} style={{
                    width: 3, height: 3, borderRadius: '50%', background: cfg.color,
                    animation: `pulse-dot 1s ${j * 0.15}s ease-in-out infinite`,
                    display: 'inline-block',
                  }}/>
                ))}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Suggestion chips ───────────────────────────────────────────────────────
function SuggestionChips({ suggestions, onSelect }: { suggestions: string[]; onSelect: (s: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => onSelect(s)}
          style={{
            padding: '7px 14px', borderRadius: 999,
            border: '1px solid var(--bg-border)',
            background: 'var(--bg-card)',
            color: 'var(--text-secondary)', cursor: 'pointer',
            fontSize: 12, fontFamily: 'var(--font-body)',
            transition: 'all 200ms var(--transition-spring)',
            animation: `scaleIn 250ms ${i * 40}ms both`,
            textAlign: 'left', lineHeight: 1.4,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(255,78,78,0.08)'
            e.currentTarget.style.borderColor = 'rgba(255,78,78,0.3)'
            e.currentTarget.style.color = 'var(--text-primary)'
            e.currentTarget.style.transform = 'translateY(-1px)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'var(--bg-card)'
            e.currentTarget.style.borderColor = 'var(--bg-border)'
            e.currentTarget.style.color = 'var(--text-secondary)'
            e.currentTarget.style.transform = 'translateY(0)'
          }}
        >
          {s}
        </button>
      ))}
    </div>
  )
}

// ── Main ChatAgent page ────────────────────────────────────────────────────
export default function ChatAgent() {
  const [messages, setMessages]       = useState<Message[]>([])
  const [input, setInput]             = useState('')
  const [streaming, setStreaming]      = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [history, setHistory]         = useState<ChatHistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [sessionId]                   = useState(() => `sess_${uid()}`)
  const cancelRef                     = useRef<(() => void) | null>(null)
  const bottomRef                     = useRef<HTMLDivElement>(null)
  const inputRef                      = useRef<HTMLTextAreaElement>(null)
  const startTimeRef                  = useRef<number>(0)

  // Load suggestions and history
  useEffect(() => {
    getAgentSuggestions().then(setSuggestions).catch(() => {})
    getAgentHistory(sessionId).then(setHistory).catch(() => {})
  }, [sessionId])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Send message
  const send = useCallback((text: string) => {
    const q = text.trim()
    if (!q || streaming) return

    const userMsg: Message = { id: uid(), role: 'user', text: q, chunks: [], timestamp: Date.now() }
    const aiId = uid()
    const aiMsg: Message = {
      id: aiId, role: 'assistant', text: '', chunks: [],
      isStreaming: true, timestamp: Date.now(),
    }

    setMessages(prev => [...prev, userMsg, aiMsg])
    setInput('')
    setStreaming(true)
    startTimeRef.current = Date.now()

    // Resize textarea back
    if (inputRef.current) inputRef.current.style.height = '44px'

    let finalAnswer = ''
    let citations: CitationItem[] = []
    let queryType = 'general'

    const cancel = createSSEStream(
      q,
      sessionId,
      // onChunk
      (chunk) => {
        if (chunk.chunk_type === 'final_answer') {
          finalAnswer = chunk.content
        } else if (chunk.chunk_type === 'citations') {
          try { citations = JSON.parse(chunk.content) } catch { citations = [] }
        }

        if (chunk.metadata?.query_type) queryType = chunk.metadata.query_type as string

        setMessages(prev => prev.map(m => {
          if (m.id !== aiId) return m
          const newChunks = [...m.chunks, { type: chunk.chunk_type, content: chunk.content, metadata: chunk.metadata }]
          const text = chunk.chunk_type === 'final_answer' ? chunk.content : m.text
          return { ...m, chunks: newChunks, text }
        }))
      },
      // onDone
      () => {
        const processingMs = Date.now() - startTimeRef.current
        setMessages(prev => prev.map(m =>
          m.id !== aiId ? m : {
            ...m, text: finalAnswer || m.text, citations,
            isStreaming: false, processingMs, queryType,
          }
        ))
        setStreaming(false)
        cancelRef.current = null
        // Refresh history
        getAgentHistory(sessionId).then(setHistory).catch(() => {})
      },
      // onError
      (err) => {
        setMessages(prev => prev.map(m =>
          m.id !== aiId ? m : { ...m, isStreaming: false, error: err }
        ))
        setStreaming(false)
        cancelRef.current = null
      },
    )

    cancelRef.current = cancel
  }, [streaming, sessionId])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const handleClear = async () => {
    if (streaming) { cancelRef.current?.(); setStreaming(false) }
    setMessages([])
    await clearAgentHistory(sessionId).catch(() => {})
    setHistory([])
  }

  const loadHistoryItem = (item: ChatHistoryEntry) => {
    setMessages([
      { id: uid(), role: 'user',      text: item.query,  chunks: [], timestamp: item.created_at * 1000 },
      { id: uid(), role: 'assistant', text: item.answer, chunks: [],
        queryType: item.query_type,
        processingMs: item.processing_time_s * 1000,
        timestamp: item.created_at * 1000 + item.processing_time_s * 1000,
      },
    ])
    setShowHistory(false)
  }

  // Current streaming message chunks
  const streamingMsg = useMemo(() => messages.find(m => m.isStreaming), [messages])

  return (
    <div className="page-body" style={{ padding: 0, display: 'flex', height: 'calc(100vh - 65px)', overflow: 'hidden' }}>

      {/* ── History Sidebar ───────────────────────────────────────────────── */}
      <div style={{
        width: showHistory ? 260 : 0,
        minWidth: showHistory ? 260 : 0,
        borderRight: '1px solid var(--bg-border)',
        background: 'var(--bg-surface)',
        overflow: 'hidden',
        transition: 'width 300ms cubic-bezier(0.4,0,0.2,1), min-width 300ms',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '16px 14px 10px',
          borderBottom: '1px solid var(--bg-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
            Query History
          </span>
          <button onClick={() => setShowHistory(false)} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 18, lineHeight: 1,
          }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
          {history.length === 0 ? (
            <div style={{ padding: '20px 14px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
              No history yet
            </div>
          ) : (
            history.map(item => (
              <HistoryItem
                key={item.id}
                item={item}
                active={false}
                onClick={() => loadHistoryItem(item)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Main Chat Area ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Chat header */}
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--bg-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--bg-card-glass)',
          backdropFilter: 'blur(10px)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: 'linear-gradient(135deg, #8B7CF7, #00D4B1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, boxShadow: '0 2px 10px rgba(139,124,247,0.3)',
            }}>🤖</div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                Ghana Health Intelligence Agent
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: streaming ? '#FFB600' : '#00D4B1',
                  boxShadow: streaming ? '0 0 6px rgba(255,182,0,0.6)' : '0 0 6px rgba(0,212,177,0.6)',
                  display: 'inline-block',
                  animation: 'pulse-dot 2s ease-in-out infinite',
                }}/>
                {streaming ? 'Generating response…' : 'Ready · RAG + SQL + Desert Intelligence'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setShowHistory(o => !o)}
              style={{
                padding: '7px 13px', borderRadius: 8,
                border: '1px solid var(--bg-border)',
                background: showHistory ? 'rgba(139,124,247,0.1)' : 'var(--bg-input)',
                color: showHistory ? '#8B7CF7' : 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-display)',
                fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5,
                transition: 'all 150ms ease',
              }}
            >
              📜 History
              {history.length > 0 && (
                <span style={{
                  background: '#8B7CF7', color: '#fff',
                  borderRadius: 999, width: 17, height: 17,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 800,
                }}>{history.length}</span>
              )}
            </button>
            {messages.length > 0 && (
              <button
                onClick={handleClear}
                style={{
                  padding: '7px 13px', borderRadius: 8,
                  border: '1px solid rgba(255,78,78,0.2)',
                  background: 'rgba(255,78,78,0.06)',
                  color: '#FF6B6B', cursor: 'pointer',
                  fontSize: 12, fontFamily: 'var(--font-display)', fontWeight: 600,
                  transition: 'all 150ms ease',
                }}
              >
                🗑 Clear
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '20px',
          display: 'flex', flexDirection: 'column', gap: 18,
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--bg-border) transparent',
        }}>
          {/* Empty state */}
          {messages.length === 0 && (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 20, paddingBottom: 40,
              animation: 'fadeIn 400ms both',
            }}>
              <div style={{
                width: 72, height: 72, borderRadius: 20,
                background: 'linear-gradient(135deg, rgba(139,124,247,0.2), rgba(0,212,177,0.15))',
                border: '1px solid rgba(139,124,247,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 32,
                boxShadow: '0 8px 32px rgba(139,124,247,0.15)',
              }}>🏥</div>
              <div style={{ textAlign: 'center', maxWidth: 480 }}>
                <div style={{
                  fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800,
                  color: 'var(--text-primary)', marginBottom: 8, letterSpacing: '-0.01em',
                }}>
                  Ask anything about Ghana's healthcare
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  Query facilities, medical deserts, anomalies, specialist gaps, and volunteer opportunities
                  across all {' '}
                  <span style={{ color: 'var(--accent-teal)', fontWeight: 600 }}>16 regions</span>
                  {' '}using natural language.
                </div>
              </div>

              {suggestions.length > 0 && (
                <div style={{ width: '100%', maxWidth: 640 }}>
                  <div style={{
                    fontSize: 11, color: 'var(--text-muted)', fontWeight: 700,
                    fontFamily: 'var(--font-display)', letterSpacing: '0.08em',
                    textTransform: 'uppercase', marginBottom: 10, textAlign: 'center',
                  }}>
                    Try asking
                  </div>
                  <SuggestionChips suggestions={suggestions.slice(0, 6)} onSelect={s => { setInput(s); inputRef.current?.focus() }} />
                </div>
              )}
            </div>
          )}

          {/* Message list */}
          {messages.map(msg => (
            msg.role === 'user'
              ? <UserMessage key={msg.id} msg={msg} />
              : <AssistantMessage key={msg.id} msg={msg} />
          ))}

          {/* Live streaming step ticker (shown below last message) */}
          {streaming && streamingMsg && (
            <div style={{
              marginLeft: 42,
              padding: '10px 14px',
              borderRadius: 10,
              background: 'var(--bg-surface)',
              border: '1px solid var(--bg-border)',
              maxWidth: 340,
            }}>
              <StreamingSteps chunks={streamingMsg.chunks} />
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Input area ────────────────────────────────────────────────── */}
        <div style={{
          padding: '14px 20px 18px',
          borderTop: '1px solid var(--bg-border)',
          background: 'var(--bg-card-glass)',
          backdropFilter: 'blur(10px)',
          flexShrink: 0,
        }}>
          {/* Quick suggestions (when messages exist) */}
          {messages.length > 0 && suggestions.length > 0 && !streaming && (
            <div style={{ marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {suggestions.slice(0, 3).map((s, i) => (
                <button
                  key={i}
                  onClick={() => { setInput(s); inputRef.current?.focus() }}
                  style={{
                    padding: '4px 11px', borderRadius: 999,
                    border: '1px solid var(--bg-border)',
                    background: 'var(--bg-input)',
                    color: 'var(--text-muted)', cursor: 'pointer',
                    fontSize: 11.5, fontFamily: 'var(--font-body)',
                    transition: 'all 150ms ease',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--bg-border-accent)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--bg-border)' }}
                >
                  {s.length > 52 ? s.slice(0, 52) + '…' : s}
                </button>
              ))}
            </div>
          )}

          {/* Input box */}
          <div style={{
            display: 'flex', gap: 10, alignItems: 'flex-end',
            padding: '10px 14px',
            borderRadius: 'var(--radius-xl)',
            background: 'var(--bg-card)',
            border: '1px solid var(--bg-border)',
            transition: 'all 220ms ease',
          }}
            onFocus={() => {}}
            ref={(el) => {
              if (!el) return
              const ta = el.querySelector('textarea')
              if (ta) {
                ta.addEventListener('focus', () => { el.style.borderColor = 'rgba(255,78,78,0.4)'; el.style.boxShadow = '0 0 0 3px rgba(255,78,78,0.08)' })
                ta.addEventListener('blur', () => { el.style.borderColor = 'var(--bg-border)'; el.style.boxShadow = 'none' })
              }
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => {
                setInput(e.target.value)
                // auto-resize
                e.target.style.height = '44px'
                e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about facilities, deserts, anomalies, specialist gaps…"
              disabled={streaming}
              rows={1}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text-primary)', fontFamily: 'var(--font-body)',
                fontSize: 13.5, lineHeight: 1.6, resize: 'none',
                minHeight: 44, maxHeight: 160,
                scrollbarWidth: 'thin',
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
              {streaming ? (
                <button
                  onClick={() => { cancelRef.current?.(); setStreaming(false) }}
                  title="Stop generating"
                  style={{
                    width: 36, height: 36, borderRadius: 10,
                    border: '1px solid rgba(255,78,78,0.3)',
                    background: 'rgba(255,78,78,0.1)',
                    color: '#FF6B6B', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, transition: 'all 150ms ease',
                  }}
                >⏹</button>
              ) : (
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim()}
                  title="Send (Enter)"
                  style={{
                    width: 36, height: 36, borderRadius: 10,
                    border: 'none',
                    background: input.trim()
                      ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-violet))'
                      : 'var(--bg-border)',
                    color: input.trim() ? '#fff' : 'var(--text-muted)',
                    cursor: input.trim() ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, transition: 'all 200ms var(--transition-spring)',
                    boxShadow: input.trim() ? '0 4px 12px rgba(255,78,78,0.3)' : 'none',
                    transform: input.trim() ? 'scale(1)' : 'scale(0.94)',
                  }}
                >↑</button>
              )}
            </div>
          </div>

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginTop: 8, paddingX: '2px',
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Enter to send · Shift+Enter for newline
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Session: {sessionId.slice(0, 12)}…
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}