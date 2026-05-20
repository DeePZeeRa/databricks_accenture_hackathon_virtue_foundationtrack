// src/pages/MapExplorer.tsx — Advanced animated map explorer v3
import { useEffect, useState, useCallback, useRef } from 'react'
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

const DESERT_COLOR = (score?: number) => {
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

const formatStat = (
  value: unknown,
  type: 'number' | 'float' | 'bool' | 'text' = 'text',
) => {
  if (value === null || value === undefined || value === '') return '—'
  if (type === 'bool')   return value ? 'Yes' : 'No'
  if (type === 'float')  return typeof value === 'number' ? value.toFixed(3) : String(value)
  if (type === 'number') return typeof value === 'number' ? value.toLocaleString() : String(value)
  return String(value)
}

const formatLabel = (s: string): string => {
  if (!s) return s
  const cleaned = s.replace(/^(has_|is_|stat_anomaly_|enhanced_)/, '')
  const words = cleaned
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
  const small = new Set(['a','an','the','and','or','of','for','in','to','at','by','on'])
  return words.map((w, i) =>
    i === 0 || !small.has(w.toLowerCase())
      ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      : w.toLowerCase()
  ).join(' ')
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
  { key: 'has_emergency_medicine', label: 'Emergency',    icon: '🚨', color: '#FF4E4E' },
  { key: 'has_surgery',            label: 'Surgery',      icon: '🔪', color: '#38BDF8' },
  { key: 'has_icu',                label: 'ICU',          icon: '🫀', color: '#8B7CF7' },
  { key: 'has_obstetrics',         label: 'Obstetrics',   icon: '👶', color: '#F472B6' },
  { key: 'has_pediatrics',         label: 'Pediatrics',   icon: '🧒', color: '#00D4B1' },
  { key: 'has_radiology',          label: 'Radiology',    icon: '🩻', color: '#38BDF8' },
  { key: 'has_infectious_disease', label: 'Infectious',   icon: '🦠', color: '#FFB600' },
  { key: 'has_mental_health',      label: 'Mental Health',icon: '🧠', color: '#A78BFA' },
  { key: 'accepts_volunteers_bool',label: 'Volunteers ✓', icon: '🤝', color: '#4ADE80' },
]

// ── Region zoomer ────────────────────────────────────────────────────────────
function RegionZoomer({ features }: { features: FacilityFeature[] }) {
  const map = useMap()
  useEffect(() => {
    if (!features.length) return
    const lats = features.map(f => f.geometry.coordinates[1]).filter(Boolean)
    const lngs = features.map(f => f.geometry.coordinates[0]).filter(Boolean)
    if (!lats.length) return
    map.fitBounds(
      [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
      { padding: [40, 40], animate: true, duration: 0.8 },
    )
  }, [features, map])
  return null
}

// ── Stat mini-card ────────────────────────────────────────────────────────────
function StatCell({
  icon, label, value, color,
}: { icon: string; label: string; value: string; color: string }) {
  return (
    <div
      style={{
        padding: '8px 4px',
        textAlign: 'center',
        borderRadius: 8,
        background: `${color}10`,
        border: `1px solid ${color}28`,
      }}
      onMouseEnter={e => {
        ;(e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'
        ;(e.currentTarget as HTMLElement).style.boxShadow = `0 4px 14px ${color}30`
      }}
      onMouseLeave={e => {
        ;(e.currentTarget as HTMLElement).style.transform = 'none'
        ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
      }}
    >
      <div style={{ fontSize: 15 }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color, marginTop: 2, fontFamily: 'var(--font-display)' }}>
        {value}
      </div>
      <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 1 }}>
        {label}
      </div>
    </div>
  )
}

// ── Facility Popup ────────────────────────────────────────────────────────────
function FacilityPopup({
  f, detail, loadingDetail,
}: { f: FacilityFeature; detail?: FacilityDetail; loadingDetail: boolean }) {
  const props = f.properties
  const desertLabel = props.mds_label || props.desert_label
  const desertColor = DESERT_LABEL_COLOR(desertLabel, props.medical_desert_score)

  // Specialties
  const specialtiesRaw = Array.isArray(props.specialties_enriched) && props.specialties_enriched.length
    ? props.specialties_enriched
    : props.specialties ? [props.specialties] : []
  const detailSpecialties = [
    ...new Set(
      (Array.isArray(detail?.specialties_enriched) && detail!.specialties_enriched!.length
        ? detail!.specialties_enriched!
        : specialtiesRaw
      ).map(formatLabel),
    ),
  ].filter(Boolean)

  // Capabilities
  const capabilities = [...new Set((detail?.capability_enriched || []).map(formatLabel))]
    .filter(Boolean)
    .slice(0, 12)

  const activeBadges = CAPABILITY_BADGES.filter(b => (props as any)[b.key])

  const website = detail?.official_website?.trim()
  const normalizedUrl =
    website && /^https?:\/\//i.test(website) ? website : `https://${website}`

  const phonesRaw = detail?.phone_numbers?.length ? detail.phone_numbers : detail?.official_phone
  const normalizedPhones = (Array.isArray(phonesRaw) ? phonesRaw : [phonesRaw])
    .map(p => p?.toString().trim())
    .filter(Boolean)

  const addressParts = [
    detail?.address_line1,
    detail?.address_line2,
    detail?.address_line3,
    detail?.address_city,
    detail?.address_state_or_region,
    detail?.address_zip_or_postcode,
  ]
    .map(v => v?.toString().trim())
    .filter(v => v && v.toLowerCase() !== 'null')
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(', ')

  const STATS = [
    { icon: '👨‍⚕️', label: 'Doctors',   value: formatStat(props.number_doctors_int, 'number'), color: '#38BDF8' },
    { icon: '🛏️', label: 'Beds',       value: formatStat(props.capacity_int, 'number'),         color: '#8B5CF6' },
    { icon: '📊', label: 'MDS',         value: formatStat(props.medical_desert_score, 'float'),  color: '#F59E0B' },
    { icon: '🫀', label: 'ICU',         value: formatStat(props.has_icu, 'bool'),                color: '#EF4444' },
    { icon: '🔪', label: 'Surgery',     value: formatStat(props.has_surgery, 'bool'),            color: '#3B82F6' },
    { icon: '🚨', label: 'Emergency',   value: formatStat(props.has_emergency_medicine, 'bool'), color: '#DC2626' },
    { icon: '🤝', label: 'Volunteers',  value: formatStat(props.accepts_volunteers_bool, 'bool'),color: '#10B981' },
    { icon: '🦠', label: 'Infectious',  value: formatStat(props.has_infectious_disease, 'bool'), color: '#F97316' },
    { icon: '⚠️', label: 'Anomalies',   value: formatStat(props.total_stat_anomalies, 'number'), color: '#F43F5E' },
  ]

  return (
    <div
      style={{
        fontFamily: '"Space Grotesk", "DM Sans", system-ui, sans-serif',
        width: 340,
        maxWidth: '90vw',
        background: 'var(--bg-card)',
        color: 'var(--text-primary)',
        borderRadius: 16,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'min(82vh, 620px)',
        overflow: 'hidden',
      }}
    >
      {/* ── Sticky header ── */}
      <div
        style={{
          flexShrink: 0,
          padding: '14px 16px 10px',
          background: `linear-gradient(135deg, ${desertColor}1a, ${desertColor}08)`,
          borderBottom: `2px solid ${desertColor}30`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: 'var(--text-primary)',
                lineHeight: 1.3,
                marginBottom: 3,
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {props.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <span>{props.facility_type_clean}</span>
              {props.city_clean && <><span>·</span><span>{props.city_clean}</span></>}
              {props.region_normalised && <><span>·</span><span>{props.region_normalised}</span></>}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
            {desertLabel && (
              <span
                style={{
                  fontSize: 9,
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontWeight: 700,
                  background: `${desertColor}22`,
                  color: desertColor,
                  border: `1px solid ${desertColor}40`,
                  whiteSpace: 'nowrap',
                }}
              >
                {desertLabel}
              </span>
            )}
            {(props.data_completeness_score ?? 0) > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 44, height: 3, borderRadius: 999, background: 'var(--bg-border)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${(props.data_completeness_score || 0) * 100}%`,
                      background: '#00D4B1',
                      borderRadius: 999,
                    }}
                  />
                </div>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {((props.data_completeness_score || 0) * 100).toFixed(0)}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Stats grid — pinned below header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 5,
            marginTop: 10,
            transition: 'all 150ms',
          }}
        >
          {STATS.slice(0, 6).map((s, i) => (
            <StatCell key={i} {...s} />
          ))}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '10px 14px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--bg-border-accent) transparent',
        }}
      >
        {/* Extra stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
          {STATS.slice(6).map((s, i) => (
            <StatCell key={i} {...s} />
          ))}
        </div>

        {/* Capability badges */}
        {activeBadges.length > 0 && (
          <div>
            <SectionLabel>Capabilities</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {activeBadges.map(b => (
                <span
                  key={b.key}
                  style={{
                    fontSize: 10,
                    padding: '3px 8px',
                    borderRadius: 999,
                    fontWeight: 600,
                    background: `${b.color}18`,
                    color: b.color,
                    border: `1px solid ${b.color}30`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <span>{b.icon}</span>
                  {b.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Year established */}
        {detail?.year_established &&
          detail.year_established.toString().trim().toLowerCase() !== 'null' && (
            <InfoRow icon="🏗️" label="Established" value={detail.year_established.toString()} />
          )}

        {/* Address */}
        {addressParts && (
          <div>
            <SectionLabel>📍 Address</SectionLabel>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
                background: 'var(--bg-surface)',
                border: '1px solid var(--bg-border)',
                borderRadius: 8,
                padding: '6px 8px',
              }}
            >
              {addressParts}
            </div>
          </div>
        )}

        {/* Organization description */}
        {detail?.organizationdescription && detail.organizationdescription.trim() && (
          <div>
            <SectionLabel>About</SectionLabel>
            <p
              style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              {detail.organizationdescription}
            </p>
          </div>
        )}

        {/* Description */}
        {detail?.description && detail.description.trim() && (
          <div>
            <SectionLabel>Description</SectionLabel>
            <p
              style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
                lineHeight: 1.55,
                margin: 0,
                fontStyle: 'italic',
              }}
            >
              "{detail.description}"
            </p>
          </div>
        )}

        {/* Specialties */}
        {detailSpecialties.length > 0 && (
          <div>
            <SectionLabel>Specialties ({detailSpecialties.length})</SectionLabel>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '3px 8px',
              }}
            >
              {detailSpecialties.map((spec, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
                  <span style={{ color: desertColor, flexShrink: 0 }}>•</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spec}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Capabilities list */}
        {capabilities.length > 0 && (
          <div>
            <SectionLabel>Procedures / Capabilities ({capabilities.length})</SectionLabel>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '3px 8px',
              }}
            >
              {capabilities.map((cap, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
                  <span style={{ color: '#8B7CF7', flexShrink: 0 }}>✓</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cap}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Anomaly alert */}
        {(props.total_stat_anomalies ?? 0) > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 8,
              background: '#FF4E4E12',
              border: '1px solid #FF4E4E30',
            }}
          >
            <span>⚠️</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#FF4E4E' }}>
                {props.total_stat_anomalies} Anomaly Flag{(props.total_stat_anomalies ?? 0) > 1 ? 's' : ''}
              </div>
              {detail?.anomaly_risk_level && (
                <div style={{ fontSize: 10, color: '#FF7423' }}>
                  Risk Level: {detail.anomaly_risk_level}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Priority action */}
        {detail?.llm_priority_action && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              fontSize: 11,
              lineHeight: 1.5,
              background: 'rgba(139,124,247,0.07)',
              border: '1px solid rgba(139,124,247,0.2)',
              color: 'var(--text-secondary)',
              borderLeft: '3px solid #8B7CF7',
            }}
          >
            <span style={{ color: '#8B7CF7', fontWeight: 700 }}>Recommended Action: </span>
            {detail.llm_priority_action}
          </div>
        )}

        {/* Contact row */}
        {(detail?.email || detail?.official_website || normalizedPhones.length > 0) && (
          <div>
            <SectionLabel>Contact</SectionLabel>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {detail?.email && (
                <ContactChip
                  href={`mailto:${detail.email}`}
                  label={detail.email}
                  icon="✉"
                  color="var(--text-muted)"
                />
              )}
              {detail?.official_website && (
                <ContactChip
                  href={normalizedUrl}
                  label={detail.official_website}
                  icon="🌐"
                  color="var(--accent-teal)"
                  external
                />
              )}
              {normalizedPhones.map((phone, idx) => (
                <ContactChip
                  key={idx}
                  href={`tel:${phone?.replace(/\s+/g, '')}`}
                  label={phone}
                  icon="📞"
                  color="#38BDF8"
                />
              ))}
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {loadingDetail && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              color: 'var(--text-muted)',
            }}
          >
            <div className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
            Loading facility details…
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9,
        fontWeight: 800,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginBottom: 5,
        fontFamily: 'var(--font-display)',
      }}
    >
      {children}
    </div>
  )
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
      {icon} {label}:{' '}
      <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
        {value}
      </span>
    </div>
  )
}

function ContactChip({
  href, label, icon, color, external,
}: { href: string; label?: string; icon: string; color: string; external?: boolean }) {
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      onClick={e => {
        e.stopPropagation()
        if (external) {
          e.preventDefault()
          window.open(href, '_blank', 'noopener,noreferrer')
        }
      }}
      style={{
        fontSize: 10,
        padding: '3px 8px',
        borderRadius: 6,
        background: 'var(--bg-surface)',
        color,
        border: '1px solid var(--bg-border)',
        textDecoration: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        maxWidth: 150,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {icon} {label}
    </a>
  )
}

// ── Toggle button ────────────────────────────────────────────────────────────
function ToggleButton({
  active, label, icon, color, onClick,
}: { active: boolean; label: string; icon: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '6px 10px',
        borderRadius: 8,
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 600,
        border: `1px solid ${active ? color + '50' : 'var(--bg-border)'}`,
        background: active ? `${color}18` : 'var(--bg-input)',
        color: active ? color : 'var(--text-muted)',
        transition: 'all 150ms ease',
        fontFamily: 'var(--font-display)',
        flex: 1,
        justifyContent: 'center',
      }}
    >
      <span style={{ fontSize: 12 }}>{icon}</span>
      {label}
    </button>
  )
}

// ── Active filter chip ────────────────────────────────────────────────────────
function FilterChip({
  label, onRemove,
}: { label: string; onRemove: () => void }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        background: 'rgba(139,124,247,0.15)',
        border: '1px solid rgba(139,124,247,0.3)',
        fontSize: 10,
        fontWeight: 600,
        color: '#8B7CF7',
        animation: 'chipIn 150ms ease both',
      }}
    >
      {label}
      <span
        onClick={onRemove}
        style={{ cursor: 'pointer', opacity: 0.7, fontWeight: 400 }}
        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.7')}
      >
        ×
      </span>
    </div>
  )
}

// ── Sidebar panel ────────────────────────────────────────────────────────────
interface SidebarPanelProps {
  collapsed: boolean
  onToggle: () => void
  children: React.ReactNode
}
function SidebarPanel({ collapsed, onToggle, children }: SidebarPanelProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: collapsed ? -222 : 16,
        zIndex: 1000,
        width: 230,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        transition: 'left 300ms cubic-bezier(0.34,1.56,0.64,1)',
      }}
    >
      {children}
      {/* Toggle tab */}
      <button
        onClick={onToggle}
        style={{
          position: 'absolute',
          top: 8,
          right: collapsed ? -44 : -36,
          width: 28,
          height: 48,
          background: 'var(--bg-card)',
          border: '1px solid var(--bg-border)',
          borderLeft: 'none',
          borderRadius: '0 8px 8px 0',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          color: 'var(--text-muted)',
          boxShadow: '4px 0 12px rgba(0,0,0,0.15)',
          transition: 'all 150ms ease',
        }}
        onMouseEnter={e => {
          ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)'
          ;(e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'
        }}
        onMouseLeave={e => {
          ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-card)'
          ;(e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'
        }}
      >
        {collapsed ? '›' : '‹'}
      </button>
    </div>
  )
}

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
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync tile style with theme
  useEffect(() => {
    setTileStyle(theme === 'dark' ? 'dark' : 'light')
  }, [theme])

  // Auto-collapse sidebar on small screens
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    if (mq.matches) setSidebarCollapsed(true)
    const handler = (e: MediaQueryListEvent) => setSidebarCollapsed(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const loadData = useCallback(
    async (region = '', type = '', desert = false, search = '') => {
      setLoading(true)
      try {
        const { data: geo } = await getFacilitiesMap({
          region: region || undefined,
          facility_type: type || undefined,
        })
        const allFeatures = (geo.features || []) as unknown as FacilityFeature[]
        let filtered = desert
          ? allFeatures.filter(f =>
              ['Critical Desert', 'Severe Desert'].includes(f.properties.desert_label || ''),
            )
          : allFeatures

        if (search.trim()) {
          const q = search.toLowerCase()
          filtered = filtered.filter(
            f =>
              f.properties.name?.toLowerCase().includes(q) ||
              f.properties.city_clean?.toLowerCase().includes(q) ||
              f.properties.region_normalised?.toLowerCase().includes(q) ||
              f.properties.facility_type_clean?.toLowerCase().includes(q),
          )
          if (filtered.length === 1)
            setActivePopupId(filtered[0].properties.unique_id || null)
        }

        if (specialtyFilter) {
          const sf = specialtyFilter.toLowerCase()
          filtered = filtered.filter(f => {
            const p = f.properties
            if (sf === 'emergency') return p.has_emergency_medicine
            if (sf === 'surgery')   return p.has_surgery
            if (sf === 'icu')       return p.has_icu
            if (sf === 'obstetrics')return p.has_obstetrics
            if (sf === 'pediatrics')return p.has_pediatrics
            if (sf === 'radiology') return p.has_radiology
            if (sf === 'volunteers')return p.accepts_volunteers_bool
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
    },
    [specialtyFilter],
  )

  useEffect(() => { getRegions().then(setRegions) }, [])

  // Debounced reload
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(
      () => loadData(regionFilter, typeFilter, desertOnly, searchTerm),
      300,
    )
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current)
    }
  }, [regionFilter, typeFilter, desertOnly, searchTerm, loadData])

  const ensureDetail = async (uniqueId?: string) => {
    if (!uniqueId || detailCache[uniqueId] || detailLoading[uniqueId]) return
    setDetailLoading(prev => ({ ...prev, [uniqueId]: true }))
    try {
      const detail = await getFacilityDetail(uniqueId)
      setDetailCache(prev => ({ ...prev, [uniqueId]: detail }))
    } catch (e) {
      console.error(e)
    } finally {
      setDetailLoading(prev => ({ ...prev, [uniqueId]: false }))
    }
  }

  const clearAllFilters = () => {
    setRegionFilter('')
    setTypeFilter('')
    setSpecialtyFilter('')
    setDesertOnly(false)
    setSearchTerm('')
  }
  const hasActiveFilters =
    !!regionFilter || !!typeFilter || !!specialtyFilter || desertOnly || !!searchTerm

  // Quick stats
  const hospitals  = features.filter(f => f.properties.is_hospital).length
  const ngos       = features.filter(f => f.properties.is_ngo).length
  const clinics    = features.filter(f => f.properties.is_clinic).length
  const criticals  = features.filter(
    f => (f.properties.desert_label || '').toLowerCase().includes('critical'),
  ).length
  const severes    = features.filter(
    f => (f.properties.desert_label || '').toLowerCase().includes('severe'),
  ).length
  const volunteers = features.filter(f => f.properties.accepts_volunteers_bool).length
  const withDoctors = features.filter(f => (f.properties.number_doctors_int ?? 0) > 0).length
  const totalDoctors = features.reduce((s, f) => s + (f.properties.number_doctors_int ?? 0), 0)

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
    <div
      style={{
        position: 'relative',
        height: 'calc(100vh - 70px)',
        overflow: 'hidden',
        background: 'var(--bg-base)',
      }}
    >
      {/* ── Controls sidebar ── */}
      <SidebarPanel collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)}>
        {/* Main controls card */}
        <div
          style={{
            borderRadius: 16,
            overflow: 'hidden',
            background: 'var(--bg-card)',
            border: '1px solid var(--bg-border)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 14px 10px',
              background: 'linear-gradient(135deg, rgba(139,124,247,0.14), rgba(0,212,177,0.06))',
              borderBottom: '1px solid var(--bg-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  fontFamily: 'var(--font-display)',
                }}
              >
                🗺️ Map Explorer
              </div>
              {hasActiveFilters && (
                <button
                  onClick={clearAllFilters}
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: '#FF4E4E',
                    background: 'rgba(255,78,78,0.1)',
                    border: '1px solid rgba(255,78,78,0.3)',
                    borderRadius: 6,
                    padding: '2px 6px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-display)',
                  }}
                >
                  Clear ×
                </button>
              )}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                  Querying…
                </span>
              ) : (
                <span>
                  <span
                    style={{
                      color: 'var(--accent-teal)',
                      fontFamily: 'var(--font-display)',
                      fontWeight: 800,
                    }}
                  >
                    {total.toLocaleString()}
                  </span>{' '}
                  facilities
                  {hasActiveFilters && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}> (filtered)</span>
                  )}
                </span>
              )}
            </div>

            {/* Active filter chips */}
            {hasActiveFilters && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {regionFilter && <FilterChip label={regionFilter} onRemove={() => setRegionFilter('')} />}
                {typeFilter && <FilterChip label={typeFilter} onRemove={() => setTypeFilter('')} />}
                {specialtyFilter && <FilterChip label={specialtyFilter} onRemove={() => setSpecialtyFilter('')} />}
                {desertOnly && <FilterChip label="Deserts only" onRemove={() => setDesertOnly(false)} />}
              </div>
            )}
          </div>

          {/* Search */}
          <div style={{ position: 'relative', padding: '8px 10px 0' }}>
            <span
              style={{
                position: 'absolute',
                left: 18,
                top: '50%',
                marginTop: 4,
                fontSize: 12,
                opacity: 0.5,
                pointerEvents: 'none',
              }}
            >
              🔍
            </span>
            <input
              type="text"
              placeholder="Search facility, city, region…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 28px 7px 28px',
                borderRadius: 9,
                fontSize: 11,
                border: `1px solid ${searchTerm ? 'rgba(0,212,177,0.5)' : 'var(--bg-border)'}`,
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                outline: 'none',
                transition: 'all 180ms ease',
                boxShadow: searchTerm ? '0 0 0 2px rgba(0,212,177,0.15)' : 'none',
              }}
            />
            {searchTerm && (
              <span
                onClick={() => setSearchTerm('')}
                style={{
                  position: 'absolute',
                  right: 18,
                  top: '50%',
                  marginTop: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                  opacity: 0.5,
                  transform: 'translateY(-50%)',
                }}
              >
                ✕
              </span>
            )}
          </div>

          {/* Filters */}
          <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <select
              value={regionFilter}
              onChange={e => setRegionFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 8,
                fontSize: 11,
                border: `1px solid ${regionFilter ? 'rgba(139,124,247,0.5)' : 'var(--bg-border)'}`,
                background: regionFilter ? 'rgba(139,124,247,0.1)' : 'var(--bg-input)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                outline: 'none',
                transition: 'all 150ms ease',
              }}
            >
              <option value="">All Regions</option>
              {regions.map(r => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 8,
                fontSize: 11,
                border: `1px solid ${typeFilter ? 'rgba(0,212,177,0.5)' : 'var(--bg-border)'}`,
                background: typeFilter ? 'rgba(0,212,177,0.1)' : 'var(--bg-input)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                outline: 'none',
                transition: 'all 150ms ease',
              }}
            >
              <option value="">All Types</option>
              <option value="Hospital">🏥 Hospitals</option>
              <option value="Clinic">🩺 Clinics</option>
              <option value="NGO">🤝 NGOs</option>
              <option value="Pharmacy">💊 Pharmacies</option>
            </select>

            <select
              value={specialtyFilter}
              onChange={e => setSpecialtyFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 8,
                fontSize: 11,
                border: `1px solid ${specialtyFilter ? 'rgba(255,182,0,0.5)' : 'var(--bg-border)'}`,
                background: specialtyFilter ? 'rgba(255,182,0,0.08)' : 'var(--bg-input)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                outline: 'none',
                transition: 'all 150ms ease',
              }}
            >
              <option value="">All Specialties</option>
              <option value="emergency">🚨 Emergency Medicine</option>
              <option value="surgery">🔪 Surgery</option>
              <option value="icu">🫀 ICU</option>
              <option value="obstetrics">👶 Obstetrics</option>
              <option value="pediatrics">🧒 Pediatrics</option>
              <option value="radiology">🩻 Radiology</option>
              <option value="volunteers">🤝 Accepts Volunteers</option>
            </select>

            <div style={{ display: 'flex', gap: 5 }}>
              <ToggleButton
                active={desertOnly}
                label="Deserts"
                icon="🌵"
                color="#FF7423"
                onClick={() => setDesertOnly(v => !v)}
              />
              <ToggleButton
                active={showDesertHeat}
                label="Heatmap"
                icon="🔥"
                color="#FF4E4E"
                onClick={() => setShowDesertHeat(v => !v)}
              />
            </div>
          </div>

          {/* Tile style switcher */}
          <div style={{ padding: '0 10px 10px' }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginBottom: 5,
              }}
            >
              Map Style
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {TILE_STYLES.map(ts => (
                <button
                  key={ts.id}
                  onClick={() => setTileStyle(ts.id)}
                  style={{
                    padding: '5px 8px',
                    borderRadius: 7,
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-display)',
                    border: `1px solid ${tileStyle === ts.id ? 'rgba(0,212,177,0.5)' : 'var(--bg-border)'}`,
                    background: tileStyle === ts.id ? 'rgba(0,212,177,0.12)' : 'var(--bg-input)',
                    color: tileStyle === ts.id ? 'var(--accent-teal)' : 'var(--text-muted)',
                    transition: 'all 150ms ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span>{ts.icon}</span>
                  {ts.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Stats card */}
        <div
          style={{
            borderRadius: 14,
            overflow: 'hidden',
            background: 'var(--bg-card)',
            border: '1px solid var(--bg-border)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}
        >
          <button
            onClick={() => setStatsOpen(v => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 800,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              fontFamily: 'var(--font-display)',
            }}
          >
            <span>📊 Stats</span>
            <span
              style={{
                transition: 'transform 200ms ease',
                transform: statsOpen ? 'rotate(180deg)' : 'none',
                fontSize: 8,
              }}
            >
              ▼
            </span>
          </button>

          {statsOpen && (
            <div
              style={{
                padding: '0 10px 10px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 5,
                animation: 'fadeIn 150ms both',
              }}
            >
              {[
                { label: 'Hospitals',   value: hospitals,     color: '#38BDF8', icon: '🏥' },
                { label: 'Clinics',     value: clinics,       color: '#00D4B1', icon: '🩺' },
                { label: 'NGOs',        value: ngos,          color: '#A78BFA', icon: '🤝' },
                { label: 'Volunteers',  value: volunteers,    color: '#4ADE80', icon: '👥' },
                { label: 'Critical',    value: criticals,     color: '#FF4E4E', icon: '⚠️' },
                { label: 'Severe',      value: severes,       color: '#FF7423', icon: '🔶' },
                { label: 'W/ Doctors',  value: withDoctors,   color: '#F59E0B', icon: '👨‍⚕️' },
                { label: 'Doctors',     value: totalDoctors,  color: '#818CF8', icon: '🩻' },
              ].map(s => (
                <div
                  key={s.label}
                  style={{
                    padding: '7px 8px',
                    borderRadius: 8,
                    background: `${s.color}0e`,
                    border: `1px solid ${s.color}22`,
                    textAlign: 'center',
                    transition: 'all 150ms ease',
                  }}
                  onMouseEnter={e => {
                    ;(e.currentTarget as HTMLElement).style.transform = 'scale(1.04)'
                    ;(e.currentTarget as HTMLElement).style.boxShadow = `0 4px 12px ${s.color}25`
                  }}
                  onMouseLeave={e => {
                    ;(e.currentTarget as HTMLElement).style.transform = 'none'
                    ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
                  }}
                >
                  <div style={{ fontSize: 13 }}>{s.icon}</div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      color: s.color,
                      fontFamily: 'var(--font-display)',
                      lineHeight: 1,
                      marginTop: 3,
                    }}
                  >
                    {s.value.toLocaleString()}
                  </div>
                  <div
                    style={{
                      fontSize: 8.5,
                      color: 'var(--text-muted)',
                      marginTop: 2,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SidebarPanel>

      {/* ── Legend (bottom-left) ── */}
      <div
        style={{
          
          position: 'absolute',
          top: 24,
          right: 16,
          zIndex: 1000,
          background: 'var(--bg-card)',
          border: '1px solid var(--bg-border)',
          borderRadius: 14,
          padding: '10px 12px',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          animation: 'fadeInUp 400ms 200ms both',
          maxHeight: 'calc(100% - 48px)',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: 7,
            fontFamily: 'var(--font-display)',
          }}
        >
          Desert Index
        </div>
        {LEGEND_ITEMS.map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                flexShrink: 0,
                background: l.color,
                boxShadow: `0 0 6px ${l.color}60`,
              }}
            />
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 500 }}>
              {l.label}
            </span>
          </div>
        ))}

        <div style={{ borderTop: '1px solid var(--bg-border)', marginTop: 8, paddingTop: 8 }}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 6,
            }}
          >
            Facility Type
          </div>
          {[
            { label: 'Hospital', emoji: '🏥', color: '#38BDF8' },
            { label: 'Clinic',   emoji: '🩺', color: '#8B7CF7' },
            { label: 'NGO',      emoji: '🤝', color: '#4ADE80' },
            { label: 'Other',    emoji: '📍', color: '#94A3B8' },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: `${l.color}18`,
                  border: `1px solid ${l.color}35`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  flexShrink: 0,
                }}
              >
                {l.emoji}
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 500 }}>
                {l.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Map ── */}
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
          attribution="&copy; OpenStreetMap contributors &copy; CARTO"
          maxZoom={19}
        />

        {/* Desert heatmap circles */}
        {showDesertHeat &&
          desertRegions.map(dr => (
            <CircleMarker
              key={dr.region}
              center={[dr.lat, dr.lon]}
              radius={Math.max(20, (dr.medical_desert_score || 0) * 65)}
              pathOptions={{
                color: DESERT_COLOR(dr.medical_desert_score),
                fillColor: DESERT_COLOR(dr.medical_desert_score),
                fillOpacity: 0.14,
                weight: 1,
                opacity: 0.45,
              }}
            >
              <Popup className="facility-popup">
                <div
                  style={{
                    fontFamily: 'system-ui, sans-serif',
                    minWidth: 200,
                    padding: 4,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: 14,
                      marginBottom: 4,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {dr.region}
                  </div>
                  <div
                    style={{
                      color: DESERT_COLOR(dr.medical_desert_score),
                      fontSize: 11,
                      fontWeight: 600,
                      marginBottom: 8,
                    }}
                  >
                    {dr.mds_label}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[
                      ['MDS Score', dr.medical_desert_score?.toFixed(3)],
                      ['Facilities', dr.total_facilities],
                      ['Doctors', dr.total_doctors],
                      ['Beds', dr.total_beds],
                    ].map(([k, v]) => (
                      <div key={k as string}>
                        <div
                          style={{
                            fontSize: 9,
                            color: '#64748b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          {k}
                        </div>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 14,
                            color: 'var(--text-primary)',
                          }}
                        >
                          {v}
                        </div>
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
          const loadingDetail = f.properties.unique_id
            ? detailLoading[f.properties.unique_id] ?? false
            : false
          const markerColor = FACILITY_COLOR(f.properties)
          const isActive = activePopupId === markerId
          const emoji = getFacilityEmoji(f.properties)
          const shortName =
            f.properties.name.length > 28
              ? `${f.properties.name.slice(0, 28)}…`
              : f.properties.name

          const icon = L.divIcon({
            className: '',
            html: `
              <div style="
                width: ${isActive ? 34 : 28}px;
                height: ${isActive ? 34 : 28}px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: ${isActive ? 20 : 15}px;
                box-shadow: 0 0 ${isActive ? 16 : 8}px ${markerColor}${isActive ? 'cc' : '80'};
                transform: translate(-50%, -50%);
                transition: all 200ms cubic-bezier(0.34,1.56,0.64,1);
                ${isActive ? `background: ${markerColor}22; border: 2px solid ${markerColor}60;` : ''}
              ">${emoji}</div>
            `,
          })

          return (
            <Marker
              key={markerId}
              position={[lat, lon]}
              icon={icon}
              eventHandlers={{
                click: e => {
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
                offset={[12, 0]}
                opacity={0.92}
              >
                {shortName}
              </Tooltip>

              <Popup
                className="facility-popup"
                closeOnClick={false}
                closeButton
                maxWidth={360}
                minWidth={320}
              >
                <FacilityPopup f={f} detail={detail} loadingDetail={loadingDetail} />
              </Popup>
            </Marker>
          )
        })}

        <RegionZoomer features={features} />
      </MapContainer>

      {/* ── Loading overlay ── */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(6,9,26,0.6)',
            backdropFilter: 'blur(4px)',
            animation: 'fadeIn 150ms both',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--bg-border)',
              borderRadius: 14,
              padding: '16px 24px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
            }}
          >
            <div className="spinner" />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
              Loading facilities…
            </span>
          </div>
        </div>
      )}

      {/* Map CSS overrides */}
      <style>{`
        @keyframes chipIn {
          from { opacity: 0; transform: scale(0.85); }
          to   { opacity: 1; transform: scale(1); }
        }

        .leaflet-popup-content-wrapper {
          padding: 0 !important;
          border-radius: 16px !important;
          overflow: hidden !important;
          background: var(--bg-card) !important;
          border: 1px solid var(--bg-border-accent) !important;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4) !important;
        }
        .leaflet-popup-content {
          margin: 0 !important;
          width: auto !important;
          min-width: 300px !important;
          max-width: 360px !important;
          overflow: hidden !important;
        }
        .leaflet-popup-tip-container { display: none !important; }
        .leaflet-popup-tip { background: var(--bg-card) !important; }
        .leaflet-popup-close-button {
          color: var(--text-muted) !important;
          font-size: 18px !important;
          padding: 8px 10px !important;
          z-index: 10 !important;
          background: var(--bg-card) !important;
          border-radius: 0 16px 0 8px !important;
          top: 0 !important;
          right: 0 !important;
        }
        .leaflet-popup-close-button:hover {
          color: var(--text-primary) !important;
          background: var(--bg-surface) !important;
        }
        .facility-label {
          background: var(--bg-card) !important;
          border: 1px solid var(--bg-border-accent) !important;
          border-radius: 7px !important;
          color: var(--text-primary) !important;
          font-size: 10.5px !important;
          font-weight: 600 !important;
          padding: 3px 8px !important;
          white-space: nowrap !important;
          box-shadow: 0 3px 10px rgba(0,0,0,0.25) !important;
          font-family: var(--font-display) !important;
        }
        .leaflet-control-zoom {
          border: none !important;
          box-shadow: 0 4px 16px rgba(0,0,0,0.25) !important;
          border-radius: 10px !important;
          overflow: hidden;
        }
        .leaflet-control-zoom-in,
        .leaflet-control-zoom-out {
          background: var(--bg-card) !important;
          border: 1px solid var(--bg-border) !important;
          color: var(--text-primary) !important;
          width: 34px !important;
          height: 34px !important;
          line-height: 32px !important;
          font-size: 16px !important;
          transition: all 150ms ease !important;
        }
        .leaflet-control-zoom-in:hover,
        .leaflet-control-zoom-out:hover {
          background: var(--bg-surface) !important;
          color: var(--accent-teal) !important;
        }
        /* Popup scrollbar */
        .leaflet-popup-content div::-webkit-scrollbar { width: 4px; }
        .leaflet-popup-content div::-webkit-scrollbar-track { background: transparent; }
        .leaflet-popup-content div::-webkit-scrollbar-thumb {
          background: var(--bg-border-accent);
          border-radius: 2px;
        }
        @keyframes fadeInLeft {
          from { opacity: 0; transform: translateX(-16px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}