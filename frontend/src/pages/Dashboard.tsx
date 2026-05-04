// src/pages/Dashboard.tsx — Enhanced with animated counters, rich charts, gradient accents
import { useEffect, useState, useRef } from 'react'
import {
  getFacilityStats, getRegionalSummary, getDesertScores,
  type FacilityStats, type RegionalSummary, type DesertScore,
} from '../api/client'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, RadialBarChart, RadialBar,
} from 'recharts'

// ── Color palettes ─────────────────────────────────────────────────────────
const DESERT_COLORS: Record<string, string> = {
  'Critical Desert':    '#FF3B3B',
  'Severe Desert':      '#FF7423',
  'Moderate Desert':    '#FFB600',
  'At Risk':            '#D4A017',
  'Data Insufficient':  '#4A5E82',
  'Adequate Coverage':  '#00D4B1',
}

const BAR_GRADIENT_ID = 'barGradientFacility'
const BAR_GRADIENT_ID2 = 'barGradientHospital'

const KPI_DEFS = [
  { key: 'total_facilities',        label: 'Total Facilities',  icon: '🏥', color: '#FF4E4E', isFloat: false },
  { key: 'hospitals',               label: 'Hospitals',         icon: '🏨', color: '#38BDF8', isFloat: false },
  { key: 'clinics',                 label: 'Clinics',           icon: '🩺', color: '#00D4B1', isFloat: false },
  { key: 'ngos',                    label: 'NGO Partners',      icon: '🌍', color: '#8B7CF7', isFloat: false },
  { key: 'volunteer_facilities',    label: 'Accept Volunteers', icon: '🤝', color: '#FFB600', isFloat: false },
  { key: 'regions_covered',         label: 'Regions',           icon: '📍', color: '#34D399', isFloat: false },
  { key: 'avg_desert_score',        label: 'Avg Desert Score',  icon: '📊', color: '#FF7423', isFloat: true  },
  { key: 'critical_desert_regions', label: 'Severe+ Deserts',   icon: '🏜️', color: '#FF3B3B', isFloat: false },
]

// ── Animated counter hook ──────────────────────────────────────────────────
function useCountUp(target: number, isFloat: boolean, duration = 900) {
  const [value, setValue] = useState(0)
  const raf = useRef<number>()

  useEffect(() => {
    if (!target) return
    const start = performance.now()
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      // Ease out expo
      const eased = 1 - Math.pow(2, -10 * progress)
      const current = target * eased
      setValue(isFloat ? parseFloat(current.toFixed(3)) : Math.round(current))
      if (progress < 1) raf.current = requestAnimationFrame(animate)
    }
    raf.current = requestAnimationFrame(animate)
    return () => raf.current && cancelAnimationFrame(raf.current)
  }, [target, isFloat, duration])

  return value
}

// ── KPI Card with animated counter ────────────────────────────────────────
function KpiCard({ def, value }: { def: typeof KPI_DEFS[0]; value: number | null }) {
  const numVal = typeof value === 'number' ? value : 0
  const animated = useCountUp(numVal, def.isFloat, 900)

  const display = value === null || value === undefined
    ? '—'
    : def.isFloat
      ? animated.toFixed(3)
      : animated > 999
        ? animated.toLocaleString()
        : String(animated)

  return (
    <div className="kpi-card" style={{ '--accent-color': def.color } as React.CSSProperties}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="kpi-icon">{def.icon}</span>
        {/* Mini sparkline bar */}
        <div style={{
          width: 36, height: 20,
          display: 'flex', alignItems: 'flex-end', gap: 2,
          opacity: 0.35,
        }}>
          {[0.4, 0.6, 0.5, 0.8, 0.65, 1.0].map((h, i) => (
            <div key={i} style={{
              flex: 1, borderRadius: 2,
              height: `${h * 100}%`,
              background: def.color,
              animation: `fadeInUp ${200 + i * 50}ms both`,
            }} />
          ))}
        </div>
      </div>
      <div className="kpi-value">{display}</div>
      <div className="kpi-label">{def.label}</div>
    </div>
  )
}

// ── Custom tooltip ─────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--bg-border-accent)',
      borderRadius: 10,
      padding: '10px 14px',
      boxShadow: 'var(--shadow-lg)',
      fontFamily: 'var(--font-body)',
    }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, color: 'var(--text-primary)', marginBottom: 6 }}>
        {label}
      </div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, flexShrink: 0 }} />
          <span>{p.name}:</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: p.fill }}>{p.value?.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

// ── Desert label distribution — Radial bar variant ─────────────────────────
const PieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: any) => {
  if (percent < 0.05) return null
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="rgba(255,255,255,0.85)" textAnchor="middle" dominantBaseline="central"
      style={{ fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 700 }}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState<FacilityStats | null>(null)
  const [regional, setRegional] = useState<RegionalSummary[]>([])
  const [desert, setDesert] = useState<DesertScore[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getFacilityStats(), getRegionalSummary(), getDesertScores()])
      .then(([s, r, d]) => { setStats(s.data); setRegional(r); setDesert(d) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="page-body">
      <div className="loading-center">
        <div className="spinner" />
        <span>Loading intelligence dashboard…</span>
      </div>
    </div>
  )

  // Bar chart: top 10 regions
  const barData = regional
    .sort((a, b) => (b.total_facilities || 0) - (a.total_facilities || 0))
    .slice(0, 10)
    .map(r => ({
      name: r.region_normalised?.split(' ')[0] || r.region_normalised,
      facilities: r.total_facilities || 0,
      hospitals: r.hospital_count || 0,
    }))

  // Pie chart: desert classification
  const labelCounts: Record<string, number> = {}
  desert.forEach(d => { labelCounts[d.mds_label] = (labelCounts[d.mds_label] || 0) + 1 })
  const pieData = Object.entries(labelCounts).map(([name, value]) => ({ name, value }))

  // Critical regions
  const criticalRegions = desert
    .filter(d => ['Critical Desert', 'Severe Desert'].includes(d.mds_label))
    .sort((a, b) => b.medical_desert_score - a.medical_desert_score)

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>Ghana Healthcare Dashboard</h1>
        <p>
          Real-time intelligence across{' '}
          <strong style={{ color: 'var(--accent-primary)' }}>
            {stats?.total_facilities?.toLocaleString()}
          </strong>{' '}
          facilities in{' '}
          <strong style={{ color: 'var(--accent-teal)' }}>
            {stats?.regions_covered}
          </strong>{' '}
          regions
        </p>
      </div>

      {/* KPI Grid */}
      <div className="kpi-grid mb-6">
        {KPI_DEFS.map(def => (
          <KpiCard
            key={def.key}
            def={def}
            value={stats ? (stats as any)[def.key] : null}
          />
        ))}
      </div>

      {/* Charts row */}
      <div className="grid-2 mb-6">
        {/* Facilities by Region */}
        <div className="card">
          <div className="card-title">Facilities by Region — Top 10</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={barData} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
              <defs>
                <linearGradient id={BAR_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#FF4E4E" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#8B7CF7" stopOpacity={0.7} />
                </linearGradient>
                <linearGradient id={BAR_GRADIENT_ID2} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#38BDF8" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#00D4B1" stopOpacity={0.7} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="name"
                tick={{ fill: 'var(--text-muted)', fontSize: 10.5, fontFamily: 'var(--font-display)' }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fill: 'var(--text-muted)', fontSize: 10.5 }}
                axisLine={false} tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,78,78,0.04)' }} />
              <Bar dataKey="facilities" fill={`url(#${BAR_GRADIENT_ID})`} radius={[5, 5, 0, 0]} name="Facilities" maxBarSize={28} />
              <Bar dataKey="hospitals"  fill={`url(#${BAR_GRADIENT_ID2})`} radius={[5, 5, 0, 0]} name="Hospitals"  maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Medical Desert Distribution */}
        <div className="card">
          <div className="card-title">Medical Desert Classification</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <ResponsiveContainer width="55%" height={240}>
              <PieChart>
                <defs>
                  {pieData.map((entry) => (
                    <radialGradient key={entry.name} id={`pie-grad-${entry.name.replace(/\s/g, '')}`} cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor={DESERT_COLORS[entry.name] || '#6366f1'} stopOpacity={1} />
                      <stop offset="100%" stopColor={DESERT_COLORS[entry.name] || '#6366f1'} stopOpacity={0.7} />
                    </radialGradient>
                  ))}
                </defs>
                <Pie
                  data={pieData}
                  cx="50%" cy="50%"
                  innerRadius={52}
                  outerRadius={88}
                  dataKey="value"
                  paddingAngle={2}
                  labelLine={false}
                  label={PieLabel}
                >
                  {pieData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={`url(#pie-grad-${entry.name.replace(/\s/g, '')})`}
                      stroke="var(--bg-card)"
                      strokeWidth={2}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-card)', border: '1px solid var(--bg-border-accent)',
                    borderRadius: 10, color: 'var(--text-primary)', fontFamily: 'var(--font-body)',
                    fontSize: 12, boxShadow: 'var(--shadow-lg)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {pieData.sort((a, b) => b.value - a.value).map(entry => (
                <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: 3,
                    background: DESERT_COLORS[entry.name] || '#6366f1',
                    flexShrink: 0,
                    boxShadow: `0 0 6px ${DESERT_COLORS[entry.name] || '#6366f1'}60`,
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', fontWeight: 500, lineHeight: 1.2 }}>
                      {entry.name.split(' ')[0]}
                    </div>
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700,
                    color: DESERT_COLORS[entry.name] || 'var(--text-primary)',
                  }}>
                    {entry.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Critical & Severe regions */}
      <div className="card mb-6">
        <div className="card-title" style={{ marginBottom: 16 }}>
          🚨 Critical & Severe Desert Regions — Immediate Action Required
          <span style={{
            marginLeft: 'auto',
            fontFamily: 'var(--font-display)',
            fontSize: 11, fontWeight: 600,
            color: 'var(--accent-primary)',
            padding: '3px 10px',
            borderRadius: 999,
            background: 'rgba(255,78,78,0.1)',
            border: '1px solid rgba(255,78,78,0.2)',
            letterSpacing: '0.04em',
          }}>
            {criticalRegions.length} REGIONS
          </span>
        </div>

        <div className="table-container" style={{ maxHeight: 340 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Region</th>
                <th>Desert Score</th>
                <th>Label</th>
                <th>Facilities</th>
                <th>Hospitals</th>
                <th>Doctors</th>
                <th>Beds</th>
                <th>Specialty Gaps</th>
              </tr>
            </thead>
            <tbody>
              {criticalRegions.map((d, idx) => {
                const col = DESERT_COLORS[d.mds_label] || '#f0f4ff'
                const gaps = 5 - (d.critical_specialties_covered || 0)
                return (
                  <tr key={d.region}>
                    <td>
                      <span style={{
                        fontFamily: 'var(--font-display)',
                        fontWeight: 800, fontSize: 14,
                        color: col,
                      }}>
                        #{idx + 1}
                      </span>
                    </td>
                    <td>
                      <span className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                        {d.region}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontFamily: 'var(--font-display)',
                          fontWeight: 800, fontSize: 15,
                          color: col,
                        }}>
                          {d.medical_desert_score?.toFixed(3)}
                        </span>
                        <div className="score-bar" style={{ width: 56 }}>
                          <div className="score-bar-fill" style={{ width: `${(d.medical_desert_score || 0) * 100}%`, background: col }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge badge-${d.mds_label.split(' ')[0].toLowerCase()}`}>
                        {d.mds_label}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{d.total_facilities}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{d.hospital_count}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{d.total_doctors}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{d.total_beds}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          fontFamily: 'var(--font-display)',
                          fontWeight: 800,
                          fontSize: 16,
                          color: gaps >= 4 ? '#FF3B3B' : gaps >= 2 ? '#FF7423' : '#FFB600',
                        }}>
                          {gaps}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>missing</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Specialty coverage radial bars */}
      {regional.length > 0 && (
        <div className="card">
          <div className="card-title mb-6">Regional Specialty Coverage Overview</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 14 }}>
            {[
              { label: 'Emergency',  key: 'emergency_medicine_facilities', color: '#FF4E4E' },
              { label: 'Obstetrics', key: 'obstetrics_facilities',         color: '#8B7CF7' },
              { label: 'Surgery',    key: 'surgery_facilities',            color: '#38BDF8' },
              { label: 'Pediatrics', key: 'pediatrics_facilities',         color: '#00D4B1' },
              { label: 'ICU',        key: 'icu_facilities',                color: '#FFB600' },
              { label: 'Radiology',  key: 'radiology_facilities',          color: '#FF7423' },
            ].map(({ label, key, color }) => {
              const total = regional.reduce((sum, r) => sum + ((r as any)[key] || 0), 0)
              const maxTotal = regional.reduce((sum, r) => sum + (r.total_facilities || 0), 0)
              const pct = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0
              return (
                <div key={key} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  padding: '14px 8px',
                  background: 'var(--bg-surface)',
                  borderRadius: 12,
                  border: '1px solid var(--bg-border)',
                  transition: 'all 200ms ease',
                }}
                  onMouseEnter={e => {
                    const el = e.currentTarget
                    el.style.borderColor = color + '40'
                    el.style.transform = 'translateY(-2px)'
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget
                    el.style.borderColor = 'var(--bg-border)'
                    el.style.transform = 'translateY(0)'
                  }}
                >
                  <ResponsiveContainer width={64} height={64}>
                    <RadialBarChart
                      cx="50%" cy="50%"
                      innerRadius="65%" outerRadius="100%"
                      data={[{ value: pct, fill: color }]}
                      startAngle={90} endAngle={-270}
                    >
                      <RadialBar background={{ fill: 'var(--bg-border)' }} dataKey="value" cornerRadius={4} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <div style={{
                    fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color,
                    marginTop: -4,
                  }}>
                    {pct}%
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textAlign: 'center', letterSpacing: '0.03em' }}>
                    {label}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}