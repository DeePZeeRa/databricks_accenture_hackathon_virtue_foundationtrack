// src/pages/ChatAgent.tsx — v4 · Advanced streaming AI agent with full UX polish
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  createSSEStream, getAgentSuggestions, getAgentHistory, clearAgentHistory,
  type StreamingChunk, type ChatHistoryEntry, type CitationItem,
} from '../api/client'

// ── Types ─────────────────────────────────────────────────────────────────────
type ChunkType = StreamingChunk['chunk_type']
interface MessageChunk { type: ChunkType; content: string; metadata?: Record<string,unknown> }
type MessageRole = 'user' | 'assistant'
interface Message {
  id: string; role: MessageRole; text: string; chunks: MessageChunk[]
  citations?: CitationItem[]; processingMs?: number; queryType?: string
  isStreaming?: boolean; error?: string; timestamp: number
}

// ── Config ────────────────────────────────────────────────────────────────────
const CHUNK_CONFIG: Record<ChunkType, { label:string; icon:string; color:string; show:boolean }> = {
  thinking:          { label:'Reasoning',        icon:'🧠', color:'#8B7CF7', show:true  },
  planning:          { label:'Planning',          icon:'📋', color:'#38BDF8', show:true  },
  sql_result:        { label:'SQL Query',         icon:'🗄️',  color:'#00D4B1', show:true  },
  rag_result:        { label:'Semantic Search',   icon:'🔍', color:'#FFB600', show:true  },
  geo_result:        { label:'Geo Analysis',      icon:'🗺️',  color:'#34D399', show:true  },
  anomaly_result:    { label:'Anomaly Check',     icon:'⚠️',  color:'#FF7423', show:true  },
  desert_result:     { label:'Desert Scoring',    icon:'🏜️',  color:'#D4A017', show:true  },
  medical_reasoning: { label:'Medical Reasoning', icon:'🏥', color:'#38BDF8', show:true  },
  ngo_result:        { label:'NGO Search',        icon:'🤝', color:'#A78BFA', show:true  },
  web_result:        { label:'Web Search',        icon:'🌐', color:'#38BDF8', show:true  },
  workforce_result:  { label:'Workforce Analysis',icon:'👥', color:'#A78BFA', show:true  },
  validation_result: { label:'Validation Node',   icon:'⚖️',  color:'#34D399', show:true  },
  resource_result:   { label:'Resource Allocation',icon:'📦', color:'#FFB600', show:true  },
  final_answer:      { label:'Answer',            icon:'✅', color:'#00D4B1', show:false },
  citations:         { label:'Citations',         icon:'📚', color:'#8B7CF7', show:false },
  done:              { label:'Done',              icon:'✓',  color:'#4A5E82', show:false },
  error:             { label:'Error',             icon:'✗',  color:'#FF3B3B', show:false },
}

const QUERY_TYPE_LABELS: Record<string,string> = {
  hybrid:'🔀 Hybrid', analytical:'📊 Analytical', geographic:'🗺️ Geographic',
  clinical:'🏥 Clinical', anomaly:'⚠️ Anomaly', rag:'🔍 RAG', general:'💬 General',
}

const DESERT_BADGE_COLORS: Record<string,string> = {
  'Critical Desert':'#FF3B3B','Severe Desert':'#FF7423',
  'Moderate Desert':'#FFB600','Adequate Coverage':'#00D4B1','At Risk':'#D4A017',
}

const EXAMPLE_PROMPTS = [
  { icon:'🏥', text:'Which regions have the most critical medical deserts?' },
  { icon:'🩺', text:'List hospitals with emergency care in the Northern Region' },
  { icon:'👻', text:'Show me ghost facility anomalies and their risk levels' },
  { icon:'🤝', text:'Find NGOs accepting volunteers in underserved areas' },
  { icon:'🎓', text:'Where are the biggest cardiology and surgery gaps?' },
  { icon:'📊', text:'Give me a statistical summary of facility anomaly flags' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
const uid   = () => Math.random().toString(36).slice(2)
const fmtMs = (ms:number) => ms<1000 ? `${ms}ms` : `${(ms/1000).toFixed(1)}s`
const fmtDate = (ts:number) => new Date(ts*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})

async function copyToClipboard(text:string) {
  try { await navigator.clipboard.writeText(text); return true }
  catch { return false }
}

// ── Streaming dots ────────────────────────────────────────────────────────────
function StreamingDots() {
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:3,marginLeft:4,verticalAlign:'middle'}}>
      {[0,1,2].map(i=>(
        <span key={i} style={{
          width:5,height:5,borderRadius:'50%',background:'var(--accent-teal)',
          animation:`pulseDot 1.2s ${i*0.2}s ease-in-out infinite`,display:'inline-block',
        }}/>
      ))}
    </span>
  )
}

// ── Thinking step pill ────────────────────────────────────────────────────────
function ThinkingPill({ type, content }: { type:ChunkType; content:string }) {
  const cfg = CHUNK_CONFIG[type]
  if (!cfg.show) return null
  return (
    <div style={{
      display:'flex',alignItems:'flex-start',gap:9,
      padding:'8px 12px',borderRadius:10,
      background:`${cfg.color}0d`,border:`1px solid ${cfg.color}22`,
      animation:'fadeInUp 200ms both',fontSize:12,
    }}>
      <span style={{fontSize:14,flexShrink:0,marginTop:1}}>{cfg.icon}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontFamily:'var(--font-display)',fontSize:9.5,fontWeight:700,color:cfg.color,letterSpacing:'0.09em',textTransform:'uppercase',marginBottom:3}}>
          {cfg.label}
        </div>
        <div style={{color:'var(--text-secondary)',lineHeight:1.55,fontSize:11.5,
          display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical',overflow:'hidden'}}>
          {content}
        </div>
      </div>
    </div>
  )
}

// ── Live step ticker (shown during streaming) ─────────────────────────────────
function LiveStepTicker({ chunks }: { chunks:MessageChunk[] }) {
  const active = chunks.filter(c=>CHUNK_CONFIG[c.type]?.show)
  if (active.length===0) return null
  return (
    <div style={{display:'flex',flexDirection:'column',gap:5}}>
      {active.map((c,i)=>{
        const cfg = CHUNK_CONFIG[c.type]
        return (
          <div key={i} style={{
            display:'flex',alignItems:'center',gap:8,
            fontSize:11.5,color:'var(--text-secondary)',
            animation:'fadeInLeft 180ms both',
          }}>
            <span style={{
              width:22,height:22,borderRadius:6,flexShrink:0,
              background:`${cfg.color}18`,
              display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,
            }}>{cfg.icon}</span>
            <span style={{color:cfg.color,fontFamily:'var(--font-display)',fontWeight:700,fontSize:10,letterSpacing:'0.06em',textTransform:'uppercase'}}>
              {cfg.label}
            </span>
            <div style={{flex:1,height:1,background:`${cfg.color}20`}}/>
            {i===active.length-1&&(
              <span style={{display:'flex',gap:2}}>
                {[0,1,2].map(j=>(
                  <span key={j} style={{
                    width:3,height:3,borderRadius:'50%',background:cfg.color,
                    animation:`pulseDot 1s ${j*0.15}s ease-in-out infinite`,display:'inline-block',
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

// ── Citation card ─────────────────────────────────────────────────────────────
function CitationCard({ c, index }: { c:CitationItem; index:number }) {
  const desertColor = DESERT_BADGE_COLORS[c.desert_label]||'var(--text-muted)'
  const matchPct = (c.similarity_score*100).toFixed(0)
  return (
    <div style={{
      padding:'11px 13px',borderRadius:10,
      background:'var(--bg-surface)',border:'1px solid var(--bg-border)',
      animation:`fadeInUp ${150+index*40}ms both`,
      transition:'all 150ms ease',cursor:'default',
    }}
    onMouseEnter={e=>{const el=e.currentTarget as HTMLElement;el.style.borderColor='var(--bg-border-accent)';el.style.transform='translateY(-1px)';el.style.boxShadow='var(--shadow-sm)'}}
    onMouseLeave={e=>{const el=e.currentTarget as HTMLElement;el.style.borderColor='var(--bg-border)';el.style.transform='translateY(0)';el.style.boxShadow='none'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:12,color:'var(--text-primary)',marginBottom:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
            {c.facility_name}
          </div>
          <div style={{fontSize:10.5,color:'var(--text-muted)'}}>{c.region}·{c.city}</div>
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,flexShrink:0}}>
          <span style={{
            fontFamily:'var(--font-mono)',fontSize:10,fontWeight:700,color:'var(--accent-teal)',
            background:'rgba(0,212,177,0.1)',padding:'2px 6px',borderRadius:4,
          }}>{matchPct}% match</span>
          <span style={{fontSize:10,color:desertColor,fontWeight:600}}>{c.desert_label}</span>
        </div>
      </div>
      {c.snippet&&(
        <div style={{
          marginTop:7,fontSize:11,color:'var(--text-secondary)',lineHeight:1.55,
          display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',
          borderTop:'1px solid var(--bg-border)',paddingTop:7,
        }}>{c.snippet}</div>
      )}
    </div>
  )
}

// ── Web result card ───────────────────────────────────────────────────────────
function WebResultCard({ result, index }: { result:{title:string;snippet:string;url:string;source:string}; index:number }) {
  return (
    <div style={{
      padding:'9px 11px',borderRadius:8,
      background:'var(--bg-surface)',border:'1px solid rgba(56,189,248,0.18)',
      animation:`fadeInUp ${100+index*60}ms both`,marginBottom:5,
    }}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:11.5,color:'#38BDF8',marginBottom:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
            {result.url
              ? <a href={result.url} target="_blank" rel="noopener noreferrer" style={{color:'inherit',textDecoration:'none'}}>🔗 {result.title}</a>
              : result.title}
          </div>
          <div style={{fontSize:11,color:'var(--text-secondary)',lineHeight:1.5,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>
            {result.snippet}
          </div>
        </div>
        <span style={{flexShrink:0,fontSize:9.5,fontWeight:600,color:'var(--text-muted)',background:'rgba(56,189,248,0.07)',padding:'2px 6px',borderRadius:4,whiteSpace:'nowrap'}}>
          {result.source}
        </span>
      </div>
    </div>
  )
}

// ── History sidebar item ──────────────────────────────────────────────────────
function HistoryItem({ item, active, onClick }: { item:ChatHistoryEntry; active:boolean; onClick:()=>void }) {
  return (
    <button onClick={onClick} style={{
      width:'100%',textAlign:'left',padding:'9px 11px',borderRadius:8,border:'none',
      background:active?'rgba(255,78,78,0.09)':'transparent',
      borderLeft:active?'2px solid var(--accent-primary)':'2px solid transparent',
      cursor:'pointer',transition:'all 150ms ease',animation:'fadeInLeft 200ms both',
    }}
    onMouseEnter={e=>{if(!active)(e.currentTarget as HTMLElement).style.background='var(--bg-card-hover)'}}
    onMouseLeave={e=>{if(!active)(e.currentTarget as HTMLElement).style.background='transparent'}}>
      <div style={{fontSize:11.5,color:active?'var(--text-primary)':'var(--text-secondary)',fontWeight:active?600:400,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',marginBottom:3}}>
        {item.query}
      </div>
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <span style={{fontSize:10,color:'var(--text-muted)'}}>{fmtDate(item.created_at)}</span>
        <span style={{fontSize:10,color:'var(--accent-teal)',fontFamily:'var(--font-mono)'}}>{fmtMs(item.processing_time_s*1000)}</span>
        {item.query_type && <span style={{fontSize:9,color:'var(--text-muted)',background:'var(--bg-border)',padding:'1px 5px',borderRadius:4}}>{item.query_type}</span>}
      </div>
    </button>
  )
}

// ── Markdown text renderer ────────────────────────────────────────────────────
function MessageText({ text }: { text:string }) {
  const lines = text.split('\n')
  return (
    <div className="msg-container">
      {lines.map((line,i)=>{
        const t = line.trim()
        if (t.startsWith('#### ')) return <h4 key={i} className="msg-h4">{renderInline(t.slice(5))}</h4>
        if (t.startsWith('### '))  return <h3 key={i} className="msg-h3">{renderInline(t.slice(4))}</h3>
        if (t.startsWith('## '))   return <h2 key={i} className="msg-h2">{renderInline(t.slice(3))}</h2>
        if (t.startsWith('> '))    return <div key={i} className="msg-quote">{renderInline(t.slice(2))}</div>
        if (t.startsWith('- '))    return <div key={i} className="msg-li">• {renderInline(t.slice(2))}</div>
        if (/^\d+\.\s/.test(t))   return <div key={i} className="msg-li">{renderInline(t)}</div>
        if (t==='---')             return <hr key={i} className="msg-hr"/>
        if (!t)                    return <div key={i} className="msg-gap"/>
        return <p key={i} className="msg-p">{renderInline(line)}</p>
      })}
    </div>
  )
}

function renderInline(text:string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|==[^=]+==|\[[^\]]+\]\([^)]+\)|(?<!\*)\*[^*]+\*(?!\*))/)
  return parts.map((part,i)=>{
    if (part.startsWith('**')&&part.endsWith('**')) return <strong key={i} className="msg-bold">{part.slice(2,-2)}</strong>
    if (part.startsWith('*') &&part.endsWith('*'))  return <em key={i} className="msg-italic">{part.slice(1,-1)}</em>
    if (part.startsWith('`') &&part.endsWith('`'))  return <code key={i} className="msg-code">{part.slice(1,-1)}</code>
    if (part.startsWith('==')&&part.endsWith('==')) return <mark key={i} className="msg-highlight">{part.slice(2,-2)}</mark>
    const m = part.match(/\[([^\]]+)\]\(([^)]+)\)/)
    if (m) return <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer" className="msg-link">{m[1]}</a>
    return <span key={i}>{part}</span>
  })
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text:string }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    const ok = await copyToClipboard(text)
    if (ok) { setCopied(true); setTimeout(()=>setCopied(false), 1800) }
  }
  return (
    <button onClick={handle} title="Copy response" style={{
      padding:'3px 8px',borderRadius:6,border:'1px solid var(--bg-border)',
      background:copied?'rgba(0,212,177,0.1)':'var(--bg-surface)',
      color:copied?'var(--accent-teal)':'var(--text-muted)',
      cursor:'pointer',fontSize:10,fontFamily:'var(--font-display)',fontWeight:700,
      transition:'all 150ms ease',display:'flex',alignItems:'center',gap:3,
    }}>
      {copied?'✓ Copied':'⎘ Copy'}
    </button>
  )
}

// ── Assistant message ─────────────────────────────────────────────────────────
function AssistantMessage({ msg }: { msg:Message }) {
  const [citationsOpen, setCitationsOpen] = useState(false)
  const [thinkingOpen, setThinkingOpen]   = useState(false)
  const thinkingChunks = msg.chunks.filter(c=>CHUNK_CONFIG[c.type]?.show)
  return (
    <div style={{display:'flex',gap:10,alignItems:'flex-start',animation:'fadeInUp 250ms both'}}>
      {/* Avatar */}
      <div style={{
        width:34,height:34,borderRadius:11,flexShrink:0,
        background:'linear-gradient(135deg,#8B7CF7,#00D4B1)',
        display:'flex',alignItems:'center',justifyContent:'center',
        fontSize:17,boxShadow:'0 3px 10px rgba(139,124,247,0.28)',marginTop:2,
        animation:'scaleIn 250ms cubic-bezier(0.34,1.56,0.64,1) both',
      }}>🤖</div>

      <div style={{flex:1,minWidth:0}}>
        {/* Thinking accordion */}
        {thinkingChunks.length>0&&(
          <div style={{marginBottom:8}}>
            <button onClick={()=>setThinkingOpen(o=>!o)} style={{
              display:'flex',alignItems:'center',gap:6,
              padding:'5px 10px',borderRadius:7,border:'1px solid var(--bg-border)',
              background:'var(--bg-surface)',cursor:'pointer',
              fontSize:11.5,color:'var(--text-muted)',fontFamily:'var(--font-body)',
              transition:'all 150ms ease',marginBottom:6,
            }}>
              <span style={{fontSize:12}}>🧠</span>
              <span>{thinkingChunks.length} reasoning step{thinkingChunks.length>1?'s':''}</span>
              <span style={{transition:'transform 200ms',transform:thinkingOpen?'rotate(180deg)':'none',display:'inline-block'}}>▾</span>
            </button>
            {thinkingOpen&&(
              <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:8}}>
                {thinkingChunks.map((c,i)=>(
                  <div key={i}>
                    <ThinkingPill type={c.type} content={c.content}/>
                    {Array.isArray((c.metadata as { results?: unknown[] } | undefined)?.results)&&((c.metadata as { results?: unknown[] } | undefined)?.results?.length ?? 0) > 0&&(
                      <div style={{marginTop:5,paddingLeft:22}}>
                        {((c.metadata as { results?: any[] } | undefined)?.results ?? []).map((r,ri)=>(
                          <WebResultCard key={ri} result={r} index={ri}/>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Main bubble */}
        <div style={{
          padding:'13px 16px',
          borderRadius:'4px 18px 18px 18px',
          background:'var(--bg-card)',
          border:'1px solid var(--bg-border)',
          fontSize:13.5,lineHeight:1.7,color:'var(--text-primary)',
          boxShadow:'var(--shadow-xs)',
          position:'relative',
        }}>
          {msg.isStreaming&&!msg.text ? (
            <span style={{color:'var(--text-muted)'}}>Thinking<StreamingDots/></span>
          ) : (
            <MessageText text={msg.text}/>
          )}
          {msg.isStreaming&&msg.text&&<StreamingDots/>}
          {msg.error&&(
            <div style={{marginTop:10,padding:'8px 12px',borderRadius:8,
              background:'rgba(255,59,59,0.08)',border:'1px solid rgba(255,59,59,0.2)',
              color:'#FF6B6B',fontSize:12}}>
              ⚠️ {msg.error}
            </div>
          )}
        </div>

        {/* Footer */}
        {!msg.isStreaming&&(
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:7,flexWrap:'wrap'}}>
            {msg.queryType&&QUERY_TYPE_LABELS[msg.queryType]&&(
              <span style={{
                fontSize:11,color:'var(--text-muted)',padding:'2px 8px',borderRadius:999,
                background:'var(--bg-surface)',border:'1px solid var(--bg-border)',
                fontFamily:'var(--font-display)',fontWeight:600,
              }}>{QUERY_TYPE_LABELS[msg.queryType]}</span>
            )}
            {msg.processingMs!=null&&(
              <span style={{fontSize:11,color:'var(--text-muted)',fontFamily:'var(--font-mono)'}}>
                ⏱ {fmtMs(msg.processingMs)}
              </span>
            )}
            {msg.text&&<CopyBtn text={msg.text}/>}
            {msg.citations&&msg.citations.length>0&&(
              <button onClick={()=>setCitationsOpen(o=>!o)} style={{
                display:'flex',alignItems:'center',gap:5,
                padding:'3px 10px',borderRadius:999,border:'none',
                background:citationsOpen?'rgba(139,124,247,0.15)':'rgba(139,124,247,0.08)',
                color:'#8B7CF7',cursor:'pointer',fontSize:11,fontWeight:700,
                fontFamily:'var(--font-display)',transition:'all 150ms ease',
              }}>
                📚 {msg.citations.length} source{msg.citations.length>1?'s':''}
                <span style={{display:'inline-block',transition:'transform 200ms',transform:citationsOpen?'rotate(180deg)':'none'}}>▾</span>
              </button>
            )}
          </div>
        )}

        {/* Citations panel */}
        {citationsOpen&&msg.citations&&msg.citations.length>0&&(
          <div style={{
            marginTop:10,display:'grid',
            gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',
            gap:7,animation:'fadeInUp 200ms both',
          }}>
            {msg.citations.map((c,i)=>(
              <CitationCard key={c.unique_id||i} c={c} index={i}/>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── User message ──────────────────────────────────────────────────────────────
function UserMessage({ msg }: { msg:Message }) {
  return (
    <div style={{display:'flex',justifyContent:'flex-end',animation:'fadeInUp 200ms both',gap:8,alignItems:'flex-end'}}>
      <div style={{
        maxWidth:'72%',padding:'11px 15px',
        borderRadius:'18px 4px 18px 18px',
        background:'linear-gradient(135deg,rgba(255,78,78,0.18),rgba(139,124,247,0.14))',
        border:'1px solid rgba(255,78,78,0.22)',
        fontSize:13.5,lineHeight:1.6,color:'var(--text-primary)',
        boxShadow:'var(--shadow-xs)',
      }}>
        {msg.text}
      </div>
      <div style={{
        width:28,height:28,borderRadius:9,flexShrink:0,
        background:'linear-gradient(135deg,rgba(255,78,78,0.3),rgba(139,124,247,0.2))',
        display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,
        border:'1px solid rgba(255,78,78,0.2)',
      }}>👤</div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ suggestions, onSelect, inputRef }: { suggestions:string[]; onSelect:(s:string)=>void; inputRef:React.RefObject<HTMLTextAreaElement | null> }) {
  return (
    <div style={{
      flex:1,display:'flex',flexDirection:'column',
      alignItems:'center',justifyContent:'center',
      gap:24,paddingBottom:40,
      animation:'fadeIn 400ms both',
    }}>
      {/* Hero icon */}
      <div style={{
        width:80,height:80,borderRadius:24,
        background:'linear-gradient(135deg,rgba(139,124,247,0.2),rgba(0,212,177,0.15))',
        border:'1px solid rgba(139,124,247,0.2)',
        display:'flex',alignItems:'center',justifyContent:'center',
        fontSize:36,
        boxShadow:'0 12px 40px rgba(139,124,247,0.2)',
        animation:'float 4s ease-in-out infinite',
      }}>🏥</div>

      <div style={{textAlign:'center',maxWidth:520}}>
        <div style={{
          fontFamily:'var(--font-display)',fontSize:24,fontWeight:900,
          color:'var(--text-primary)',marginBottom:8,letterSpacing:'-0.02em',
          background:'linear-gradient(135deg,var(--text-primary) 40%,var(--text-secondary))',
          WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',
        }}>
          Ask anything about Ghana's healthcare
        </div>
        <div style={{fontSize:13.5,color:'var(--text-muted)',lineHeight:1.65}}>
          Query facilities, medical deserts, anomalies, and specialist gaps across all{' '}
          <span style={{color:'var(--accent-teal)',fontWeight:700}}>16 regions</span>{' '}
          using natural language.
        </div>
      </div>

      {/* Example prompt cards */}
      <div style={{
        display:'grid',
        gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',
        gap:8,width:'100%',maxWidth:640,
      }}>
        {(suggestions.length>0?suggestions:EXAMPLE_PROMPTS.map(e=>e.text)).slice(0,6).map((s,i)=>(
          <button key={i} onClick={()=>{onSelect(s);inputRef.current?.focus()}} style={{
            padding:'10px 14px',borderRadius:12,cursor:'pointer',
            border:'1px solid var(--bg-border)',background:'var(--bg-card)',
            color:'var(--text-secondary)',fontSize:12,fontFamily:'var(--font-body)',
            lineHeight:1.4,textAlign:'left',
            transition:'all 200ms cubic-bezier(0.34,1.56,0.64,1)',
            animation:`scaleIn 300ms ${i*50}ms both`,
          }}
          onMouseEnter={e=>{const el=e.currentTarget as HTMLElement;el.style.background='rgba(255,78,78,0.07)';el.style.borderColor='rgba(255,78,78,0.28)';el.style.color='var(--text-primary)';el.style.transform='translateY(-2px)'}}
          onMouseLeave={e=>{const el=e.currentTarget as HTMLElement;el.style.background='var(--bg-card)';el.style.borderColor='var(--bg-border)';el.style.color='var(--text-secondary)';el.style.transform='none'}}>
            <span style={{fontSize:14,marginRight:6}}>{EXAMPLE_PROMPTS[i]?.icon||'💬'}</span>
            {s.length>70?s.slice(0,70)+'…':s}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main ChatAgent ────────────────────────────────────────────────────────────
export default function ChatAgent() {
  const [messages, setMessages]       = useState<Message[]>([])
  const [input, setInput]             = useState('')
  const [streaming, setStreaming]     = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [history, setHistory]         = useState<ChatHistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [charCount, setCharCount]     = useState(0)
  const [webSearchEnabled, setWebSearchEnabled] = useState(
    ()=>localStorage.getItem('virtue_web_search')==='true'
  )
  const [sessionId] = useState(()=>{
    const stored = localStorage.getItem('virtue_chat_session_id')
    if (stored) return stored
    const fresh = `sess_${uid()}`
    localStorage.setItem('virtue_chat_session_id', fresh)
    return fresh
  })
  const cancelRef    = useRef<(()=>void)|null>(null)
  const bottomRef    = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLTextAreaElement>(null)
  const startTimeRef = useRef<number>(0)

  useEffect(()=>{
    getAgentSuggestions().then(setSuggestions).catch(()=>{})
    getAgentHistory(sessionId).then(setHistory).catch(()=>{})
  },[sessionId])

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:'smooth'}) },[messages])

  const send = useCallback((text:string)=>{
    const q = text.trim()
    if (!q||streaming) return
    const userMsg:Message = { id:uid(), role:'user', text:q, chunks:[], timestamp:Date.now() }
    const aiId = uid()
    const aiMsg:Message = { id:aiId, role:'assistant', text:'', chunks:[], isStreaming:true, timestamp:Date.now() }
    setMessages(prev=>[...prev,userMsg,aiMsg])
    setInput(''); setCharCount(0); setStreaming(true)
    startTimeRef.current = Date.now()
    if (inputRef.current) inputRef.current.style.height='44px'

    let finalAnswer='', citations:CitationItem[]=[], queryType='general'

    const cancel = createSSEStream(q, sessionId,
      (chunk)=>{
        if (chunk.chunk_type==='final_answer') finalAnswer=chunk.content
        else if (chunk.chunk_type==='citations') { try{citations=JSON.parse(chunk.content)}catch{} }
        if (chunk.metadata?.query_type) queryType=chunk.metadata.query_type as string
        setMessages(prev=>prev.map(m=>{
          if(m.id!==aiId) return m
          return { ...m, chunks:[...m.chunks,{type:chunk.chunk_type,content:chunk.content,metadata:chunk.metadata}],
            text:chunk.chunk_type==='final_answer'?chunk.content:m.text }
        }))
      },
      ()=>{
        const processingMs = Date.now()-startTimeRef.current
        setMessages(prev=>prev.map(m=>m.id!==aiId?m:{...m,text:finalAnswer||m.text,citations,isStreaming:false,processingMs,queryType}))
        setStreaming(false); cancelRef.current=null
        getAgentHistory(sessionId).then(setHistory).catch(()=>{})
      },
      (err)=>{
        setMessages(prev=>prev.map(m=>m.id!==aiId?m:{...m,isStreaming:false,error:err}))
        setStreaming(false); cancelRef.current=null
      },
      webSearchEnabled,
    )
    cancelRef.current = cancel
  },[streaming,sessionId,webSearchEnabled])

  const handleKey = (e:React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); send(input) }
  }

  const handleClear = async ()=>{
    if (streaming){cancelRef.current?.();setStreaming(false)}
    setMessages([])
    await clearAgentHistory(sessionId).catch(()=>{})
    setHistory([])
  }

  const loadHistoryItem = (item:ChatHistoryEntry)=>{
    setMessages([
      {id:uid(),role:'user',text:item.query,chunks:[],timestamp:item.created_at*1000},
      {id:uid(),role:'assistant',text:item.answer,chunks:[],
        queryType:item.query_type,processingMs:item.processing_time_s*1000,
        timestamp:item.created_at*1000+item.processing_time_s*1000},
    ])
    setShowHistory(false)
  }

  const streamingMsg = useMemo(()=>messages.find(m=>m.isStreaming),[messages])

  return (
    <div style={{display:'flex',height:'calc(100dvh - 88px)',overflow:'hidden',background:'var(--bg-base)'}}>

      {/* ── History Sidebar ── */}
      <div style={{
        width:showHistory?265:0,minWidth:showHistory?265:0,
        borderRight:'1px solid var(--bg-border)',
        background:'var(--bg-surface)',overflow:'hidden',
        transition:'width 280ms cubic-bezier(0.4,0,0.2,1),min-width 280ms',
        display:'flex',flexDirection:'column',flexShrink:0,
      }}>
        <div style={{padding:'14px 12px 10px',borderBottom:'1px solid var(--bg-border)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <span style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:13,color:'var(--text-primary)'}}>
            Query History
          </span>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <span style={{fontSize:10,color:'var(--text-muted)',background:'var(--bg-border)',padding:'2px 6px',borderRadius:4,fontFamily:'var(--font-display)',fontWeight:600}}>
              {history.length}
            </span>
            <button onClick={()=>setShowHistory(false)} style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:17,lineHeight:1}}>×</button>
          </div>
        </div>
        <div className="history-sidebar" style={{flex:1,overflowY:'auto',padding:'7px 5px'}}>
          {history.length===0
            ? <div style={{padding:'20px 12px',color:'var(--text-muted)',fontSize:12,textAlign:'center'}}>No history yet</div>
            : history.map(item=><HistoryItem key={item.id} item={item} active={false} onClick={()=>loadHistoryItem(item)}/>)
          }
        </div>
      </div>

      {/* ── Main chat area ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>

        {/* Chat header */}
        <div style={{
          padding:'12px 18px',borderBottom:'1px solid var(--bg-border)',
          display:'flex',alignItems:'center',justifyContent:'space-between',
          background:'var(--bg-card-glass)',backdropFilter:'blur(12px)',flexShrink:0,
          gap:8,flexWrap:'wrap',
        }}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{
              width:36,height:36,borderRadius:11,
              background:'linear-gradient(135deg,#8B7CF7,#00D4B1)',
              display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:18,boxShadow:'0 3px 12px rgba(139,124,247,0.3)',
            }}>🤖</div>
            <div>
              <div style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:13.5,color:'var(--text-primary)'}}>
                Ghana Health Intelligence Agent
              </div>
              <div style={{fontSize:10.5,color:'var(--text-muted)',display:'flex',alignItems:'center',gap:5}}>
                <span style={{
                  width:6,height:6,borderRadius:'50%',display:'inline-block',
                  background:streaming?'#FFB600':'#00D4B1',
                  boxShadow:streaming?'0 0 7px rgba(255,182,0,0.6)':'0 0 7px rgba(0,212,177,0.6)',
                  animation:'pulseDot 2s ease-in-out infinite',
                }}/>
                {streaming?'Generating response…':'Ready · RAG + SQL + Desert + Geo Intelligence'}
              </div>
            </div>
          </div>

          <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
            {/* Web search toggle */}
            <button onClick={()=>{const n=!webSearchEnabled;setWebSearchEnabled(n);localStorage.setItem('virtue_web_search',String(n))}}
              title={webSearchEnabled?'Web search ON':'Web search OFF'}
              style={{
                padding:'6px 11px',borderRadius:8,
                border:`1px solid ${webSearchEnabled?'rgba(56,189,248,0.5)':'var(--bg-border)'}`,
                background:webSearchEnabled?'rgba(56,189,248,0.12)':'var(--bg-input)',
                color:webSearchEnabled?'#38BDF8':'var(--text-muted)',
                cursor:'pointer',fontSize:11.5,fontFamily:'var(--font-display)',fontWeight:700,
                display:'flex',alignItems:'center',gap:4,transition:'all 150ms ease',
                boxShadow:webSearchEnabled?'0 0 0 2px rgba(56,189,248,0.12)':'none',
              }}>
              🌐 {webSearchEnabled?'Web ON':'Web OFF'}
            </button>

            <button onClick={()=>setShowHistory(o=>!o)} style={{
              padding:'6px 11px',borderRadius:8,
              border:'1px solid var(--bg-border)',
              background:showHistory?'rgba(139,124,247,0.1)':'var(--bg-input)',
              color:showHistory?'#8B7CF7':'var(--text-secondary)',
              cursor:'pointer',fontSize:11.5,fontFamily:'var(--font-display)',fontWeight:700,
              display:'flex',alignItems:'center',gap:5,transition:'all 150ms ease',
            }}>
              📜 History
              {history.length>0&&(
                <span style={{
                  background:'#8B7CF7',color:'#fff',borderRadius:999,
                  width:16,height:16,display:'flex',alignItems:'center',justifyContent:'center',
                  fontSize:9,fontWeight:900,
                }}>{history.length}</span>
              )}
            </button>

            {messages.length>0&&(
              <button onClick={handleClear} style={{
                padding:'6px 11px',borderRadius:8,
                border:'1px solid rgba(255,78,78,0.2)',background:'rgba(255,78,78,0.06)',
                color:'#FF6B6B',cursor:'pointer',fontSize:11.5,
                fontFamily:'var(--font-display)',fontWeight:700,transition:'all 150ms ease',
              }}>🗑 Clear</button>
            )}

            <button onClick={()=>{
              if(streaming){cancelRef.current?.();setStreaming(false)}
              const fresh=`sess_${uid()}`
              localStorage.setItem('virtue_chat_session_id',fresh)
              window.location.reload()
            }} style={{
              padding:'6px 11px',borderRadius:8,
              border:'1px solid rgba(0,212,177,0.25)',background:'rgba(0,212,177,0.07)',
              color:'#00D4B1',cursor:'pointer',fontSize:11.5,
              fontFamily:'var(--font-display)',fontWeight:700,transition:'all 150ms ease',
            }}>✨ New</button>
          </div>
        </div>

        {/* Messages scroll area */}
        <div style={{
          flex:1,overflowY:'auto',padding:'20px',
          display:'flex',flexDirection:'column',gap:18,
          scrollbarWidth:'thin',scrollbarColor:'var(--bg-border) transparent',
        }}>
          {messages.length===0
            ? <EmptyState suggestions={suggestions} onSelect={s=>setInput(s)} inputRef={inputRef}/>
            : messages.map(msg=>msg.role==='user'
                ? <UserMessage key={msg.id} msg={msg}/>
                : <AssistantMessage key={msg.id} msg={msg}/>)
          }

          {/* Live streaming ticker */}
          {streaming&&streamingMsg&&(
            <div style={{
              marginLeft:44,padding:'10px 14px',borderRadius:10,
              background:'var(--bg-surface)',border:'1px solid var(--bg-border)',
              maxWidth:360,animation:'fadeIn 200ms both',
            }}>
              <LiveStepTicker chunks={streamingMsg.chunks}/>
            </div>
          )}

          <div ref={bottomRef}/>
        </div>

        {/* Input area */}
        <div style={{
          padding:'12px 18px 16px',
          borderTop:'1px solid var(--bg-border)',
          background:'var(--bg-card-glass)',backdropFilter:'blur(12px)',flexShrink:0,
        }}>
          {/* Quick suggestion chips */}
          {messages.length>0&&suggestions.length>0&&!streaming&&(
            <div style={{
              display:'flex',gap:5,marginBottom:9,
              overflowX:'auto',paddingBottom:2,
              scrollbarWidth:'none',
            }}>
              {suggestions.slice(0,4).map((s,i)=>(
                <button key={i} onClick={()=>{setInput(s);inputRef.current?.focus()}} style={{
                  padding:'4px 11px',borderRadius:999,
                  border:'1px solid var(--bg-border)',background:'var(--bg-input)',
                  color:'var(--text-muted)',cursor:'pointer',fontSize:11,
                  fontFamily:'var(--font-body)',transition:'all 150ms ease',whiteSpace:'nowrap',flexShrink:0,
                }}
                onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.color='var(--text-secondary)';(e.currentTarget as HTMLElement).style.borderColor='var(--bg-border-accent)'}}
                onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.color='var(--text-muted)';(e.currentTarget as HTMLElement).style.borderColor='var(--bg-border)'}}>
                  {s.length>50?s.slice(0,50)+'…':s}
                </button>
              ))}
            </div>
          )}

          {/* Input box */}
          <div ref={el=>{
            if(!el)return
            const ta=el.querySelector('textarea')
            if(ta){
              ta.addEventListener('focus',()=>{el.style.borderColor='rgba(255,78,78,0.42)';el.style.boxShadow='0 0 0 3px rgba(255,78,78,0.09)'})
              ta.addEventListener('blur',()=>{el.style.borderColor='var(--bg-border)';el.style.boxShadow='none'})
            }
          }} style={{
            display:'flex',gap:8,alignItems:'flex-end',
            padding:'10px 12px',borderRadius:20,
            background:'var(--bg-card)',border:'1px solid var(--bg-border)',
            transition:'all 220ms ease',
          }}>
            <textarea ref={inputRef} value={input}
              onChange={e=>{
                setInput(e.target.value); setCharCount(e.target.value.length)
                e.target.style.height='44px'
                e.target.style.height=Math.min(e.target.scrollHeight,160)+'px'
              }}
              onKeyDown={handleKey}
              placeholder="Ask about facilities, deserts, anomalies, specialist gaps…"
              disabled={streaming} rows={1}
              style={{
                flex:1,background:'transparent',border:'none',outline:'none',
                color:'var(--text-primary)',fontFamily:'var(--font-body)',
                fontSize:13.5,lineHeight:1.6,resize:'none',
                minHeight:44,maxHeight:160,scrollbarWidth:'thin',
              }}/>
            <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'center'}}>
              {charCount>0&&!streaming&&(
                <span style={{fontSize:9.5,color:'var(--text-muted)',fontFamily:'var(--font-mono)'}}>{charCount}</span>
              )}
              {streaming ? (
                <button onClick={()=>{cancelRef.current?.();setStreaming(false)}} title="Stop" style={{
                  width:36,height:36,borderRadius:10,
                  border:'1px solid rgba(255,78,78,0.3)',background:'rgba(255,78,78,0.1)',
                  color:'#FF6B6B',cursor:'pointer',
                  display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,
                  transition:'all 150ms ease',
                }}>⏹</button>
              ) : (
                <button onClick={()=>send(input)} disabled={!input.trim()} title="Send (Enter)" style={{
                  width:36,height:36,borderRadius:10,border:'none',
                  background:input.trim()?'linear-gradient(135deg,var(--accent-primary),var(--accent-violet))':'var(--bg-border)',
                  color:input.trim()?'#fff':'var(--text-muted)',
                  cursor:input.trim()?'pointer':'default',
                  display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,
                  transition:'all 200ms cubic-bezier(0.34,1.56,0.64,1)',
                  boxShadow:input.trim()?'0 4px 14px rgba(255,78,78,0.3)':'none',
                  transform:input.trim()?'scale(1)':'scale(0.92)',
                }}>↑</button>
              )}
            </div>
          </div>

          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:7,padding:'0 2px'}}>
            <span style={{fontSize:10.5,color:'var(--text-muted)'}}>Enter to send · Shift+Enter for newline</span>
            <span style={{fontSize:10.5,color:'var(--text-muted)',fontFamily:'var(--font-mono)'}}>{sessionId.slice(0,14)}…</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulseDot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.6;transform:scale(0.8)} }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeInLeft { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
        @keyframes scaleIn { from{opacity:0;transform:scale(0.93)} to{opacity:1;transform:scale(1)} }
      `}</style>
    </div>
  )
}