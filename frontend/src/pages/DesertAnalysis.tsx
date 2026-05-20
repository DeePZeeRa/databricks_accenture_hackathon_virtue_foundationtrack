// src/pages/DesertAnalysis.tsx — v4 · Advanced animated desert intelligence dashboard
import { useEffect, useState, useRef } from 'react'
import {
  getDesertScores, getRegionalSummary, getSpecialtyGaps, type DesertScore,
} from '../api/client'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  CartesianGrid,
} from 'recharts'

// ── Config ────────────────────────────────────────────────────────────────────
const DESERT_COLORS: Record<string, string> = {
  'Critical Desert':   '#FF3B3B',
  'Severe Desert':     '#FF7423',
  'Moderate Desert':   '#FFB600',
  'At Risk':           '#D4A017',
  'Data Insufficient': '#4A5E82',
  'Adequate Coverage': '#00D4B1',
}
const BADGE_MAP: Record<string, string> = {
  'Critical Desert':   'badge-critical',
  'Severe Desert':     'badge-severe',
  'Moderate Desert':   'badge-moderate',
  'At Risk':           'badge-risk',
  'Data Insufficient': 'badge-clinic',
  'Adequate Coverage': 'badge-adequate',
}
const SPECIALTY_LABELS: Record<string, string> = {
  emergencyMedicine:       'Emergency',
  generalSurgery:          'Gen. Surgery',
  gynecologyAndObstetrics: 'Gynecology',
  pediatrics:              'Pediatrics',
  infectiousDiseases:      'Infectious',
  radiology:               'Radiology',
  anesthesia:              'Anesthesia',
  orthopedics:             'Orthopaedics',
  cardiology:              'Cardiology',
  mentalHealth:            'Mental Health',
  has_emergency_medicine:  'Emergency',
  has_surgery:             'Surgery',
  has_obstetrics:          'Obstetrics',
  has_pediatrics:          'Pediatrics',
  has_icu:                 'ICU',
  has_radiology:           'Radiology',
  has_infectious_disease:  'Infectious',
  has_mental_health:       'Mental Health',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function toList(val: string | string[] | undefined | null): string[] {
  if (!val) return []
  if (Array.isArray(val)) return val
  try { return JSON.parse(val) } catch { return [val] }
}
function humanize(s: string): string {
  return SPECIALTY_LABELS[s] || s.replace(/_/g,' ').replace(/([A-Z])/g,' $1')
    .replace(/^./,c=>c.toUpperCase()).trim()
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true) }, { threshold })
    obs.observe(el); return () => obs.disconnect()
  }, [threshold])
  return { ref, inView }
}

function useCountUp(target: number, enabled = true, dur = 900) {
  const [val, setVal] = useState(0)
  const raf = useRef<number|null>(null)
  useEffect(() => {
    if (!target || !enabled) return
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - start)/dur, 1)
      setVal(Math.round(target * (1 - Math.pow(2, -10*p))))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [target, enabled, dur])
  return val
}

// ── Sub-components ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const score = payload[0]?.value as number
  const color = score >= 0.75 ? '#FF3B3B' : score >= 0.55 ? '#FF7423' : score >= 0.40 ? '#FFB600' : '#00D4B1'
  return (
    <div style={{
      background:'var(--bg-card)', border:'1px solid var(--bg-border-accent)',
      borderRadius:10, padding:'10px 14px', boxShadow:'var(--shadow-lg)',
    }}>
      <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:12, color:'var(--text-primary)', marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:13, fontFamily:'var(--font-display)', fontWeight:800, color }}>
        MDS: {score?.toFixed(3)}
      </div>
    </div>
  )
}

function DesertKpiCard({ label, count, color, total, active, onClick }: {
  label: string; count: number; color: string; total: number; active: boolean; onClick: () => void
}) {
  const { ref, inView } = useInView()
  const animated = useCountUp(count, inView)
  return (
    <div
      ref={ref}
      onClick={onClick}
      className="kpi-card"
      style={{
        '--accent-color': color,
        cursor: 'pointer',
        outline: active ? `2px solid ${color}` : '2px solid transparent',
        outlineOffset: 3,
        transform: active ? 'translateY(-4px) scale(1.02)' : undefined,
        boxShadow: active ? `0 8px 24px ${color}28` : undefined,
        transition: 'all 200ms cubic-bezier(0.34,1.56,0.64,1)',
        userSelect: 'none',
      } as React.CSSProperties}
    >
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div className="kpi-value" style={{ color, lineHeight:1 }}>{animated}</div>
        {active && (
          <span style={{
            fontSize:9, fontWeight:800, color, background:`${color}18`,
            padding:'2px 6px', borderRadius:6, fontFamily:'var(--font-display)',
          }}>● ON</span>
        )}
      </div>
      <div className="kpi-label" style={{ marginTop:4 }}>{label.split(' ').slice(0,1)[0]}</div>
      <div style={{
        height:3, borderRadius:999, background:`${color}25`, marginTop:6, overflow:'hidden',
      }}>
        <div style={{
          height:'100%', borderRadius:999, background:color,
          width: inView ? `${(count/Math.max(total,1))*100}%` : '0%',
          transition: 'width 900ms cubic-bezier(0.34,1.56,0.64,1)',
          boxShadow:`0 0 6px ${color}60`,
        }} />
      </div>
    </div>
  )
}

function StatBox({ label, value, color = 'var(--text-primary)', sub }: { label:string; value:string|number; color?:string; sub?:string }) {
  return (
    <div style={{
      padding:'10px 12px', borderRadius:10,
      background:'var(--bg-surface)', border:'1px solid var(--bg-border)',
      transition:'all 180ms ease',
    }}
    onMouseEnter={e=>{const el=e.currentTarget as HTMLElement;el.style.borderColor='var(--bg-border-accent)';el.style.transform='translateY(-1px)'}}
    onMouseLeave={e=>{const el=e.currentTarget as HTMLElement;el.style.borderColor='var(--bg-border)';el.style.transform='none'}}>
      <div style={{fontSize:9.5,color:'var(--text-muted)',fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:3}}>{label}</div>
      <div style={{fontFamily:'var(--font-display)',fontWeight:800,fontSize:18,color,lineHeight:1}}>{value??'—'}</div>
      {sub && <div style={{fontSize:9.5,color:'var(--text-muted)',marginTop:2}}>{sub}</div>}
    </div>
  )
}

function SpecialtyBadge({ label, missing }: { label:string; missing:boolean }) {
  const color = missing ? '#FF6B6B' : '#00D4B1'
  return (
    <span style={{
      fontSize:10.5, padding:'3px 9px', borderRadius:8,
      background:`${color}12`, color,
      border:`1px solid ${color}28`, fontWeight:600,
      display:'flex', alignItems:'center', gap:4,
      transition:'all 150ms ease',
      animation:'scaleIn 150ms both',
    }}>
      {missing ? '✗' : '✓'} {label}
    </span>
  )
}

function SortButton({ active, label, onClick }: { active:boolean; label:string; onClick:()=>void }) {
  return (
    <button onClick={onClick} style={{
      padding:'5px 11px', borderRadius:7, fontSize:11, fontWeight:active?700:500,
      fontFamily:'var(--font-display)', cursor:'pointer',
      border:`1px solid ${active?'rgba(0,212,177,0.5)':'var(--bg-border)'}`,
      background:active?'rgba(0,212,177,0.1)':'var(--bg-card)',
      color:active?'var(--accent-teal)':'var(--text-muted)',
      transition:'all 150ms ease', whiteSpace:'nowrap',
    }}>{label}</button>
  )
}

// ── Region list item ──────────────────────────────────────────────────────────
function RegionRow({ score, rank, isSelected, onClick }: {
  score:DesertScore; rank:number; isSelected:boolean; onClick:()=>void
}) {
  const col = DESERT_COLORS[score.mds_label] || '#6366f1'
  return (
    <div
      onClick={onClick}
      style={{
        padding:'10px 14px', cursor:'pointer', borderRadius:10, marginBottom:5,
        background: isSelected ? `${col}12` : 'var(--bg-surface)',
        border:`1px solid ${isSelected?`${col}35`:'var(--bg-border)'}`,
        transition:'all 180ms ease',
        animation:'fadeInLeft 200ms both',
        position:'relative', overflow:'hidden',
      }}
      onMouseEnter={e=>{if(!isSelected){const el=e.currentTarget as HTMLElement;el.style.borderColor='var(--bg-border-accent)';el.style.background='var(--bg-card-hover)'}}}
      onMouseLeave={e=>{if(!isSelected){const el=e.currentTarget as HTMLElement;el.style.borderColor='var(--bg-border)';el.style.background='var(--bg-surface)'}}}
    >
      {isSelected && (
        <div style={{position:'absolute',left:0,top:0,bottom:0,width:3,background:col,borderRadius:'2px 0 0 2px'}} />
      )}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
        <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
          <span style={{fontFamily:'var(--font-display)',fontWeight:800,fontSize:11,color:rank<=3?col:'var(--text-muted)',width:20,textAlign:'center',flexShrink:0}}>
            #{rank}
          </span>
          <div style={{minWidth:0}}>
            <div style={{fontWeight:600,fontSize:12,color:isSelected?'var(--text-primary)':'var(--text-secondary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {score.region}
            </div>
            <div style={{fontSize:10,color:'var(--text-muted)',marginTop:1}}>
              {score.total_facilities} facilities · {score.total_doctors || 0} doctors
            </div>
          </div>
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,flexShrink:0}}>
          <span style={{fontFamily:'var(--font-display)',fontWeight:800,fontSize:14,color:col}}>
            {score.medical_desert_score?.toFixed(3)}
          </span>
          <span className={`badge ${BADGE_MAP[score.mds_label]||'badge-adequate'}`} style={{fontSize:8,padding:'1px 6px'}}>
            {score.mds_label?.split(' ')[0]}
          </span>
        </div>
      </div>
      {/* Score bar */}
      <div style={{height:2,borderRadius:999,background:'var(--bg-border)',marginTop:7,overflow:'hidden'}}>
        <div style={{
          height:'100%',borderRadius:999,background:col,
          width:`${(score.medical_desert_score||0)*100}%`,
          transition:'width 600ms ease',
          boxShadow:`0 0 4px ${col}50`,
        }} />
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DesertAnalysis() {
  const [scores,       setScores]       = useState<DesertScore[]>([])
  const [gaps,         setGaps]         = useState<any[]>([])
  const [selected,     setSelected]     = useState<DesertScore|null>(null)
  const [loading,      setLoading]      = useState(true)
  const [desertFilter, setDesertFilter] = useState('')
  const [minScore,     setMinScore]     = useState(0)
  const [sortBy,       setSortBy]       = useState<'score_desc'|'score_asc'|'name'|'facilities'>('score_desc')
  const [gapFilter,    setGapFilter]    = useState(0)
  const [searchQuery,  setSearchQuery]  = useState('')
  const [activeTab,    setActiveTab]    = useState<'overview'|'regions'|'gaps'>('overview')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([getDesertScores(), getRegionalSummary(), getSpecialtyGaps()])
      .then(([s, _r, g]) => { setScores(s); setGaps(g); setSelected(s[0]||null) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filteredScores = scores
    .filter(s => !desertFilter || s.mds_label === desertFilter)
    .filter(s => (s.medical_desert_score??0) >= minScore)
    .filter(s => gapFilter===0 || (s.critical_specialty_gap_count??0) >= gapFilter)
    .filter(s => !searchQuery || (s.region??'').toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a,b) => {
      if (sortBy==='score_desc') return (b.medical_desert_score??0)-(a.medical_desert_score??0)
      if (sortBy==='score_asc')  return (a.medical_desert_score??0)-(b.medical_desert_score??0)
      if (sortBy==='name')       return (a.region??'').localeCompare(b.region??'')
      if (sortBy==='facilities') return (b.total_facilities??0)-(a.total_facilities??0)
      return 0
    })

  useEffect(() => {
    if (filteredScores.length > 0) {
      const stillValid = selected && filteredScores.some(s => s.region===selected.region)
      if (!stillValid) setSelected(filteredScores[0])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desertFilter,minScore,gapFilter,searchQuery])

  const clearFilters = () => { setDesertFilter(''); setMinScore(0); setGapFilter(0); setSearchQuery('') }
  const hasFilters = !!(desertFilter||minScore>0||gapFilter>0||searchQuery)

  if (loading) return (
    <div className="page-body">
      <div className="loading-center" style={{minHeight:'60vh'}}>
        <div className="spinner" />
        <span>Loading desert intelligence…</span>
      </div>
    </div>
  )

  const selectedColor = selected ? DESERT_COLORS[selected.mds_label]||'#FF3B3B' : '#FF3B3B'

  const radarData = selected ? [
    { subject:'Density',        value:(1-((selected as any).density_component||0))*100 },
    { subject:'Specialists',    value:(1-((selected as any).specialty_component||0))*100 },
    { subject:'Infrastructure', value:(1-((selected as any).integrity_component||0))*100 },
    { subject:'Data Quality',   value:((selected as any).confidence_component||0)*100 },
    { subject:'Spec. Coverage', value:((8-(selected.critical_specialty_gap_count||0))/8)*100 },
  ] : []

  const barData = filteredScores.map(d => ({
    name: d.region?.split(' ')[0]||d.region,
    full_name: d.region,
    score: d.medical_desert_score,
    color: DESERT_COLORS[d.mds_label]||'#6366f1',
    label: d.mds_label,
  }))

  const missingSpecialties = toList(selected?.missing_critical_specialties)
  const coveredSpecialties = ['Emergency','Surgery','Obstetrics','Pediatrics','ICU','Radiology','Infectious','Mental Health']
    .filter(s => !missingSpecialties.map(m=>humanize(m)).includes(s))

  // Global summary stats
  const totalFacilities = scores.reduce((s,r)=>s+(r.total_facilities||0),0)
  const totalDoctors    = scores.reduce((s,r)=>s+(r.total_doctors||0),0)
  const totalBeds       = scores.reduce((s,r)=>s+(r.total_beds||0),0)
  const criticalCount   = scores.filter(s=>['Critical Desert','Severe Desert'].includes(s.mds_label)).length
  const avgMDS          = scores.length ? (scores.reduce((s,r)=>s+(r.medical_desert_score||0),0)/scores.length).toFixed(3) : '—'

  return (
    <div className="page-body" style={{ maxWidth:1600, margin:'0 auto' }}>
      {/* ── Header ── */}
      <div className="page-header">
        <h1>Medical Desert Analysis</h1>
        <p>Composite scoring across facility density, specialist coverage, infrastructure, and data quality across {scores.length} regions</p>
      </div>

      {/* ── Global summary bar ── */}
      <div style={{
        display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',
        gap:10, marginBottom:20,
        padding:'14px', background:'var(--bg-card)', border:'1px solid var(--bg-border)', borderRadius:14,
      }}>
        {[
          { label:'Regions',    value:scores.length,  color:'#8B7CF7', icon:'📍' },
          { label:'Facilities', value:totalFacilities,color:'#38BDF8', icon:'🏥' },
          { label:'Doctors',    value:totalDoctors,   color:'#FFB600', icon:'👨‍⚕️' },
          { label:'Beds',       value:totalBeds,      color:'#F472B6', icon:'🛏️' },
          { label:'Avg MDS',    value:avgMDS,         color:'#FF7423', icon:'📊' },
          { label:'Severe+',    value:criticalCount,  color:'#FF3B3B', icon:'🚨' },
        ].map(s => (
          <div key={s.label} style={{
            textAlign:'center', padding:'8px 6px', borderRadius:9,
            background:`${s.color}0d`, border:`1px solid ${s.color}22`,
            transition:'all 180ms ease',
          }}
          onMouseEnter={e=>{const el=e.currentTarget as HTMLElement;el.style.transform='translateY(-2px)';el.style.boxShadow=`0 5px 14px ${s.color}20`}}
          onMouseLeave={e=>{const el=e.currentTarget as HTMLElement;el.style.transform='none';el.style.boxShadow='none'}}>
            <div style={{fontSize:16}}>{s.icon}</div>
            <div style={{fontFamily:'var(--font-display)',fontWeight:800,fontSize:15,color:s.color,marginTop:2}}>
              {typeof s.value==='number'?s.value.toLocaleString():s.value}
            </div>
            <div style={{fontSize:9,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginTop:1}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Desert label KPI cards (click to filter) ── */}
      <div style={{
        display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',
        gap:10, marginBottom:20,
      }}>
        {Object.entries(DESERT_COLORS).map(([label,color])=>{
          const count = scores.filter(s=>s.mds_label===label).length
          if(count===0) return null
          return (
            <DesertKpiCard
              key={label} label={label} count={count} color={color}
              total={scores.length} active={desertFilter===label}
              onClick={()=>setDesertFilter(desertFilter===label?'':label)}
            />
          )
        })}
      </div>

      {/* ── Tab bar ── */}
      <div style={{
        display:'flex', gap:4, marginBottom:18,
        background:'var(--bg-card)', border:'1px solid var(--bg-border)',
        borderRadius:12, padding:5, overflowX:'auto',
      }}>
        {([['overview','📊 Overview'],['regions','📍 Region Detail'],['gaps','🔬 Specialty Gaps']] as const).map(([id,label])=>(
          <button key={id} onClick={()=>setActiveTab(id as any)} style={{
            padding:'7px 18px', borderRadius:8, border:'none', cursor:'pointer',
            fontSize:12, fontWeight:700, fontFamily:'var(--font-display)',
            background:activeTab===id
              ?'linear-gradient(135deg,rgba(255,78,78,0.2),rgba(139,124,247,0.15))'
              :'transparent',
            color:activeTab===id?'var(--text-primary)':'var(--text-muted)',
            borderBottom:`2px solid ${activeTab===id?'var(--accent-primary)':'transparent'}`,
            transition:'all 200ms ease', whiteSpace:'nowrap',
          }}>{label}</button>
        ))}
      </div>

      {/* ══ OVERVIEW TAB ══ */}
      {activeTab==='overview' && (
        <div style={{animation:'fadeInUp 250ms both'}}>
          {/* Filter bar */}
          <div style={{
            display:'flex',flexWrap:'wrap',gap:8,marginBottom:16,
            padding:'12px 14px',background:'var(--bg-card)',
            border:'1px solid var(--bg-border)',borderRadius:12,
          }}>
            <div style={{
              display:'flex',alignItems:'center',gap:7,padding:'6px 11px',borderRadius:8,
              border:`1px solid ${searchQuery?'rgba(0,212,177,0.5)':'var(--bg-border)'}`,
              background:'var(--bg-input)',flex:'1 1 180px',maxWidth:240,
              transition:'all 180ms ease',
            }}>
              <span style={{opacity:.5,flexShrink:0}}>🔍</span>
              <input type="text" placeholder="Search region…" value={searchQuery}
                onChange={e=>setSearchQuery(e.target.value)}
                style={{background:'transparent',border:'none',outline:'none',color:'var(--text-primary)',fontSize:11,width:'100%'}}/>
              {searchQuery&&<span onClick={()=>setSearchQuery('')} style={{cursor:'pointer',opacity:.5,fontSize:12,flexShrink:0}}>✕</span>}
            </div>

            <select className="filter-select" value={minScore} onChange={e=>setMinScore(Number(e.target.value))} style={{flex:'0 0 150px'}}>
              <option value={0}>Any MDS Score</option>
              <option value={0.25}>MDS ≥ 0.25</option>
              <option value={0.40}>MDS ≥ 0.40</option>
              <option value={0.55}>MDS ≥ 0.55</option>
              <option value={0.75}>MDS ≥ 0.75</option>
            </select>

            <select className="filter-select" value={gapFilter} onChange={e=>setGapFilter(Number(e.target.value))} style={{flex:'0 0 180px'}}>
              <option value={0}>Any Gap Count</option>
              <option value={2}>2+ Missing Specialties</option>
              <option value={4}>4+ Missing Specialties</option>
              <option value={6}>6+ Missing Specialties</option>
              <option value={7}>7+ Missing</option>
            </select>

            <div style={{display:'flex',gap:4}}>
              {(['score_desc','score_asc','name','facilities'] as const).map(s=>(
                <SortButton key={s} active={sortBy===s} onClick={()=>setSortBy(s)}
                  label={s==='score_desc'?'↓ Score':s==='score_asc'?'↑ Score':s==='name'?'A–Z':'Facilities'}/>
              ))}
            </div>

            {hasFilters&&(
              <button onClick={clearFilters} style={{
                padding:'6px 13px',borderRadius:8,border:'1px solid rgba(255,78,78,0.3)',
                background:'rgba(255,78,78,0.08)',color:'#FF6B6B',cursor:'pointer',
                fontSize:11,fontWeight:700,fontFamily:'var(--font-display)',
              }}>✕ Clear</button>
            )}

            <span style={{marginLeft:'auto',fontSize:12,color:'var(--text-muted)',flexShrink:0}}>
              <strong style={{color:'var(--text-primary)',fontFamily:'var(--font-display)',fontSize:14}}>
                {filteredScores.length}
              </strong>{' '}of {scores.length} regions
            </span>
          </div>

          {/* MDS Bar chart — all regions */}
          <div className="card" style={{marginBottom:16}}>
            <div className="card-title">
              Medical Desert Score — All Filtered Regions
              <span style={{marginLeft:8,fontSize:10,fontWeight:400,color:'var(--text-muted)',textTransform:'none',letterSpacing:0}}>
                Click a bar to inspect that region
              </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} margin={{left:-16,right:4,top:4,bottom:4}}>
                <defs>
                  {Object.entries(DESERT_COLORS).map(([label,color])=>(
                    <linearGradient key={label} id={`dg-${label.replace(/\s/g,'')}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={color} stopOpacity={0.95}/>
                      <stop offset="100%" stopColor={color} stopOpacity={0.5}/>
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bg-border)" vertical={false}/>
                <XAxis dataKey="name" tick={{fill:'var(--text-muted)',fontSize:10,fontFamily:'var(--font-display)'}} axisLine={false} tickLine={false}/>
                <YAxis domain={[0,1]} tick={{fill:'var(--text-muted)',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>v.toFixed(1)}/>
                <Tooltip content={<CustomTooltip/>} cursor={{fill:'rgba(255,78,78,0.04)'}}/>
                <Bar dataKey="score" radius={[5,5,0,0]} maxBarSize={28}
                  onClick={(d:any)=>setSelected(scores.find(s=>s.region===d.full_name)||null)}
                  style={{cursor:'pointer'}}>
                  {barData.map((entry,index)=>(
                    <Cell key={index}
                      fill={`url(#dg-${entry.label.replace(/\s/g,'')})`}
                      opacity={selected?.region===entry.full_name?1:0.72}
                      stroke={selected?.region===entry.full_name?entry.color:'none'}
                      strokeWidth={2}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Two-column: region detail + radar */}
          {selected && (
            <div style={{
              display:'grid',
              gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',
              gap:16, marginBottom:16,
            }}>
              {/* Region detail card */}
              <div className="card" style={{
                border:`1px solid ${selectedColor}28`,
                background:`linear-gradient(135deg,var(--bg-card),${selectedColor}08)`,
              }}>
                <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16}}>
                  <div>
                    <div style={{fontSize:10,color:'var(--text-muted)',fontWeight:700,marginBottom:4,fontFamily:'var(--font-display)',letterSpacing:'0.08em',textTransform:'uppercase'}}>
                      Selected Region
                    </div>
                    <div style={{fontFamily:'var(--font-display)',fontSize:20,fontWeight:900,color:'var(--text-primary)',letterSpacing:'-0.02em',lineHeight:1}}>
                      {selected.region}
                    </div>
                    <span className={`badge ${BADGE_MAP[selected.mds_label]||'badge-adequate'}`} style={{marginTop:8,display:'inline-flex'}}>
                      {selected.mds_label}
                    </span>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontFamily:'var(--font-display)',fontSize:42,fontWeight:900,color:selectedColor,letterSpacing:'-0.04em',lineHeight:1,textShadow:`0 0 30px ${selectedColor}40`}}>
                      {(selected.medical_desert_score||0).toFixed(3)}
                    </div>
                    <div style={{fontSize:10,color:'var(--text-muted)',marginTop:4}}>MDS Score</div>
                  </div>
                </div>

                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:14}}>
                  {[
                    ['Facilities', selected.total_facilities],
                    ['Hospitals',  selected.hospital_count],
                    ['Beds',       selected.total_beds],
                    ['Doctors',    selected.total_doctors],
                    ['Per 100k',   selected.facilities_per_100k?.toFixed(1)],
                    ['Spec. Cov.', `${8-(selected.critical_specialty_gap_count??0)}/8`],
                  ].map(([label,val])=>(
                    <StatBox key={label as string} label={label as string} value={val??'—'} color={selectedColor}/>
                  ))}
                </div>

                {/* Specialty coverage chips */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:9.5,color:'var(--text-muted)',fontWeight:800,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:6}}>
                    Specialty Coverage
                  </div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                    {coveredSpecialties.map(s=><SpecialtyBadge key={s} label={s} missing={false}/>)}
                    {missingSpecialties.map(s=><SpecialtyBadge key={s} label={humanize(s)} missing={true}/>)}
                  </div>
                </div>

                {/* Recommended actions */}
                {toList(selected.recommended_actions).length>0&&(
                  <div>
                    <div style={{fontSize:9.5,color:'var(--text-muted)',fontWeight:800,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:7}}>
                      NGO Recommendations
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:5}}>
                      {toList(selected.recommended_actions).slice(0,4).map((a,i)=>(
                        <div key={i} style={{display:'flex',gap:7,alignItems:'flex-start',animation:`fadeInLeft ${150+i*40}ms both`}}>
                          <span style={{color:selectedColor,fontSize:11,marginTop:1,flexShrink:0}}>→</span>
                          <span style={{fontSize:11.5,color:'var(--text-secondary)',lineHeight:1.5}}>{a}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Radar chart */}
              {radarData.length>0&&(
                <div className="card">
                  <div className="card-title" style={{marginBottom:4}}>
                    Coverage Profile — {selected?.region}
                  </div>
                  <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:12}}>
                    Higher values = better coverage. Click bars in chart to change region.
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <RadarChart data={radarData} margin={{top:10,right:20,bottom:10,left:20}}>
                      <PolarGrid stroke="var(--bg-border)" strokeDasharray="3 3"/>
                      <PolarAngleAxis dataKey="subject"
                        tick={{fill:'var(--text-secondary)',fontSize:11,fontFamily:'var(--font-display)',fontWeight:600}}/>
                      <PolarRadiusAxis angle={90} domain={[0,100]}
                        tick={{fill:'var(--text-muted)',fontSize:9}} axisLine={false}/>
                      <Radar dataKey="value"
                        stroke={selectedColor} fill={selectedColor} fillOpacity={0.18}
                        strokeWidth={2.5}
                        dot={{fill:selectedColor,r:4,strokeWidth:0}}
                        animationBegin={0} animationDuration={900}/>
                    </RadarChart>
                  </ResponsiveContainer>
                  {/* Score breakdown */}
                  <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:8}}>
                    {radarData.map(d=>(
                      <div key={d.subject}>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                          <span style={{fontSize:10.5,color:'var(--text-muted)'}}>{d.subject}</span>
                          <span style={{fontSize:10.5,fontFamily:'var(--font-mono)',color:selectedColor,fontWeight:700}}>
                            {d.value.toFixed(0)}%
                          </span>
                        </div>
                        <div style={{height:3,borderRadius:999,background:'var(--bg-border)',overflow:'hidden'}}>
                          <div style={{
                            height:'100%',borderRadius:999,
                            width:`${d.value}%`,background:selectedColor,
                            transition:'width 700ms cubic-bezier(0.34,1.56,0.64,1)',
                            boxShadow:`0 0 5px ${selectedColor}50`,
                          }}/>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ REGIONS TAB ══ */}
      {activeTab==='regions' && (
        <div style={{animation:'fadeInUp 250ms both', display:'flex',gap:16}}>
          {/* Left: scrollable region list */}
          <div style={{
            width:320, flexShrink:0,
            background:'var(--bg-card)', border:'1px solid var(--bg-border)',
            borderRadius:14, padding:'12px',
            height:'calc(100vh - 260px)', minHeight:400,
            display:'flex', flexDirection:'column',
          }}>
            <div style={{fontSize:10,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8,fontFamily:'var(--font-display)'}}>
              {filteredScores.length} Regions
            </div>
            {/* Mini filter */}
            <div style={{marginBottom:8, position:'relative'}}>
              <span style={{position:'absolute',left:9,top:'50%',transform:'translateY(-50%)',opacity:.4,fontSize:11,pointerEvents:'none'}}>🔍</span>
              <input type="text" placeholder="Filter…" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
                style={{
                  width:'100%',padding:'6px 8px 6px 26px',borderRadius:8,fontSize:11,
                  border:'1px solid var(--bg-border)',background:'var(--bg-input)',
                  color:'var(--text-primary)',outline:'none',
                }}/>
            </div>
            <div ref={listRef} style={{flex:1,overflowY:'auto',paddingRight:2}}>
              {filteredScores.map((s,i)=>(
                <RegionRow key={s.region} score={s} rank={i+1}
                  isSelected={selected?.region===s.region}
                  onClick={()=>setSelected(s)}/>
              ))}
            </div>
          </div>

          {/* Right: detail + radar */}
          {selected ? (
            <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:16}}>
              {/* Header */}
              <div style={{
                padding:'16px 20px',
                background:`linear-gradient(135deg,var(--bg-card),${selectedColor}0a)`,
                borderRadius:14, border:`1px solid ${selectedColor}25`,
              }}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
                  <div>
                    <div style={{fontFamily:'var(--font-display)',fontWeight:900,fontSize:24,color:'var(--text-primary)',letterSpacing:'-0.02em'}}>
                      {selected.region}
                    </div>
                    <span className={`badge ${BADGE_MAP[selected.mds_label]||''}`} style={{marginTop:6,display:'inline-flex'}}>
                      {selected.mds_label}
                    </span>
                  </div>
                  <div style={{fontFamily:'var(--font-display)',fontSize:52,fontWeight:900,color:selectedColor,letterSpacing:'-0.04em',textShadow:`0 0 40px ${selectedColor}40`,lineHeight:1}}>
                    {(selected.medical_desert_score||0).toFixed(3)}
                  </div>
                </div>
              </div>

              {/* Stats grid */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10}}>
                {[
                  ['🏥','Facilities',   selected.total_facilities,   '#38BDF8'],
                  ['🏨','Hospitals',    selected.hospital_count,      '#38BDF8'],
                  ['🛏️','Beds',         selected.total_beds,          '#8B7CF7'],
                  ['👨‍⚕️','Doctors',     selected.total_doctors,       '#FFB600'],
                  ['📍','Per 100k',     selected.facilities_per_100k?.toFixed(1), '#34D399'],
                  ['🎓','Spec. Cov.',   `${8-(selected.critical_specialty_gap_count??0)}/8`, '#00D4B1'],
                ].map(([icon,label,val,color])=>(
                  <div key={label as string} style={{
                    textAlign:'center',padding:'12px 8px',borderRadius:10,
                    background:`${color as string}0d`,border:`1px solid ${color as string}22`,
                    transition:'all 180ms ease',
                  }}
                  onMouseEnter={e=>{const el=e.currentTarget as HTMLElement;el.style.transform='translateY(-2px)';el.style.boxShadow=`0 5px 14px ${color as string}20`}}
                  onMouseLeave={e=>{const el=e.currentTarget as HTMLElement;el.style.transform='none';el.style.boxShadow='none'}}>
                    <div style={{fontSize:18}}>{icon as string}</div>
                    <div style={{fontFamily:'var(--font-display)',fontWeight:800,fontSize:16,color:color as string,marginTop:3}}>
                      {(val??'—') as any}
                    </div>
                    <div style={{fontSize:9,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginTop:1}}>
                      {label as string}
                    </div>
                  </div>
                ))}
              </div>

              {/* Specialty + radar row */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                <div style={{background:'var(--bg-card)',border:'1px solid var(--bg-border)',borderRadius:14,padding:'14px 16px'}}>
                  <div style={{fontSize:10,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10,fontFamily:'var(--font-display)'}}>
                    Specialty Coverage
                  </div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                    {coveredSpecialties.map(s=><SpecialtyBadge key={s} label={s} missing={false}/>)}
                    {missingSpecialties.map(s=><SpecialtyBadge key={s} label={humanize(s)} missing={true}/>)}
                  </div>
                </div>
                {radarData.length>0&&(
                  <div style={{background:'var(--bg-card)',border:'1px solid var(--bg-border)',borderRadius:14,padding:'14px 16px'}}>
                    <div style={{fontSize:10,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4,fontFamily:'var(--font-display)'}}>
                      Coverage Radar
                    </div>
                    <ResponsiveContainer width="100%" height={180}>
                      <RadarChart data={radarData} margin={{top:4,right:16,bottom:4,left:16}}>
                        <PolarGrid stroke="var(--bg-border)" strokeDasharray="2 2"/>
                        <PolarAngleAxis dataKey="subject" tick={{fill:'var(--text-muted)',fontSize:9,fontFamily:'var(--font-display)'}}/>
                        <PolarRadiusAxis angle={90} domain={[0,100]} tick={false} axisLine={false}/>
                        <Radar dataKey="value" stroke={selectedColor} fill={selectedColor} fillOpacity={0.2} strokeWidth={2}
                          dot={{fill:selectedColor,r:3,strokeWidth:0}} animationBegin={0} animationDuration={800}/>
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {toList(selected.recommended_actions).length>0&&(
                <div style={{background:'var(--bg-card)',border:'1px solid var(--bg-border)',borderRadius:14,padding:'14px 16px'}}>
                  <div style={{fontSize:10,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10,fontFamily:'var(--font-display)'}}>
                    NGO Recommended Actions
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:6}}>
                    {toList(selected.recommended_actions).map((a,i)=>(
                      <div key={i} style={{display:'flex',gap:8,alignItems:'flex-start',padding:'7px 10px',borderRadius:8,background:`${selectedColor}07`,border:`1px solid ${selectedColor}18`,animation:`fadeInLeft ${120+i*40}ms both`}}>
                        <span style={{color:selectedColor,flexShrink:0,marginTop:1}}>→</span>
                        <span style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.5}}>{a}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)',fontSize:14}}>
              Select a region from the list
            </div>
          )}
        </div>
      )}

      {/* ══ GAPS TAB ══ */}
      {activeTab==='gaps' && (
        <div style={{animation:'fadeInUp 250ms both',display:'flex',flexDirection:'column',gap:16}}>
          {gaps.length>0&&(
            <div className="card">
              <div className="card-title" style={{marginBottom:14}}>Specialty Gap Analysis — All Regions</div>
              <div className="table-container" style={{maxHeight:420}}>
                <table className="data-table">
                  <thead><tr>
                    <th>Region</th><th>Desert Status</th>
                    <th style={{textAlign:'center'}}>Gap Count</th>
                    <th>Missing Specialties</th>
                  </tr></thead>
                  <tbody>
                    {gaps.map((g:any)=>(
                      <tr key={g.region} style={{cursor:'pointer'}} onClick={()=>{
                        const s=scores.find(sc=>sc.region===g.region)
                        if(s){setSelected(s);setActiveTab('regions')}
                      }}>
                        <td style={{fontWeight:600,color:'var(--text-primary)'}}>{g.region}</td>
                        <td><span className={`badge ${BADGE_MAP[g.desert_label]||'badge-adequate'}`}>{g.desert_label||'—'}</span></td>
                        <td style={{textAlign:'center'}}>
                          <span style={{
                            display:'inline-flex',alignItems:'center',justifyContent:'center',
                            width:28,height:28,borderRadius:7,fontFamily:'var(--font-display)',fontWeight:800,fontSize:13,
                            background:g.gap_count>=4?'rgba(255,59,59,0.12)':g.gap_count>=2?'rgba(255,116,35,0.1)':'rgba(255,182,0,0.1)',
                            border:`1px solid ${g.gap_count>=4?'rgba(255,59,59,0.25)':g.gap_count>=2?'rgba(255,116,35,0.2)':'rgba(255,182,0,0.2)'}`,
                            color:g.gap_count>=4?'#FF3B3B':g.gap_count>=2?'#FF7423':'#FFB600',
                          }}>{g.gap_count}</span>
                        </td>
                        <td>
                          <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                            {(g.missing_specialties||[]).map((s:string)=>(
                              <span key={s} style={{
                                fontSize:10,padding:'2px 7px',borderRadius:8,
                                background:'rgba(255,116,35,0.1)',color:'#FF7423',
                                border:'1px solid rgba(255,116,35,0.2)',fontWeight:600,
                              }}>{humanize(s)}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Full ranking table */}
          <div className="card">
            <div className="card-title" style={{marginBottom:14}}>All Regions — Desert Score Ranking</div>
            <div className="table-container" style={{maxHeight:440}}>
              <table className="data-table">
                <thead><tr>
                  <th style={{width:40}}>#</th><th>Region</th><th>MDS Score</th>
                  <th>Label</th><th>Facilities</th><th>Beds</th>
                  <th>Doctors</th><th>Per 100k</th><th>Specialties</th>
                </tr></thead>
                <tbody>
                  {filteredScores.map((s,i)=>{
                    const col=DESERT_COLORS[s.mds_label]||'#6366f1'
                    return (
                      <tr key={s.region} style={{cursor:'pointer',
                        background:selected?.region===s.region?`${col}0a`:undefined,
                        borderLeft:`3px solid ${selected?.region===s.region?col:'transparent'}`,
                        transition:'all 150ms',
                      }} onClick={()=>setSelected(s)}>
                        <td><span style={{fontFamily:'var(--font-display)',fontWeight:800,fontSize:12,color:i<3?col:'var(--text-muted)'}}>#{i+1}</span></td>
                        <td>
                          <span style={{fontWeight:600,color:'var(--text-primary)',fontSize:12.5}}>{s.region}</span>
                          {selected?.region===s.region&&<span style={{marginLeft:6,fontSize:9,color:col,fontFamily:'var(--font-display)',fontWeight:700}}>● SELECTED</span>}
                        </td>
                        <td>
                          <div style={{display:'flex',alignItems:'center',gap:7}}>
                            <span style={{fontFamily:'var(--font-display)',fontWeight:800,fontSize:14,color:col}}>{s.medical_desert_score?.toFixed(3)}</span>
                            <div className="score-bar" style={{width:48}}>
                              <div className="score-bar-fill" style={{width:`${(s.medical_desert_score||0)*100}%`,background:col}}/>
                            </div>
                          </div>
                        </td>
                        <td><span className={`badge ${BADGE_MAP[s.mds_label]||'badge-adequate'}`} style={{fontSize:9}}>{s.mds_label}</span></td>
                        <td style={{color:'var(--text-secondary)'}}>{s.total_facilities}</td>
                        <td style={{color:'var(--text-secondary)'}}>{s.total_beds}</td>
                        <td style={{color:'var(--text-secondary)'}}>{s.total_doctors}</td>
                        <td style={{color:'var(--text-secondary)'}}>{s.facilities_per_100k?.toFixed(1)??'—'}</td>
                        <td>
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            <span style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:12,color:'var(--text-primary)'}}>{8-(s.critical_specialty_gap_count??0)}/8</span>
                            <div className="score-bar" style={{width:40}}>
                              <div className="score-bar-fill" style={{width:`${((8-(s.critical_specialty_gap_count||0))/8)*100}%`,background:'#00D4B1'}}/>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeInUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeInLeft { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:translateX(0)} }
        @keyframes scaleIn { from{opacity:0;transform:scale(0.93)} to{opacity:1;transform:scale(1)} }
      `}</style>
    </div>
  )
}