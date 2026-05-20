// src/pages/MapExplorer.tsx — Mission Control v4 (Performance-Optimised)
import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react'
import {
  MapContainer, TileLayer, Marker, Popup, Tooltip,
  ZoomControl, useMap, CircleMarker,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getFacilitiesMap, getRegions, getFacilityDetail, type FacilityDetail } from '../api/client'
import { useTheme } from '../App'

// ── Types ────────────────────────────────────────────────────────────────────
interface FacilityFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    unique_id?: string
    name: string
    facility_type_clean?: string
    region_normalised?: string
    city_clean?: string
    specialties?: string
    specialties_enriched?: string[]
    phone_numbers?: string[]
    official_phone?: string
    desert_label?: string
    medical_desert_score?: number
    data_completeness_score?: number
    number_doctors_int?: number
    capacity_int?: number
    is_hospital?: boolean
    is_clinic?: boolean
    is_ngo?: boolean
    has_emergency_medicine?: boolean
    has_surgery?: boolean
    has_icu?: boolean
    has_obstetrics?: boolean
    has_pediatrics?: boolean
    has_radiology?: boolean
    has_infectious_disease?: boolean
    has_mental_health?: boolean
    accepts_volunteers_bool?: boolean
    mds_label?: string
    total_stat_anomalies?: number
    capability_confidence?: number
    capability_is_valid?: boolean
    idp_citations?: string[]
    description?: string
    address_line1?: string
    address_line2?: string
    address_line3?: string
    address_city?: string
    address_state_or_region?: string
    address_zip_or_postcode?: string
    year_established?: string
    organizationdescription?: string
    organization_type_clean?: string
    color?: string
  }
}

interface DesertRegion {
  region: string
  lat: number
  lon: number
  medical_desert_score: number
  mds_label: string
  total_facilities: number
  total_doctors: number
  total_beds: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const getFacilityEmoji = (props: FacilityFeature['properties']) => {
  if (props.is_hospital) return '🏥'
  if (props.is_clinic)   return '🩺'
  if (props.is_ngo)      return '🤝'
  return '📍'
}

const DESERT_COLOR = (score?: number): string => {
  if (score === null || score === undefined) return '#94a3b8'
  if (score >= 0.75) return '#FF4E4E'
  if (score >= 0.55) return '#FF7423'
  if (score >= 0.40) return '#FFB600'
  if (score >= 0.25) return '#4ADE80'
  return '#00D4B1'
}

const FACILITY_COLOR = (props: FacilityFeature['properties']) =>
  DESERT_COLOR(props.medical_desert_score)

const DESERT_LABEL_COLOR = (label?: string, score?: number) => {
  if (label?.toLowerCase().includes('critical')) return '#FF4E4E'
  if (label?.toLowerCase().includes('severe'))   return '#FF7423'
  if (label?.toLowerCase().includes('moderate')) return '#FFB600'
  if (label?.toLowerCase().includes('risk'))     return '#4ADE80'
  if (label?.toLowerCase().includes('adequate')) return '#00D4B1'
  return DESERT_COLOR(score)
}

const formatStat = (value: unknown, type: 'number' | 'float' | 'bool' | 'text' = 'text') => {
  if (value === null || value === undefined || value === '') return '—'
  if (type === 'bool')   return value ? 'Yes' : 'No'
  if (type === 'float')  return typeof value === 'number' ? value.toFixed(3) : String(value)
  if (type === 'number') return typeof value === 'number' ? value.toLocaleString() : String(value)
  return String(value)
}

// Memoised label formatter with a small LRU-style cache (unbounded but cheap)
const labelCache = new Map<string, string>()
const formatLabel = (s: string): string => {
  if (!s) return s
  const cached = labelCache.get(s)
  if (cached !== undefined) return cached
  const cleaned = s.replace(/^(has_|is_|stat_anomaly_|enhanced_)/, '')
  const words = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim().split(/\s+/)
  const small = new Set(['a','an','the','and','or','of','for','in','to','at','by','on'])
  const result = words.map((w, i) =>
    i === 0 || !small.has(w.toLowerCase())
      ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      : w.toLowerCase()
  ).join(' ')
  labelCache.set(s, result)
  return result
}

// ── Tile layers ──────────────────────────────────────────────────────────────
const TILE_LAYERS = {
  dark:      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light:     'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  terrain:   'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
}
type TileStyle = keyof typeof TILE_LAYERS

// ── Capability badge config ──────────────────────────────────────────────────
const CAPABILITY_BADGES = [
  { key: 'has_emergency_medicine', label: 'Emergency',     icon: '🚨', color: '#FF4E4E' },
  { key: 'has_surgery',            label: 'Surgery',       icon: '🔪', color: '#38BDF8' },
  { key: 'has_icu',                label: 'ICU',           icon: '🫀', color: '#8B7CF7' },
  { key: 'has_obstetrics',         label: 'Obstetrics',    icon: '👶', color: '#F472B6' },
  { key: 'has_pediatrics',         label: 'Pediatrics',    icon: '🧒', color: '#00D4B1' },
  { key: 'has_radiology',          label: 'Radiology',     icon: '🩻', color: '#38BDF8' },
  { key: 'has_infectious_disease', label: 'Infectious',    icon: '🦠', color: '#FFB600' },
  { key: 'has_mental_health',      label: 'Mental Health', icon: '🧠', color: '#A78BFA' },
  { key: 'accepts_volunteers_bool',label: 'Volunteers',    icon: '🤝', color: '#4ADE80' },
] as const

// ── Static style objects (defined once, outside render) ─────────────────────
const POPUP_BODY_STYLE: React.CSSProperties = {
  flex: 1, overflowY: 'auto', overflowX: 'hidden',
  padding: '12px 14px 14px',
  display: 'flex', flexDirection: 'column', gap: 10,
  scrollbarWidth: 'thin', scrollbarColor: 'var(--bg-border-accent) transparent',
}

const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 9, fontWeight: 800, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.12em',
  marginBottom: 6, fontFamily: 'var(--font-display)',
  display: 'flex', alignItems: 'center', gap: 5,
}

// ── Animated count-up hook ───────────────────────────────────────────────────
function useCountUp(target: number, duration = 900) {
  const [current, setCurrent] = useState(0)
  const frameRef = useRef<number | null>(null)
  const prevTarget = useRef(0)

  useEffect(() => {
    if (prevTarget.current === target) return
    prevTarget.current = target
    const start = Date.now()
    const from = current

    const tick = () => {
      const elapsed = Date.now() - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCurrent(Math.round(from + (target - from) * eased))
      if (progress < 1) frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current) }
  }, [target, duration]) // current intentionally excluded to avoid restarts

  return current
}

// ── MDS Arc Gauge ─────────────────────────────────────────────────────────────
const MDSGauge = memo(function MDSGauge({ score, color }: { score: number; color: string }) {
  const R = 28, cx = 36, cy = 36
  const circumference = Math.PI * R
  const offset = circumference * (1 - Math.min(score, 1))
  return (
    <svg width={72} height={42} viewBox="0 0 72 44" style={{ overflow: 'visible' }}>
      <path
        d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={5} strokeLinecap="round"
      />
      <path
        d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
        fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
        strokeDasharray={`${circumference}`} strokeDashoffset={`${offset}`}
        style={{ transition: 'stroke-dashoffset 800ms cubic-bezier(0.34,1.1,0.64,1)', filter: `drop-shadow(0 0 4px ${color}80)` }}
      />
      <text x={cx} y={cy - 4} textAnchor="middle" fill={color}
        style={{ fontSize: 11, fontWeight: 800, fontFamily: 'var(--font-mono)', letterSpacing: '-0.03em' }}>
        {score.toFixed(2)}
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" fill="rgba(255,255,255,0.35)"
        style={{ fontSize: 6.5, fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        MDS
      </text>
    </svg>
  )
})

// ── Region zoomer ─────────────────────────────────────────────────────────────
// Uses a stable key to prevent unnecessary effect runs
function RegionZoomer({ features }: { features: FacilityFeature[] }) {
  const map = useMap()
  // Derive a stable bounding-box key so the effect only fires when bounds change
  const boundsKey = useMemo(() => {
    if (!features.length) return ''
    const lats = features.map(f => f.geometry.coordinates[1]).filter(Boolean)
    const lngs = features.map(f => f.geometry.coordinates[0]).filter(Boolean)
    if (!lats.length) return ''
    return `${Math.min(...lats).toFixed(4)},${Math.min(...lngs).toFixed(4)},${Math.max(...lats).toFixed(4)},${Math.max(...lngs).toFixed(4)}`
  }, [features])

  useEffect(() => {
    if (!boundsKey) return
    const [s, w, n, e] = boundsKey.split(',').map(Number)
    map.fitBounds([[s, w], [n, e]], { padding: [40, 40], animate: true, duration: 0.8 })
  }, [boundsKey, map])
  return null
}

// ── Stat mini-card ────────────────────────────────────────────────────────────
const StatCell = memo(function StatCell({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div className="stat-cell" style={{ '--cell-color': color } as React.CSSProperties}>
      <div style={{ fontSize: 15 }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color, marginTop: 2, fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div style={{ fontSize: 7.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>
        {label}
      </div>
    </div>
  )
})

// ── Tab button ────────────────────────────────────────────────────────────────
const TabBtn = memo(function TabBtn({ active, label, icon, onClick }: { active: boolean; label: string; icon: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        padding: '7px 4px', background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 10, fontWeight: active ? 700 : 500,
        fontFamily: 'var(--font-display)',
        color: active ? 'var(--accent-teal)' : 'var(--text-muted)',
        borderBottom: `2px solid ${active ? 'var(--accent-teal)' : 'transparent'}`,
        transition: 'all 180ms ease',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: 11 }}>{icon}</span>
      {label}
    </button>
  )
})

// ── Anomaly flag row ──────────────────────────────────────────────────────────
const AnomalyRow = memo(function AnomalyRow({ label, value }: { label: string; value: boolean | undefined }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid rgba(255,78,78,0.08)' }}>
      <span style={{ color: '#FF7423', fontSize: 10 }}>▲</span>
      <span style={{ fontSize: 10, color: '#FF9966', fontFamily: 'var(--font-body)' }}>{label}</span>
    </div>
  )
})

// ── Sub-components ────────────────────────────────────────────────────────────
const SectionLabel = memo(function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={SECTION_LABEL_STYLE}>{children}</div>
})

// ── Facility Popup ────────────────────────────────────────────────────────────
const FacilityPopup = memo(function FacilityPopup({ f, detail, loadingDetail }: { f: FacilityFeature; detail?: FacilityDetail; loadingDetail: boolean }) {
  const props = f.properties
  const [activeTab, setActiveTab] = useState<'overview' | 'capabilities' | 'contact'>('overview')

  const desertLabel = props.mds_label || props.desert_label
  const desertColor = useMemo(() => DESERT_LABEL_COLOR(desertLabel, props.medical_desert_score), [desertLabel, props.medical_desert_score])
  const mdsScore = props.medical_desert_score ?? 0

  const detailSpecialties = useMemo(() => {
    const specialtiesRaw = Array.isArray(props.specialties_enriched) && props.specialties_enriched.length
      ? props.specialties_enriched
      : props.specialties ? [props.specialties] : []
    return [...new Set(
      (Array.isArray(detail?.specialties_enriched) && detail!.specialties_enriched!.length
        ? detail!.specialties_enriched! : specialtiesRaw
      ).map(formatLabel),
    )].filter(Boolean)
  }, [props.specialties_enriched, props.specialties, detail?.specialties_enriched])

  const capabilities = useMemo(() =>
    [...new Set((detail?.capability_enriched || []).map(formatLabel))].filter(Boolean).slice(0, 16),
    [detail?.capability_enriched]
  )

  const activeBadges = useMemo(() =>
    CAPABILITY_BADGES.filter(b => (props as any)[b.key]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.has_emergency_medicine, props.has_surgery, props.has_icu, props.has_obstetrics,
     props.has_pediatrics, props.has_radiology, props.has_infectious_disease,
     props.has_mental_health, props.accepts_volunteers_bool]
  )

  const { normalizedUrl } = useMemo(() => {
    const website = detail?.official_website?.trim()
    const normalizedUrl = website && /^https?:\/\//i.test(website) ? website : `https://${website}`
    return { normalizedUrl }
  }, [detail?.official_website])

  const normalizedPhones = useMemo(() => {
    const phonesRaw = detail?.phone_numbers?.length ? detail.phone_numbers : detail?.official_phone
    return (Array.isArray(phonesRaw) ? phonesRaw : [phonesRaw])
      .map(p => p?.toString().trim()).filter(Boolean)
  }, [detail?.phone_numbers, detail?.official_phone])

  const addressParts = useMemo(() =>
    [detail?.address_line1, detail?.address_line2, detail?.address_line3,
     detail?.address_city, detail?.address_state_or_region, detail?.address_zip_or_postcode]
      .map(v => v?.toString().trim()).filter(v => v && v.toLowerCase() !== 'null')
      .filter((v, i, arr) => arr.indexOf(v) === i).join(', '),
    [detail?.address_line1, detail?.address_line2, detail?.address_line3,
     detail?.address_city, detail?.address_state_or_region, detail?.address_zip_or_postcode]
  )

  const isCritical = desertLabel?.toLowerCase().includes('critical')
  const isSevere   = desertLabel?.toLowerCase().includes('severe')

  const handleOverview     = useCallback(() => setActiveTab('overview'), [])
  const handleCapabilities = useCallback(() => setActiveTab('capabilities'), [])
  const handleContact      = useCallback(() => setActiveTab('contact'), [])

  return (
    <div style={{
      fontFamily: 'var(--font-display)',
      width: 340, maxWidth: '90vw',
      background: 'var(--bg-card)',
      color: 'var(--text-primary)',
      borderRadius: 16,
      display: 'flex', flexDirection: 'column',
      maxHeight: 'min(82vh, 620px)',
      overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{
        flexShrink: 0,
        padding: '14px 16px 0',
        background: `linear-gradient(145deg, ${desertColor}14, ${desertColor}05, transparent)`,
        borderBottom: `1px solid ${desertColor}22`,
      }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
          <div style={{ flexShrink: 0, marginTop: -2 }}>
            <MDSGauge score={mdsScore} color={desertColor} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 800, color: 'var(--text-primary)',
              lineHeight: 1.3, marginBottom: 4,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {props.name}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '2px 6px', lineHeight: 1.6 }}>
              {props.facility_type_clean && <span style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>{props.facility_type_clean}</span>}
              {props.city_clean && <span>📍 {props.city_clean}</span>}
              {props.region_normalised && <span>• {props.region_normalised}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
              {desertLabel && (
                <span style={{
                  fontSize: 9, padding: '2px 8px', borderRadius: 999,
                  fontWeight: 700, background: `${desertColor}20`,
                  color: desertColor, border: `1px solid ${desertColor}40`,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  {(isCritical || isSevere) && <span style={{ animation: 'pulseOpacity 1.4s ease-in-out infinite' }}>●</span>}
                  {desertLabel}
                </span>
              )}
              {(props.data_completeness_score ?? 0) > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
                  <div style={{ flex: 1, height: 3, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${(props.data_completeness_score || 0) * 100}%`,
                      background: 'linear-gradient(90deg, #00D4B1, #38BDF8)',
                      borderRadius: 999, transition: 'width 600ms ease',
                    }} />
                  </div>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {((props.data_completeness_score || 0) * 100).toFixed(0)}% complete
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 2 }}>
          <TabBtn active={activeTab === 'overview'}     label="Overview"     icon="📊" onClick={handleOverview} />
          <TabBtn active={activeTab === 'capabilities'} label="Capabilities" icon="⚕️" onClick={handleCapabilities} />
          <TabBtn active={activeTab === 'contact'}      label="Contact"      icon="📞" onClick={handleContact} />
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={POPUP_BODY_STYLE}>

        {/* ── TAB: OVERVIEW ── */}
        {activeTab === 'overview' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
              {[
                { icon: '👨‍⚕️', label: 'Doctors',   value: formatStat(props.number_doctors_int, 'number'), color: '#38BDF8' },
                { icon: '🛏️',  label: 'Beds',       value: formatStat(props.capacity_int, 'number'),         color: '#8B5CF6' },
                { icon: '⚠️',  label: 'Anomalies',  value: formatStat(props.total_stat_anomalies, 'number'), color: '#F43F5E' },
                { icon: '🫀',  label: 'ICU',         value: formatStat(props.has_icu, 'bool'),                color: '#EF4444' },
                { icon: '🔪',  label: 'Surgery',     value: formatStat(props.has_surgery, 'bool'),            color: '#3B82F6' },
                { icon: '🚨',  label: 'Emergency',   value: formatStat(props.has_emergency_medicine, 'bool'), color: '#DC2626' },
              ].map((s, i) => <StatCell key={i} {...s} />)}
            </div>

            {(props.total_stat_anomalies ?? 0) > 0 && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 11px',
                borderRadius: 10, background: '#FF4E4E0d', border: '1px solid #FF4E4E28',
                borderLeft: '3px solid #FF4E4E',
              }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#FF6B6B', marginBottom: 2 }}>
                    {props.total_stat_anomalies} Data Anomal{(props.total_stat_anomalies ?? 0) > 1 ? 'ies' : 'y'} Detected
                  </div>
                  {detail?.anomaly_risk_level && (
                    <div style={{ fontSize: 10, color: '#FF9966' }}>Risk Level: {detail.anomaly_risk_level}</div>
                  )}
                  {detail && (
                    <div style={{ marginTop: 5 }}>
                      <AnomalyRow label="Capability inflation detected"     value={detail.stat_anomaly_capability_inflation} />
                      <AnomalyRow label="Hospital with no doctors"          value={detail.stat_anomaly_hospital_no_doctors} />
                      <AnomalyRow label="Clinic claims ICU"                 value={detail.stat_anomaly_clinic_claims_icu} />
                      <AnomalyRow label="Possible ghost facility"           value={detail.stat_anomaly_ghost_facility} />
                      <AnomalyRow label="Specialty mismatch"                value={detail.stat_anomaly_specialty_mismatch} />
                      <AnomalyRow label="Suspicious procedure breadth"      value={detail.stat_anomaly_procedure_breadth} />
                      <AnomalyRow label="Low IDP confidence"                value={detail.enhanced_low_idp_confidence} />
                      <AnomalyRow label="ICU without infrastructure"        value={detail.enhanced_icu_no_infrastructure} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {detail?.llm_priority_action && (
              <div style={{
                padding: '9px 11px', borderRadius: 10,
                background: 'rgba(139,124,247,0.06)', border: '1px solid rgba(139,124,247,0.18)',
                borderLeft: '3px solid #8B7CF7',
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#8B7CF7', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 4 }}>
                  ✦ Recommended Action
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  {detail.llm_priority_action}
                </div>
              </div>
            )}

            {detail?.llm_clinical_assessment && (
              <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(0,212,177,0.05)', border: '1px solid rgba(0,212,177,0.15)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent-teal)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 4 }}>
                  🩺 Clinical Assessment
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{detail.llm_clinical_assessment}</div>
              </div>
            )}

            {detail?.description && detail.description.trim() && (
              <div>
                <SectionLabel>About this facility</SectionLabel>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, fontStyle: 'italic' }}>
                  "{detail.description}"
                </p>
              </div>
            )}

            {loadingDetail && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                <div className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                Loading full details…
              </div>
            )}
          </>
        )}

        {/* ── TAB: CAPABILITIES ── */}
        {activeTab === 'capabilities' && (
          <>
            {activeBadges.length > 0 && (
              <div>
                <SectionLabel>Active Service Capabilities</SectionLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {activeBadges.map(b => (
                    <span key={b.key} style={{
                      fontSize: 10, padding: '4px 10px', borderRadius: 999,
                      fontWeight: 700, background: `${b.color}16`,
                      color: b.color, border: `1px solid ${b.color}30`,
                      display: 'flex', alignItems: 'center', gap: 4,
                      animation: 'fadeInUp 200ms both',
                    }}>
                      {b.icon} {b.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {detailSpecialties.length > 0 && (
              <div>
                <SectionLabel>Medical Specialties ({detailSpecialties.length})</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px 10px' }}>
                  {detailSpecialties.map((spec, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)', padding: '2px 0' }}>
                      <span style={{ color: desertColor, flexShrink: 0, fontSize: 8 }}>◆</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spec}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {capabilities.length > 0 && (
              <div>
                <SectionLabel>Procedures & Capabilities ({capabilities.length})</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '3px 10px' }}>
                  {capabilities.map((cap, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text-secondary)', padding: '2px 0' }}>
                      <span style={{ color: '#8B7CF7', flexShrink: 0, fontSize: 8 }}>✓</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cap}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
              {[
                { icon: '🤝', label: 'Volunteers',  value: formatStat(props.accepts_volunteers_bool, 'bool'), color: '#10B981' },
                { icon: '🦠', label: 'Infectious',  value: formatStat(props.has_infectious_disease, 'bool'),  color: '#F97316' },
                { icon: '🧠', label: 'Mental Hlth', value: formatStat(props.has_mental_health, 'bool'),        color: '#A78BFA' },
                { icon: '👶', label: 'Obstetrics',  value: formatStat(props.has_obstetrics, 'bool'),           color: '#F472B6' },
                { icon: '🩻', label: 'Radiology',   value: formatStat(props.has_radiology, 'bool'),            color: '#38BDF8' },
                { icon: '🧒', label: 'Pediatrics',  value: formatStat(props.has_pediatrics, 'bool'),           color: '#00D4B1' },
              ].map((s, i) => <StatCell key={i} {...s} />)}
            </div>

            {(props.capability_confidence ?? 0) > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.15)' }}>
                <span style={{ fontSize: 13 }}>🎯</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>Capability Confidence</span>
                    <span style={{ fontSize: 10, color: '#38BDF8', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                      {((props.capability_confidence ?? 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(props.capability_confidence ?? 0) * 100}%`, background: 'linear-gradient(90deg, #38BDF8, #00D4B1)', borderRadius: 999 }} />
                  </div>
                </div>
              </div>
            )}

            {loadingDetail && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                <div className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                Loading capabilities…
              </div>
            )}
          </>
        )}

        {/* ── TAB: CONTACT ── */}
        {activeTab === 'contact' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {detail?.year_established && detail.year_established.toString().trim().toLowerCase() !== 'null' && (
                <div style={{ padding: '8px 10px', borderRadius: 9, background: 'rgba(0,212,177,0.06)', border: '1px solid rgba(0,212,177,0.15)' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Founded</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent-teal)', fontFamily: 'var(--font-mono)' }}>{detail.year_established}</div>
                </div>
              )}
              {props.organization_type_clean && (
                <div style={{ padding: '8px 10px', borderRadius: 9, background: 'rgba(139,124,247,0.06)', border: '1px solid rgba(139,124,247,0.15)' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Org Type</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#8B7CF7' }}>{props.organization_type_clean}</div>
                </div>
              )}
            </div>

            {addressParts && (
              <div>
                <SectionLabel>📍 Address</SectionLabel>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.55, background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 9, padding: '8px 10px' }}>
                  {addressParts}
                </div>
              </div>
            )}

            {(detail?.email || detail?.official_website || normalizedPhones.length > 0) ? (
              <div>
                <SectionLabel>Contact Methods</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {normalizedPhones.map((phone, idx) => (
                    <a key={idx} href={`tel:${phone?.replace(/\s+/g, '')}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.18)', textDecoration: 'none', color: '#38BDF8' }}>
                      <span style={{ fontSize: 14 }}>📞</span>
                      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{phone}</span>
                    </a>
                  ))}
                  {detail?.email && (
                    <a href={`mailto:${detail.email}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bg-border)', textDecoration: 'none', color: 'var(--text-secondary)' }}>
                      <span style={{ fontSize: 14 }}>✉️</span>
                      <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail.email}</span>
                    </a>
                  )}
                  {detail?.official_website && (
                    <a href={normalizedUrl} target="_blank" rel="noopener noreferrer"
                      onClick={e => { e.preventDefault(); window.open(normalizedUrl, '_blank', 'noopener,noreferrer') }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, background: 'rgba(0,212,177,0.07)', border: '1px solid rgba(0,212,177,0.18)', textDecoration: 'none', color: 'var(--accent-teal)' }}>
                      <span style={{ fontSize: 14 }}>🌐</span>
                      <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail.official_website}</span>
                      <span style={{ fontSize: 9, marginLeft: 'auto', opacity: 0.6 }}>↗</span>
                    </a>
                  )}
                </div>
              </div>
            ) : (
              !loadingDetail && (
                <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 11 }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>📭</div>
                  No contact information available
                </div>
              )
            )}

            {detail?.organizationdescription && detail.organizationdescription.trim() && (
              <div>
                <SectionLabel>Organization</SectionLabel>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                  {detail.organizationdescription}
                </p>
              </div>
            )}

            {loadingDetail && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[1,2,3].map(i => (
                  <div key={i} style={{ height: 38, borderRadius: 9, background: 'var(--bg-surface)', animation: 'shimmer 1.4s ease infinite' }} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})

// ── Toggle button ─────────────────────────────────────────────────────────────
const ToggleButton = memo(function ToggleButton({ active, label, icon, color, onClick }: { active: boolean; label: string; icon: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '7px 10px', borderRadius: 9, cursor: 'pointer',
      fontSize: 11, fontWeight: 700,
      border: `1px solid ${active ? color + '55' : 'var(--bg-border)'}`,
      background: active ? `${color}18` : 'var(--bg-input)',
      color: active ? color : 'var(--text-muted)',
      transition: 'all 200ms cubic-bezier(0.34,1.2,0.64,1)',
      fontFamily: 'var(--font-display)', flex: 1, justifyContent: 'center',
      boxShadow: active ? `0 0 12px ${color}28` : 'none',
    }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      {label}
    </button>
  )
})

// ── Filter chip ───────────────────────────────────────────────────────────────
const FilterChip = memo(function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999,
      background: 'rgba(139,124,247,0.14)', border: '1px solid rgba(139,124,247,0.28)',
      fontSize: 10, fontWeight: 600, color: '#8B7CF7',
      animation: 'chipIn 200ms cubic-bezier(0.34,1.56,0.64,1) both',
    }}>
      {label}
      <span onClick={onRemove} style={{ cursor: 'pointer', opacity: 0.6, marginLeft: 2, fontWeight: 400 }}
        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.6')}>
        ×
      </span>
    </div>
  )
})

// ── Sidebar panel ─────────────────────────────────────────────────────────────
const SidebarPanel = memo(function SidebarPanel({ collapsed, onToggle, children }: { collapsed: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'absolute', top: 16, left: collapsed ? -238 : 16,
      zIndex: 1000, width: 244,
      display: 'flex', flexDirection: 'column', gap: 10,
      transition: 'left 380ms cubic-bezier(0.34,1.3,0.64,1)',
    }}>
      {children}
      <button onClick={onToggle} style={{
        position: 'absolute', top: 8, right: collapsed ? -42 : -34,
        width: 26, height: 52,
        background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
        borderLeft: 'none', borderRadius: '0 10px 10px 0', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: 'var(--text-muted)',
        boxShadow: '4px 0 16px rgba(0,0,0,0.2)',
        transition: 'all 150ms ease',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--accent-teal)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
      >
        {collapsed ? '›' : '‹'}
      </button>
    </div>
  )
})

// ── Animated Stat Card ────────────────────────────────────────────────────────
const AnimatedStatCard = memo(function AnimatedStatCard({ icon, label, value, color, index }: { icon: string; label: string; value: number; color: string; index: number }) {
  const animated = useCountUp(value, 800 + index * 60)
  return (
    <div style={{
      padding: '8px 8px 7px', borderRadius: 10,
      background: `${color}0d`, border: `1px solid ${color}20`,
      textAlign: 'center', cursor: 'default',
      animation: `fadeInUp 300ms ${index * 40}ms both`,
      transition: 'transform 150ms ease, box-shadow 150ms ease',
    }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1.05)'
        ;(e.currentTarget as HTMLElement).style.boxShadow = `0 4px 16px ${color}28`
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1)'
        ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
      }}
    >
      <div style={{ fontSize: 14 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color, fontFamily: 'var(--font-mono)', lineHeight: 1, marginTop: 3, letterSpacing: '-0.02em' }}>
        {animated.toLocaleString()}
      </div>
      <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
    </div>
  )
})

// ── Icon cache — avoids creating a new L.divIcon on every render ──────────────
const iconCache = new Map<string, L.DivIcon>()

function getMarkerIcon(
  emoji: string,
  isActive: boolean,
  hasPulse: boolean,
  markerColor: string,
): L.DivIcon {
  const key = `${emoji}|${isActive}|${hasPulse}|${markerColor}`
  const cached = iconCache.get(key)
  if (cached) return cached

  const size = isActive ? 36 : 28
  const icon = L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:${size}px;height:${size}px;transform:translate(-50%,-50%);">
        ${hasPulse ? `
          <div style="
            position:absolute;inset:-6px;border-radius:50%;
            border:2px solid ${markerColor};
            animation:markerPulse 2s ease-out infinite;
            opacity:0.5;pointer-events:none;
          "></div>
          <div style="
            position:absolute;inset:-12px;border-radius:50%;
            border:1.5px solid ${markerColor};
            animation:markerPulse 2s ease-out infinite 0.5s;
            opacity:0.25;pointer-events:none;
          "></div>
        ` : ''}
        <div style="
          width:${size}px;height:${size}px;border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          font-size:${isActive ? 20 : 15}px;
          background:${isActive ? `${markerColor}1a` : 'rgba(6,9,26,0.7)'};
          border:${isActive ? `2px solid ${markerColor}80` : `1.5px solid ${markerColor}40`};
          box-shadow:0 0 ${isActive ? 18 : 8}px ${markerColor}${isActive ? 'bb' : '55'};
          backdrop-filter:blur(4px);
          transition:all 200ms cubic-bezier(0.34,1.56,0.64,1);
        ">${emoji}</div>
      </div>
    `,
  })
  iconCache.set(key, icon)
  return icon
}

// ── Individual Marker (memoised) ─────────────────────────────────────────────
interface FacilityMarkerProps {
  f: FacilityFeature
  index: number
  isActive: boolean
  detail?: FacilityDetail
  loadingDetail: boolean
  onMarkerClick: (markerId: string, uniqueId?: string) => void
  onPopupClose: () => void
}

const FacilityMarker = memo(function FacilityMarker({
  f, index, isActive, detail, loadingDetail, onMarkerClick, onPopupClose,
}: FacilityMarkerProps) {
  const [lon, lat] = f.geometry?.coordinates || [0, 0]
  if (!lat || !lon) return null

  const props = f.properties
  const markerId = props.unique_id || String(index)
  const markerColor = FACILITY_COLOR(props)
  const emoji = getFacilityEmoji(props)
  const isCritical = (props.desert_label || '').toLowerCase().includes('critical')
  const isSevere   = (props.desert_label || '').toLowerCase().includes('severe')
  const hasPulse   = isCritical || isSevere
  const shortName  = props.name.length > 28 ? `${props.name.slice(0, 28)}…` : props.name

  const icon = getMarkerIcon(emoji, isActive, hasPulse, markerColor)

  const handleClick = useCallback(() => {
    onMarkerClick(markerId, props.unique_id)
  }, [markerId, props.unique_id, onMarkerClick])

  return (
    <Marker
      key={markerId}
      position={[lat, lon]}
      icon={icon}
      eventHandlers={{
        click: handleClick,
        popupclose: onPopupClose,
      }}
    >
      <Tooltip className="facility-label" direction="right" offset={[14, 0]} opacity={0.95}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: markerColor, display: 'inline-block', flexShrink: 0 }} />
          {shortName}
        </span>
      </Tooltip>
      <Popup className="facility-popup" closeOnClick={false} closeButton maxWidth={360} minWidth={320}>
        <FacilityPopup f={f} detail={detail} loadingDetail={loadingDetail} />
      </Popup>
    </Marker>
  )
})

// ── Desert circle marker (memoised) ─────────────────────────────────────────
const DesertCircle = memo(function DesertCircle({ dr }: { dr: DesertRegion }) {
  const color = DESERT_COLOR(dr.medical_desert_score)
  const radius = Math.max(20, (dr.medical_desert_score || 0) * 65)
  const pathOptions = useMemo(() => ({
    color, fillColor: color, fillOpacity: 0.12, weight: 1, opacity: 0.4,
  }), [color])

  return (
    <CircleMarker center={[dr.lat, dr.lon]} radius={radius} pathOptions={pathOptions}>
      <Popup className="facility-popup">
        <div style={{ fontFamily: 'var(--font-display)', minWidth: 200, padding: 4 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4, color: 'var(--text-primary)' }}>{dr.region}</div>
          <div style={{ color, fontSize: 11, fontWeight: 600, marginBottom: 8 }}>{dr.mds_label}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[['MDS Score', dr.medical_desert_score?.toFixed(3)], ['Facilities', dr.total_facilities], ['Doctors', dr.total_doctors], ['Beds', dr.total_beds]].map(([k, v]) => (
              <div key={k as string}>
                <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </Popup>
    </CircleMarker>
  )
})

// ── Static data (defined once) ────────────────────────────────────────────────
const TILE_STYLES = [
  { id: 'dark'      as TileStyle, label: 'Dark',      icon: '🌑' },
  { id: 'light'     as TileStyle, label: 'Light',     icon: '☀️' },
  { id: 'terrain'   as TileStyle, label: 'Terrain',   icon: '🏔️' },
  { id: 'satellite' as TileStyle, label: 'Satellite', icon: '🛰️' },
]

const LEGEND_ITEMS = [
  { label: 'Critical Desert', color: '#FF4E4E', score: 0.90 },
  { label: 'Severe Desert',   color: '#FF7423', score: 0.65 },
  { label: 'Moderate',        color: '#FFB600', score: 0.48 },
  { label: 'At Risk',         color: '#4ADE80', score: 0.30 },
  { label: 'Adequate',        color: '#00D4B1', score: 0.12 },
]

const LEGEND_FACILITY_TYPES = [
  { label: 'Hospital', emoji: '🏥', color: '#38BDF8' },
  { label: 'Clinic',   emoji: '🩺', color: '#8B7CF7' },
  { label: 'NGO',      emoji: '🤝', color: '#4ADE80' },
  { label: 'Other',    emoji: '📍', color: '#94A3B8' },
]

const FILTER_CONFIGS = [
  {
    placeholder: 'All Regions', accent: '139,124,247',
    optionsKey: 'regions' as const,
    stateKey: 'regionFilter' as const,
  },
  {
    placeholder: 'All Types', accent: '0,212,177',
    optionsKey: 'types' as const,
    stateKey: 'typeFilter' as const,
    staticOptions: [
      { value: 'Hospital', label: '🏥 Hospital' },
      { value: 'Clinic',   label: '🩺 Clinic' },
      { value: 'NGO',      label: '🤝 NGO' },
      { value: 'Pharmacy', label: '💊 Pharmacy' },
    ],
  },
  {
    placeholder: 'All Specialties', accent: '255,182,0',
    optionsKey: 'specialties' as const,
    stateKey: 'specialtyFilter' as const,
    staticOptions: [
      { value: 'emergency',  label: '🚨 Emergency' },
      { value: 'surgery',    label: '🔪 Surgery' },
      { value: 'icu',        label: '🫀 ICU' },
      { value: 'obstetrics', label: '👶 Obstetrics' },
      { value: 'pediatrics', label: '🧒 Pediatrics' },
      { value: 'radiology',  label: '🩻 Radiology' },
      { value: 'volunteers', label: '🤝 Volunteers' },
    ],
  },
]

// ── Main component ────────────────────────────────────────────────────────────
export default function MapExplorer() {
  const { theme } = useTheme()
  const [features,      setFeatures]      = useState<FacilityFeature[]>([])
  const [desertRegions, setDesertRegions] = useState<DesertRegion[]>([])
  const [regions,       setRegions]       = useState<string[]>([])
  const [loading,       setLoading]       = useState(true)
  const [regionFilter,  setRegionFilter]  = useState('')
  const [typeFilter,    setTypeFilter]    = useState('')
  const [desertOnly,    setDesertOnly]    = useState(false)
  const [searchTerm,    setSearchTerm]    = useState('')
  const [showDesertHeat,setShowDesertHeat]= useState(true)
  const [tileStyle,     setTileStyle]     = useState<TileStyle>('dark')
  const [total,         setTotal]         = useState(0)
  const [activePopupId, setActivePopupId] = useState<string | null>(null)
  const [detailCache,   setDetailCache]   = useState<Record<string, FacilityDetail>>({})
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({})
  const [statsOpen,     setStatsOpen]     = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [specialtyFilter, setSpecialtyFilter] = useState('')

  // Use a Set ref to guard in-flight requests without triggering re-renders
  const fetchingRef = useRef<Set<string>>(new Set())
  const searchRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setTileStyle(theme === 'dark' ? 'dark' : 'light') }, [theme])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    if (mq.matches) setSidebarCollapsed(true)
    const handler = (e: MediaQueryListEvent) => setSidebarCollapsed(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const loadData = useCallback(async (region = '', type = '', desert = false, search = '', specialty = '') => {
    setLoading(true)
    try {
      const { data: geo } = await getFacilitiesMap({ region: region || undefined, facility_type: type || undefined })
      const allFeatures = (geo.features || []) as unknown as FacilityFeature[]
      let filtered = desert
        ? allFeatures.filter(f => ['Critical Desert', 'Severe Desert'].includes(f.properties.desert_label || ''))
        : allFeatures

      if (search.trim()) {
        const q = search.toLowerCase()
        filtered = filtered.filter(f =>
          f.properties.name?.toLowerCase().includes(q) ||
          f.properties.city_clean?.toLowerCase().includes(q) ||
          f.properties.region_normalised?.toLowerCase().includes(q) ||
          f.properties.facility_type_clean?.toLowerCase().includes(q),
        )
        if (filtered.length === 1) setActivePopupId(filtered[0].properties.unique_id || null)
      }

      if (specialty) {
        const sf = specialty.toLowerCase()
        filtered = filtered.filter(f => {
          const p = f.properties
          if (sf === 'emergency')  return p.has_emergency_medicine
          if (sf === 'surgery')    return p.has_surgery
          if (sf === 'icu')        return p.has_icu
          if (sf === 'obstetrics') return p.has_obstetrics
          if (sf === 'pediatrics') return p.has_pediatrics
          if (sf === 'radiology')  return p.has_radiology
          if (sf === 'volunteers') return p.accepts_volunteers_bool
          return true
        })
      }

      setFeatures(filtered)
      setTotal(filtered.length)
      setDesertRegions([])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, []) // no specialtyFilter dep — passed as argument now

  useEffect(() => { getRegions().then(setRegions) }, [])

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(
      () => loadData(regionFilter, typeFilter, desertOnly, searchTerm, specialtyFilter),
      300,
    )
    return () => { if (searchRef.current) clearTimeout(searchRef.current) }
  }, [regionFilter, typeFilter, desertOnly, searchTerm, specialtyFilter, loadData])

  const ensureDetail = useCallback(async (uniqueId?: string) => {
    if (!uniqueId || fetchingRef.current.has(uniqueId) || detailCache[uniqueId]) return
    fetchingRef.current.add(uniqueId)
    setDetailLoading(prev => ({ ...prev, [uniqueId]: true }))
    try {
      const detail = await getFacilityDetail(uniqueId)
      setDetailCache(prev => ({ ...prev, [uniqueId]: detail }))
    } catch (e) {
      console.error(e)
    } finally {
      fetchingRef.current.delete(uniqueId)
      setDetailLoading(prev => ({ ...prev, [uniqueId]: false }))
    }
  }, [detailCache])

  const handleMarkerClick = useCallback((markerId: string, uniqueId?: string) => {
    setActivePopupId(prev => {
      if (prev === markerId) return null
      return markerId
    })
    ensureDetail(uniqueId)
  }, [ensureDetail])

  const handlePopupClose = useCallback(() => setActivePopupId(null), [])

  const clearAllFilters = useCallback(() => {
    setRegionFilter(''); setTypeFilter(''); setSpecialtyFilter('')
    setDesertOnly(false); setSearchTerm('')
  }, [])

  const toggleDesertOnly    = useCallback(() => setDesertOnly(v => !v), [])
  const toggleDesertHeat    = useCallback(() => setShowDesertHeat(v => !v), [])
  const toggleStats         = useCallback(() => setStatsOpen(v => !v), [])
  const toggleSidebar       = useCallback(() => setSidebarCollapsed(v => !v), [])
  const clearSearch         = useCallback(() => setSearchTerm(''), [])

  const hasActiveFilters = !!regionFilter || !!typeFilter || !!specialtyFilter || desertOnly || !!searchTerm

  // ── Derived stats (memoised) ─────────────────────────────────────────────
  const stats = useMemo(() => ({
    hospitals:   features.filter(f => f.properties.is_hospital).length,
    ngos:        features.filter(f => f.properties.is_ngo).length,
    clinics:     features.filter(f => f.properties.is_clinic).length,
    criticals:   features.filter(f => (f.properties.desert_label || '').toLowerCase().includes('critical')).length,
    severes:     features.filter(f => (f.properties.desert_label || '').toLowerCase().includes('severe')).length,
    volunteers:  features.filter(f => f.properties.accepts_volunteers_bool).length,
    withDoctors: features.filter(f => (f.properties.number_doctors_int ?? 0) > 0).length,
    totalDoctors:features.reduce((s, f) => s + (f.properties.number_doctors_int ?? 0), 0),
  }), [features])

  const statCards = useMemo(() => [
    { label: 'Hospitals',  value: stats.hospitals,    color: '#38BDF8', icon: '🏥' },
    { label: 'Clinics',    value: stats.clinics,      color: '#00D4B1', icon: '🩺' },
    { label: 'NGOs',       value: stats.ngos,         color: '#A78BFA', icon: '🤝' },
    { label: 'Volunteers', value: stats.volunteers,   color: '#4ADE80', icon: '👥' },
    { label: 'Critical',   value: stats.criticals,    color: '#FF4E4E', icon: '⚠️' },
    { label: 'Severe',     value: stats.severes,      color: '#FF7423', icon: '🔶' },
    { label: 'W/ Doctors', value: stats.withDoctors,  color: '#F59E0B', icon: '👨‍⚕️' },
    { label: 'Doctors',    value: stats.totalDoctors, color: '#818CF8', icon: '🩻' },
  ], [stats])

  const regionOptions = useMemo(() => regions.map(r => ({ value: r, label: r })), [regions])

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 70px)', overflow: 'hidden', background: 'var(--bg-base)' }}>

      {/* ── Controls sidebar ── */}
      <SidebarPanel collapsed={sidebarCollapsed} onToggle={toggleSidebar}>

        {/* Main controls card */}
        <div style={{
          borderRadius: 18, overflow: 'hidden',
          background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
          backdropFilter: 'blur(16px)', boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
        }}>
          {/* Header */}
          <div style={{
            padding: '13px 14px 10px',
            background: 'linear-gradient(135deg, rgba(139,124,247,0.12), rgba(0,212,177,0.05))',
            borderBottom: '1px solid var(--bg-border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 7, background: 'rgba(139,124,247,0.2)',
                  border: '1px solid rgba(139,124,247,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
                }}>🗺️</div>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: 'var(--font-display)' }}>
                  Map Explorer
                </div>
              </div>
              {hasActiveFilters && (
                <button onClick={clearAllFilters} style={{
                  fontSize: 9, fontWeight: 700, color: '#FF4E4E',
                  background: 'rgba(255,78,78,0.1)', border: '1px solid rgba(255,78,78,0.3)',
                  borderRadius: 7, padding: '2px 7px', cursor: 'pointer', fontFamily: 'var(--font-display)',
                }}>
                  Clear ×
                </button>
              )}
            </div>

            <div style={{ marginTop: 7, fontSize: 20, color: 'var(--text-primary)', fontWeight: 800, fontFamily: 'var(--font-mono)', letterSpacing: '-0.03em', lineHeight: 1 }}>
              {loading ? (
                <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'var(--font-display)', fontWeight: 500 }}>
                  <div className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
                  <span style={{ color: 'var(--text-muted)' }}>Querying…</span>
                </span>
              ) : (
                <span>
                  <span style={{ color: 'var(--accent-teal)' }}>{total.toLocaleString()}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 500, marginLeft: 6 }}>
                    facilities{hasActiveFilters && ' (filtered)'}
                  </span>
                </span>
              )}
            </div>

            {/* Active filter chips */}
            {hasActiveFilters && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7 }}>
                {regionFilter    && <FilterChip label={regionFilter}    onRemove={() => setRegionFilter('')} />}
                {typeFilter      && <FilterChip label={typeFilter}      onRemove={() => setTypeFilter('')} />}
                {specialtyFilter && <FilterChip label={specialtyFilter} onRemove={() => setSpecialtyFilter('')} />}
                {desertOnly      && <FilterChip label="Deserts only"    onRemove={() => setDesertOnly(false)} />}
              </div>
            )}
          </div>

          {/* Search */}
          <div style={{ padding: '10px 10px 0', position: 'relative' }}>
            <span style={{ position: 'absolute', left: 19, top: '50%', marginTop: 5, fontSize: 12, opacity: 0.4, pointerEvents: 'none' }}>🔍</span>
            <input
              type="text" placeholder="Search facility, city, region…" value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                width: '100%', padding: '8px 28px 8px 28px',
                borderRadius: 10, fontSize: 11,
                border: `1px solid ${searchTerm ? 'rgba(0,212,177,0.45)' : 'var(--bg-border)'}`,
                background: searchTerm ? 'rgba(0,212,177,0.05)' : 'var(--bg-input)',
                color: 'var(--text-primary)', outline: 'none',
                transition: 'all 200ms ease',
                boxShadow: searchTerm ? '0 0 0 2px rgba(0,212,177,0.12)' : 'none',
                fontFamily: 'var(--font-display)',
              }}
            />
            {searchTerm && (
              <span onClick={clearSearch} style={{
                position: 'absolute', right: 19, top: '50%',
                transform: 'translateY(calc(-50% + 5px))',
                fontSize: 11, cursor: 'pointer', opacity: 0.5,
              }}>✕</span>
            )}
          </div>

          {/* Filters */}
          <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Region */}
            <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={{
              width: '100%', padding: '7px 10px', borderRadius: 9, fontSize: 11,
              border: `1px solid ${regionFilter ? 'rgba(139,124,247,0.45)' : 'var(--bg-border)'}`,
              background: regionFilter ? 'rgba(139,124,247,0.08)' : 'var(--bg-input)',
              color: 'var(--text-primary)', cursor: 'pointer', outline: 'none',
              transition: 'all 150ms ease', fontFamily: 'var(--font-display)',
              boxShadow: regionFilter ? '0 0 0 1px rgba(139,124,247,0.15)' : 'none',
            }}>
              <option value="">All Regions</option>
              {regionOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            {/* Type */}
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{
              width: '100%', padding: '7px 10px', borderRadius: 9, fontSize: 11,
              border: `1px solid ${typeFilter ? 'rgba(0,212,177,0.45)' : 'var(--bg-border)'}`,
              background: typeFilter ? 'rgba(0,212,177,0.08)' : 'var(--bg-input)',
              color: 'var(--text-primary)', cursor: 'pointer', outline: 'none',
              transition: 'all 150ms ease', fontFamily: 'var(--font-display)',
              boxShadow: typeFilter ? '0 0 0 1px rgba(0,212,177,0.15)' : 'none',
            }}>
              <option value="">All Types</option>
              {FILTER_CONFIGS[1].staticOptions!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            {/* Specialty */}
            <select value={specialtyFilter} onChange={e => setSpecialtyFilter(e.target.value)} style={{
              width: '100%', padding: '7px 10px', borderRadius: 9, fontSize: 11,
              border: `1px solid ${specialtyFilter ? 'rgba(255,182,0,0.45)' : 'var(--bg-border)'}`,
              background: specialtyFilter ? 'rgba(255,182,0,0.08)' : 'var(--bg-input)',
              color: 'var(--text-primary)', cursor: 'pointer', outline: 'none',
              transition: 'all 150ms ease', fontFamily: 'var(--font-display)',
              boxShadow: specialtyFilter ? '0 0 0 1px rgba(255,182,0,0.15)' : 'none',
            }}>
              <option value="">All Specialties</option>
              {FILTER_CONFIGS[2].staticOptions!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <div style={{ display: 'flex', gap: 5 }}>
              <ToggleButton active={desertOnly}     label="Deserts" icon="🌵" color="#FF7423" onClick={toggleDesertOnly} />
              <ToggleButton active={showDesertHeat} label="Heatmap" icon="🔥" color="#FF4E4E" onClick={toggleDesertHeat} />
            </div>
          </div>

          {/* Map style */}
          <div style={{ padding: '0 10px 12px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Map Style</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {TILE_STYLES.map(ts => (
                <button key={ts.id} onClick={() => setTileStyle(ts.id)} style={{
                  padding: '6px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'var(--font-display)',
                  border: `1px solid ${tileStyle === ts.id ? 'rgba(0,212,177,0.45)' : 'var(--bg-border)'}`,
                  background: tileStyle === ts.id ? 'rgba(0,212,177,0.1)' : 'var(--bg-input)',
                  color: tileStyle === ts.id ? 'var(--accent-teal)' : 'var(--text-muted)',
                  transition: 'all 150ms ease',
                  display: 'flex', alignItems: 'center', gap: 5,
                  boxShadow: tileStyle === ts.id ? '0 0 10px rgba(0,212,177,0.15)' : 'none',
                }}>
                  {ts.icon} {ts.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Stats card */}
        <div style={{
          borderRadius: 18, overflow: 'hidden', background: 'var(--bg-card)',
          border: '1px solid var(--bg-border)', backdropFilter: 'blur(16px)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
        }}>
          <button onClick={toggleStats} style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '11px 13px', background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: statsOpen ? '1px solid var(--bg-border)' : 'none',
          }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>📊</span> Statistics
            </span>
            <span style={{ fontSize: 9, transition: 'transform 200ms ease', transform: statsOpen ? 'rotate(180deg)' : 'none', color: 'var(--text-muted)' }}>▼</span>
          </button>

          {statsOpen && (
            <div style={{ padding: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {statCards.map((s, i) => <AnimatedStatCard key={s.label} {...s} index={i} />)}
            </div>
          )}
        </div>
      </SidebarPanel>

      {/* ── Legend (top-right) ── */}
      <div style={{
        position: 'absolute', top: 16, right: 16, zIndex: 1000,
        background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
        borderRadius: 16, padding: '12px 14px',
        backdropFilter: 'blur(16px)', boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
        animation: 'fadeInUp 400ms 200ms both',
        minWidth: 148,
      }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 9 }}>
          Desert Index
        </div>
        {LEGEND_ITEMS.map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ position: 'relative', width: 28, height: 7, borderRadius: 999, background: `${l.color}20`, overflow: 'hidden', flexShrink: 0 }}>
              <div style={{ position: 'absolute', inset: 0, width: `${l.score * 100}%`, background: l.color, borderRadius: 999, boxShadow: `0 0 6px ${l.color}60` }} />
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 500 }}>{l.label}</span>
          </div>
        ))}

        <div style={{ borderTop: '1px solid var(--bg-border)', marginTop: 10, paddingTop: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
            Facility Type
          </div>
          {LEGEND_FACILITY_TYPES.map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 21, height: 21, borderRadius: '50%', background: `${l.color}15`, border: `1px solid ${l.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>
                {l.emoji}
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 500 }}>{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Map ── */}
      <MapContainer center={[7.9465, -1.0232]} zoom={7} style={{ height: '100%', width: '100%' }} zoomControl={false}>
        <ZoomControl position="bottomright" />
        <TileLayer key={tileStyle} url={TILE_LAYERS[tileStyle]} attribution="&copy; OpenStreetMap contributors &copy; CARTO" maxZoom={19} />

        {/* Desert heatmap circles */}
        {showDesertHeat && desertRegions.map(dr => (
          <DesertCircle key={dr.region} dr={dr} />
        ))}

        {/* Facility markers */}
        {features.map((f, i) => {
          const markerId = f.properties.unique_id || String(i)
          return (
            <FacilityMarker
              key={markerId}
              f={f}
              index={i}
              isActive={activePopupId === markerId}
              detail={f.properties.unique_id ? detailCache[f.properties.unique_id] : undefined}
              loadingDetail={f.properties.unique_id ? detailLoading[f.properties.unique_id] ?? false : false}
              onMarkerClick={handleMarkerClick}
              onPopupClose={handlePopupClose}
            />
          )
        })}

        <RegionZoomer features={features} />
      </MapContainer>

      {/* ── Loading overlay ── */}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 500,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(6,9,26,0.65)', backdropFilter: 'blur(6px)',
          animation: 'fadeIn 150ms both', pointerEvents: 'none',
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--bg-border-accent)',
            borderRadius: 18, padding: '18px 28px',
            display: 'flex', alignItems: 'center', gap: 12,
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div className="spinner" />
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 700, marginBottom: 2 }}>Loading facilities</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Fetching Ghana healthcare data…</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Map CSS ── */}
      <style>{`
        @keyframes markerPulse {
          0%   { transform: scale(1);   opacity: 0.6; }
          70%  { transform: scale(1.8); opacity: 0;   }
          100% { transform: scale(1.8); opacity: 0;   }
        }
        @keyframes pulseOpacity {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
        @keyframes chipIn {
          from { opacity: 0; transform: scale(0.82) translateY(4px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        @keyframes fadeIn    { from { opacity: 0; }  to { opacity: 1; } }
        @keyframes fadeInUp  { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shimmer {
          0%   { opacity: 0.4; }
          50%  { opacity: 0.9; }
          100% { opacity: 0.4; }
        }

        .stat-cell {
          padding: 8px 4px;
          text-align: center;
          border-radius: 9px;
          background: color-mix(in srgb, var(--cell-color) 7%, transparent);
          border: 1px solid color-mix(in srgb, var(--cell-color) 20%, transparent);
          transition: transform 150ms ease, box-shadow 150ms ease;
        }
        .stat-cell:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px color-mix(in srgb, var(--cell-color) 22%, transparent);
        }

        .leaflet-popup-content-wrapper {
          padding: 0 !important;
          border-radius: 16px !important;
          overflow: hidden !important;
          background: var(--bg-card) !important;
          border: 1px solid var(--bg-border-accent) !important;
          box-shadow: 0 24px 64px rgba(0,0,0,0.5) !important;
        }
        .leaflet-popup-content {
          margin: 0 !important;
          width: auto !important;
          min-width: 300px !important;
          max-width: 360px !important;
          overflow: hidden !important;
        }
        .leaflet-popup-tip-container { display: none !important; }
        .leaflet-popup-close-button {
          color: var(--text-muted) !important;
          font-size: 17px !important;
          padding: 8px 10px !important;
          z-index: 10 !important;
          background: transparent !important;
          top: 0 !important; right: 0 !important;
          transition: color 150ms ease !important;
        }
        .leaflet-popup-close-button:hover { color: var(--text-primary) !important; }

        .facility-label {
          background: var(--bg-card) !important;
          border: 1px solid var(--bg-border-accent) !important;
          border-radius: 8px !important;
          color: var(--text-primary) !important;
          font-size: 10.5px !important;
          font-weight: 600 !important;
          padding: 4px 9px !important;
          white-space: nowrap !important;
          box-shadow: 0 4px 14px rgba(0,0,0,0.3) !important;
          font-family: var(--font-display) !important;
        }
        .leaflet-control-zoom {
          border: none !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important;
          border-radius: 12px !important; overflow: hidden;
        }
        .leaflet-control-zoom-in, .leaflet-control-zoom-out {
          background: var(--bg-card) !important;
          border: 1px solid var(--bg-border) !important;
          color: var(--text-primary) !important;
          width: 36px !important; height: 36px !important;
          line-height: 34px !important; font-size: 17px !important;
          transition: all 150ms ease !important;
        }
        .leaflet-control-zoom-in:hover, .leaflet-control-zoom-out:hover {
          background: var(--bg-surface) !important;
          color: var(--accent-teal) !important;
        }
        .leaflet-popup-content div::-webkit-scrollbar { width: 3px; }
        .leaflet-popup-content div::-webkit-scrollbar-track { background: transparent; }
        .leaflet-popup-content div::-webkit-scrollbar-thumb { background: var(--bg-border-accent); border-radius: 2px; }
      `}</style>
    </div>
  )
}