// src/pages/AnomalyReport.tsx — v4 · Advanced animated anomaly intelligence dashboard
import { useEffect, useState, useRef, useCallback } from 'react'
import { getAnomalies, getAnomalySummary, getRegions, type AnomalyRecord } from '../api/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts'

// ── Constants ────────────────────────────────────────────────────────────────
const RISK_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const
type RiskLevel = typeof RISK_ORDER[number]

const RISK_CONFIG: Record<RiskLevel, { color: string; bg: string; icon: string; label: string; glow: string }> = {
  CRITICAL: { color: '#FF3B3B', bg: 'rgba(255,59,59,0.12)',  icon: '🚨', label: 'Critical', glow: '0 0 20px rgba(255,59,59,0.4)' },
  HIGH:     { color: '#FF7423', bg: 'rgba(255,116,35,0.1)',  icon: '⚠️', label: 'High',     glow: '0 0 20px rgba(255,116,35,0.3)' },
  MEDIUM:   { color: '#FFB600', bg: 'rgba(255,182,0,0.1)',   icon: '🟡', label: 'Medium',   glow: '0 0 20px rgba(255,182,0,0.3)' },
  LOW:      { color: '#00D4B1', bg: 'rgba(0,212,177,0.1)',   icon: '✅', label: 'Low',      glow: '0 0 20px rgba(0,212,177,0.3)' },
}

const BADGE_CLASS: Record<string, string> = {
  CRITICAL: 'badge-critical', HIGH: 'badge-severe', MEDIUM: 'badge-moderate', LOW: 'badge-adequate',
}

const ANOMALY_TYPE_LABELS: Record<string, string> = {
  capability_inflation:                   'Capability Inflation',
  hospital_no_doctors:                   'Hospital — No Doctors',
  clinic_claims_icu:                     'Clinic Claims ICU',
  ghost_facility:                        'Ghost Facility',
  procedure_breadth:                     'Procedure Breadth',
  specialty_mismatch:                    'Specialty Mismatch',
  enhanced_type_capability_mismatch:     'Type/Cap Mismatch',
  enhanced_ghost_hospital:               'Ghost Hospital',
  enhanced_procedures_no_equipment:      'Procs Without Equipment',
  enhanced_low_idp_confidence:           'Low IDP Confidence',
  enhanced_suspicious_completeness:      'Suspicious Completeness',
  enhanced_icu_no_infrastructure:        'ICU No Infrastructure',
  enhanced_implausible_doctor_bed_ratio: 'Implausible Doc-Bed Ratio',
  enhanced_em_without_surgical_support:  'EM Without Surgical',
  enhanced_high_quality_risk:            'High Quality Risk',
  enhanced_peer_capability_outlier:      'Peer Cap Outlier',
  enhanced_maturity_infra_mismatch:      'Maturity-Infra Mismatch',
  enhanced_graph_dependency_gap:         'Graph Dependency Gap',
  enhanced_richness_equipment_mismatch:  'Richness-Equipment Mismatch',
}

const ANOMALY_TYPE_ICONS: Record<string, string> = {
  capability_inflation: '📈', hospital_no_doctors: '🏥', clinic_claims_icu: '🔬',
  ghost_facility: '👻', procedure_breadth: '📋', specialty_mismatch: '🔀',
  enhanced_type_capability_mismatch: '⚠️', enhanced_ghost_hospital: '👻',
  enhanced_procedures_no_equipment: '🔧', enhanced_low_idp_confidence: '📊',
  enhanced_suspicious_completeness: '🤔', enhanced_icu_no_infrastructure: '🏥',
  enhanced_implausible_doctor_bed_ratio: '⚖️', enhanced_em_without_surgical_support: '🚑',
  enhanced_high_quality_risk: '🎯', enhanced_peer_capability_outlier: '🔍',
  enhanced_maturity_infra_mismatch: '🏗️', enhanced_graph_dependency_gap: '🕸️',
  enhanced_richness_equipment_mismatch: '📦',
}

const STAT_FLAG_FIELDS = [
  'stat_anomaly_capability_inflation', 'stat_anomaly_hospital_no_doctors',
  'stat_anomaly_clinic_claims_icu', 'stat_anomaly_ghost_facility',
  'stat_anomaly_procedure_breadth', 'stat_anomaly_specialty_mismatch',
] as const

const ENH_FLAG_FIELDS = [
  'enhanced_type_capability_mismatch', 'enhanced_ghost_hospital',
  'enhanced_procedures_no_equipment', 'enhanced_low_idp_confidence',
  'enhanced_suspicious_completeness', 'enhanced_icu_no_infrastructure',
  'enhanced_implausible_doctor_bed_ratio', 'enhanced_em_without_surgical_support',
  'enhanced_high_quality_risk', 'enhanced_peer_capability_outlier',
  'enhanced_maturity_infra_mismatch', 'enhanced_graph_dependency_gap',
  'enhanced_richness_equipment_mismatch',
] as const

const STAT_KEYS = ['capability_inflation','hospital_no_doctors','clinic_claims_icu','ghost_facility','procedure_breadth','specialty_mismatch']
const ENHANCED_KEYS = [
  'enhanced_type_capability_mismatch','enhanced_ghost_hospital','enhanced_procedures_no_equipment',
  'enhanced_low_idp_confidence','enhanced_suspicious_completeness','enhanced_icu_no_infrastructure',
  'enhanced_implausible_doctor_bed_ratio','enhanced_em_without_surgical_support',
  'enhanced_high_quality_risk','enhanced_peer_capability_outlier',
  'enhanced_maturity_infra_mismatch','enhanced_graph_dependency_gap','enhanced_richness_equipment_mismatch',
]

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildProblemsAndActions(r: AnomalyRecord) {
  const problems: string[] = []
  const actions: string[] = []
  if (r.stat_anomaly_hospital_no_doctors)        problems.push('Hospital has no documented doctors on record')
  if (r.stat_anomaly_capability_inflation)        problems.push('Claims more capabilities than data evidence supports')
  if (r.stat_anomaly_clinic_claims_icu)           problems.push('Clinic-type facility claims ICU capability without infrastructure')
  if (r.stat_anomaly_ghost_facility)              problems.push('Possible ghost facility — high absence confidence with sparse evidence')
  if (r.stat_anomaly_procedure_breadth)           problems.push('Procedure breadth is statistically anomalous for facility type')
  if (r.stat_anomaly_specialty_mismatch)          problems.push('Specialty claims conflict with documented facility type')
  if (r.enhanced_type_capability_mismatch)        problems.push('Facility type does not match declared capabilities')
  if (r.enhanced_ghost_hospital)                  problems.push('ML model flags as likely ghost hospital — unverifiable presence')
  if (r.enhanced_procedures_no_equipment)         problems.push('Procedures claimed without matching equipment records')
  if (r.enhanced_low_idp_confidence)              problems.push('Low AI extraction confidence — data may be unreliable')
  if (r.enhanced_suspicious_completeness)         problems.push('Suspiciously high data completeness for low-evidence source')
  if (r.enhanced_icu_no_infrastructure)           problems.push('ICU claimed but critical infrastructure dependencies missing')
  if (r.enhanced_implausible_doctor_bed_ratio)    problems.push('Doctor-to-bed ratio is implausible — data likely inaccurate')
  if (r.enhanced_em_without_surgical_support)     problems.push('Emergency care claimed without any surgical support capability')
  if (r.enhanced_high_quality_risk)               problems.push('Overall data quality risk score is high')
  if (r.enhanced_peer_capability_outlier)         problems.push('Capability claims are outliers vs similar peer facilities')
  if (r.enhanced_maturity_infra_mismatch)         problems.push('Service maturity label does not align with infrastructure level')
  if (r.enhanced_graph_dependency_gap)            problems.push('Capability graph reveals unmet dependency requirements')
  if (r.enhanced_richness_equipment_mismatch)     problems.push('Service richness does not match equipment availability')
  if (r.data_poverty_flag)                        problems.push('Data poverty flag: insufficient evidence to assess accurately')
  if (r.high_continuity_risk)                     problems.push('High continuity risk — facility may face operational disruption')
  if ((r.ghost_probability_score ?? 0) >= 0.5)   problems.push(`Elevated ghost probability: ${((r.ghost_probability_score ?? 0)*100).toFixed(0)}%`)
  if (r.capability_anomalies?.length)             r.capability_anomalies.forEach(a => problems.push(a))
  if (r.llm_clinical_assessment)                  problems.push(r.llm_clinical_assessment)
  if (r.llm_priority_action)                      actions.push(r.llm_priority_action)
  if ((r.emergency_readiness_score ?? 1) < 0.3)  actions.push('Deploy emergency stabilisation equipment and train staff in triage protocols')
  if ((r.clinical_risk_score ?? 0) > 0.4)        actions.push('Conduct clinical audit and verify all claimed capabilities on-site')
  if ((r.quality_risk_score ?? 0) > 0.3)         actions.push('Initiate data quality review and re-survey facility for accurate records')
  if ((r.ghost_probability_score ?? 0) >= 0.4)   actions.push('Dispatch field verification team to confirm facility operational status')
  if ((r.infrastructure_completeness_score ?? 1) < 0.3) actions.push('Address critical infrastructure gaps: equipment, utilities, support systems')
  if ((r.healthcare_maturity_score ?? 1) < 0.3)  actions.push('Implement capacity-building programme to raise healthcare service maturity')
  if ((r.continuity_risk_score ?? 0) > 0.5)      actions.push('Develop contingency and continuity-of-care plan for this facility')
  if (r.enhanced_procedures_no_equipment)        actions.push('Procure and document missing equipment required for claimed procedures')
  if (r.enhanced_icu_no_infrastructure)          actions.push('Resolve ICU infrastructure dependencies before accepting critical patients')
  if (r.stat_anomaly_hospital_no_doctors)        actions.push('Recruit or assign qualified medical personnel immediately')
  if (r.llm_recommended_quality_category)       actions.push(`Data quality target: classify as "${r.llm_recommended_quality_category}"`)
  return { problems: [...new Set(problems)], actions: [...new Set(actions)] }
}

// ── IntersectionObserver hook ─────────────────────────────────────────────────
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true) }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return { ref, inView }
}

// ── Animated counter ──────────────────────────────────────────────────────────
function useCountUp(target: number, enabled = true, dur = 900) {
  const [val, setVal] = useState(0)
  const raf = useRef<number | null>(null)
  useEffect(() => {
    if (!target || !enabled) return
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - start) / dur, 1)
      setVal(Math.round(target * (1 - Math.pow(2, -10 * p))))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [target, enabled, dur])
  return val
}

// ── Risk KPI card ─────────────────────────────────────────────────────────────
function RiskCard({ risk, count, active, onClick }: {
  risk: RiskLevel; count: number; active: boolean; onClick: () => void
}) {
  const cfg = RISK_CONFIG[risk]
  const { ref, inView } = useInView()
  const animated = useCountUp(count, inView)
  return (
    <div
      ref={ref}
      onClick={onClick}
      className="kpi-card"
      style={{
        '--accent-color': cfg.color,
        cursor: 'pointer',
        outline: active ? `2px solid ${cfg.color}` : '2px solid transparent',
        outlineOffset: 3,
        boxShadow: active ? cfg.glow : undefined,
        transition: 'all 200ms cubic-bezier(0.34,1.56,0.64,1)',
        transform: active ? 'translateY(-4px) scale(1.02)' : undefined,
        userSelect: 'none',
      } as React.CSSProperties}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 20 }}>{cfg.icon}</span>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: cfg.color,
          opacity: active ? 1 : 0.5, fontFamily: 'var(--font-display)',
          background: active ? `${cfg.color}20` : 'transparent',
          padding: active ? '2px 6px' : '2px 0', borderRadius: 6,
          transition: 'all 200ms',
        }}>
          {active ? '● ACTIVE' : 'CLICK TO FILTER'}
        </span>
      </div>
      <div className="kpi-value" style={{ color: cfg.color }}>{animated.toLocaleString()}</div>
      <div className="kpi-label">{cfg.label} Risk</div>
    </div>
  )
}

// ── Sortable table hook ───────────────────────────────────────────────────────
function useSortable(data: AnomalyRecord[], defaultKey: keyof AnomalyRecord = 'composite_anomaly_score') {
  const [key, setKey] = useState<keyof AnomalyRecord>(defaultKey)
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const sorted = [...data].sort((a, b) => {
    const av = (a as any)[key] ?? 0, bv = (b as any)[key] ?? 0
    return dir === 'desc' ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1)
  })
  const toggle = (k: keyof AnomalyRecord) => {
    if (k === key) setDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setKey(k); setDir('desc') }
  }
  return { sorted, sortKey: key, sortDir: dir, toggle }
}

function SortTh({ label, sortKey, currentKey, dir, onClick, style }: {
  label: string; sortKey: string; currentKey: string; dir: 'asc' | 'desc'
  onClick: () => void; style?: React.CSSProperties
}) {
  const active = sortKey === currentKey
  return (
    <th onClick={onClick} style={{ cursor: 'pointer', userSelect: 'none', ...style }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        color: active ? 'var(--accent-teal)' : undefined,
        transition: 'color 150ms',
      }}>
        {label}
        <span style={{ fontSize: 8, opacity: active ? 1 : 0.3, transition: 'opacity 150ms' }}>
          {active ? (dir === 'desc' ? '▼' : '▲') : '⇅'}
        </span>
      </span>
    </th>
  )
}

// ── Anomaly flag chips ────────────────────────────────────────────────────────
function AnomalyFlags({ record, enhanced = false, max = 4 }: { record: AnomalyRecord; enhanced?: boolean; max?: number }) {
  const flagSet = enhanced ? ENH_FLAG_FIELDS : STAT_FLAG_FIELDS
  const flags = (flagSet as readonly string[]).filter(f => (record as any)[f])
  const color  = enhanced ? '#38BDF8' : '#FF6B6B'
  const bg     = enhanced ? 'rgba(56,189,248,0.1)'  : 'rgba(255,59,59,0.1)'
  const border = enhanced ? 'rgba(56,189,248,0.22)' : 'rgba(255,59,59,0.2)'
  const shown  = flags.slice(0, max)
  const extra  = flags.length - shown.length
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
      {shown.map(f => (
        <span key={f} title={ANOMALY_TYPE_LABELS[f.replace('stat_anomaly_', '')] || f} style={{
          fontSize: 9.5, padding: '2px 7px', borderRadius: 999,
          background: bg, color, border: `1px solid ${border}`,
          fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3,
          fontFamily: 'var(--font-display)', whiteSpace: 'nowrap',
        }}>
          {ANOMALY_TYPE_ICONS[f.replace('stat_anomaly_', '')] || '📌'}
          {(ANOMALY_TYPE_LABELS[f.replace('stat_anomaly_', '')] || f.replace(/_/g, ' ')).split(' ').slice(0, 2).join(' ')}
        </span>
      ))}
      {extra > 0 && (
        <span style={{
          fontSize: 9.5, padding: '2px 7px', borderRadius: 999,
          background: bg, color, border: `1px solid ${border}`,
          fontWeight: 700, fontFamily: 'var(--font-display)',
        }}>+{extra}</span>
      )}
      {flags.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
    </div>
  )
}

// ── Score mini-gauge ──────────────────────────────────────────────────────────
function ScoreGauge({ value, color, label }: { value: number; color: string; label: string }) {
  const pct = Math.min(Math.max(value, 0), 1) * 100
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color, fontWeight: 700 }}>
          {pct.toFixed(0)}%
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 999, background: 'var(--bg-border)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 999,
          width: `${pct}%`, background: color,
          transition: 'width 700ms cubic-bezier(0.34,1.56,0.64,1)',
          boxShadow: `0 0 6px ${color}60`,
        }} />
      </div>
    </div>
  )
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--bg-border-accent)',
      borderRadius: 10, padding: '10px 14px', boxShadow: 'var(--shadow-lg)',
    }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, color: 'var(--text-primary)', marginBottom: 4 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ fontSize: 12, color: p.fill || p.stroke || 'var(--text-secondary)', marginTop: 2 }}>
          {p.name}: <strong style={{ fontFamily: 'var(--font-display)' }}>{p.value?.toLocaleString?.() ?? p.value}</strong>
        </div>
      ))}
    </div>
  )
}

// ── Expanded row detail panel ─────────────────────────────────────────────────
function ExpandedDetail({ record }: { record: AnomalyRecord }) {
  const { problems, actions } = buildProblemsAndActions(record)
  const riskDimensions = [
    { label: 'Clinical Risk',           value: record.clinical_risk_score,            color: '#FF4E4E' },
    { label: 'Quality Risk',            value: record.quality_risk_score,             color: '#FFB600' },
    { label: 'Operational Risk',        value: record.operational_risk_score,         color: '#FF7423' },
    { label: 'Emergency Readiness',     value: record.emergency_readiness_score,      color: '#4ADE80' },
    { label: 'Healthcare Maturity',     value: record.healthcare_maturity_score,      color: '#38BDF8' },
    { label: 'Infrastructure Complete', value: record.infrastructure_completeness_score, color: '#8B7CF7' },
    { label: 'Continuity Risk',         value: record.continuity_risk_score,          color: '#F472B6' },
    { label: 'Ghost Probability',       value: record.ghost_probability_score,        color: '#A78BFA' },
  ].filter(d => d.value != null)

  const scoreSummary = [
    { label: 'Composite',     value: record.composite_anomaly_score, color: '#FF7423' },
    { label: 'Clinical',      value: record.clinical_risk_score, color: '#FF4E4E' },
    { label: 'Quality',       value: record.quality_risk_score, color: '#FFB600' },
    { label: 'Maturity',      value: record.healthcare_maturity_score, color: '#38BDF8' },
  ]

  return (
    <div style={{
      padding: '20px 24px',
      background: 'linear-gradient(135deg, rgba(10,15,38,0.95), rgba(6,9,26,0.98))',
      borderBottom: '1px solid var(--bg-border)',
      animation: 'expandDown 220ms cubic-bezier(0.34,1.56,0.64,1) both',
    }}>
      {/* Top meta bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16,
        padding: '10px 14px',
        background: 'var(--bg-surface)',
        borderRadius: 10,
        border: '1px solid var(--bg-border)',
        alignItems: 'center',
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: 'var(--text-primary)' }}>
          {record.name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>·</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{record.region_normalised}</span>
        {record.city_clean && <>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>·</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{record.city_clean}</span>
        </>}
        {record.facility_tier_label && (
          <span style={{
            fontSize: 9, padding: '2px 8px', borderRadius: 999,
            background: 'rgba(139,124,247,0.15)', color: '#8B7CF7',
            border: '1px solid rgba(139,124,247,0.25)', fontWeight: 700,
            fontFamily: 'var(--font-display)',
          }}>
            {record.facility_tier_label}
          </span>
        )}
        {/* Score pills */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {scoreSummary.filter(s => s.value != null).map(s => (
            <span key={s.label} style={{
              fontSize: 10, padding: '3px 10px', borderRadius: 999,
              background: `${s.color}14`, color: s.color,
              border: `1px solid ${s.color}28`, fontWeight: 700, fontFamily: 'var(--font-display)',
            }}>
              {s.label}: {(s.value! * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      </div>

      {/* Main 3-column grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
      }}>
        {/* Problems */}
        {problems.length > 0 && (
          <div style={{
            background: 'rgba(255,59,59,0.04)',
            border: '1px solid rgba(255,59,59,0.15)',
            borderRadius: 12,
            padding: '14px 16px',
          }}>
            <div style={{
              fontSize: 10, fontWeight: 800, color: '#FF6B6B',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              marginBottom: 10, fontFamily: 'var(--font-display)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span>⚠️</span> Problems Identified
              <span style={{
                marginLeft: 'auto', fontSize: 9,
                background: 'rgba(255,59,59,0.15)', color: '#FF6B6B',
                padding: '1px 6px', borderRadius: 999,
              }}>{problems.length}</span>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {problems.map((p, i) => (
                <li key={i} style={{
                  display: 'flex', gap: 7,
                  fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5,
                  animation: `fadeInLeft ${120 + i * 40}ms both`,
                }}>
                  <span style={{ color: '#FF6B6B', flexShrink: 0, marginTop: 2, fontSize: 8 }}>■</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        {actions.length > 0 && (
          <div style={{
            background: 'rgba(74,222,128,0.04)',
            border: '1px solid rgba(74,222,128,0.15)',
            borderRadius: 12,
            padding: '14px 16px',
          }}>
            <div style={{
              fontSize: 10, fontWeight: 800, color: '#4ADE80',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              marginBottom: 10, fontFamily: 'var(--font-display)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span>✅</span> Recommended Actions
              <span style={{
                marginLeft: 'auto', fontSize: 9,
                background: 'rgba(74,222,128,0.15)', color: '#4ADE80',
                padding: '1px 6px', borderRadius: 999,
              }}>{actions.length}</span>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {actions.map((a, i) => (
                <li key={i} style={{
                  display: 'flex', gap: 7,
                  fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5,
                  animation: `fadeInLeft ${120 + i * 40}ms both`,
                }}>
                  <span style={{ color: '#4ADE80', flexShrink: 0, marginTop: 2 }}>→</span>
                  {a}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Risk Dimensions */}
        {riskDimensions.length > 0 && (
          <div style={{
            background: 'rgba(139,124,247,0.03)',
            border: '1px solid rgba(139,124,247,0.12)',
            borderRadius: 12,
            padding: '14px 16px',
          }}>
            <div style={{
              fontSize: 10, fontWeight: 800, color: '#8B7CF7',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              marginBottom: 12, fontFamily: 'var(--font-display)',
            }}>
              📊 Risk Dimensions
            </div>
            {riskDimensions.map(d => (
              <ScoreGauge key={d.label} label={d.label} value={d.value!} color={d.color} />
            ))}
          </div>
        )}

        {/* All anomaly flags */}
        <div style={{
          background: 'rgba(56,189,248,0.03)',
          border: '1px solid rgba(56,189,248,0.12)',
          borderRadius: 12,
          padding: '14px 16px',
        }}>
          <div style={{
            fontSize: 10, fontWeight: 800, color: '#38BDF8',
            textTransform: 'uppercase', letterSpacing: '0.1em',
            marginBottom: 10, fontFamily: 'var(--font-display)',
          }}>
            🔬 All Active Flags
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Stat Flags</div>
            <AnomalyFlags record={record} max={99} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, marginTop: 8 }}>ML Enhanced Flags</div>
            <AnomalyFlags record={record} enhanced max={99} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Pagination ────────────────────────────────────────────────────────────────
function Pagination({ page, limit, total, onChange }: {
  page: number; limit: number; total: number; onChange: (p: number) => void
}) {
  const totalPages = Math.ceil(total / limit)
  const start = page * limit + 1
  const end = Math.min((page + 1) * limit, total)
  const pages = Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
    if (totalPages <= 7) return i
    if (page < 4) return i
    if (page > totalPages - 5) return totalPages - 7 + i
    return page - 3 + i
  })
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginTop: 16, flexWrap: 'wrap', gap: 10,
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Showing <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{start}–{end}</strong>{' '}
        of <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{total.toLocaleString()}</strong>
      </span>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <PagBtn label="←" onClick={() => onChange(Math.max(0, page - 1))} disabled={page === 0} />
        {pages.map(p => (
          <PagBtn key={p} label={String(p + 1)} onClick={() => onChange(p)} active={p === page} />
        ))}
        <PagBtn label="→" onClick={() => onChange(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} />
      </div>
    </div>
  )
}

function PagBtn({ label, onClick, disabled, active }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '6px 12px', borderRadius: 8, border: `1px solid ${active ? 'rgba(0,212,177,0.5)' : 'var(--bg-border)'}`,
      background: active ? 'rgba(0,212,177,0.12)' : 'var(--bg-card)',
      color: active ? 'var(--accent-teal)' : disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
      cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 12,
      fontFamily: active ? 'var(--font-display)' : 'var(--font-body)', fontWeight: active ? 800 : 400,
      opacity: disabled ? 0.4 : 1, transition: 'all 150ms ease',
      minWidth: 34,
    }}>{label}</button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AnomalyReport() {
  const [items,         setItems]         = useState<AnomalyRecord[]>([])
  const [total,         setTotal]         = useState(0)
  const [summary,       setSummary]       = useState<any>({})
  const [regions,       setRegions]       = useState<string[]>([])
  const [loading,       setLoading]       = useState(true)
  const [riskFilter,    setRiskFilter]    = useState('')
  const [regionFilter,  setRegionFilter]  = useState('')
  const [typeFilter,    setTypeFilter]    = useState('')
  const [minFlagsFilter,setMinFlagsFilter]= useState(0)
  const [flagMode,      setFlagMode]      = useState<'all'|'stat'|'enhanced'>('all')
  const [search,        setSearch]        = useState('')
  const [page,          setPage]          = useState(0)
  const [expandedRow,   setExpandedRow]   = useState<string | null>(null)
  const [viewMode,      setViewMode]      = useState<'table'|'cards'>('table')
  const [activeTab,     setActiveTab]     = useState<'overview'|'detail'>('overview')
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const limit = 50

  useEffect(() => {
    getRegions().then(setRegions)
    getAnomalySummary().then(setSummary)
  }, [])

  useEffect(() => { setPage(0) }, [riskFilter, regionFilter, typeFilter, minFlagsFilter, flagMode, search])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, unknown> = { limit, offset: page * limit }
      if (riskFilter)   params.risk_level = riskFilter
      if (regionFilter) params.region     = regionFilter
      await getAnomalies(params).then(d => { setItems(d.items); setTotal(d.total) })
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [riskFilter, regionFilter, page])

  useEffect(() => { loadData() }, [loadData])

  // Client-side secondary filters
  const displayedItems = items
    .filter(r => !search || r.name?.toLowerCase().includes(search.toLowerCase()) || r.region_normalised?.toLowerCase().includes(search.toLowerCase()))
    .filter(r => minFlagsFilter === 0 || (r.total_anomaly_flags ?? 0) >= minFlagsFilter)
    .filter(r => !typeFilter || (r as any)[typeFilter] === true)
    .filter(r => {
      if (flagMode === 'stat')     return STAT_FLAG_FIELDS.some(f => (r as any)[f])
      if (flagMode === 'enhanced') return ENH_FLAG_FIELDS.some(f => (r as any)[f])
      return true
    })

  const { sorted, sortKey, sortDir, toggle } = useSortable(displayedItems)

  // Summary data
  const worstRegions = Object.entries(summary.worst_regions || {})
    .map(([name, count]) => ({ name: name.split(' ')[0], count: count as number })).slice(0, 8)
  const typeCounts = summary.anomaly_type_counts || {}
  const riskCounts = summary.by_risk_level || {}
  const globalStats = summary.global_stats || {}

  const statTypeData = STAT_KEYS
    .map(k => ({ name: ANOMALY_TYPE_LABELS[k]?.split(' ').slice(0,3).join(' ') || k.replace(/_/g,' '), icon: ANOMALY_TYPE_ICONS[k]||'📌', count: (typeCounts[k] as number)||0, key: k }))
    .filter(d => d.count > 0).sort((a, b) => b.count - a.count)

  const enhancedTypeData = ENHANCED_KEYS
    .map(k => ({ name: ANOMALY_TYPE_LABELS[k]?.split(' ').slice(0,3).join(' ') || k.replace(/_/g,' '), icon: ANOMALY_TYPE_ICONS[k]||'📌', count: (typeCounts[k] as number)||0, key: k }))
    .filter(d => d.count > 0).sort((a, b) => b.count - a.count)

  const fmt = (v: unknown, pct = false) => {
    if (v == null) return '—'
    const n = Number(v); if (isNaN(n)) return '—'
    return pct ? `${(n * 100).toFixed(1)}%` : n.toFixed(3)
  }

  const clearAll = () => {
    setRiskFilter(''); setRegionFilter(''); setTypeFilter('')
    setMinFlagsFilter(0); setFlagMode('all'); setSearch('')
  }
  const hasFilters = !!(riskFilter || regionFilter || typeFilter || minFlagsFilter > 0 || flagMode !== 'all' || search)

  const globalStatCards = [
    { label: 'Avg Composite',    value: fmt(globalStats.avg_composite_score),        icon: '📊', color: '#FF7423' },
    { label: 'Avg Ghost %',      value: fmt(globalStats.avg_ghost_probability, true), icon: '👻', color: '#8B7CF7' },
    { label: 'Avg Clinical',     value: fmt(globalStats.avg_clinical_risk),           icon: '🩺', color: '#FF4E4E' },
    { label: 'Avg Quality',      value: fmt(globalStats.avg_quality_risk),            icon: '🎯', color: '#FFB600' },
    { label: 'Data Poverty',     value: String(globalStats.data_poverty_count ?? '—'),icon: '📂', color: '#38BDF8' },
    { label: 'Continuity Risk',  value: String(globalStats.high_continuity_risk_count ?? '—'), icon: '⛓️', color: '#F472B6' },
    { label: 'Avg Emergency',    value: fmt(globalStats.avg_emergency_readiness, true),icon: '🚨', color: '#4ADE80' },
    { label: 'Avg Maturity',     value: fmt(globalStats.avg_healthcare_maturity, true),icon: '🏗️', color: '#00D4B1' },
  ]

  return (
    <div className="page-body" style={{ maxWidth: 1600, margin: '0 auto' }}>
      {/* ── Page header ── */}
      <div className="page-header">
        <h1>Anomaly Detection Report</h1>
        <p>AI-flagged facilities with suspicious capability claims, ghost indicators, or data inconsistencies</p>
      </div>

      {/* ── Risk KPI cards ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12, marginBottom: 20,
      }}>
        {RISK_ORDER.map(risk => (
          <RiskCard
            key={risk}
            risk={risk}
            count={riskCounts[risk] ?? 0}
            active={riskFilter === risk}
            onClick={() => setRiskFilter(riskFilter === risk ? '' : risk)}
          />
        ))}
      </div>

      {/* ── Global stats micro-bar ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
        gap: 8, marginBottom: 20,
        padding: '14px',
        background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
        borderRadius: 14,
      }}>
        {globalStatCards.map(s => (
          <div key={s.label} style={{
            textAlign: 'center', padding: '8px 6px', borderRadius: 9,
            background: `${s.color}0d`, border: `1px solid ${s.color}22`,
            transition: 'all 200ms ease',
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement
            el.style.transform = 'translateY(-2px)'; el.style.boxShadow = `0 6px 16px ${s.color}20`
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement
            el.style.transform = 'none'; el.style.boxShadow = 'none'
          }}>
            <div style={{ fontSize: 16 }}>{s.icon}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: s.color, marginTop: 2 }}>{s.value}</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 1 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Tab bar ── */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 18,
        background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
        borderRadius: 12, padding: 5, overflowX: 'auto',
      }}>
        {([['overview','📊 Analytics'], ['detail', '🔍 Records']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{
            padding: '7px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-display)',
            background: activeTab === id
              ? 'linear-gradient(135deg, rgba(255,78,78,0.2), rgba(139,124,247,0.15))'
              : 'transparent',
            color: activeTab === id ? 'var(--text-primary)' : 'var(--text-muted)',
            borderBottom: `2px solid ${activeTab === id ? 'var(--accent-primary)' : 'transparent'}`,
            transition: 'all 200ms ease', whiteSpace: 'nowrap',
          }}>{label}</button>
        ))}
      </div>

      {/* ══ ANALYTICS TAB ══ */}
      {activeTab === 'overview' && (
        <div style={{ animation: 'fadeInUp 250ms both' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 16, marginBottom: 16,
          }}>
            {/* Worst regions bar */}
            <div className="card">
              <div className="card-title">Worst Regions by Anomaly Count</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={worstRegions} margin={{ left: -16, right: 4 }}>
                  <defs>
                    <linearGradient id="aGrad1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF4E4E" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="#FF7423" stopOpacity={0.6} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,78,78,0.04)' }} />
                  <Bar dataKey="count" fill="url(#aGrad1)" radius={[5,5,0,0]} name="Anomalies" maxBarSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Risk level pie */}
            <div className="card">
              <div className="card-title">Risk Level Distribution</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ResponsiveContainer width="55%" height={180}>
                  <PieChart>
                    <Pie
                      data={RISK_ORDER.filter(r => riskCounts[r]).map(r => ({ name: r, value: riskCounts[r], color: RISK_CONFIG[r].color }))}
                      cx="50%" cy="50%" innerRadius={44} outerRadius={76}
                      dataKey="value" paddingAngle={3} animationBegin={0} animationDuration={900}
                    >
                      {RISK_ORDER.filter(r => riskCounts[r]).map(r => (
                        <Cell key={r} fill={RISK_CONFIG[r].color} stroke="var(--bg-card)" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border-accent)', borderRadius: 10, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {RISK_ORDER.map(r => (
                    <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 9, height: 9, borderRadius: 2, background: RISK_CONFIG[r].color, flexShrink: 0, boxShadow: `0 0 5px ${RISK_CONFIG[r].color}50` }} />
                      <span style={{ flex: 1, fontSize: 10.5, color: 'var(--text-secondary)', fontWeight: 500 }}>{RISK_CONFIG[r].label}</span>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 800, color: RISK_CONFIG[r].color }}>{riskCounts[r] ?? 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Stat anomaly bars */}
            <div className="card">
              <div className="card-title">Stat Anomaly Type Breakdown</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 4 }}>
                {statTypeData.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No data</span>}
                {statTypeData.map((d, i) => {
                  const max = statTypeData[0]?.count || 1
                  return (
                    <div key={d.key} style={{ animation: `fadeInLeft ${180 + i * 45}ms both` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span>{d.icon}</span>{d.name}
                        </span>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, color: '#FFB600' }}>{d.count}</span>
                      </div>
                      <div style={{ height: 4, borderRadius: 999, background: 'var(--bg-border)', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 999, width: `${(d.count/max)*100}%`,
                          background: 'linear-gradient(90deg, #FFB600, #FF7423)',
                          transition: 'width 700ms cubic-bezier(0.34,1.56,0.64,1)',
                        }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Enhanced ML flags grid */}
          {enhancedTypeData.length > 0 && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 14 }}>
                🤖 Enhanced ML-Detected Anomaly Flags
                <span style={{
                  marginLeft: 10, fontSize: 10, fontWeight: 700, color: '#38BDF8',
                  background: 'rgba(56,189,248,0.1)', padding: '2px 8px',
                  borderRadius: 999, border: '1px solid rgba(56,189,248,0.2)', fontFamily: 'var(--font-display)',
                }}>ML MODEL</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                {enhancedTypeData.map((d, i) => {
                  const max = enhancedTypeData[0]?.count || 1
                  const pct = Math.round((d.count / max) * 100)
                  return (
                    <div key={d.key} style={{
                      padding: '11px 13px', borderRadius: 10,
                      background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.13)',
                      animation: `scaleIn ${150 + i * 50}ms both`,
                      transition: 'all 200ms ease',
                    }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(-2px)'; el.style.borderColor = 'rgba(56,189,248,0.3)' }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'none'; el.style.borderColor = 'rgba(56,189,248,0.13)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 13 }}>{d.icon}</span>{d.name}
                        </span>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: '#38BDF8' }}>{d.count}</span>
                      </div>
                      <div style={{ height: 3, borderRadius: 999, background: 'var(--bg-border)', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 999, width: `${pct}%`,
                          background: 'linear-gradient(90deg, #38BDF8, #8B7CF7)',
                          transition: 'width 800ms cubic-bezier(0.34,1.56,0.64,1)',
                        }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ RECORDS TAB ══ */}
      {activeTab === 'detail' && (
        <div style={{ animation: 'fadeInUp 250ms both' }}>
          {/* Filter bar */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14,
            padding: '12px 14px',
            background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
            borderRadius: 12, alignItems: 'center',
          }}>
            {/* Search */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '6px 12px', borderRadius: 9, border: `1px solid ${search ? 'rgba(0,212,177,0.5)' : 'var(--bg-border)'}`,
              background: 'var(--bg-input)', minWidth: 200, flex: '1 1 200px', maxWidth: 280,
              transition: 'all 180ms ease', boxShadow: search ? '0 0 0 2px rgba(0,212,177,0.12)' : 'none',
            }}>
              <span style={{ opacity: 0.5, flexShrink: 0 }}>🔍</span>
              <input
                type="text"
                placeholder="Search name, region…"
                value={search}
                onChange={e => { if (searchDebounce.current) clearTimeout(searchDebounce.current); searchDebounce.current = setTimeout(() => setSearch(e.target.value), 250) }}
                style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 11, width: '100%' }}
              />
              {search && <span onClick={() => setSearch('')} style={{ cursor: 'pointer', opacity: 0.5, fontSize: 13, flexShrink: 0 }}>✕</span>}
            </div>

            <select className="filter-select" value={riskFilter} onChange={e => setRiskFilter(e.target.value)} style={{ flex: '1 1 130px', maxWidth: 160 }}>
              <option value="">All Risk Levels</option>
              {RISK_ORDER.map(r => <option key={r} value={r}>{RISK_CONFIG[r].icon} {RISK_CONFIG[r].label}</option>)}
            </select>

            <select className="filter-select" value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={{ flex: '1 1 140px', maxWidth: 180 }}>
              <option value="">All Regions</option>
              {regions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>

            <select className="filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ flex: '1 1 170px', maxWidth: 220 }}>
              <option value="">All Flag Types</option>
              <optgroup label="Stat Flags">
                <option value="stat_anomaly_capability_inflation">📈 Capability Inflation</option>
                <option value="stat_anomaly_hospital_no_doctors">🏥 Hospital No Doctors</option>
                <option value="stat_anomaly_clinic_claims_icu">🔬 Clinic Claims ICU</option>
                <option value="stat_anomaly_ghost_facility">👻 Ghost Facility</option>
                <option value="stat_anomaly_procedure_breadth">📋 Procedure Breadth</option>
                <option value="stat_anomaly_specialty_mismatch">🔀 Specialty Mismatch</option>
              </optgroup>
              <optgroup label="Enhanced ML">
                <option value="enhanced_type_capability_mismatch">⚠️ Type/Cap Mismatch</option>
                <option value="enhanced_ghost_hospital">👻 Ghost Hospital</option>
                <option value="enhanced_procedures_no_equipment">🔧 Procs No Equipment</option>
                <option value="enhanced_low_idp_confidence">📊 Low IDP Confidence</option>
                <option value="enhanced_suspicious_completeness">🤔 Suspicious Completeness</option>
                <option value="enhanced_icu_no_infrastructure">🏥 ICU No Infrastructure</option>
              </optgroup>
            </select>

            <select className="filter-select" value={minFlagsFilter} onChange={e => setMinFlagsFilter(Number(e.target.value))} style={{ flex: '0 0 140px' }}>
              <option value={0}>Any Flag Count</option>
              <option value={1}>1+ Flags</option>
              <option value={2}>2+ Flags</option>
              <option value={3}>3+ Flags</option>
              <option value={5}>5+ Flags</option>
            </select>

            {/* Flag mode toggle */}
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bg-border)', flexShrink: 0 }}>
              {(['all','stat','enhanced'] as const).map(m => (
                <button key={m} onClick={() => setFlagMode(m)} style={{
                  padding: '6px 11px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                  fontFamily: 'var(--font-display)', letterSpacing: '0.04em',
                  background: flagMode === m ? 'var(--accent-primary)' : 'var(--bg-card)',
                  color: flagMode === m ? '#fff' : 'var(--text-muted)',
                  transition: 'all 150ms ease',
                }}>
                  {m === 'all' ? 'ALL' : m === 'stat' ? 'STAT' : 'ML'}
                </button>
              ))}
            </div>

            {/* View mode */}
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bg-border)', flexShrink: 0 }}>
              {(['table','cards'] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)} style={{
                  padding: '6px 11px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                  fontFamily: 'var(--font-display)',
                  background: viewMode === m ? 'rgba(139,124,247,0.25)' : 'var(--bg-card)',
                  color: viewMode === m ? '#8B7CF7' : 'var(--text-muted)',
                  transition: 'all 150ms ease',
                }}>
                  {m === 'table' ? '≡ Table' : '⊞ Cards'}
                </button>
              ))}
            </div>

            {hasFilters && (
              <button onClick={clearAll} style={{
                padding: '6px 13px', borderRadius: 8, border: '1px solid rgba(255,78,78,0.3)',
                background: 'rgba(255,78,78,0.08)', color: '#FF6B6B',
                cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-display)',
                flexShrink: 0,
              }}>✕ Clear</button>
            )}

            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>
              <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: 14 }}>
                {sorted.length}
              </strong>{' '}shown · {total.toLocaleString()} total
            </span>
          </div>

          {loading ? (
            <div className="loading-center"><div className="spinner" /><span>Loading anomalies…</span></div>
          ) : sorted.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '60px 20px',
              color: 'var(--text-muted)', fontSize: 14,
              background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--bg-border)',
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
              No anomalies match the current filters.
              <div><button onClick={clearAll} style={{
                marginTop: 12, padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
                background: 'rgba(255,78,78,0.1)', color: '#FF6B6B',
                border: '1px solid rgba(255,78,78,0.3)', fontSize: 12, fontWeight: 600,
              }}>Clear filters</button></div>
            </div>
          ) : viewMode === 'table' ? (
            /* ── Table view ── */
            <div>
              <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid var(--bg-border)' }}>
                <table className="data-table" style={{ minWidth: 920 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}></th>
                      <SortTh label="Facility"   sortKey="name"                   currentKey={sortKey as string} dir={sortDir} onClick={() => toggle('name')} />
                      <SortTh label="Region"     sortKey="region_normalised"      currentKey={sortKey as string} dir={sortDir} onClick={() => toggle('region_normalised')} />
                      <th>Risk</th>
                      <SortTh label="Composite"  sortKey="composite_anomaly_score" currentKey={sortKey as string} dir={sortDir} onClick={() => toggle('composite_anomaly_score')} />
                      <SortTh label="Ghost %"    sortKey="ghost_probability_score" currentKey={sortKey as string} dir={sortDir} onClick={() => toggle('ghost_probability_score')} />
                      <th>Stat Flags</th>
                      <th>ML Flags</th>
                      <SortTh label="LLM Quality" sortKey="llm_data_quality_score" currentKey={sortKey as string} dir={sortDir} onClick={() => toggle('llm_data_quality_score')} />
                      <SortTh label="#"           sortKey="total_anomaly_flags"    currentKey={sortKey as string} dir={sortDir} onClick={() => toggle('total_anomaly_flags')} style={{ width: 48, textAlign: 'center' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r, i) => {
                      const rCfg = RISK_CONFIG[r.anomaly_risk_level as RiskLevel]
                      const rowId = r.unique_id || String(i)
                      const isExpanded = expandedRow === rowId
                      const flagCount = r.total_anomaly_flags ?? 0
                      return (
                        <>
                          <tr
                            key={rowId}
                            style={{
                              animationDelay: `${Math.min(i, 20) * 16}ms`,
                              cursor: 'pointer',
                              background: isExpanded ? 'rgba(139,124,247,0.06)' : undefined,
                              borderLeft: isExpanded ? '3px solid #8B7CF7' : '3px solid transparent',
                              transition: 'all 150ms ease',
                            }}
                            onClick={() => setExpandedRow(isExpanded ? null : rowId)}
                          >
                            <td style={{ textAlign: 'center', paddingRight: 4 }}>
                              <span style={{
                                fontSize: 10, color: isExpanded ? '#8B7CF7' : 'var(--text-muted)',
                                display: 'inline-block',
                                transition: 'transform 200ms ease, color 150ms',
                                transform: isExpanded ? 'rotate(90deg)' : 'none',
                              }}>▶</span>
                            </td>
                            <td>
                              <div style={{ color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {r.name}
                              </div>
                              {r.city_clean && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1 }}>{r.city_clean}</div>}
                              {r.facility_tier_label && <div style={{ fontSize: 9.5, color: '#8B7CF7', marginTop: 1 }}>{r.facility_tier_label}</div>}
                            </td>
                            <td style={{ color: 'var(--text-secondary)', fontSize: 11.5 }}>{r.region_normalised}</td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <span className={`badge ${BADGE_CLASS[r.anomaly_risk_level || ''] || 'badge-adequate'}`}>
                                  {rCfg?.icon} {r.anomaly_risk_level || '—'}
                                </span>
                                {r.data_poverty_flag && (
                                  <span style={{ fontSize: 9, color: '#38BDF8' }}>📂 Data Poverty</span>
                                )}
                              </div>
                            </td>
                            <td>
                              <span style={{
                                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13,
                                color: (r.composite_anomaly_score ?? 0) > 0.35 ? '#FF7423' : '#FFB600',
                              }}>
                                {r.composite_anomaly_score != null ? r.composite_anomaly_score.toFixed(3) : '—'}
                              </span>
                            </td>
                            <td>
                              <span style={{
                                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13,
                                color: (r.ghost_probability_score ?? 0) >= 0.5 ? '#FF3B3B' : 'var(--text-secondary)',
                              }}>
                                {r.ghost_probability_score != null ? `${(r.ghost_probability_score * 100).toFixed(0)}%` : '—'}
                              </span>
                            </td>
                            <td><AnomalyFlags record={r} /></td>
                            <td><AnomalyFlags record={r} enhanced /></td>
                            <td>
                              {r.llm_data_quality_score != null ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <div className="score-bar" style={{ width: 44 }}>
                                    <div className="score-bar-fill" style={{ width: `${Math.min((r.llm_data_quality_score || 0) * 10, 100)}%` }} />
                                  </div>
                                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                    {(r.llm_data_quality_score).toFixed(1)}
                                  </span>
                                </div>
                              ) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <div style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                width: 30, height: 30, borderRadius: 7,
                                background: flagCount > 3 ? 'rgba(255,59,59,0.12)' : flagCount > 1 ? 'rgba(255,182,0,0.1)' : 'rgba(0,212,177,0.08)',
                                border: `1px solid ${flagCount > 3 ? 'rgba(255,59,59,0.25)' : flagCount > 1 ? 'rgba(255,182,0,0.2)' : 'rgba(0,212,177,0.15)'}`,
                              }}>
                                <span style={{
                                  fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13,
                                  color: flagCount > 3 ? '#FF3B3B' : flagCount > 1 ? '#FFB600' : '#00D4B1',
                                }}>{flagCount}</span>
                              </div>
                            </td>
                          </tr>

                          {isExpanded && (
                            <tr key={`${rowId}-exp`}>
                              <td colSpan={10} style={{ padding: 0 }}>
                                <ExpandedDetail record={r} />
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} limit={limit} total={total} onChange={setPage} />
            </div>
          ) : (
            /* ── Card view ── */
            <div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: 12,
              }}>
                {sorted.map((r, i) => {
                  const rCfg = RISK_CONFIG[r.anomaly_risk_level as RiskLevel]
                  const rowId = r.unique_id || String(i)
                  const isExpanded = expandedRow === rowId
                  const flagCount = r.total_anomaly_flags ?? 0
                  const color = rCfg?.color || '#94A3B8'
                  return (
                    <div
                      key={rowId}
                      style={{
                        background: 'var(--bg-card)',
                        border: `1px solid ${isExpanded ? `${color}40` : 'var(--bg-border)'}`,
                        borderRadius: 14,
                        overflow: 'hidden',
                        transition: 'all 200ms ease',
                        animation: `scaleIn ${120 + i * 25}ms both`,
                        boxShadow: isExpanded ? `0 8px 24px ${color}20` : undefined,
                      }}
                    >
                      {/* Card header */}
                      <div
                        style={{
                          padding: '12px 14px',
                          background: `linear-gradient(135deg, ${color}10, transparent)`,
                          borderBottom: `1px solid ${color}20`,
                          cursor: 'pointer',
                        }}
                        onClick={() => setExpandedRow(isExpanded ? null : rowId)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.name}
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                              {r.region_normalised}{r.city_clean && ` · ${r.city_clean}`}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                            <span className={`badge ${BADGE_CLASS[r.anomaly_risk_level || ''] || ''}`} style={{ fontSize: 9 }}>
                              {rCfg?.icon} {r.anomaly_risk_level}
                            </span>
                            <div style={{
                              width: 24, height: 24, borderRadius: 6,
                              background: `${color}18`, border: `1px solid ${color}30`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 11, color,
                            }}>{flagCount}</div>
                          </div>
                        </div>
                      </div>
                      {/* Card scores */}
                      <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        {[
                          { label: 'Composite', value: r.composite_anomaly_score, color: '#FF7423' },
                          { label: 'Ghost %', value: r.ghost_probability_score != null ? r.ghost_probability_score * 100 : null, color: '#8B7CF7', pct: true },
                          { label: 'Clinical', value: r.clinical_risk_score, color: '#FF4E4E' },
                          { label: 'Quality', value: r.quality_risk_score, color: '#FFB600' },
                        ].map(s => (
                          <div key={s.label} style={{ padding: '6px 8px', borderRadius: 8, background: `${s.color}0d`, border: `1px solid ${s.color}20`, textAlign: 'center' }}>
                            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
                            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, color: s.color, marginTop: 1 }}>
                              {s.value != null ? (s.pct ? `${s.value.toFixed(0)}%` : s.value.toFixed(3)) : '—'}
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Flags row */}
                      <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <AnomalyFlags record={r} max={3} />
                        <AnomalyFlags record={r} enhanced max={3} />
                      </div>
                      {/* Expand button */}
                      <div
                        style={{
                          padding: '8px 14px',
                          borderTop: '1px solid var(--bg-border)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                          fontFamily: 'var(--font-display)',
                          transition: 'all 150ms ease',
                          background: isExpanded ? `${color}0d` : 'transparent',
                        }}
                        onClick={() => setExpandedRow(isExpanded ? null : rowId)}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
                      >
                        {isExpanded ? '▲ Collapse' : '▼ Expand Detail'}
                      </div>
                      {isExpanded && <ExpandedDetail record={r} />}
                    </div>
                  )
                })}
              </div>
              <Pagination page={page} limit={limit} total={total} onChange={setPage} />
            </div>
          )}
        </div>
      )}

      {/* ── CSS ── */}
      <style>{`
        @keyframes expandDown {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.94); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes fadeInLeft {
          from { opacity: 0; transform: translateX(-12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}