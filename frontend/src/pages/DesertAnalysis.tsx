// src/pages/DesertAnalysis.tsx — Enhanced with animated transitions and richer visuals
import { useEffect, useState } from 'react'
import { getDesertScores, getRegionalSummary, getSpecialtyGaps, type DesertScore } from '../api/client'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
} from 'recharts'

const DESERT_COLORS: Record<string, string> = {
  'Critical Desert':    '#FF3B3B',
  'Severe Desert':      '#FF7423',
  'Moderate Desert':    '#FFB600',
  'At Risk':            '#D4A017',
  'Data Insufficient':  '#4A5E82',
  'Adequate Coverage':  '#00D4B1',
}

const BADGE_MAP: Record<string, string> = {
  'Critical Desert':    'badge-critical',
  'Severe Desert':      'badge-severe',
  'Moderate Desert':    'badge-moderate',
  'At Risk':            'badge-risk',
  'Data Insufficient':  'badge-clinic',
  'Adequate Coverage':  'badge-adequate',
}

function toList(val: string | string[] | undefined | null): string[] {
  if (!val) return []
  if (Array.isArray(val)) return val
  try { return JSON.parse(val) } catch { return [val] }
}

const SPECIALTY_LABELS: Record<string, string> = {
  emergencyMedicine:       'Emergency Medicine',
  generalSurgery:          'General Surgery',
  gynecologyAndObstetrics: 'Gynecology & Obs.',
  pediatrics:              'Pediatrics',
  infectiousDiseases:      'Infectious Diseases',
  radiology:               'Radiology',
  anesthesia:              'Anesthesia',
  orthopedics:             'Orthopedics',
  cardiology:              'Cardiology',
  mentalHealth:            'Mental Health',
  has_emergency_medicine:  'Emergency Medicine',
  has_surgery:             'Surgery',
  has_obstetrics:          'Obstetrics',
  has_pediatrics:          'Pediatrics',
  has_icu:                 'ICU',
  has_radiology:           'Radiology',
  has_infectious_disease:  'Infectious Diseases',
  has_mental_health:       'Mental Health',
}

function humanize(s: string): string {
  return SPECIALTY_LABELS[s] || s.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim()
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--bg-border-accent)',
      borderRadius: 10, padding: '10px 14px', boxShadow: 'var(--shadow-lg)',
      fontFamily: 'var(--font-body)',
    }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, color: 'var(--text-primary)', marginBottom: 6 }}>
        {label}
      </div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          MDS: <strong style={{ color: p.fill || 'var(--accent-primary)', fontFamily: 'var(--font-display)' }}>
            {typeof p.value === 'number' ? p.value.toFixed(3) : p.value}
          </strong>
        </div>
      ))}
    </div>
  )
}

export default function DesertAnalysis() {
  const [scores, setScores]     = useState<DesertScore[]>([])
  const [gaps, setGaps]         = useState<any[]>([])
  const [selected, setSelected] = useState<DesertScore | null>(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    Promise.all([getDesertScores(), getRegionalSummary(), getSpecialtyGaps()])
      .then(([s, _r, g]) => { setScores(s); setGaps(g); setSelected(s[0] || null) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="page-body">
      <div className="loading-center"><div className="spinner" /><span>Loading desert analysis…</span></div>
    </div>
  )

  const radarData = selected ? [
    { subject: 'Density',       value: (1 - ((selected as any).density_component || 0)) * 100 },
    { subject: 'Specialists',   value: (1 - ((selected as any).specialist_component || 0)) * 100 },
    { subject: 'Infrastructure',value: (1 - ((selected as any).infrastructure_component || 0)) * 100 },
    { subject: 'Data Quality',  value: ((selected as any).completeness_component || 0) * 100 },
    { subject: 'Coverage',      value: ((selected.critical_specialties_covered || 0) / 8) * 100 },
  ] : []

  const barData = scores.map(d => ({
    name: d.region?.split(' ')[0] || d.region,
    full_name: d.region,
    score: d.medical_desert_score,
    color: DESERT_COLORS[d.mds_label] || '#6366f1',
    label: d.mds_label,
  }))

  const selectedColor = selected ? DESERT_COLORS[selected.mds_label] || '#FF3B3B' : '#FF3B3B'

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>Medical Desert Analysis</h1>
        <p>Composite scoring across facility density, specialist coverage, infrastructure, and data quality</p>
      </div>

      {/* Summary KPIs */}
      <div className="kpi-grid mb-6" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {Object.entries(DESERT_COLORS).map(([label, color], i) => {
          const count = scores.filter(s => s.mds_label === label).length
          if (count === 0) return null
          return (
            <div key={label} className="kpi-card" style={{ '--accent-color': color, '--animation-delay': `${i * 50}ms` } as React.CSSProperties}>
              <div className="kpi-value" style={{ color, fontSize: 24 }}>{count}</div>
              <div className="kpi-label">{label.split(' ')[0]}</div>
              <div style={{ height: 3, borderRadius: 999, background: color + '30', marginTop: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(count / scores.length) * 100}%`, background: color, borderRadius: 999 }} />
              </div>
            </div>
          )
        }).filter(Boolean)}
      </div>

      {/* MDS Bar chart (all regions) */}
      <div className="card mb-6">
        <div className="card-title">Medical Desert Score — All Regions
          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>
            Higher = worse coverage. Click to inspect a region.
          </span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={barData} margin={{ left: -16, bottom: 4, right: 4 }}>
            <defs>
              {Object.entries(DESERT_COLORS).map(([label, color]) => (
                <linearGradient key={label} id={`grad-${label.replace(/\s/g,'')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={color} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.55} />
                </linearGradient>
              ))}
            </defs>
            <XAxis
              dataKey="name"
              tick={{ fill: 'var(--text-muted)', fontSize: 10.5, fontFamily: 'var(--font-display)' }}
              axisLine={false} tickLine={false}
            />
            <YAxis
              domain={[0, 1]}
              tick={{ fill: 'var(--text-muted)', fontSize: 10.5 }}
              axisLine={false} tickLine={false}
              tickFormatter={v => v.toFixed(1)}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,78,78,0.04)' }} />
            <Bar
              dataKey="score"
              radius={[5, 5, 0, 0]}
              maxBarSize={30}
              onClick={(d: any) => setSelected(scores.find(s => s.region === d.full_name) || null)}
              style={{ cursor: 'pointer' }}
            >
              {barData.map((entry, index) => (
                <Cell
                  key={index}
                  fill={`url(#grad-${entry.label.replace(/\s/g,'')})`}
                  opacity={selected?.region === entry.full_name ? 1 : 0.75}
                  stroke={selected?.region === entry.full_name ? entry.color : 'none'}
                  strokeWidth={1.5}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid-2 mb-6">
        {/* Selected region detail */}
        {selected && (
          <div className="card" style={{
            border: `1px solid ${selectedColor}28`,
            background: `linear-gradient(135deg, var(--bg-card) 0%, ${selectedColor}08 100%)`,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, fontFamily: 'var(--font-display)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Selected Region
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                  {selected.region}
                </div>
                <span className={`badge ${BADGE_MAP[selected.mds_label] || 'badge-adequate'}`} style={{ marginTop: 6, display: 'inline-flex' }}>
                  {selected.mds_label}
                </span>
              </div>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 38, fontWeight: 900,
                color: selectedColor, letterSpacing: '-0.03em',
                textShadow: `0 0 24px ${selectedColor}40`,
              }}>
                {(selected.medical_desert_score || 0).toFixed(3)}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {[
                ['Facilities', selected.total_facilities],
                ['Hospitals',  selected.hospital_count],
                ['Beds',       selected.total_beds],
                ['Doctors',    selected.total_doctors],
                ['Per 100k',   selected.facilities_per_100k?.toFixed(1)],
                ['Specialties', `${selected.critical_specialties_covered ?? 0}/8`],
              ].map(([label, val]) => (
                <div key={label as string} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--bg-border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 4 }}>
                    {label as string}
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)' }}>
                    {val ?? '—'}
                  </div>
                </div>
              ))}
            </div>

            {/* Missing specialties */}
            {toList(selected.critical_specialties_missing).length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.06em' }}>
                  MISSING CRITICAL SPECIALTIES
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {toList(selected.critical_specialties_missing).map(s => (
                    <span key={s} style={{
                      fontSize: 11, padding: '3px 9px', borderRadius: 10,
                      background: 'rgba(255,59,59,0.1)', color: '#FF6B6B',
                      border: '1px solid rgba(255,59,59,0.2)', fontWeight: 600,
                    }}>
                      ✗ {humanize(s)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Recommended actions */}
            {toList(selected.recommended_actions).length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.06em' }}>
                  RECOMMENDED NGO ACTIONS
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {toList(selected.recommended_actions).slice(0, 4).map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ color: selectedColor, fontSize: 12, marginTop: 1, flexShrink: 0 }}>→</span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{a}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Radar chart */}
        {radarData.length > 0 && (
          <div className="card">
            <div className="card-title">Coverage Profile — {selected?.region}</div>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData} margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                <PolarGrid
                  stroke="var(--bg-border)"
                  strokeDasharray="3 3"
                />
                <PolarAngleAxis
                  dataKey="subject"
                  tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: 'var(--font-display)', fontWeight: 600 }}
                />
                <PolarRadiusAxis
                  angle={90} domain={[0, 100]}
                  tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
                  axisLine={false}
                />
                <Radar
                  dataKey="value"
                  stroke={selectedColor}
                  fill={selectedColor}
                  fillOpacity={0.18}
                  strokeWidth={2}
                  dot={{ fill: selectedColor, r: 3, strokeWidth: 0 }}
                />
              </RadarChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
              Higher values = better coverage in each dimension
            </div>
          </div>
        )}
      </div>

      {/* Specialty gaps table */}
      {gaps.length > 0 && (
        <div className="card mb-6">
          <div className="card-title mb-4">Specialty Gap Analysis — All Regions</div>
          <div className="table-container" style={{ maxHeight: 340 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Region</th>
                  <th>Desert Status</th>
                  <th>Gap Count</th>
                  <th>Missing Specialties</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((g: any) => (
                  <tr key={g.region}>
                    <td className="font-semibold" style={{ color: 'var(--text-primary)' }}>{g.region}</td>
                    <td>
                      <span className={`badge ${BADGE_MAP[g.desert_label] || 'badge-adequate'}`}>{g.desert_label || '—'}</span>
                    </td>
                    <td>
                      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 30, height: 30, borderRadius: 8,
                        background: g.gap_count >= 4 ? 'rgba(255,59,59,0.12)' : g.gap_count >= 2 ? 'rgba(255,116,35,0.1)' : 'rgba(255,182,0,0.1)',
                        border: `1px solid ${g.gap_count >= 4 ? 'rgba(255,59,59,0.25)' : g.gap_count >= 2 ? 'rgba(255,116,35,0.2)' : 'rgba(255,182,0,0.2)'}`,
                      }}>
                        <span style={{
                          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14,
                          color: g.gap_count >= 4 ? '#FF3B3B' : g.gap_count >= 2 ? '#FF7423' : '#FFB600',
                        }}>{g.gap_count}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {(g.missing_specialties || []).map((s: string) => (
                          <span key={s} style={{
                            fontSize: 10, padding: '2px 7px', borderRadius: 10,
                            background: 'rgba(255,116,35,0.1)', color: '#FF7423',
                            border: '1px solid rgba(255,116,35,0.2)', fontWeight: 600,
                          }}>
                            {humanize(s)}
                          </span>
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
        <div className="card-title mb-4">All Regions — Desert Score Ranking</div>
        <div className="table-container" style={{ maxHeight: 420 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Region</th>
                <th>MDS Score</th>
                <th>Label</th>
                <th>Facilities</th>
                <th>Beds</th>
                <th>Doctors</th>
                <th>Per 100k</th>
                <th>Specialties</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s, i) => {
                const col = DESERT_COLORS[s.mds_label] || '#f0f4ff'
                return (
                  <tr key={s.region} style={{ cursor: 'pointer' }} onClick={() => setSelected(s)}>
                    <td>
                      <span style={{
                        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13,
                        color: i < 3 ? col : 'var(--text-muted)',
                      }}>
                        #{i + 1}
                      </span>
                    </td>
                    <td>
                      <span className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                        {s.region}
                      </span>
                      {selected?.region === s.region && (
                        <span style={{
                          marginLeft: 6, fontSize: 10, color: col,
                          fontFamily: 'var(--font-display)', fontWeight: 700,
                        }}>● selected</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: col }}>
                          {s.medical_desert_score?.toFixed(3)}
                        </span>
                        <div className="score-bar" style={{ width: 52 }}>
                          <div className="score-bar-fill" style={{ width: `${(s.medical_desert_score || 0) * 100}%`, background: col }} />
                        </div>
                      </div>
                    </td>
                    <td><span className={`badge ${BADGE_MAP[s.mds_label] || 'badge-adequate'}`}>{s.mds_label}</span></td>
                    <td style={{ color: 'var(--text-secondary)' }}>{s.total_facilities}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{s.total_beds}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{s.total_doctors}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{s.facilities_per_100k?.toFixed(1) ?? '—'}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                          {s.critical_specialties_covered ?? 0}/8
                        </span>
                        <div className="score-bar" style={{ width: 44 }}>
                          <div className="score-bar-fill" style={{
                            width: `${((s.critical_specialties_covered || 0) / 8) * 100}%`,
                            background: '#00D4B1',
                          }} />
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
  )
}