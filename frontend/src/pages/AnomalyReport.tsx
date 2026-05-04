// src/pages/AnomalyReport.tsx — Enhanced with animated risk indicators and polished UI
import { useEffect, useState } from 'react'
import { getAnomalies, getAnomalySummary, getRegions, type AnomalyRecord } from '../api/client'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area,
} from 'recharts'

const RISK_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

const RISK_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  CRITICAL: { color: '#FF3B3B', bg: 'rgba(255,59,59,0.12)',  icon: '🚨', label: 'Critical' },
  HIGH:     { color: '#FF7423', bg: 'rgba(255,116,35,0.1)',  icon: '⚠️', label: 'High'     },
  MEDIUM:   { color: '#FFB600', bg: 'rgba(255,182,0,0.1)',   icon: '🟡', label: 'Medium'   },
  LOW:      { color: '#00D4B1', bg: 'rgba(0,212,177,0.1)',   icon: '✅', label: 'Low'      },
}

const BADGE_CLASS: Record<string, string> = {
  CRITICAL: 'badge-critical',
  HIGH:     'badge-severe',
  MEDIUM:   'badge-moderate',
  LOW:      'badge-adequate',
}

const ANOMALY_TYPE_LABELS: Record<string, string> = {
  capability_inflation: 'Capability Inflation',
  hospital_no_doctors:  'Hospital — No Doctors',
  clinic_claims_icu:    'Clinic Claims ICU',
  ghost_facility:       'Ghost Facility',
  procedure_breadth:    'Procedure Breadth',
  specialty_mismatch:   'Specialty Mismatch',
}

const ANOMALY_TYPE_ICONS: Record<string, string> = {
  capability_inflation: '📈',
  hospital_no_doctors:  '🏥',
  clinic_claims_icu:    '🔬',
  ghost_facility:       '👻',
  procedure_breadth:    '📋',
  specialty_mismatch:   '🔀',
}

function AnomalyFlags({ record }: { record: AnomalyRecord }) {
  const flags: string[] = []
  const checks: [keyof typeof record, string][] = [
    ['stat_anomaly_capability_inflation', 'capability_inflation'],
    ['stat_anomaly_hospital_no_doctors',  'hospital_no_doctors'],
    ['stat_anomaly_clinic_claims_icu',    'clinic_claims_icu'],
    ['stat_anomaly_ghost_facility',       'ghost_facility'],
    ['stat_anomaly_procedure_breadth',    'procedure_breadth'],
    ['enhanced_procedures_no_equipment',  'procedure_breadth'],
  ]
  for (const [field, label] of checks) {
    if (record[field]) flags.push(label)
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {[...new Set(flags)].map(f => (
        <span key={f} style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 10,
          background: 'rgba(255,59,59,0.1)', color: '#FF6B6B',
          border: '1px solid rgba(255,59,59,0.2)',
          fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
          fontFamily: 'var(--font-display)',
        }}>
          {ANOMALY_TYPE_ICONS[f]} {ANOMALY_TYPE_LABELS[f] || f}
        </span>
      ))}
      {flags.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--bg-border-accent)',
      borderRadius: 10, padding: '10px 14px', boxShadow: 'var(--shadow-lg)',
      fontFamily: 'var(--font-body)',
    }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, color: 'var(--text-primary)', marginBottom: 4 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ fontSize: 12, color: p.fill || 'var(--text-secondary)' }}>
          {p.name}: <strong>{p.value}</strong>
        </div>
      ))}
    </div>
  )
}

export default function AnomalyReport() {
  const [items, setItems]     = useState<AnomalyRecord[]>([])
  const [total, setTotal]     = useState(0)
  const [summary, setSummary] = useState<any>({})
  const [regions, setRegions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [riskFilter, setRiskFilter]     = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [page, setPage]                 = useState(0)
  const limit = 50

  useEffect(() => { getRegions().then(setRegions); getAnomalySummary().then(setSummary) }, [])
  useEffect(() => { setPage(0) }, [riskFilter, regionFilter])

  useEffect(() => {
    setLoading(true)
    const params: Record<string, unknown> = { limit, offset: page * limit }
    if (riskFilter)  params.risk_level = riskFilter
    if (regionFilter) params.region    = regionFilter
    getAnomalies(params)
      .then(d => { setItems(d.items); setTotal(d.total) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [riskFilter, regionFilter, page])

  const worstRegions = Object.entries(summary.worst_regions || {})
    .map(([name, count]) => ({ name: name.split(' ')[0], count: count as number }))
    .slice(0, 8)

  const typeData = Object.entries(summary.anomaly_type_counts || {})
    .map(([name, count]) => ({
      name: ANOMALY_TYPE_LABELS[name] || name.replace(/_/g, ' '),
      icon: ANOMALY_TYPE_ICONS[name] || '📌',
      count: count as number,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  const riskCounts = summary.by_risk_level || {}

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>Anomaly Detection Report</h1>
        <p>AI-flagged facilities with suspicious capability claims, ghost indicators, or data inconsistencies</p>
      </div>

      {/* Risk summary cards */}
      <div className="kpi-grid mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {RISK_ORDER.map((risk, i) => {
          const cfg = RISK_CONFIG[risk]
          const count = riskCounts[risk]
          return (
            <div
              key={risk}
              className="kpi-card"
              style={{
                '--accent-color': cfg.color,
                '--animation-delay': `${i * 60}ms`,
                cursor: 'pointer',
                outline: riskFilter === risk ? `2px solid ${cfg.color}` : 'none',
                outlineOffset: 2,
              } as React.CSSProperties}
              onClick={() => setRiskFilter(riskFilter === risk ? '' : risk)}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="kpi-icon">{cfg.icon}</span>
                <span style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                  color: cfg.color, opacity: 0.7,
                }}>
                  {riskFilter === risk ? 'ACTIVE ✓' : 'CLICK TO FILTER'}
                </span>
              </div>
              <div className="kpi-value" style={{ color: cfg.color }}>{count ?? '—'}</div>
              <div className="kpi-label">{cfg.label} Risk</div>
            </div>
          )
        })}
      </div>

      <div className="grid-2 mb-6">
        {/* Worst regions */}
        <div className="card">
          <div className="card-title">Worst Regions by Anomaly Count</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={worstRegions} margin={{ left: -16, right: 4 }}>
              <defs>
                <linearGradient id="anomalyBarGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#FF4E4E" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#FF7423" stopOpacity={0.6} />
                </linearGradient>
              </defs>
              <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 10.5 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10.5 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,78,78,0.04)' }} />
              <Bar dataKey="count" fill="url(#anomalyBarGrad)" radius={[5,5,0,0]} name="Anomalies" maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Anomaly type breakdown */}
        <div className="card">
          <div className="card-title">Anomaly Types Detected</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            {typeData.map((d, i) => {
              const max = typeData[0]?.count || 1
              return (
                <div key={d.name} style={{ animation: `fadeInUp ${200 + i * 50}ms both` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 500 }}>
                      {d.icon} {d.name}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13,
                      color: '#FFB600',
                    }}>{d.count}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 999, background: 'var(--bg-border)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 999,
                      width: `${(d.count / max) * 100}%`,
                      background: `linear-gradient(90deg, #FFB600, #FF7423)`,
                      transition: 'width 700ms cubic-bezier(0.34,1.56,0.64,1)',
                    }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar mb-4">
        <select className="filter-select" value={riskFilter} onChange={e => setRiskFilter(e.target.value)}>
          <option value="">All Risk Levels</option>
          {RISK_ORDER.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="filter-select" value={regionFilter} onChange={e => setRegionFilter(e.target.value)}>
          <option value="">All Regions</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        {riskFilter && (
          <button
            onClick={() => setRiskFilter('')}
            style={{
              padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(255,78,78,0.3)',
              background: 'rgba(255,78,78,0.08)', color: '#FF6B6B',
              cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-display)',
            }}
          >
            × Clear filter
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500 }}>
          <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: 15 }}>
            {total.toLocaleString()}
          </strong>{' '}flagged facilities
        </span>
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /><span>Loading anomalies…</span></div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Facility</th>
                <th>Region</th>
                <th>Type</th>
                <th>Risk Level</th>
                <th>Anomaly Flags</th>
                <th>LLM Assessment</th>
                <th>Data Quality</th>
                <th>Total Flags</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r, i) => {
                const riskCfg = RISK_CONFIG[r.anomaly_risk_level || '']
                return (
                  <tr key={r.unique_id || i} style={{ animationDelay: `${i * 18}ms` }}>
                    <td>
                      <div className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 13 }}>{r.name}</div>
                      {r.city_clean && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{r.city_clean}</div>}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{r.region_normalised}</td>
                    <td>
                      <span className="badge badge-clinic" style={{ fontSize: 10.5 }}>
                        {r.facility_type_clean}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${BADGE_CLASS[r.anomaly_risk_level || ''] || 'badge-adequate'}`}>
                        {riskCfg?.icon} {r.anomaly_risk_level || '—'}
                      </span>
                    </td>
                    <td><AnomalyFlags record={r} /></td>
                    <td style={{ maxWidth: 200 }}>
                      <span title={r.llm_clinical_assessment || ''} style={{
                        fontSize: 11, color: 'var(--text-secondary)',
                        display: 'block', maxWidth: 180,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {r.llm_clinical_assessment?.slice(0, 100) || (r.llm_anomaly_severity ? `Severity: ${r.llm_anomaly_severity}` : '—')}
                      </span>
                    </td>
                    <td>
                      {r.llm_data_quality_score != null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div className="score-bar" style={{ width: 48 }}>
                            <div className="score-bar-fill" style={{ width: `${(r.llm_data_quality_score || 0) * 100}%` }} />
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {(r.llm_data_quality_score || 0).toFixed(2)}
                          </span>
                        </div>
                      ) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                    </td>
                    <td>
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 32, height: 32, borderRadius: 8,
                        background: (r.total_anomaly_flags ?? 0) > 2
                          ? 'rgba(255,59,59,0.12)' : 'rgba(255,182,0,0.1)',
                        border: `1px solid ${(r.total_anomaly_flags ?? 0) > 2
                          ? 'rgba(255,59,59,0.25)' : 'rgba(255,182,0,0.2)'}`,
                      }}>
                        <span style={{
                          fontFamily: 'var(--font-display)', fontWeight: 800,
                          color: (r.total_anomaly_flags ?? 0) > 2 ? '#FF3B3B' : '#FFB600',
                          fontSize: 14,
                        }}>
                          {r.total_anomaly_flags ?? 0}
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            Showing <strong style={{ color: 'var(--text-primary)' }}>{page * limit + 1}–{Math.min((page + 1) * limit, total)}</strong>{' '}of{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{total.toLocaleString()}</strong>
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                padding: '7px 18px', borderRadius: 8,
                border: '1px solid var(--bg-border)',
                background: 'var(--bg-card)', color: 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--font-body)',
                transition: 'all 150ms ease',
              }}
            >
              ← Prev
            </button>
            <span style={{
              padding: '7px 14px', fontSize: 12.5, color: 'var(--text-secondary)',
              background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--bg-border)',
              fontFamily: 'var(--font-display)', fontWeight: 700,
            }}>
              {page + 1}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={(page + 1) * limit >= total}
              style={{
                padding: '7px 18px', borderRadius: 8,
                border: '1px solid var(--bg-border)',
                background: 'var(--bg-card)', color: 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--font-body)',
                transition: 'all 150ms ease',
              }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}