// src/pages/Dashboard.tsx — Advanced animated intelligence dashboard v3
import { useEffect, useState, useRef } from 'react'
import {
  getFacilityStats, getRegionalSummary, getDesertScores,
  getAnomalySummary, getRegionalPriority,
  type FacilityStats, type RegionalSummary, type DesertScore, type RegionalPriority,
} from '../api/client'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, RadialBarChart, RadialBar,
  CartesianGrid, Legend, AreaChart, Area,
} from 'recharts'

// ── Color palettes ────────────────────────────────────────────────────────────
const DESERT_COLORS: Record<string, string> = {
  'Critical Desert':   '#FF3B3B',
  'Severe Desert':     '#FF7423',
  'Moderate Desert':   '#FFB600',
  'At Risk':           '#D4A017',
  'Data Insufficient': '#4A5E82',
  'Adequate Coverage': '#00D4B1',
}

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

// ── Animated counter ──────────────────────────────────────────────────────────
function useCountUp(target: number, isFloat: boolean, duration = 900, enabled = true) {
  const [value, setValue] = useState(0)
  const raf = useRef<number | null>(null)
  useEffect(() => {
    if (!target || !enabled) return
    const start = performance.now()
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(2, -10 * progress)
      const current = target * eased
      setValue(isFloat ? parseFloat(current.toFixed(3)) : Math.round(current))
      if (progress < 1) raf.current = requestAnimationFrame(animate)
    }
    raf.current = requestAnimationFrame(animate)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [target, isFloat, duration, enabled])
  return value
}

// ── Intersection observer hook ────────────────────────────────────────────────
function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true) },
      { threshold },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return { ref, inView }
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ def, value }: { def: typeof KPI_DEFS[0]; value: number | null }) {
  const { ref, inView } = useInView()
  const numVal = typeof value === 'number' ? value : 0
  const animated = useCountUp(numVal, def.isFloat, 900, inView)

  const display =
    value === null || value === undefined
      ? '—'
      : def.isFloat
        ? animated.toFixed(3)
        : animated > 999
          ? animated.toLocaleString()
          : String(animated)

  return (
    <div
      ref={ref}
      className="kpi-card"
      style={{ '--accent-color': def.color } as React.CSSProperties}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="kpi-icon">{def.icon}</span>
        {/* Micro sparkline */}
        <div
          style={{
            width: 36,
            height: 18,
            display: 'flex',
            alignItems: 'flex-end',
            gap: 2,
            opacity: 0.3,
          }}
        >
          {[0.3, 0.5, 0.4, 0.7, 0.55, 1].map((h, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                borderRadius: 2,
                height: `${h * 100}%`,
                background: def.color,
                animation: inView ? `fadeInUp ${150 + i * 50}ms ${i * 40}ms both` : 'none',
              }}
            />
          ))}
        </div>
      </div>
      <div className="kpi-value">{display}</div>
      <div className="kpi-label">{def.label}</div>
    </div>
  )
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--bg-border-accent)',
        borderRadius: 10,
        padding: '10px 14px',
        boxShadow: 'var(--shadow-lg)',
        fontFamily: 'var(--font-body)',
        minWidth: 140,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 12,
          color: 'var(--text-primary)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {payload.map((p: any) => (
        <div
          key={p.dataKey}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--text-secondary)',
            padding: '2px 0',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: p.fill || p.stroke,
              flexShrink: 0,
            }}
          />
          <span>{p.name}:</span>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              color: p.fill || p.stroke,
              marginLeft: 'auto',
            }}
          >
            {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Pie label ─────────────────────────────────────────────────────────────────
const PieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.05) return null
  const R = Math.PI / 180
  const r = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + r * Math.cos(-midAngle * R)
  const y = cy + r * Math.sin(-midAngle * R)
  return (
    <text
      x={x}
      y={y}
      fill="rgba(255,255,255,0.9)"
      textAnchor="middle"
      dominantBaseline="central"
      style={{ fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 700 }}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({
  title,
  badge,
  badgeColor = '#FF4E4E',
  subtitle,
}: {
  title: string
  badge?: string
  badgeColor?: string
  subtitle?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <div>
        <div className="card-title" style={{ marginBottom: subtitle ? 2 : 0 }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      {badge && (
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            fontWeight: 700,
            color: badgeColor,
            padding: '3px 10px',
            borderRadius: 999,
            background: `${badgeColor}15`,
            border: `1px solid ${badgeColor}30`,
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}
        >
          {badge}
        </span>
      )}
    </div>
  )
}

// ── Sortable table hook ───────────────────────────────────────────────────────
function useSortable<T extends Record<string, any>>(data: T[], defaultKey: keyof T) {
  const [sortKey,  setSortKey]  = useState<keyof T>(defaultKey)
  const [sortDir,  setSortDir]  = useState<'asc' | 'desc'>('desc')

  const sorted = [...data].sort((a, b) => {
    const aVal = a[sortKey] ?? 0
    const bVal = b[sortKey] ?? 0
    return sortDir === 'desc'
      ? (bVal > aVal ? 1 : -1)
      : (aVal > bVal ? 1 : -1)
  })

  const toggle = (key: keyof T) => {
    if (key === sortKey) setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  return { sorted, sortKey, sortDir, toggle }
}

function ThCell({
  label, sortKey, currentKey, dir, onClick,
}: {
  label: string
  sortKey: string
  currentKey: string
  dir: 'asc' | 'desc'
  onClick: () => void
}) {
  const active = sortKey === currentKey
  return (
    <th
      onClick={onClick}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          color: active ? 'var(--accent-teal)' : undefined,
          transition: 'color 150ms',
        }}
      >
        {label}
        <span style={{ fontSize: 8, opacity: active ? 1 : 0.3 }}>
          {active ? (dir === 'desc' ? '▼' : '▲') : '⇅'}
        </span>
      </span>
    </th>
  )
}

// ── Specialty coverage radial card ────────────────────────────────────────────
function SpecialtyRadial({
  label, pct, color, total,
}: { label: string; pct: number; color: string; total: number }) {
  const { ref, inView } = useInView()
  const animated = useCountUp(pct, false, 700, inView)
  return (
    <div
      ref={ref}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '14px 8px',
        background: 'var(--bg-surface)',
        borderRadius: 12,
        border: '1px solid var(--bg-border)',
        transition: 'all 200ms ease',
        cursor: 'default',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = color + '45'
        el.style.transform = 'translateY(-3px)'
        el.style.boxShadow = `0 8px 20px ${color}20`
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = 'var(--bg-border)'
        el.style.transform = 'none'
        el.style.boxShadow = 'none'
      }}
    >
      <ResponsiveContainer width={64} height={64}>
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="60%"
          outerRadius="100%"
          data={[{ value: inView ? pct : 0, fill: color }]}
          startAngle={90}
          endAngle={-270}
        >
          <RadialBar
            background={{ fill: 'var(--bg-border)' }}
            dataKey="value"
            cornerRadius={4}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 15,
          color,
          marginTop: -4,
          lineHeight: 1,
        }}
      >
        {animated}%
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          fontWeight: 600,
          textAlign: 'center',
          letterSpacing: '0.03em',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
        {total.toLocaleString()} facilities
      </div>
    </div>
  )
}

// ── Trend mock data (for visual richness) ─────────────────────────────────────
const TREND_DATA = [
  { month: 'Jan', critical: 12, severe: 8, adequate: 3 },
  { month: 'Feb', critical: 11, severe: 9, adequate: 4 },
  { month: 'Mar', critical: 13, severe: 7, adequate: 5 },
  { month: 'Apr', critical: 10, severe: 8, adequate: 6 },
  { month: 'May', critical: 9,  severe: 10, adequate: 7 },
  { month: 'Jun', critical: 11, severe: 9,  adequate: 7 },
]

// ── Main component ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [stats,         setStats]         = useState<FacilityStats | null>(null)
  const [regional,      setRegional]      = useState<RegionalSummary[]>([])
  const [desert,        setDesert]        = useState<DesertScore[]>([])
  const [anomalySummary,setAnomalySummary]= useState<Record<string, unknown>>({})
  const [priority,      setPriority]      = useState<RegionalPriority[]>([])
  const [loading,       setLoading]       = useState(true)
  const [activeTab,     setActiveTab]     = useState<'overview' | 'regions' | 'anomalies'>('overview')

  useEffect(() => {
    Promise.all([
      getFacilityStats(),
      getRegionalSummary(),
      getDesertScores(),
      getAnomalySummary().catch(() => ({})),
      getRegionalPriority().catch(() => ({ data: [], dataSource: 'databricks' })),
    ])
      .then(([s, r, d, a, p]) => {
        setStats(s.data)
        setRegional(r)
        setDesert(d)
        setAnomalySummary(a as Record<string, unknown>)
        setPriority((p as { data: RegionalPriority[] }).data || [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // ── Derived data ──────────────────────────────────────────────────────────
  const barData = regional
    .sort((a, b) => (b.total_facilities || 0) - (a.total_facilities || 0))
    .slice(0, 10)
    .map(r => ({
      name: (r.region_normalised || '').split(' ')[0],
      facilities: r.total_facilities || 0,
      hospitals: r.hospital_count || 0,
      doctors: r.total_doctors || 0,
    }))

  const labelCounts: Record<string, number> = {}
  desert.forEach(d => { labelCounts[d.mds_label] = (labelCounts[d.mds_label] || 0) + 1 })
  const pieData = Object.entries(labelCounts).map(([name, value]) => ({ name, value }))

  const criticalRegions = desert
    .filter(d => ['Critical Desert', 'Severe Desert'].includes(d.mds_label))
    .sort((a, b) => b.medical_desert_score - a.medical_desert_score)

  const { sorted: sortedCritical, sortKey: crKey, sortDir: crDir, toggle: crToggle } =
    useSortable(criticalRegions, 'medical_desert_score')

  const { sorted: sortedPriority, sortKey: prKey, sortDir: prDir, toggle: prToggle } =
    useSortable(priority, 'regional_priority_score')

  const SPECIALTY_DEFS = [
    { label: 'Emergency',    key: 'emergency_medicine_facilities', color: '#FF4E4E' },
    { label: 'Obstetrics',   key: 'obstetrics_facilities',         color: '#8B7CF7' },
    { label: 'Surgery',      key: 'surgery_facilities',            color: '#38BDF8' },
    { label: 'Pediatrics',   key: 'pediatrics_facilities',         color: '#00D4B1' },
    { label: 'ICU',          key: 'icu_facilities',                color: '#FFB600' },
    { label: 'Radiology',    key: 'radiology_facilities',          color: '#FF7423' },
    { label: 'Mental Health',key: 'mental_health_facilities',      color: '#A78BFA' },
    { label: 'Infectious',   key: 'infectious_disease_facilities', color: '#34D399' },
  ]

  const maxTotal = regional.reduce((sum, r) => sum + (r.total_facilities || 0), 0)

  if (loading) return (
    <div className="page-body">
      <div className="loading-center" style={{ minHeight: 'calc(100vh - 200px)' }}>
        <div className="spinner" />
        <span>Loading intelligence dashboard…</span>
      </div>
    </div>
  )

  return (
    <div className="page-body" style={{ maxWidth: 1600, margin: '0 auto' }}>
      {/* ── Page header ── */}
      <div className="page-header" style={{ marginBottom: 20 }}>
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
          regions — Virtue Foundation Ghana Project
        </p>
      </div>

      {/* ── KPI Grid ── */}
      <div className="kpi-grid mb-6">
        {KPI_DEFS.map(def => (
          <KpiCard key={def.key} def={def} value={stats ? (stats as any)[def.key] : null} />
        ))}
      </div>

      {/* ── Tab nav ── */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 20,
          background: 'var(--bg-card)',
          padding: 6,
          borderRadius: 12,
          border: '1px solid var(--bg-border)',
          overflowX: 'auto',
        }}
      >
        {([
          { id: 'overview',   label: '📊 Overview',  },
          { id: 'regions',    label: '📍 Regions',   },
          { id: 'anomalies',  label: '⚠️ Anomalies', },
        ] as { id: typeof activeTab; label: string }[]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '7px 16px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'var(--font-display)',
              letterSpacing: '0.02em',
              transition: 'all 200ms ease',
              background: activeTab === tab.id
                ? 'linear-gradient(135deg, rgba(255,78,78,0.2), rgba(139,124,247,0.15))'
                : 'transparent',
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════════════ OVERVIEW TAB ══════════════════ */}
      {activeTab === 'overview' && (
        <div style={{ animation: 'fadeInUp 250ms both' }}>
          {/* Charts row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 16,
              marginBottom: 16,
            }}
          >
            {/* Facilities by Region bar chart */}
            <div className="card">
              <SectionHeader title="Facilities by Region — Top 10" subtitle="Sorted by total count" />
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={barData} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradFacility" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF4E4E" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="#8B7CF7" stopOpacity={0.7} />
                    </linearGradient>
                    <linearGradient id="gradHospital" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="#00D4B1" stopOpacity={0.7} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--bg-border)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-display)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,78,78,0.04)' }} />
                  <Bar dataKey="facilities" fill="url(#gradFacility)" radius={[5, 5, 0, 0]} name="Facilities" maxBarSize={24} />
                  <Bar dataKey="hospitals"  fill="url(#gradHospital)" radius={[5, 5, 0, 0]} name="Hospitals"  maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Desert Classification pie */}
            <div className="card">
              <SectionHeader title="Medical Desert Classification" subtitle={`${desert.length} regions mapped`} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ResponsiveContainer width="52%" height={220}>
                  <PieChart>
                    <defs>
                      {pieData.map(entry => (
                        <radialGradient
                          key={entry.name}
                          id={`pie-${entry.name.replace(/\s/g, '')}`}
                          cx="50%" cy="50%" r="50%"
                        >
                          <stop offset="0%"   stopColor={DESERT_COLORS[entry.name] || '#6366f1'} stopOpacity={1} />
                          <stop offset="100%" stopColor={DESERT_COLORS[entry.name] || '#6366f1'} stopOpacity={0.7} />
                        </radialGradient>
                      ))}
                    </defs>
                    <Pie
                      data={pieData}
                      cx="50%" cy="50%"
                      innerRadius={48}
                      outerRadius={84}
                      dataKey="value"
                      paddingAngle={2}
                      labelLine={false}
                      label={PieLabel}
                      animationBegin={0}
                      animationDuration={900}
                    >
                      {pieData.map(entry => (
                        <Cell
                          key={entry.name}
                          fill={`url(#pie-${entry.name.replace(/\s/g, '')})`}
                          stroke="var(--bg-card)"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--bg-border-accent)',
                        borderRadius: 10,
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-body)',
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {pieData
                    .sort((a, b) => b.value - a.value)
                    .map(entry => (
                      <div
                        key={entry.name}
                        style={{ display: 'flex', alignItems: 'center', gap: 7 }}
                      >
                        <div
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: 3,
                            background: DESERT_COLORS[entry.name] || '#6366f1',
                            flexShrink: 0,
                            boxShadow: `0 0 5px ${DESERT_COLORS[entry.name] || '#6366f1'}60`,
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 10,
                              color: 'var(--text-secondary)',
                              fontWeight: 500,
                              lineHeight: 1.2,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {entry.name}
                          </div>
                        </div>
                        <div
                          style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 13,
                            fontWeight: 800,
                            color: DESERT_COLORS[entry.name] || 'var(--text-primary)',
                          }}
                        >
                          {entry.value}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>

          {/* Trend line chart */}
          <div className="card mb-6">
            <SectionHeader
              title="Desert Severity Trend (Simulated)"
              subtitle="Monthly regional desert classification changes"
            />
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={TREND_DATA} margin={{ top: 4, right: 16, left: -14, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradCritical" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#FF4E4E" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#FF4E4E" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradSevere" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#FF7423" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#FF7423" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradAdequate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#00D4B1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00D4B1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bg-border)" />
                <XAxis
                  dataKey="month"
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-display)', paddingTop: 8 }}
                />
                <Area type="monotone" dataKey="critical" name="Critical"  stroke="#FF4E4E" fill="url(#gradCritical)"  strokeWidth={2} dot={{ r: 3, fill: '#FF4E4E' }} />
                <Area type="monotone" dataKey="severe"   name="Severe"    stroke="#FF7423" fill="url(#gradSevere)"    strokeWidth={2} dot={{ r: 3, fill: '#FF7423' }} />
                <Area type="monotone" dataKey="adequate" name="Adequate"  stroke="#00D4B1" fill="url(#gradAdequate)"  strokeWidth={2} dot={{ r: 3, fill: '#00D4B1' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Specialty coverage */}
          <div className="card">
            <SectionHeader
              title="Regional Specialty Coverage"
              subtitle="% of facilities with each specialty across all regions"
            />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                gap: 12,
              }}
            >
              {SPECIALTY_DEFS.map(({ label, key, color }) => {
                const total = regional.reduce((sum, r) => sum + ((r as any)[key] || 0), 0)
                const pct = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0
                return (
                  <SpecialtyRadial
                    key={key}
                    label={label}
                    pct={pct}
                    color={color}
                    total={total}
                  />
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════ REGIONS TAB ══════════════════ */}
      {activeTab === 'regions' && (
        <div style={{ animation: 'fadeInUp 250ms both', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Critical regions table */}
          <div className="card">
            <SectionHeader
              title="🚨 Critical & Severe Desert Regions"
              subtitle="Regions requiring immediate intervention"
              badge={`${criticalRegions.length} REGIONS`}
              badgeColor="#FF4E4E"
            />
            <div className="table-container" style={{ maxHeight: 380 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <ThCell label="Region"       sortKey="region"               currentKey={crKey as string} dir={crDir} onClick={() => crToggle('region')} />
                    <ThCell label="MDS Score"    sortKey="medical_desert_score" currentKey={crKey as string} dir={crDir} onClick={() => crToggle('medical_desert_score')} />
                    <th>Label</th>
                    <ThCell label="Facilities"   sortKey="total_facilities"     currentKey={crKey as string} dir={crDir} onClick={() => crToggle('total_facilities')} />
                    <ThCell label="Hospitals"    sortKey="hospital_count"       currentKey={crKey as string} dir={crDir} onClick={() => crToggle('hospital_count')} />
                    <ThCell label="Doctors"      sortKey="total_doctors"        currentKey={crKey as string} dir={crDir} onClick={() => crToggle('total_doctors')} />
                    <ThCell label="Beds"         sortKey="total_beds"           currentKey={crKey as string} dir={crDir} onClick={() => crToggle('total_beds')} />
                    <th>Specialty Gaps</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCritical.map((d, idx) => {
                    const col  = DESERT_COLORS[d.mds_label] || '#f0f4ff'
                    const gaps = 5 - (d.critical_specialties_covered || 0)
                    return (
                      <tr key={d.region}>
                        <td>
                          <span
                            style={{
                              fontFamily: 'var(--font-display)',
                              fontWeight: 800,
                              fontSize: 13,
                              color: col,
                            }}
                          >
                            #{idx + 1}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              fontWeight: 600,
                              color: 'var(--text-primary)',
                              fontSize: 13,
                            }}
                          >
                            {d.region}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span
                              style={{
                                fontFamily: 'var(--font-display)',
                                fontWeight: 800,
                                fontSize: 14,
                                color: col,
                              }}
                            >
                              {d.medical_desert_score?.toFixed(3)}
                            </span>
                            <div className="score-bar" style={{ width: 52 }}>
                              <div
                                className="score-bar-fill"
                                style={{
                                  width: `${(d.medical_desert_score || 0) * 100}%`,
                                  background: col,
                                }}
                              />
                            </div>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`badge badge-${d.mds_label.split(' ')[0].toLowerCase()}`}
                          >
                            {d.mds_label}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-secondary)' }}>{d.total_facilities}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{d.hospital_count}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{d.total_doctors}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{d.total_beds}</td>
                        <td>
                          <span
                            style={{
                              fontFamily: 'var(--font-display)',
                              fontWeight: 800,
                              fontSize: 15,
                              color:
                                gaps >= 4
                                  ? '#FF3B3B'
                                  : gaps >= 2
                                    ? '#FF7423'
                                    : '#FFB600',
                            }}
                          >
                            {gaps}
                          </span>
                          <span
                            style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}
                          >
                            missing
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Regional priority */}
          {priority.length > 0 && (
            <div className="card">
              <SectionHeader
                title="Regional Intervention Priority"
                subtitle="Composite score across desert severity, specialty gaps, and facility density"
              />
              <div className="table-container" style={{ maxHeight: 400 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <ThCell label="Region"        sortKey="region_normalised"      currentKey={prKey as string} dir={prDir} onClick={() => prToggle('region_normalised')} />
                      <ThCell label="Priority Score" sortKey="regional_priority_score" currentKey={prKey as string} dir={prDir} onClick={() => prToggle('regional_priority_score')} />
                      <ThCell label="Desert Score"  sortKey="avg_desert_score"        currentKey={prKey as string} dir={prDir} onClick={() => prToggle('avg_desert_score')} />
                      <th>Tier</th>
                      <ThCell label="Facilities"    sortKey="facility_count"          currentKey={prKey as string} dir={prDir} onClick={() => prToggle('facility_count')} />
                      <ThCell label="Critical"      sortKey="critical_facility_count" currentKey={prKey as string} dir={prDir} onClick={() => prToggle('critical_facility_count')} />
                      <ThCell label="High Risk"     sortKey="high_risk_facility_count"currentKey={prKey as string} dir={prDir} onClick={() => prToggle('high_risk_facility_count')} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPriority.map((p, idx) => {
                      const TIER_COLORS: Record<string, string> = {
                        'Tier 1': '#FF3B3B',
                        'Tier 2': '#FF7423',
                        'Tier 3': '#FFB600',
                        'Tier 4': '#34D399',
                      }
                      const tierKey =
                        Object.keys(TIER_COLORS).find(k =>
                          (p.priority_tier || '').startsWith(k),
                        ) || ''
                      const col = TIER_COLORS[tierKey] || '#4A5E82'
                      return (
                        <tr key={p.region_normalised}>
                          <td>
                            <span
                              style={{
                                fontFamily: 'var(--font-display)',
                                fontWeight: 800,
                                fontSize: 13,
                                color:
                                  idx < 3
                                    ? '#FF3B3B'
                                    : idx < 6
                                      ? '#FF7423'
                                      : 'var(--text-muted)',
                              }}
                            >
                              #{idx + 1}
                            </span>
                          </td>
                          <td>
                            <span
                              style={{
                                fontWeight: 600,
                                color: 'var(--text-primary)',
                                fontSize: 13,
                              }}
                            >
                              {p.region_normalised}
                            </span>
                          </td>
                          <td>
                            <span
                              style={{
                                fontFamily: 'var(--font-display)',
                                fontWeight: 800,
                                fontSize: 14,
                                color: col,
                              }}
                            >
                              {(p.regional_priority_score ?? 0).toFixed(3)}
                            </span>
                          </td>
                          <td>
                            <span
                              style={{
                                fontFamily: 'var(--font-display)',
                                fontWeight: 700,
                                color: col,
                              }}
                            >
                              {(p.avg_desert_score ?? 0).toFixed(3)}
                            </span>
                          </td>
                          <td>
                            <span
                              style={{
                                fontSize: 10,
                                padding: '2px 8px',
                                borderRadius: 999,
                                background: col + '22',
                                color: col,
                                fontWeight: 700,
                                fontFamily: 'var(--font-display)',
                              }}
                            >
                              {p.priority_tier || '—'}
                            </span>
                          </td>
                          <td style={{ color: 'var(--text-secondary)' }}>
                            {p.facility_count ?? '—'}
                          </td>
                          <td>
                            <span
                              style={{
                                fontWeight: 700,
                                color:
                                  (p.critical_facility_count ?? 0) >= 3
                                    ? '#FF3B3B'
                                    : '#FFB600',
                              }}
                            >
                              {p.critical_facility_count ?? '—'}
                            </span>
                          </td>
                          <td
                            style={{
                              color:
                                (p.high_risk_facility_count ?? 0) > 10
                                  ? '#FF7423'
                                  : 'var(--text-secondary)',
                            }}
                          >
                            {p.high_risk_facility_count ?? '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Doctor density bar chart */}
          {barData.length > 0 && (
            <div className="card">
              <SectionHeader title="Doctor Distribution by Region" subtitle="Top 10 regions" />
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradDoctor" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#FFB600" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="#FF7423" stopOpacity={0.7} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--bg-border)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-display)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,182,0,0.04)' }} />
                  <Bar dataKey="doctors" fill="url(#gradDoctor)" radius={[5, 5, 0, 0]} name="Doctors" maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ ANOMALIES TAB ══════════════════ */}
      {activeTab === 'anomalies' && (
        <div style={{ animation: 'fadeInUp 250ms both', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Risk distribution */}
          {anomalySummary && (anomalySummary as any).by_risk_level && (
            <div className="card">
              <SectionHeader
                title="Anomaly Risk Distribution"
                subtitle="Statistical anomaly flags across the facility dataset"
              />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: 10,
                  marginBottom: 16,
                }}
              >
                {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'CLEAN'] as const).map(level => {
                  const colors: Record<string, string> = {
                    CRITICAL: '#FF3B3B',
                    HIGH:     '#FF7423',
                    MEDIUM:   '#FFB600',
                    LOW:      '#34D399',
                    CLEAN:    '#00D4B1',
                  }
                  const count = ((anomalySummary as any).by_risk_level?.[level] || 0) as number
                  const pct = stats?.total_facilities
                    ? ((count / stats.total_facilities) * 100).toFixed(1)
                    : '—'
                  return (
                    <div
                      key={level}
                      style={{
                        padding: '14px 16px',
                        borderRadius: 12,
                        background: colors[level] + '0d',
                        border: `1px solid ${colors[level]}25`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        transition: 'all 200ms ease',
                      }}
                      onMouseEnter={e => {
                        const el = e.currentTarget as HTMLElement
                        el.style.transform = 'translateY(-2px)'
                        el.style.boxShadow = `0 8px 20px ${colors[level]}20`
                      }}
                      onMouseLeave={e => {
                        const el = e.currentTarget as HTMLElement
                        el.style.transform = 'none'
                        el.style.boxShadow = 'none'
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: colors[level],
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          fontFamily: 'var(--font-display)',
                        }}
                      >
                        {level}
                      </div>
                      <div
                        style={{
                          fontSize: 24,
                          fontWeight: 800,
                          color: colors[level],
                          fontFamily: 'var(--font-display)',
                          lineHeight: 1,
                        }}
                      >
                        {count.toLocaleString()}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        facilities · {pct}%
                      </div>
                      <div
                        style={{
                          height: 3,
                          borderRadius: 999,
                          background: 'var(--bg-border)',
                          overflow: 'hidden',
                          marginTop: 2,
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${Math.min((count / (stats?.total_facilities || 1)) * 100 * 3, 100)}%`,
                            background: colors[level],
                            borderRadius: 999,
                            transition: 'width 800ms cubic-bezier(0.34,1.56,0.64,1)',
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Anomaly bar chart breakdown */}
          {anomalySummary && (anomalySummary as any).by_risk_level && (
            <div className="card">
              <SectionHeader title="Risk Level Breakdown" />
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'CLEAN'] as const).map(level => ({
                    level,
                    count: (anomalySummary as any).by_risk_level?.[level] || 0,
                    color: { CRITICAL: '#FF3B3B', HIGH: '#FF7423', MEDIUM: '#FFB600', LOW: '#34D399', CLEAN: '#00D4B1' }[level],
                  }))}
                  margin={{ top: 4, right: 4, left: -14, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--bg-border)" vertical={false} />
                  <XAxis
                    dataKey="level"
                    tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-display)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,78,78,0.04)' }} />
                  <Bar dataKey="count" name="Facilities" radius={[6, 6, 0, 0]} maxBarSize={52}>
                    {['CRITICAL','HIGH','MEDIUM','LOW','CLEAN'].map((level, i) => (
                      <Cell
                        key={level}
                        fill={['#FF3B3B','#FF7423','#FFB600','#34D399','#00D4B1'][i]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Additional anomaly stats */}
          {anomalySummary && Object.keys(anomalySummary).length > 0 && (
            <div className="card">
              <SectionHeader title="Anomaly Summary Stats" />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 10,
                }}
              >
                {Object.entries(anomalySummary)
                  .filter(([k]) => k !== 'by_risk_level' && typeof (anomalySummary as any)[k] !== 'object')
                  .map(([key, val]) => (
                    <div
                      key={key}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 10,
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--bg-border)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          marginBottom: 4,
                        }}
                      >
                        {key.replace(/_/g, ' ')}
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontWeight: 800,
                          fontSize: 20,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {typeof val === 'number'
                          ? Number.isInteger(val)
                            ? val.toLocaleString()
                            : val.toFixed(3)
                          : String(val)}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}