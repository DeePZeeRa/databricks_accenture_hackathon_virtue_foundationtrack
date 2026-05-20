// src/pages/FacilityExplorer.tsx — v4 · Advanced animated facility intelligence browser
import { useEffect, useState, useCallback, useRef, Fragment } from 'react'
import { getFacilities, getRegions, getFacilityDetail, type Facility, type FacilityDetail } from '../api/client'

// ── Config ────────────────────────────────────────────────────────────────────
const CAPABILITY_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  has_emergency_medicine: { label: 'Emergency',    icon: '🚨', color: '#FF4E4E' },
  has_surgery:            { label: 'Surgery',      icon: '🔪', color: '#38BDF8' },
  has_obstetrics:         { label: 'Obstetrics',   icon: '👶', color: '#8B7CF7' },
  has_pediatrics:         { label: 'Pediatrics',   icon: '🧒', color: '#00D4B1' },
  has_icu:                { label: 'ICU',          icon: '🫀', color: '#FF7423' },
  has_radiology:          { label: 'Radiology',    icon: '🩻', color: '#38BDF8' },
  has_infectious_disease: { label: 'Infectious',   icon: '🦠', color: '#FFB600' },
  has_mental_health:      { label: 'Mental Health',icon: '🧠', color: '#A78BFA' },
}

const DESERT_COLOR = (score: number) => {
  if (score >= 0.75) return '#FF4E4E'
  if (score >= 0.55) return '#FF7423'
  if (score >= 0.40) return '#FFB600'
  if (score >= 0.25) return '#4ADE80'
  return '#00D4B1'
}

// ── Sub-components ────────────────────────────────────────────────────────────
function CapabilityChips({ facility, max = 5 }: { facility: Facility; max?: number }) {
  const chips = Object.entries(CAPABILITY_CONFIG)
    .filter(([key]) => Boolean((facility as any)[key]))
  if (chips.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
  const shown = chips.slice(0, max)
  const extra = chips.length - shown.length
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {shown.map(([key, cfg]) => (
        <span key={key} title={cfg.label} style={{
          fontSize: 10, padding: '2px 7px', borderRadius: 999,
          background: `${cfg.color}14`, color: cfg.color,
          border: `1px solid ${cfg.color}28`, fontWeight: 600,
          fontFamily: 'var(--font-display)',
          display: 'flex', alignItems: 'center', gap: 3,
        }}>
          <span style={{ fontSize: 10 }}>{cfg.icon}</span>
          {cfg.label}
        </span>
      ))}
      {extra > 0 && (
        <span style={{
          fontSize: 10, padding: '2px 7px', borderRadius: 999,
          background: 'rgba(139,124,247,0.1)', color: '#8B7CF7',
          border: '1px solid rgba(139,124,247,0.2)', fontWeight: 700,
          fontFamily: 'var(--font-display)',
        }}>+{extra}</span>
      )}
    </div>
  )
}

function ScoreBar({ score, color }: { score: number; color?: string }) {
  const c = color || DESERT_COLOR(score)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: c, fontSize: 12, width: 38, flexShrink: 0 }}>
        {score.toFixed(2)}
      </span>
      <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'var(--bg-border)', overflow: 'hidden', minWidth: 44 }}>
        <div style={{
          height: '100%', borderRadius: 999,
          width: `${Math.min(score * 100, 100)}%`,
          background: `linear-gradient(90deg, ${c}bb, ${c})`,
          transition: 'width 650ms cubic-bezier(0.34,1.56,0.64,1)',
          boxShadow: `0 0 6px ${c}50`,
        }} />
      </div>
    </div>
  )
}

function ToggleChip({ active, label, color = '#FF4E4E', onClick }: {
  active: boolean; label: string; color?: string; onClick: () => void
}) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      fontFamily: 'var(--font-display)', cursor: 'pointer',
      border: `1px solid ${active ? color + '50' : 'var(--bg-border)'}`,
      background: active ? `${color}18` : 'var(--bg-input)',
      color: active ? color : 'var(--text-secondary)',
      transition: 'all 150ms cubic-bezier(0.34,1.56,0.64,1)',
      whiteSpace: 'nowrap',
      transform: active ? 'scale(1.03)' : 'scale(1)',
    }}>
      {active ? '✓ ' : ''}{label}
    </button>
  )
}

function StatMiniCard({ icon, label, value, color }: { icon: string; label: string; value: string | number; color: string }) {
  return (
    <div style={{
      textAlign: 'center', padding: '8px 10px', borderRadius: 9,
      background: `${color}0d`, border: `1px solid ${color}22`,
      transition: 'all 180ms ease', minWidth: 80,
    }}
    onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = `0 5px 14px ${color}20` }}
    onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'none'; el.style.boxShadow = 'none' }}>
      <div style={{ fontSize: 16 }}>{icon}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 1 }}>{label}</div>
    </div>
  )
}

// ── Sortable hook ─────────────────────────────────────────────────────────────
function useSortable(data: Facility[], defaultKey: string = 'name') {
  const [key, setKey] = useState(defaultKey)
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')
  const sorted = [...data].sort((a, b) => {
    const av = (a as any)[key] ?? '', bv = (b as any)[key] ?? ''
    if (typeof av === 'number' && typeof bv === 'number')
      return dir === 'desc' ? bv - av : av - bv
    return dir === 'desc'
      ? String(bv).localeCompare(String(av))
      : String(av).localeCompare(String(bv))
  })
  const toggle = (k: string) => {
    if (k === key) setDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setKey(k); setDir('asc') }
  }
  return { sorted, sortKey: key, sortDir: dir, toggle }
}

function SortTh({ label, col, currentKey, dir, onClick, style }: {
  label: string; col: string; currentKey: string; dir: 'asc'|'desc'; onClick: () => void; style?: React.CSSProperties
}) {
  const active = col === currentKey
  return (
    <th onClick={onClick} style={{ cursor: 'pointer', userSelect: 'none', ...style }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: active ? 'var(--accent-teal)' : undefined, transition: 'color 150ms' }}>
        {label}
        <span style={{ fontSize: 8, opacity: active ? 1 : 0.3 }}>{active ? (dir === 'desc' ? '▼' : '▲') : '⇅'}</span>
      </span>
    </th>
  )
}

// ── Expanded detail panel ─────────────────────────────────────────────────────
function DetailPanel({ facility, detail, loading: detailLoading }: { facility: Facility; detail?: FacilityDetail; loading: boolean }) {
  const clean = (v: unknown) => v != null && v !== '' && v !== 'null' && v !== 'None' && v !== 'undefined'
  const d = detail

  const addressStr = d ? [d.address_line1, d.address_line2, d.address_line3, d.address_city, d.address_state_or_region, d.address_zip_or_postcode]
    .filter(clean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ') : ''

  const phonesRaw = d?.phone_numbers?.length ? d.phone_numbers : d?.official_phone ? [d.official_phone] : []
  const phones = (Array.isArray(phonesRaw) ? phonesRaw : [phonesRaw]).map(p => String(p).trim()).filter(Boolean)

  const deserColor = DESERT_COLOR(facility.medical_desert_score ?? 0)

  const counts = [
    { label: 'Procedures',    value: d?.procedure_count  ?? facility.procedure_count,  color: '#38BDF8', icon: '📋' },
    { label: 'Equipment',     value: d?.equipment_count  ?? facility.equipment_count,   color: '#8B7CF7', icon: '🔧' },
    { label: 'Capabilities',  value: d?.capability_count,                               color: '#00D4B1', icon: '⚡' },
    { label: 'Specialties',   value: d?.specialty_count,                                color: '#FFB600', icon: '🎓' },
    { label: 'Doctors',       value: facility.number_doctors_int,                       color: '#38BDF8', icon: '👨‍⚕️' },
    { label: 'Beds',          value: facility.capacity_int,                             color: '#A78BFA', icon: '🛏️' },
  ].filter(c => c.value != null && c.value !== 0)

  const riskDims = [
    { label: 'Desert Score',   value: facility.medical_desert_score,     color: deserColor },
    { label: 'Data Completeness', value: facility.data_completeness_score, color: '#4ADE80' },
    { label: 'Anomaly Flags',  value: (facility.total_stat_anomalies ?? 0) / 10, color: '#FF4E4E', raw: facility.total_stat_anomalies },
  ].filter(d => d.value != null)

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(10,15,38,0.97), rgba(6,9,26,0.99))',
      borderBottom: '2px solid var(--bg-border)',
      animation: 'expandDown 220ms cubic-bezier(0.34,1.56,0.64,1) both',
      overflow: 'hidden',
    }}>
      {detailLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 24px', color: 'var(--text-muted)', fontSize: 13 }}>
          <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
          Loading facility details…
        </div>
      ) : (
        <div style={{ padding: '18px 22px' }}>
          {/* Header */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16,
            padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--bg-border)',
            alignItems: 'center',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: 'var(--text-primary)' }}>{facility.name}</div>
              {d?.organizationdescription && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, maxWidth: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.organizationdescription}
                </div>
              )}
            </div>
            {facility.mds_label && (
              <span style={{
                marginLeft: 'auto', fontSize: 10, padding: '3px 10px', borderRadius: 999,
                background: `${deserColor}18`, color: deserColor, border: `1px solid ${deserColor}30`,
                fontWeight: 700, fontFamily: 'var(--font-display)',
              }}>{facility.mds_label}</span>
            )}
            {d?.year_established && d.year_established.toString().toLowerCase() !== 'null' && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>🏗️ Est. {d.year_established}</span>
            )}
          </div>

          {/* Count mini-cards */}
          {counts.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {counts.map(c => (
                <StatMiniCard key={c.label} icon={c.icon} label={c.label} value={c.value!} color={c.color} />
              ))}
            </div>
          )}

          {/* Main grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            {/* Contact & Address */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--bg-border)' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontFamily: 'var(--font-display)' }}>
                📍 Location & Contact
              </div>
              {addressStr && (
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 8, padding: '7px 9px', background: 'var(--bg-card)', borderRadius: 7, border: '1px solid var(--bg-border)' }}>
                  {addressStr}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {phones.map((p, i) => (
                  <a key={i} href={`tel:${p.replace(/\s+/g,'')}`} style={{ fontSize: 11, color: '#38BDF8', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}>
                    📞 {p}
                  </a>
                ))}
                {d?.email && <a href={`mailto:${d.email}`} style={{ fontSize: 11, color: 'var(--accent-teal)', textDecoration: 'none' }}>✉ {d.email}</a>}
                {d?.official_website && (
                  <a href={d.official_website.startsWith('http') ? d.official_website : `https://${d.official_website}`}
                    target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent-teal)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    🌐 {d.official_website}
                  </a>
                )}
              </div>
            </div>

            {/* Capabilities */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--bg-border)' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontFamily: 'var(--font-display)' }}>
                ⚡ Capabilities
              </div>
              <CapabilityChips facility={facility} max={99} />
              {d?.capability_enriched && d.capability_enriched.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Enriched Capabilities</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {d.capability_enriched.slice(0, 8).map((cap, i) => (
                      <div key={i} style={{ fontSize: 10.5, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ color: '#8B7CF7', flexShrink: 0 }}>✓</span>
                        {cap}
                      </div>
                    ))}
                    {d.capability_enriched.length > 8 && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>+{d.capability_enriched.length - 8} more</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Specialties */}
            {(d?.specialties_enriched?.length || 0) > 0 && (
              <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--bg-border)' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontFamily: 'var(--font-display)' }}>
                  🎓 Specialties ({d!.specialties_enriched!.length})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 10px' }}>
                  {d!.specialties_enriched!.map((spec, i) => (
                    <div key={i} style={{ fontSize: 10.5, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                      <span style={{ color: 'var(--accent-teal)', flexShrink: 0, fontSize: 8 }}>●</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spec.replace(/_/g,' ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risk & Anomaly */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--bg-border)' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontFamily: 'var(--font-display)' }}>
                📊 Scores & Risk
              </div>
              {riskDims.map(dim => (
                <div key={dim.label} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{dim.label}</span>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: dim.color, fontWeight: 700 }}>
                      {dim.raw !== undefined ? dim.raw : `${((dim.value ?? 0) * 100).toFixed(0)}%`}
                    </span>
                  </div>
                  <div style={{ height: 4, borderRadius: 999, background: 'var(--bg-border)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 999, width: `${Math.min((dim.value ?? 0) * 100, 100)}%`,
                      background: dim.color, boxShadow: `0 0 5px ${dim.color}50`,
                      transition: 'width 700ms cubic-bezier(0.34,1.56,0.64,1)',
                    }} />
                  </div>
                </div>
              ))}
              {/* Anomaly info */}
              {((facility.total_stat_anomalies ?? 0) > 0 || d?.anomaly_risk_level) && (
                <div style={{
                  marginTop: 10, padding: '8px 10px', borderRadius: 8,
                  background: 'rgba(255,59,59,0.06)', border: '1px solid rgba(255,59,59,0.18)',
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#FF4E4E', marginBottom: 4 }}>
                    ⚠️ {facility.total_stat_anomalies ?? 0} Anomaly Flag{(facility.total_stat_anomalies ?? 0) !== 1 ? 's' : ''}
                    {d?.anomaly_risk_level && <span style={{ marginLeft: 6, fontWeight: 500 }}>· Risk: {d.anomaly_risk_level}</span>}
                  </div>
                  {d?.llm_priority_action && (
                    <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      → {d.llm_priority_action}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Description */}
            {(d?.description || d?.organizationdescription) && (
              <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--bg-border)', gridColumn: 'span 2' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'var(--font-display)' }}>
                  📖 Description
                </div>
                {d?.description && <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, fontStyle: 'italic' }}>"{d.description}"</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pagination ────────────────────────────────────────────────────────────────
function Pagination({ page, limit, total, onChange }: { page: number; limit: number; total: number; onChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / limit)
  const window = Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
    if (totalPages <= 7) return i
    if (page < 4) return i
    if (page > totalPages - 5) return totalPages - 7 + i
    return page - 3 + i
  })
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Showing <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{page * limit + 1}–{Math.min((page + 1) * limit, total)}</strong>{' '}
        of <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{total.toLocaleString()}</strong>
      </span>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {[
          { label: '←', action: () => onChange(Math.max(0, page - 1)), disabled: page === 0 },
          ...window.map(p => ({ label: String(p + 1), action: () => onChange(p), active: p === page })),
          { label: '→', action: () => onChange(Math.min(totalPages - 1, page + 1)), disabled: page >= totalPages - 1 },
        ].map((btn, i) => (
          <button key={i} onClick={btn.action} disabled={(btn as any).disabled} style={{
            padding: '6px 11px', borderRadius: 8, border: `1px solid ${(btn as any).active ? 'rgba(0,212,177,0.5)' : 'var(--bg-border)'}`,
            background: (btn as any).active ? 'rgba(0,212,177,0.12)' : 'var(--bg-card)',
            color: (btn as any).active ? 'var(--accent-teal)' : (btn as any).disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
            cursor: (btn as any).disabled ? 'not-allowed' : 'pointer', fontSize: 12,
            fontFamily: (btn as any).active ? 'var(--font-display)' : 'var(--font-body)',
            fontWeight: (btn as any).active ? 800 : 400,
            opacity: (btn as any).disabled ? 0.4 : 1, transition: 'all 150ms ease', minWidth: 34,
          }}>{btn.label}</button>
        ))}
      </div>
    </div>
  )
}

// ── Card view for single facility ─────────────────────────────────────────────
function FacilityCard({ facility, isOpen, onToggle, detail, detailLoading }: {
  facility: Facility; isOpen: boolean; onToggle: () => void
  detail?: FacilityDetail; detailLoading: boolean
}) {
  const deserColor = DESERT_COLOR(facility.medical_desert_score ?? 0)
  return (
    <div style={{
      background: 'var(--bg-card)', border: `1px solid ${isOpen ? 'rgba(0,212,177,0.35)' : 'var(--bg-border)'}`,
      borderRadius: 14, overflow: 'hidden', transition: 'all 200ms ease',
      boxShadow: isOpen ? '0 8px 24px rgba(0,212,177,0.12)' : undefined,
      animation: 'scaleIn 200ms both',
    }}>
      <div
        style={{
          padding: '12px 14px',
          background: `linear-gradient(135deg, ${deserColor}0d, transparent)`,
          borderBottom: `1px solid ${deserColor}18`,
          cursor: 'pointer',
        }}
        onClick={onToggle}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {facility.name}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {facility.region_normalised && <span>{facility.region_normalised}</span>}
              {facility.city_clean && <><span>·</span><span>{facility.city_clean}</span></>}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            <span className={`badge ${facility.is_hospital ? 'badge-hospital' : facility.is_ngo ? 'badge-ngo' : 'badge-clinic'}`} style={{ fontSize: 9 }}>
              {facility.facility_type_clean || (facility.is_hospital ? 'Hospital' : facility.is_ngo ? 'NGO' : 'Clinic')}
            </span>
            {facility.mds_label && (
              <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, background: `${deserColor}18`, color: deserColor, border: `1px solid ${deserColor}30`, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                {facility.mds_label}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Score row */}
      <div style={{ padding: '8px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {[
          { label: 'Desert Score', value: facility.medical_desert_score, color: deserColor },
          { label: 'Completeness', value: facility.data_completeness_score, color: '#4ADE80' },
        ].map(s => s.value ? (
          <div key={s.label} style={{ padding: '5px 7px', borderRadius: 7, background: `${s.color}0d`, border: `1px solid ${s.color}20` }}>
            <div style={{ fontSize: 8.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{s.label}</div>
            <ScoreBar score={s.value} color={s.color} />
          </div>
        ) : null)}
      </div>

      {/* Capabilities */}
      <div style={{ padding: '0 14px 10px' }}>
        <CapabilityChips facility={facility} max={4} />
      </div>

      <div style={{
        padding: '7px 14px', borderTop: '1px solid var(--bg-border)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 600, color: isOpen ? 'var(--accent-teal)' : 'var(--text-muted)',
        fontFamily: 'var(--font-display)', transition: 'all 150ms ease',
        background: isOpen ? 'rgba(0,212,177,0.04)' : 'transparent',
      }}
      onClick={onToggle}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = isOpen ? 'var(--accent-teal)' : 'var(--text-muted)'}
      >
        {isOpen ? '▲ Hide Details' : '▼ Show Details'}
      </div>
      {isOpen && <DetailPanel facility={facility} detail={detail} loading={detailLoading} />}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FacilityExplorer() {
  const [items,       setItems]       = useState<Facility[]>([])
  const [total,       setTotal]       = useState(0)
  const [regions,     setRegions]     = useState<string[]>([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [regionFilter,setRegionFilter]= useState('')
  const [typeFilter,  setTypeFilter]  = useState('')
  const [volunteerOnly,  setVolunteerOnly]   = useState(false)
  const [hasEmergency,   setHasEmergency]    = useState<boolean | undefined>()
  const [hasICU,         setHasICU]          = useState<boolean | undefined>()
  const [hasSurgery,     setHasSurgery]      = useState<boolean | undefined>()
  const [hasRadiology,   setHasRadiology]    = useState<boolean | undefined>()
  const [hasPediatrics,  setHasPediatrics]   = useState<boolean | undefined>()
  const [hasObstetrics,  setHasObstetrics]   = useState<boolean | undefined>()
  const [page,        setPage]        = useState(0)
  const [openId,      setOpenId]      = useState<string | null>(null)
  const [detailCache, setDetailCache] = useState<Record<string, FacilityDetail>>({})
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({})
  const [viewMode,    setViewMode]    = useState<'table'|'cards'>('table')
  const [statsOpen,   setStatsOpen]   = useState(true)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, unknown> = { limit, offset: page * limit }
      if (debouncedSearch)  params.search         = debouncedSearch
      if (regionFilter)     params.region         = regionFilter
      if (typeFilter)       params.facility_type  = typeFilter
      if (volunteerOnly)    params.volunteer       = true
      if (hasEmergency !== undefined)  params.has_emergency  = hasEmergency
      if (hasSurgery   !== undefined)  params.has_surgery    = hasSurgery
      if (hasICU       !== undefined)  params.has_icu        = hasICU
      if (hasRadiology !== undefined)  params.has_radiology  = hasRadiology
      if (hasPediatrics !== undefined) params.has_pediatrics = hasPediatrics
      if (hasObstetrics !== undefined) params.has_obstetrics = hasObstetrics
      const { items, total } = await getFacilities(params)
      setItems(items); setTotal(total)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [debouncedSearch, regionFilter, typeFilter, volunteerOnly, hasEmergency, hasSurgery, hasICU, hasRadiology, hasPediatrics, hasObstetrics, page])

  useEffect(() => { getRegions().then(setRegions) }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [debouncedSearch, regionFilter, typeFilter, volunteerOnly, hasEmergency, hasSurgery, hasICU, hasRadiology, hasPediatrics, hasObstetrics])

  const ensureDetail = useCallback(async (id: string) => {
    if (!id || detailCache[id] || detailLoading[id]) return
    setDetailLoading(s => ({ ...s, [id]: true }))
    try {
      const d = await getFacilityDetail(id)
      setDetailCache(s => ({ ...s, [id]: d }))
    } catch (e) { console.error(e) }
    finally { setDetailLoading(s => ({ ...s, [id]: false })) }
  }, [detailCache, detailLoading])

  const handleSearch = (val: string) => {
    setSearch(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(val), 320)
  }

  const clearAll = () => {
    setSearch(''); setDebouncedSearch(''); setRegionFilter(''); setTypeFilter('')
    setVolunteerOnly(false); setHasEmergency(undefined); setHasSurgery(undefined)
    setHasICU(undefined); setHasRadiology(undefined); setHasPediatrics(undefined); setHasObstetrics(undefined)
    setPage(0)
  }

  const { sorted, sortKey, sortDir, toggle } = useSortable(items)

  const activeFilters = [regionFilter, typeFilter, volunteerOnly, hasEmergency !== undefined, hasSurgery !== undefined, hasICU !== undefined, hasRadiology !== undefined, hasPediatrics !== undefined, hasObstetrics !== undefined].filter(Boolean).length

  // Quick stats from current page
  const hospitals  = items.filter(f => f.is_hospital).length
  const ngos       = items.filter(f => f.is_ngo).length
  const clinics    = items.filter(f => f.is_clinic).length
  const withEmerg  = items.filter(f => f.has_emergency_medicine).length
  const withICU    = items.filter(f => f.has_icu).length
  const withSurg   = items.filter(f => f.has_surgery).length
  const volunteers = items.filter(f => f.accepts_volunteers_bool).length

  const CAPABILITY_TOGGLES = [
    { state: volunteerOnly,   set: () => setVolunteerOnly(v => !v),                                 label: '🤝 Volunteers', color: '#4ADE80' },
    { state: hasEmergency===true, set: () => setHasEmergency(h => h===true ? undefined : true),    label: '🚨 Emergency',  color: '#FF4E4E' },
    { state: hasSurgery===true,   set: () => setHasSurgery(h => h===true ? undefined : true),      label: '🔪 Surgery',    color: '#38BDF8' },
    { state: hasICU===true,       set: () => setHasICU(h => h===true ? undefined : true),          label: '🫀 ICU',        color: '#FF7423' },
    { state: hasRadiology===true, set: () => setHasRadiology(h => h===true ? undefined : true),    label: '🩻 Radiology',  color: '#8B7CF7' },
    { state: hasPediatrics===true,set: () => setHasPediatrics(h => h===true ? undefined : true),   label: '🧒 Pediatrics', color: '#00D4B1' },
    { state: hasObstetrics===true,set: () => setHasObstetrics(h => h===true ? undefined : true),   label: '👶 Obstetrics', color: '#F472B6' },
  ]

  return (
    <div className="page-body" style={{ maxWidth: 1600, margin: '0 auto' }}>
      {/* ── Header ── */}
      <div className="page-header">
        <h1>Facility Explorer</h1>
        <p>
          Browsing{' '}
          <strong style={{ color: 'var(--accent-teal)', fontFamily: 'var(--font-display)' }}>
            {total.toLocaleString()}
          </strong>{' '}
          facilities — filter by region, type, specialty, or volunteer status
        </p>
      </div>

      {/* ── Quick stats bar (collapsible) ── */}
      <div style={{ marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 14, overflow: 'hidden' }}>
        <button
          onClick={() => setStatsOpen(v => !v)}
          style={{
            width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 10, fontWeight: 800, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-display)',
          }}
        >
          <span>📊 Quick Stats — Current Page</span>
          <span style={{ transition: 'transform 200ms', transform: statsOpen ? 'rotate(180deg)' : 'none', fontSize: 8 }}>▼</span>
        </button>
        {statsOpen && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: 8, padding: '4px 12px 12px',
            animation: 'fadeIn 150ms both',
          }}>
            {[
              { icon: '🏥', label: 'Hospitals',  value: hospitals,  color: '#38BDF8' },
              { icon: '🩺', label: 'Clinics',    value: clinics,    color: '#00D4B1' },
              { icon: '🤝', label: 'NGOs',       value: ngos,       color: '#8B7CF7' },
              { icon: '🚨', label: 'Emergency',  value: withEmerg,  color: '#FF4E4E' },
              { icon: '🫀', label: 'ICU',        value: withICU,    color: '#FF7423' },
              { icon: '🔪', label: 'Surgery',    value: withSurg,   color: '#38BDF8' },
              { icon: '👥', label: 'Volunteers', value: volunteers, color: '#4ADE80' },
            ].map(s => (
              <StatMiniCard key={s.label} icon={s.icon} label={s.label} value={s.value} color={s.color} />
            ))}
          </div>
        )}
      </div>

      {/* ── Filter bar ── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14,
        padding: '12px 14px', background: 'var(--bg-card)',
        border: '1px solid var(--bg-border)', borderRadius: 12,
      }}>
        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '7px 12px', borderRadius: 9,
          border: `1px solid ${search ? 'rgba(0,212,177,0.5)' : 'var(--bg-border)'}`,
          background: 'var(--bg-input)',
          flex: '1 1 200px', maxWidth: 280,
          transition: 'all 180ms ease',
          boxShadow: search ? '0 0 0 2px rgba(0,212,177,0.12)' : 'none',
        }}>
          <span style={{ opacity: 0.5, flexShrink: 0 }}>🔍</span>
          <input
            type="text" placeholder="Search by name, city…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 11, width: '100%' }}
          />
          {search && <span onClick={() => handleSearch('')} style={{ cursor: 'pointer', opacity: 0.5, fontSize: 13, flexShrink: 0 }}>✕</span>}
        </div>

        <select className="filter-select" value={regionFilter} onChange={e => { setRegionFilter(e.target.value); setPage(0) }} style={{ flex: '1 1 140px', maxWidth: 180 }}>
          <option value="">All Regions</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        <select className="filter-select" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(0) }} style={{ flex: '1 1 130px', maxWidth: 170 }}>
          <option value="">All Types</option>
          <option value="Hospital">🏥 Hospital</option>
          <option value="Clinic">🩺 Clinic</option>
          <option value="NGO">🤝 NGO</option>
          <option value="Pharmacy">💊 Pharmacy</option>
          <option value="Health Centre">🏘️ Health Centre</option>
        </select>

        {/* Capability toggles */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flex: '1 1 auto' }}>
          {CAPABILITY_TOGGLES.map(t => (
            <ToggleChip key={t.label} active={!!t.state} label={t.label} color={t.color} onClick={t.set} />
          ))}
        </div>

        {/* View mode */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bg-border)', flexShrink: 0 }}>
          {(['table','cards'] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)} style={{
              padding: '6px 10px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
              fontFamily: 'var(--font-display)',
              background: viewMode === m ? 'rgba(139,124,247,0.25)' : 'var(--bg-card)',
              color: viewMode === m ? '#8B7CF7' : 'var(--text-muted)',
              transition: 'all 150ms ease',
            }}>
              {m === 'table' ? '≡' : '⊞'} {m === 'table' ? 'Table' : 'Cards'}
            </button>
          ))}
        </div>

        {activeFilters > 0 && (
          <button onClick={clearAll} style={{
            padding: '6px 13px', borderRadius: 999, fontSize: 11, fontWeight: 700,
            fontFamily: 'var(--font-display)', cursor: 'pointer', flexShrink: 0,
            border: '1px solid rgba(255,78,78,0.3)', background: 'rgba(255,78,78,0.08)', color: '#FF6B6B',
          }}>
            ✕ Clear {activeFilters}
          </button>
        )}
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /><span>Loading facilities…</span></div>
      ) : items.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          color: 'var(--text-muted)', fontSize: 14,
          background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--bg-border)',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏥</div>
          No facilities match your filters.
          <div><button onClick={clearAll} style={{
            marginTop: 12, padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
            background: 'rgba(0,212,177,0.1)', color: 'var(--accent-teal)',
            border: '1px solid rgba(0,212,177,0.3)', fontSize: 12, fontWeight: 600,
          }}>Clear all filters</button></div>
        </div>
      ) : viewMode === 'table' ? (
        /* ── Table view ── */
        <>
          <div style={{ borderRadius: 14, border: '1px solid var(--bg-border)', overflowX: 'auto', overflowY: 'visible' }}>
            <table className="data-table" style={{ minWidth: 1000 }}>
              <thead>
                <tr>
                  <SortTh label="Name"       col="name"                   currentKey={sortKey} dir={sortDir} onClick={() => toggle('name')} />
                  <SortTh label="Region"     col="region_normalised"      currentKey={sortKey} dir={sortDir} onClick={() => toggle('region_normalised')} />
                  <th>Type</th>
                  <SortTh label="City"       col="city_clean"             currentKey={sortKey} dir={sortDir} onClick={() => toggle('city_clean')} />
                  <SortTh label="Procedures" col="procedure_count"        currentKey={sortKey} dir={sortDir} onClick={() => toggle('procedure_count')} style={{ textAlign: 'center' }} />
                  <SortTh label="Equipment"  col="equipment_count"        currentKey={sortKey} dir={sortDir} onClick={() => toggle('equipment_count')} style={{ textAlign: 'center' }} />
                  <th>Capabilities</th>
                  <SortTh label="Flags"      col="total_stat_anomalies"   currentKey={sortKey} dir={sortDir} onClick={() => toggle('total_stat_anomalies')} style={{ textAlign: 'center' }} />
                  <SortTh label="Desert Score" col="medical_desert_score" currentKey={sortKey} dir={sortDir} onClick={() => toggle('medical_desert_score')} />
                  <SortTh label="Completeness" col="data_completeness_score" currentKey={sortKey} dir={sortDir} onClick={() => toggle('data_completeness_score')} />
                  <th style={{ width: 80 }}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((f, i) => (
                  <Fragment key={f.unique_id || i}>
                    <tr style={{
                      animationDelay: `${Math.min(i, 25) * 14}ms`,
                      background: openId === f.unique_id ? 'rgba(0,212,177,0.04)' : undefined,
                      borderLeft: openId === f.unique_id ? '3px solid var(--accent-teal)' : '3px solid transparent',
                      transition: 'background 150ms, border-color 150ms',
                    }}>
                      <td>
                        <div style={{ color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.name}
                        </div>
                        {f.organization_type_clean && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{f.organization_type_clean}</div>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: 11.5 }}>{f.region_normalised}</td>
                      <td>
                        <span className={`badge ${f.is_hospital ? 'badge-hospital' : f.is_ngo ? 'badge-ngo' : 'badge-clinic'}`}>
                          {f.facility_type_clean || (f.is_hospital ? 'Hospital' : f.is_ngo ? 'NGO' : 'Clinic')}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{f.city_clean || '—'}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-secondary)', fontSize: 13 }}>{f.procedure_count ?? '—'}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-secondary)', fontSize: 13 }}>{f.equipment_count ?? '—'}</td>
                      <td><CapabilityChips facility={f} max={3} /></td>
                      <td style={{ textAlign: 'center' }}>
                        {(f.total_stat_anomalies ?? 0) > 0 ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 26, height: 26, borderRadius: 7,
                            background: (f.total_stat_anomalies ?? 0) > 2 ? 'rgba(255,59,59,0.12)' : 'rgba(255,182,0,0.1)',
                            border: `1px solid ${(f.total_stat_anomalies ?? 0) > 2 ? 'rgba(255,59,59,0.25)' : 'rgba(255,182,0,0.2)'}`,
                            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 11,
                            color: (f.total_stat_anomalies ?? 0) > 2 ? '#FF3B3B' : '#FFB600',
                          }}>{f.total_stat_anomalies}</span>
                        ) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>0</span>}
                      </td>
                      <td style={{ minWidth: 130 }}>
                        {(f.medical_desert_score ?? 0) > 0
                          ? <ScoreBar score={f.medical_desert_score!} />
                          : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ minWidth: 110 }}>
                        {(f.data_completeness_score ?? 0) > 0
                          ? <ScoreBar score={f.data_completeness_score!} color="#00D4B1" />
                          : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                      </td>
                      <td>
                        <button
                          onClick={async () => {
                            const id = f.unique_id
                            if (openId === id) { setOpenId(null) }
                            else { setOpenId(id); await ensureDetail(id) }
                          }}
                          style={{
                            padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                            fontFamily: 'var(--font-display)', transition: 'all 150ms ease',
                            border: `1px solid ${openId === f.unique_id ? 'rgba(0,212,177,0.5)' : 'var(--bg-border)'}`,
                            background: openId === f.unique_id ? 'rgba(0,212,177,0.12)' : 'var(--bg-card)',
                            color: openId === f.unique_id ? 'var(--accent-teal)' : 'var(--text-secondary)',
                          }}
                        >
                          {openId === f.unique_id ? '▲ Hide' : '▼ Detail'}
                        </button>
                      </td>
                    </tr>

                    {openId === f.unique_id && (
                      <tr key={`${f.unique_id}-detail`}>
                        <td colSpan={11} style={{ padding: 0 }}>
                          <DetailPanel
                            facility={f}
                            detail={detailCache[f.unique_id || '']}
                            loading={detailLoading[f.unique_id || ''] ?? false}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} limit={limit} total={total} onChange={setPage} />
        </>
      ) : (
        /* ── Card view ── */
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
          }}>
            {sorted.map((f, i) => (
              <div key={f.unique_id || i} style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }}>
                <FacilityCard
                  facility={f}
                  isOpen={openId === f.unique_id}
                  onToggle={async () => {
                    if (openId === f.unique_id) { setOpenId(null) }
                    else { setOpenId(f.unique_id); await ensureDetail(f.unique_id) }
                  }}
                  detail={detailCache[f.unique_id || '']}
                  detailLoading={detailLoading[f.unique_id || ''] ?? false}
                />
              </div>
            ))}
          </div>
          <Pagination page={page} limit={limit} total={total} onChange={setPage} />
        </>
      )}

      <style>{`
        @keyframes expandDown {
          from { opacity: 0; max-height: 0; transform: translateY(-8px); }
          to   { opacity: 1; max-height: 2000px; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.94) translateY(6px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes fadeInLeft {
          from { opacity: 0; transform: translateX(-10px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}