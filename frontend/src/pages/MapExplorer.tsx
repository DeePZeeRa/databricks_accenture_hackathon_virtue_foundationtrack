// src/pages/MapExplorer.tsx — Advanced animated map explorer
import { useEffect, useState, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Tooltip, ZoomControl, useMap } from 'react-leaflet'

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getFacilitiesMap, getRegions, getFacilityDetail, type FacilityDetail } from '../api/client'
import { useTheme } from '../App'

// ── Types ───────────────────────────────────────────────────────────────────
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

  }
}

interface DesertRegion {
  region: string; lat: number; lon: number
  medical_desert_score: number; mds_label: string
  total_facilities: number; total_doctors: number; total_beds: number
}
const getFacilityEmoji = (props: FacilityFeature['properties']) => {
  if (props.is_hospital) return '🏥'
  if (props.is_clinic) return '🩺'
  if (props.is_ngo) return '🤝'
  return '📍'
}

// ── Color helpers ────────────────────────────────────────────────────────────
const DESERT_COLOR = (score?: number) => {
  if (score === null || score === undefined) return '#94a3b8'
  if (score >= 0.75) return '#FF4E4E'
  if (score >= 0.55) return '#FF7423'
  if (score >= 0.40) return '#FFB600'
  if (score >= 0.25) return '#4ADE80'
  return '#00D4B1'
}

const FACILITY_COLOR = (props: FacilityFeature['properties']) => DESERT_COLOR(props.medical_desert_score)

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
  if (type === 'bool') return value ? 'Yes' : 'No'
  if (type === 'float') return typeof value === 'number' ? value.toFixed(3) : String(value)
  if (type === 'number') return typeof value === 'number' ? value.toLocaleString() : String(value)
  return String(value)
}

// ── Tile layer URLs ──────────────────────────────────────────────────────────
const TILE_LAYERS = {
  dark:    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light:   'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  terrain: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  satellite:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
}

type TileStyle = keyof typeof TILE_LAYERS

// ── Capability chips config ──────────────────────────────────────────────────
const CAPABILITY_BADGES = [
  { key: 'has_emergency_medicine', label: 'Emergency',       icon: '🚨', color: '#FF4E4E' },
  { key: 'has_surgery',            label: 'Surgery',         icon: '🔪', color: '#38BDF8' },
  { key: 'has_icu',                label: 'ICU',             icon: '🫀', color: '#8B7CF7' },
  { key: 'has_obstetrics',         label: 'Obstetrics',      icon: '👶', color: '#F472B6' },
  { key: 'has_pediatrics',         label: 'Pediatrics',      icon: '🧒', color: '#00D4B1' },
  { key: 'has_radiology',          label: 'Radiology',       icon: '🩻', color: '#38BDF8' },
  { key: 'has_infectious_disease', label: 'Infectious',      icon: '🦠', color: '#FFB600' },
  { key: 'has_mental_health',      label: 'Mental Health',   icon: '🧠', color: '#A78BFA' },
  { key: 'accepts_volunteers_bool',label: 'Volunteers ✓',   icon: '🤝', color: '#4ADE80' },
]

// ── Region zoomer ─────────────────────────────────────────────────────────────
function RegionZoomer({ features }: { features: FacilityFeature[] }) {
  const map = useMap()
  useEffect(() => {
    if (!features.length) return
    const lats = features.map(f => f.geometry.coordinates[1]).filter(Boolean)
    const lngs = features.map(f => f.geometry.coordinates[0]).filter(Boolean)
    if (!lats.length) return
    map.fitBounds(
      [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
      { padding: [40, 40] }
    )
  }, [features, map])
  return null
}

// ── Facility Popup ─────────────────────────────────────────────────────────────
function FacilityPopup({ f, detail, loadingDetail }: {
  f: FacilityFeature
  detail?: FacilityDetail
  loadingDetail: boolean
}) {
  const props = f.properties
  const desertLabel = props.mds_label || props.desert_label
  const desertColor = DESERT_LABEL_COLOR(desertLabel, props.medical_desert_score)
  const specialties = Array.isArray(props.specialties_enriched) && props.specialties_enriched.length
    ? props.specialties_enriched.join(', ')
    : props.specialties
  const detailSpecialties = Array.isArray(detail?.specialties_enriched) && detail.specialties_enriched?.length
    ? detail.specialties_enriched.join(', ')
    : specialties
  const capabilities = detail?.capability_enriched?.slice(0, 5) || []
  const procedures = detail?.procedure_enriched?.slice(0, 4) || []

  const activeBadges = CAPABILITY_BADGES.filter(b => (props as any)[b.key])
  const website = detail?.official_website?.trim()

  const normalizedUrl =
    website && /^https?:\/\//i.test(website)
      ? website
      : `https://${website}`
  const phonesRaw =
  detail?.phone_numbers?.length
    ? detail.phone_numbers
    : detail?.official_phone

  const normalizedPhones = (Array.isArray(phonesRaw) ? phonesRaw : [phonesRaw])
    .map(p => p?.toString().trim())
    .filter(Boolean)
  const citations =detail?.idp_citations?.length ? detail.idp_citations: f.properties?.idp_citations || []
  const addressParts = [
    detail?.address_line1,
    detail?.address_line2,
    detail?.address_line3,
    detail?.address_city,
    detail?.address_state_or_region,
    detail?.address_zip_or_postcode,
  ]
    .map(v => v?.toString().trim())
    .filter(v => v && v.toLowerCase() !== 'null') // 🔥 fix
    .filter((v, i, arr) => arr.indexOf(v) === i) // remove duplicates
    .join(', ')

  
const STATS = [
  { icon: '👨‍⚕️', label: 'Doctors', value: formatStat(props.number_doctors_int, 'number'), color: '#38BDF8' },
  { icon: '🛏️', label: 'Beds', value: formatStat(props.capacity_int, 'number'), color: '#8B5CF6' },
  { icon: '📊', label: 'MDS', value: formatStat(props.medical_desert_score, 'float'), color: '#F59E0B' },

  { icon: '🫀', label: 'ICU', value: formatStat(props.has_icu, 'bool'), color: '#EF4444' },
  { icon: '🔪', label: 'Surgery', value: formatStat(props.has_surgery, 'bool'), color: '#3B82F6' },
  { icon: '🦠', label: 'Infectious', value: formatStat(props.has_infectious_disease, 'bool'), color: '#F97316' },

  { icon: '🚨', label: 'Emergency', value: formatStat(props.has_emergency_medicine, 'bool'), color: '#DC2626' },
  { icon: '🤝', label: 'Volunteers', value: formatStat(props.accepts_volunteers_bool, 'bool'), color: '#10B981' },
  { icon: '⚠️', label: 'Anomalies', value: formatStat(props.total_stat_anomalies, 'number'), color: '#F43F5E' },
]
  

  return (
    <div style={{
      fontFamily: '"Space Grotesk", "DM Sans", system-ui, sans-serif',
      minWidth: 300, maxWidth: 360,
      background: 'var(--bg-card)', color: 'var(--text-primary)',
      borderRadius: 16, overflow: 'hidden',
    }}>
      {/* Header gradient strip */}
      <div style={{
        padding: '14px 16px 12px',
        background: `linear-gradient(135deg, ${desertColor}18, ${desertColor}08)`,
        borderBottom: `3px solid ${desertColor}40`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 3 }}>
              {props.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {props.facility_type_clean} · {props.city_clean || props.region_normalised}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
            {props.facility_type_clean && (
              <span style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 999, fontWeight: 700,
                background: 'var(--bg-surface)', color: 'var(--text-secondary)',
                border: '1px solid var(--bg-border)', whiteSpace: 'nowrap',
              }}>{props.facility_type_clean}</span>
            )}
            {desertLabel && (
              <span style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 999, fontWeight: 700,
                background: `${desertColor}20`, color: desertColor,
                border: `1px solid ${desertColor}40`, whiteSpace: 'nowrap',
              }}>{desertLabel}</span>
            )}
          </div>
        </div>
      </div>

      {/* Key stats row */}
      {/* <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0, borderBottom: '1px solid var(--bg-border)' }}>
        {[
          { icon: '👨‍⚕️', label: 'Doctors', value: formatStat(props.number_doctors_int, 'number'), color: '#38BDF8' },
          { icon: '🛏️', label: 'Beds', value: formatStat(props.capacity_int, 'number'), color: '#8B5CF6' },
          { icon: '📊', label: 'MDS', value: formatStat(props.medical_desert_score, 'float'), color: '#F59E0B' },
        
          { icon: '🫀', label: 'ICU', value: formatStat(props.has_icu, 'bool'), color: '#EF4444' },
          { icon: '🔪', label: 'Surgery', value: formatStat(props.has_surgery, 'bool'), color: '#3B82F6' },
          { icon: '🦠', label: 'Infectious', value: formatStat(props.has_infectious_disease, 'bool'), color: '#F97316' },
        
          { icon: '🚨', label: 'Emergency', value: formatStat(props.has_emergency_medicine, 'bool'), color: '#DC2626' },
          { icon: '🤝', label: 'Volunteers', value: formatStat(props.accepts_volunteers_bool, 'bool'), color: '#10B981' },
          { icon: '⚠️', label: 'Anomalies', value: formatStat(props.total_stat_anomalies, 'number'), color: '#F43F5E' },

        ].map((stat, i) => (
          <div key={i} style={{
            padding: '10px 8px', textAlign: 'center',
            borderRight: i < 2 ? '1px solid var(--bg-border)' : 'none',
            background: 'var(--bg-surface)',
          }}>
            <div style={{ fontSize: 14 }}>{stat.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>{stat.value}</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 1 }}>{stat.label}</div>
          </div>
        ))}
      </div> */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
          padding: '6px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--bg-border)',
        }}
      >
        {STATS.map((stat, i) => (
          <div
            key={i}
            style={{
              padding: '10px 6px',
              textAlign: 'center',
              borderRadius: 10,
              background: `${stat.color}12`,
              border: `1px solid ${stat.color}30`,
              transition: 'all 150ms ease',
              cursor: 'default',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = `0 4px 12px ${stat.color}30`
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <div style={{ fontSize: 16 }}>{stat.icon}</div>

            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: stat.color,
                marginTop: 3,
                fontFamily: 'var(--font-display)',
              }}
            >
              {stat.value}
            </div>

            <div
              style={{
                fontSize: 9,
                color: 'var(--text-stats)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginTop: 2,
              }}
            >
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Capability badges */}
        {activeBadges.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {activeBadges.map(b => (
              <span key={b.key} style={{
                fontSize: 10, padding: '3px 8px', borderRadius: 999, fontWeight: 600,
                background: `${b.color}18`, color: b.color,
                border: `1px solid ${b.color}30`,
                display: 'flex', alignItems: 'center', gap: 3,
              }}>
                <span style={{ fontSize: 10 }}>{b.icon}</span>
                {b.label}
              </span>
            ))}
          </div>
        )}
        {/* Year Established */}
        {detail?.year_established &&
          detail.year_established.toString().trim().toLowerCase() !== 'null' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              color: 'var(--text-secondary)',
            }}>
              🏗️ Established:
              <span style={{
                fontWeight: 700,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-display)',
              }}>
                {detail.year_established}
              </span>
            </div>
          )}
        {/* Address */}
        {addressParts && (
          <div>
            <div style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 4,
              fontWeight: 700,
            }}>
              📍 Address
            </div>

            <div style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              background: 'var(--bg-surface)',
              border: '1px solid var(--bg-border)',
              borderRadius: 8,
              padding: '6px 8px',
            }}>
              {addressParts}
            </div>
          </div>
        )}
                {/* Citations */}
        {/* Citations */}
        <div>
          <div style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 6,
            fontWeight: 700,
          }}>
            🧾 Citations
          </div>

          {citations.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {citations
                .filter(c => c && c.trim() !== '')
                .slice(0, 3)
                .map((c, idx) => (
                  <div key={idx} style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    background: 'rgba(139,124,247,0.08)',
                    border: '1px solid rgba(139,124,247,0.2)',
                    borderLeft: '3px solid #8B7CF7',
                    borderRadius: 8,
                    padding: '6px 8px',
                  }}>
                    {c}
                  </div>
                ))}
            </div>
          ) : (
            <div style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              fontStyle: 'italic'
            }}>
              No citations available
            </div>
          )}
        </div>

        {/* Specialties */}
        {detailSpecialties && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, fontWeight: 700 }}>Specialties</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{detailSpecialties}</div>
          </div>
        )}

        {/* Capabilities / Procedures */}
        {capabilities.length > 0 && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, fontWeight: 700 }}>Capabilities</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{capabilities.join(' · ')}</div>
          </div>
        )}

        {/* Anomaly alert */}
        {(props.total_stat_anomalies ?? 0) > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', borderRadius: 8,
            background: '#FF4E4E12', border: '1px solid #FF4E4E30',
          }}>
            <span>⚠️</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#FF4E4E' }}>
                {props.total_stat_anomalies} Anomaly Flags
              </div>
              {detail?.anomaly_risk_level && (
                <div style={{ fontSize: 10, color: '#FF7423' }}>Risk: {detail.anomaly_risk_level}</div>
              )}
            </div>
          </div>
        )}

        {/* Priority action */}
        {detail?.llm_priority_action && (
          <div style={{
            padding: '8px 10px', borderRadius: 8, fontSize: 11, lineHeight: 1.5,
            background: 'rgba(139,124,247,0.08)', border: '1px solid rgba(139,124,247,0.2)',
            color: 'var(--text-secondary)',
            borderLeft: '3px solid #8B7CF7',
          }}>
            <span style={{ color: '#8B7CF7', fontWeight: 700 }}>Action: </span>
            {detail.llm_priority_action}
          </div>
        )}

        {/* Contact */}
        {(detail?.email || detail?.official_website || normalizedPhones.length > 0) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>

            {/* Email */}
            {detail?.email && (
              <a
                href={`mailto:${detail.email}`}
                onClick={(e) => e.stopPropagation()}
                style={{
                  fontSize: 10,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'var(--bg-surface)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--bg-border)',
                  textDecoration: 'none',
                }}
              >
                ✉ {detail.email}
              </a>
            )}

            {/* Website */}
            {detail?.official_website && (
              <a
                href={normalizedUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  window.open(normalizedUrl, '_blank', 'noopener,noreferrer')
                }}
                style={{
                  fontSize: 10,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'var(--bg-surface)',
                  color: 'var(--accent-teal)',
                  border: '1px solid rgba(0,212,177,0.25)',
                  textDecoration: 'none',
                }}
              >
                🌐 {detail.official_website}
              </a>
            )}

            {/* Phones */}
            {normalizedPhones.map((phone, idx) => {
              const clean = phone.replace(/\s+/g, '')

              return (
                <a
                  key={idx}
                  href={`tel:${clean}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    fontSize: 10,
                    padding: '3px 8px',
                    borderRadius: 6,
                    background: 'var(--bg-surface)',
                    color: '#38BDF8',
                    border: '1px solid rgba(56,189,248,0.25)',
                    textDecoration: 'none',
                  }}
                >
                  📞 {phone}
                </a>
              )
            })}

          </div>
        )}

        {/* Data completeness */}
        {(props.data_completeness_score ?? 0) > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 80, flexShrink: 0 }}>Data Quality</span>
            <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'var(--bg-border)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${(props.data_completeness_score || 0) * 100}%`,
                background: '#00D4B1', borderRadius: 999,
              }} />
            </div>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
              {(props.data_completeness_score || 0).toFixed(2)}
            </span>
          </div>
        )}

        {loadingDetail && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
            Loading details…
          </div>
        )}
      </div>
    </div>
  )
}

// ── Toggle Chip ────────────────────────────────────────────────────────────────
function ToggleButton({ active, label, icon, color, onClick }: {
  active: boolean; label: string; icon: string; color: string; onClick: () => void
}) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600,
      border: `1px solid ${active ? color + '50' : 'var(--bg-border)'}`,
      background: active ? `${color}18` : 'var(--bg-input)',
      color: active ? color : 'var(--text-muted)',
      transition: 'all 150ms ease',
      fontFamily: 'var(--font-display)',
    }}>
      <span style={{ fontSize: 12 }}>{icon}</span>
      {label}
    </button>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function MapExplorer() {
  const { theme } = useTheme()
  const [features, setFeatures] = useState<FacilityFeature[]>([])
  const [desertRegions, setDesertRegions] = useState<DesertRegion[]>([])
  const [regions, setRegions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [regionFilter, setRegionFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [desertOnly, setDesertOnly] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [showDesertHeat, setShowDesertHeat] = useState(true)
  const [tileStyle, setTileStyle] = useState<TileStyle>('dark')
  const [total, setTotal] = useState(0)
  const [activePopupId, setActivePopupId] = useState<string | null>(null)
  const [detailCache, setDetailCache] = useState<Record<string, FacilityDetail>>({})
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({})
  const [statsOpen, setStatsOpen] = useState(true)

  // Sync tile with theme
  useEffect(() => {
    setTileStyle(theme === 'dark' ? 'dark' : 'light')
  }, [theme])

  const loadData = useCallback(async (region = '', type = '', desert = false) => {
    setLoading(true)
    try {
      const { data: geo } = await getFacilitiesMap({ region: region || undefined, facility_type: type || undefined })
      const allFeatures = (geo.features || []) as unknown as FacilityFeature[]
      let filtered = desert
        ? allFeatures.filter(f =>
            ['Critical Desert', 'Severe Desert'].includes(f.properties.desert_label || '')
          )
        : allFeatures

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase()

      filtered = filtered.filter(f =>
        f.properties.name?.toLowerCase().includes(q) ||
        f.properties.city_clean?.toLowerCase().includes(q) ||
        f.properties.region_normalised?.toLowerCase().includes(q) ||
        f.properties.facility_type_clean?.toLowerCase().includes(q)
      )
      if (searchTerm && filtered.length === 1) {
        setActivePopupId(filtered[0].properties.unique_id || null)
      }
    }
      setFeatures(filtered)
      setTotal(filtered.length)
      setDesertRegions([])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [searchTerm])

  

  useEffect(() => { getRegions().then(setRegions) }, [])
  useEffect(() => {
    const t = setTimeout(() => loadData(regionFilter, typeFilter, desertOnly), 0)
    return () => clearTimeout(t)
  }, [regionFilter, typeFilter, desertOnly, loadData])

  const ensureDetail = async (uniqueId?: string) => {
    if (!uniqueId || detailCache[uniqueId] || detailLoading[uniqueId]) return
    setDetailLoading(prev => ({ ...prev, [uniqueId]: true }))
    try {
      const detail = await getFacilityDetail(uniqueId)
      setDetailCache(prev => ({ ...prev, [uniqueId]: detail }))
    } catch (e) { console.error(e) }
    finally { setDetailLoading(prev => ({ ...prev, [uniqueId]: false })) }
  }

  // Compute quick stats
  const hospitals  = features.filter(f => f.properties.is_hospital).length
  const ngos       = features.filter(f => f.properties.is_ngo).length
  const criticals  = features.filter(f => (f.properties.desert_label || '').toLowerCase().includes('critical')).length
  const volunteers = features.filter(f => f.properties.accepts_volunteers_bool).length

  const LEGEND_ITEMS = [
    { label: 'Critical Desert', color: '#FF4E4E' },
    { label: 'Severe Desert',   color: '#FF7423' },
    { label: 'Moderate',        color: '#FFB600' },
    { label: 'At Risk',         color: '#4ADE80' },
    { label: 'Adequate',        color: '#00D4B1' },
  ]

  const TILE_STYLES: { id: TileStyle; label: string; icon: string }[] = [
    { id: 'dark',      label: 'Dark',      icon: '🌑' },
    { id: 'light',     label: 'Light',     icon: '☀️' },
    { id: 'terrain',   label: 'Terrain',   icon: '🏔️' },
    { id: 'satellite', label: 'Satellite', icon: '🛰️' },
  ]

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 70px)', overflow: 'hidden', background: 'var(--bg-base)' }}>
      {/* ── Controls sidebar ───────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 16, left: 16, zIndex: 1000,
        width: 230,
        display: 'flex', flexDirection: 'column', gap: 10,
        animation: 'fadeInLeft 300ms cubic-bezier(0.34,1.56,0.64,1) both',
      }}>
        {/* Main controls card */}
        <div style={{
          borderRadius: 16, overflow: 'hidden',
          background: 'var(--bg-card)',
          border: '1px solid var(--bg-border)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 14px 10px',
            background: 'linear-gradient(135deg, rgba(139,124,247,0.12), rgba(0,212,177,0.06))',
            borderBottom: '1px solid var(--bg-border)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: 'var(--font-display)' }}>
              🗺️ Map Explorer
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                  Loading…
                </span>
              ) : (
                <span>
                  <span style={{ color: 'var(--accent-teal)', fontFamily: 'var(--font-display)', fontWeight: 800 }}>
                    {total.toLocaleString()}
                  </span> facilities
                </span>
              )}
            </div>
          </div>

          {/* Search */}
          <div style={{ position: 'relative' }}>
            {/* Icon */}
            <span style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 12,
              opacity: 0.6,
              pointerEvents: 'none',
            }}>
              🔍
            </span>

            <input
              type="text"
              placeholder="Search facility, city..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px 8px 28px',
                borderRadius: 10,
                fontSize: 11,
                border: '1px solid var(--bg-border)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                outline: 'none',
                transition: 'all 180ms ease',
                boxShadow: searchTerm
                  ? '0 0 0 1px rgba(0,212,177,0.4), 0 0 10px rgba(0,212,177,0.2)'
                  : 'none',
              }}
              onFocus={(e) => {
                e.currentTarget.style.border = '1px solid rgba(0,212,177,0.6)'
                e.currentTarget.style.boxShadow =
                  '0 0 0 1px rgba(0,212,177,0.4), 0 0 12px rgba(0,212,177,0.25)'
              }}
              onBlur={(e) => {
                e.currentTarget.style.border = '1px solid var(--bg-border)'
                e.currentTarget.style.boxShadow = searchTerm
                  ? '0 0 0 1px rgba(0,212,177,0.4)'
                  : 'none'
              }}
            />

            {/* Clear button */}
            {searchTerm && (
              <span
                onClick={() => setSearchTerm('')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 12,
                  cursor: 'pointer',
                  opacity: 0.6,
                  transition: 'opacity 120ms',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
              >
                ✖
              </span>
            )}
          </div>

          {/* Filters */}
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <select
              value={regionFilter}
              onChange={e => setRegionFilter(e.target.value)}
              style={{
                width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 11,
                border: `1px solid ${regionFilter ? 'rgba(139,124,247,0.5)' : 'var(--bg-border)'}`,
                background: regionFilter ? 'rgba(139,124,247,0.08)' : 'var(--bg-input)',
                color: 'var(--text-primary)', cursor: 'pointer', outline: 'none',
                transition: 'all 150ms ease',
              }}
            >
              <option value="">All Regions</option>
              {regions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>

            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              style={{
                width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 11,
                border: `1px solid ${typeFilter ? 'rgba(0,212,177,0.5)' : 'var(--bg-border)'}`,
                background: typeFilter ? 'rgba(0,212,177,0.08)' : 'var(--bg-input)',
                color: 'var(--text-primary)', cursor: 'pointer', outline: 'none',
                transition: 'all 150ms ease',
              }}
            >
              <option value="">All Types</option>
              <option value="Hospital">Hospitals</option>
              <option value="Clinic">Clinics</option>
              <option value="NGO">NGOs</option>
              <option value="Pharmacy">Pharmacies</option>
            </select>

            <div style={{ display: 'flex', gap: 5 }}>
              <ToggleButton active={desertOnly} label="Deserts" icon="🌵" color="#FF7423" onClick={() => setDesertOnly(v => !v)} />
              <ToggleButton active={showDesertHeat} label="Heatmap" icon="🔥" color="#FF4E4E" onClick={() => setShowDesertHeat(v => !v)} />
            </div>
          </div>

          {/* Tile style switcher */}
          <div style={{ padding: '0 12px 12px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>Map Style</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {TILE_STYLES.map(ts => (
                <button key={ts.id} onClick={() => setTileStyle(ts.id)} style={{
                  padding: '5px 8px', borderRadius: 7, fontSize: 10, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'var(--font-display)',
                  border: `1px solid ${tileStyle === ts.id ? 'rgba(0,212,177,0.5)' : 'var(--bg-border)'}`,
                  background: tileStyle === ts.id ? 'rgba(0,212,177,0.12)' : 'var(--bg-input)',
                  color: tileStyle === ts.id ? 'var(--accent-teal)' : 'var(--text-muted)',
                  transition: 'all 150ms ease',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <span>{ts.icon}</span>{ts.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Stats card */}
        <div style={{
          borderRadius: 14, overflow: 'hidden',
          background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}>
          <button
            onClick={() => setStatsOpen(v => !v)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 800, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-display)',
            }}
          >
            <span>📊 Stats</span>
            <span style={{ transition: 'transform 200ms ease', transform: statsOpen ? 'rotate(180deg)' : 'none', fontSize: 8 }}>▼</span>
          </button>

          {statsOpen && (
            <div style={{ padding: '0 12px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, animation: 'fadeIn 150ms both' }}>
              {[
                { label: 'Hospitals',   value: hospitals,  color: '#38BDF8', icon: '🏥' },
                { label: 'NGOs',        value: ngos,       color: '#A78BFA', icon: '🤝' },
                { label: 'Critical',    value: criticals,  color: '#FF4E4E', icon: '⚠️' },
                { label: 'Volunteers',  value: volunteers, color: '#4ADE80', icon: '👥' },
              ].map(s => (
                <div key={s.label} style={{
                  padding: '8px 8px', borderRadius: 8,
                  background: `${s.color}0e`, border: `1px solid ${s.color}25`,
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 14 }}>{s.icon}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: s.color, fontFamily: 'var(--font-display)', lineHeight: 1, marginTop: 4 }}>
                    {s.value.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', bottom: 24, left: 16, zIndex: 1000,
        background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
        borderRadius: 14, padding: '10px 12px',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        animation: 'fadeInUp 400ms 200ms both',
      }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'var(--font-display)' }}>
          Desert Index
        </div>
        {LEGEND_ITEMS.map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
              background: l.color, boxShadow: `0 0 6px ${l.color}60`,
            }} />
            <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', fontWeight: 500 }}>{l.label}</span>
          </div>
        ))}

        <div style={{ borderTop: '1px solid var(--bg-border)', marginTop: 8, paddingTop: 8 }}>
        <div style={{
            fontSize: 9,
            fontWeight: 800,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: 6,
            fontFamily: 'var(--font-display)'
          }}>
            Facility Type
          </div>

          {[
            { label: 'Hospital', emoji: '🏥', color: '#38BDF8' },
            { label: 'Clinic',   emoji: '🩺', color: '#8B7CF7' },
            { label: 'NGO',      emoji: '🤝', color: '#4ADE80' },
            { label: 'Other',    emoji: '📍', color: '#94A3B8' },
          ].map(l => (
            <div
              key={l.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
              }}
            >
              <div style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: `${l.color}20`,
                border: `1px solid ${l.color}40`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                boxShadow: `0 0 6px ${l.color}30`,
                flexShrink: 0,
              }}>
                {l.emoji}
              </div>

              <span style={{
                fontSize: 10.5,
                color: 'var(--text-secondary)',
                fontWeight: 500,
              }}>
                {l.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <MapContainer
        center={[7.9465, -1.0232]}
        zoom={7}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        <ZoomControl position="bottomright" />
        <TileLayer
          key={tileStyle}
          url={TILE_LAYERS[tileStyle]}
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          maxZoom={19}
        />

        {/* Desert heatmap circles */}
        {showDesertHeat && desertRegions.map(dr => (
          <CircleMarker
            key={dr.region}
            center={[dr.lat, dr.lon]}
            radius={Math.max(20, (dr.medical_desert_score || 0) * 65)}
            pathOptions={{
              color: DESERT_COLOR(dr.medical_desert_score),
              fillColor: DESERT_COLOR(dr.medical_desert_score),
              fillOpacity: 0.15, weight: 1, opacity: 0.45,
            }}
          >
            <Popup className="facility-popup">
              <div style={{ fontFamily: 'system-ui, sans-serif', minWidth: 200 }}>
                <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4, color: 'var(--text-primary)' }}>{dr.region}</div>
                <div style={{ color: DESERT_COLOR(dr.medical_desert_score), fontSize: 11, fontWeight: 600, marginBottom: 8 }}>{dr.mds_label}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    ['MDS Score', dr.medical_desert_score?.toFixed(3)],
                    ['Facilities', dr.total_facilities],
                    ['Doctors', dr.total_doctors],
                    ['Beds', dr.total_beds],
                  ].map(([k, v]) => (
                    <div key={k as string}>
                      <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* Facility markers */}
        {features.map((f, i) => {
          const [lon, lat] = f.geometry?.coordinates || [0, 0]
          if (!lat || !lon) return null
          const markerId = f.properties.unique_id || String(i)
          const detail = f.properties.unique_id ? detailCache[f.properties.unique_id] : undefined
          const loadingDetail = f.properties.unique_id ? (detailLoading[f.properties.unique_id] ?? false) : false
          const markerColor = FACILITY_COLOR(f.properties)
          const shortName = f.properties.name.length > 26 ? `${f.properties.name.slice(0, 26)}…` : f.properties.name
          const radius = f.properties.is_hospital ? 8 : f.properties.is_ngo ? 5 : f.properties.is_clinic ? 6 : 4

          const emoji = getFacilityEmoji(f.properties)

          const icon = L.divIcon({
            className: '',
            html: `
              <div style="
                width: 26px;
                height: 26px;
                
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: ${activePopupId === markerId ? 18 : 14}px;
                color: white;
                box-shadow: 0 0 8px ${markerColor};
                transform: translate(-50%, -50%);
              ">
                ${emoji}
              </div>
            `,
          })


          return (
            <Marker
              key={markerId}
              position={[lat, lon]}
              icon={icon}
              eventHandlers={{
                click: (e) => {
                  if (activePopupId === markerId) {
                    e.target.closePopup()
                    setActivePopupId(null)
                    return
                  }
                  e.target.openPopup()
                  setActivePopupId(markerId)
                  ensureDetail(f.properties.unique_id)
                },
                popupclose: () => setActivePopupId(null),
              }}
            >
              <Tooltip
                className="facility-label"
                direction="right"
                offset={[10, 0]}
                opacity={0.9}
              >
                {shortName}
              </Tooltip>

              <Popup
                className="facility-popup"
                closeOnClick={false}
                closeButton
                maxWidth={380}
              >
                <FacilityPopup f={f} detail={detail} loadingDetail={loadingDetail} />
              </Popup>
            </Marker>
          )
        })}

        <RegionZoomer features={features} />
      </MapContainer>

      {/* Map CSS overrides */}
      <style>{`
        .leaflet-popup-content-wrapper {
          padding: 0 !important;
          border-radius: 16px !important;
          overflow: hidden !important;
          background: var(--bg-card) !important;
          border: 1px solid var(--bg-border) !important;
          box-shadow: 0 16px 48px rgba(0,0,0,0.35) !important;
        }
        .leaflet-popup-content {
          margin: 0 !important;
          width: auto !important;
          min-width: 300px !important;
        }
        .leaflet-popup-tip {
          background: var(--bg-card) !important;
        }
        .leaflet-popup-close-button {
          color: var(--text-muted) !important;
          font-size: 18px !important;
          padding: 8px 10px !important;
          z-index: 10 !important;
        }
        .leaflet-popup-close-button:hover {
          color: var(--text-primary) !important;
        }
        .facility-label {
          background: var(--bg-card) !important;
          border: 1px solid var(--bg-border) !important;
          border-radius: 6px !important;
          color: var(--text-primary) !important;
          font-size: 10px !important;
          font-weight: 600 !important;
          padding: 2px 6px !important;
          white-space: nowrap !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
        }
        .leaflet-control-zoom {
          border: none !important;
        }
        .leaflet-control-zoom-in,
        .leaflet-control-zoom-out {
          background: var(--bg-card) !important;
          border: 1px solid var(--bg-border) !important;
          color: var(--text-primary) !important;
          width: 32px !important;
          height: 32px !important;
          line-height: 30px !important;
          font-size: 16px !important;
        }
        .leaflet-control-zoom-in:hover,
        .leaflet-control-zoom-out:hover {
          background: var(--bg-surface) !important;
        }
        @keyframes fadeInLeft {
          from { opacity: 0; transform: translateX(-16px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}