// src/pages/FacilityExplorer.tsx — Enhanced with rich filters, animated chips, and polished table
import { useEffect, useState, useCallback, Fragment } from 'react'
import { getFacilities, getRegions, getFacilityDetail, type Facility, type FacilityDetail } from '../api/client'

const CAPABILITY_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  has_emergency_medicine: { label: 'Emergency', icon: '🚨', color: '#FF4E4E' },
  has_surgery: { label: 'Surgery', icon: '🔪', color: '#38BDF8' },
  has_obstetrics: { label: 'Obstetrics', icon: '👶', color: '#8B7CF7' },
  has_pediatrics: { label: 'Pediatrics', icon: '🧒', color: '#00D4B1' },
  has_icu: { label: 'ICU', icon: '🫀', color: '#FF7423' },
  has_radiology: { label: 'Radiology', icon: '🩻', color: '#38BDF8' },
  has_infectious_disease: { label: 'Infectious', icon: '🦠', color: '#FFB600' },
  has_mental_health: { label: 'Mental Health', icon: '🧠', color: '#8B7CF7' },
}

function CapabilityChips({ facility }: { facility: Facility }) {
  const chips = Object.entries(CAPABILITY_CONFIG)
    .filter(([key]) => Boolean((facility as unknown as Record<string, unknown>)[key]))
    .slice(0, 5)

  if (chips.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {chips.map(([key, cfg]) => (
        <span key={key} title={cfg.label} style={{
          fontSize: 11, padding: '2px 7px', borderRadius: 999,
          background: cfg.color + '14',
          color: cfg.color,
          border: `1px solid ${cfg.color}28`,
          fontWeight: 600,
          fontFamily: 'var(--font-display)',
          display: 'flex', alignItems: 'center', gap: 3,
        }}>
          <span style={{ fontSize: 10 }}>{cfg.icon}</span>
          {cfg.label}
        </span>
      ))}
    </div>
  )
}

function ScoreBar({ score, color }: { score: number; color?: string }) {
  const c = color || (score > 0.7 ? '#FF3B3B' : score > 0.4 ? '#FF7423' : '#00D4B1')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontWeight: 600, color: c, fontSize: 12, width: 38, flexShrink: 0,
      }}>
        {score.toFixed(2)}
      </span>
      <div style={{ flex: 1, height: 5, borderRadius: 999, background: 'var(--bg-border)', overflow: 'hidden', minWidth: 40 }}>
        <div style={{
          height: '100%', borderRadius: 999, width: `${score * 100}%`,
          background: `linear-gradient(90deg, ${c}cc, ${c})`,
          transition: 'width 600ms cubic-bezier(0.34,1.56,0.64,1)',
        }} />
      </div>
    </div>
  )
}

function ToggleChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 13px', borderRadius: 999, fontSize: 12, fontWeight: 600,
        fontFamily: 'var(--font-display)', cursor: 'pointer',
        border: active ? '1px solid rgba(255,78,78,0.4)' : '1px solid var(--bg-border)',
        background: active ? 'rgba(255,78,78,0.12)' : 'var(--bg-input)',
        color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
        transition: 'all 150ms ease',
        whiteSpace: 'nowrap',
      }}
    >
      {active ? '✓ ' : ''}{label}
    </button>
  )
}

export default function FacilityExplorer() {
  const [items, setItems] = useState<Facility[]>([])
  const [total, setTotal] = useState(0)
  const [regions, setRegions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [volunteerOnly, setVolunteerOnly] = useState(false)
  const [hasEmergency, setHasEmergency] = useState<boolean | undefined>()
  const [hasICU, setHasICU] = useState<boolean | undefined>()
  const [hasSurgery, setHasSurgery] = useState<boolean | undefined>()
  const [hasRadiology, setHasRadiology] = useState<boolean | undefined>()
  const [page, setPage] = useState(0)
  const limit = 50
  const [openId, setOpenId] = useState<string | null>(null)
  const [detailCache, setDetailCache] = useState<Record<string, FacilityDetail>>({})
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, unknown> = { limit, offset: page * limit }
      if (search) params.search = search
      if (regionFilter) params.region = regionFilter
      if (typeFilter) params.facility_type = typeFilter
      if (volunteerOnly) params.volunteer = true
      if (hasEmergency !== undefined) params.has_emergency = hasEmergency
      if (hasSurgery !== undefined) params.has_surgery = hasSurgery
      if (hasICU !== undefined) params.has_icu = hasICU
      if (hasRadiology !== undefined) params.has_radiology = hasRadiology
      const { items, total } = await getFacilities(params)
      setItems(items)
      setTotal(total)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [search, regionFilter, typeFilter, volunteerOnly, hasEmergency, hasSurgery, hasICU, hasRadiology, page])

  useEffect(() => { getRegions().then(setRegions) }, [])
  useEffect(() => { const t = setTimeout(() => { load() }, 0); return () => clearTimeout(t) }, [load])

  const ensureDetail = useCallback(async (id: string) => {
    if (!id) return
    if (detailCache[id]) return
    setDetailLoading(s => ({ ...s, [id]: true }))
    try {
      const d = await getFacilityDetail(id)
      setDetailCache(s => ({ ...s, [id]: d }))
    } catch (e) { console.error(e) }
    finally { setDetailLoading(s => ({ ...s, [id]: false })) }
  }, [detailCache])

  const activeFiltersCount = [regionFilter, typeFilter, volunteerOnly, hasEmergency !== undefined, hasSurgery !== undefined, hasICU !== undefined, hasRadiology !== undefined]
    .filter(Boolean).length
  const clean = (v: unknown) => v !== null && v !== undefined && v !== '' && v !== 'null' && v !== 'None' && v !== 'undefined'
  return (
    <div className="page-body">
      <div className="page-header">
        <h1>Facility Explorer</h1>
        <p>
          Browsing{' '}
          <strong style={{ color: 'var(--accent-teal)', fontFamily: 'var(--font-display)' }}>
            {total.toLocaleString()}
          </strong>
          {' '}facilities — filter by region, type, specialty, or volunteer status
        </p>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar mb-4">
        {/* Search */}
        <div className="search-bar" style={{ width: 240 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>🔍</span>
          <input
            placeholder="Search by name…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0,
            }}>×</button>
          )}
        </div>

        {/* Region select */}
        <select className="filter-select" value={regionFilter} onChange={e => { setRegionFilter(e.target.value); setPage(0) }}>
          <option value="">All Regions</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        {/* Type select */}
        <select className="filter-select" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(0) }}>
          <option value="">All Types</option>
          <option value="Hospital">Hospital</option>
          <option value="Clinic">Clinic</option>
          <option value="NGO">NGO</option>
          <option value="Pharmacy">Pharmacy</option>
          <option value="Health Centre">Health Centre</option>
        </select>

        {/* Toggle chips */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <ToggleChip active={volunteerOnly} label="🤝 Volunteers" onClick={() => { setVolunteerOnly(v => !v); setPage(0) }} />
          <ToggleChip
            active={hasEmergency === true}
            label="🚨 Emergency"
            onClick={() => { setHasEmergency(h => h === true ? undefined : true); setPage(0) }}
          />
          <ToggleChip
            active={hasSurgery === true}
            label="🔪 Surgery"
            onClick={() => { setHasSurgery(h => h === true ? undefined : true); setPage(0) }}
          />
          <ToggleChip
            active={hasICU === true}
            label="🛏️ ICU"
            onClick={() => { setHasICU(h => h === true ? undefined : true); setPage(0) }}
          />
          <ToggleChip
            active={hasRadiology === true}
            label="☢️ Radiology"
            onClick={() => { setHasRadiology(h => h === true ? undefined : true); setPage(0) }}
          />
        </div>

        {/* Clear all */}
        {activeFiltersCount > 0 && (
          <button onClick={() => { setRegionFilter(''); setTypeFilter(''); setVolunteerOnly(false); setHasEmergency(undefined); setHasSurgery(undefined); setHasICU(undefined); setHasRadiology(undefined); setPage(0) }}
            style={{
              marginLeft: 'auto', padding: '6px 13px', borderRadius: 999, fontSize: 12, fontWeight: 600,
              fontFamily: 'var(--font-display)', cursor: 'pointer',
              border: '1px solid rgba(255,78,78,0.3)', background: 'rgba(255,78,78,0.08)', color: '#FF6B6B',
            }}>
            × Clear {activeFiltersCount} filter{activeFiltersCount > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {loading ? (
        <div className="loading-center">
          <div className="spinner" />
          <span>Loading facilities…</span>
        </div>
      ) : (
        <>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Region</th>
                  <th>Type</th>
                  <th>City</th>
                  <th>Procedures</th>
                  <th>Equipment</th>
                  <th>Capabilities</th>
                  <th>Flags</th>
                  <th>Desert Score</th>
                  <th>Completeness</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((f, i) => (
                  <Fragment key={f.unique_id || i}>
                    <tr style={{ animationDelay: `${i * 15}ms` }}>
                      <td>
                        <div className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 13 }}>{f.name}</div>
                        {f.organization_type_clean && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{f.organization_type_clean}</div>
                        )}
                        {f.email && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                            <a href={`mailto:${f.email}`} style={{ color: 'inherit', textDecoration: 'none' }}>✉ {f.email}</a>
                          </div>
                        )}
                        {f.official_website && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                            <a href={f.official_website} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>🌐 {f.official_website}</a>
                          </div>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>{f.region_normalised}</td>
                      <td>
                        <span className={`badge ${f.is_hospital ? 'badge-hospital' : f.is_ngo ? 'badge-ngo' : 'badge-clinic'}`}>
                          {f.facility_type_clean || (f.is_hospital ? 'Hospital' : f.is_ngo ? 'NGO' : 'Clinic')}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{f.city_clean}</td>
                      <td style={{ textAlign: 'center' }}>{f.procedure_count ?? '—'}</td>
                      <td style={{ textAlign: 'center' }}>{f.equipment_count ?? '—'}</td>
                      <td style={{ textAlign: 'center' }}><CapabilityChips facility={f} /></td>
                      <td style={{ textAlign: 'center' }}>{f.total_stat_anomalies ?? 0}</td>
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
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button onClick={async () => { const id = f.unique_id; if (openId === id) { setOpenId(null) } else { setOpenId(id); await ensureDetail(id) } }}
                          style={{ color: "#ffffff", fontWeight: 700, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--bg-border)', background: 'var(--bg-card)', cursor: 'pointer' }}>
                          {openId === f.unique_id ? 'Hide' : 'Details'}
                        </button>
                      </td>
                    </tr>

                    {openId === f.unique_id && (
                      <tr key={`${f.unique_id}-detail`}>
                        <td colSpan={11} style={{ background: 'var(--bg-surface)', padding: 12 }}>
                          {detailLoading[f.unique_id || ''] ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                              Loading details…
                            </div>
                          ) : (
                            (() => {
                              const d = detailCache[f.unique_id || '']
                              return d ? (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                  <div>
                                    <div style={{ fontSize: 13, fontWeight: 800 }}>{d.name}</div>
                                    <div style={{ marginTop: 6, color: 'var(--text-secondary)' }}>{d.description || 'No description available.'}</div>
                                    <div style={{ marginTop: 8 }}>
                                      <strong>Address</strong>

                                      <div style={{ color: '#ba531b', marginTop: 6 }}>
                                        {[d.address_line1, d.address_line2, d.address_line3]
                                          .filter(clean)
                                          .join(', ')}
                                      </div>

                                      <div style={{ color: '#ba531b', marginTop: 4 }}>
                                        {[d.address_city, d.address_state_or_region, d.address_zip_or_postcode]
                                          .filter(clean)
                                          .join(', ')}
                                      </div>
                                    </div>
                                    <div style={{ marginTop: 8 }}>
                                      <strong>Contact</strong>
                                      <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        {d.phone_numbers && d.phone_numbers.length > 0 ? d.phone_numbers.map((p, idx) => (
                                          <a key={idx} href={`tel:${p}`} style={{ color: 'var(--text-accent)' }}>{p}</a>
                                        )) : <span style={{ color: 'var(--text-muted)' }}>No phone numbers</span>}
                                      </div>
                                      {d.email && <div style={{ marginTop: 6 }}><a style={{ color: '#ffd479' }} href={`mailto:${d.email}`}>{d.email}</a></div>}
                                      {d.official_website && <div style={{ marginTop: 6 }}><a href={d.official_website} style={{ color: '#ffd479' }} target="_blank" rel="noreferrer">{d.official_website}</a></div>}
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                      <div style={{ background: 'var(--bg-card)', padding: 10, borderRadius: 8 }}>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Procedures</div>
                                        <div style={{ fontSize: 16, fontWeight: 800 }}>{d.procedure_count ?? '—'}</div>
                                      </div>
                                      <div style={{ background: 'var(--bg-card)', padding: 10, borderRadius: 8 }}>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Equipment</div>
                                        <div style={{ fontSize: 16, fontWeight: 800 }}>{d.equipment_count ?? '—'}</div>
                                      </div>
                                      <div style={{ background: 'var(--bg-card)', padding: 10, borderRadius: 8 }}>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Capabilities</div>
                                        <div style={{ fontSize: 16, fontWeight: 800 }}>{d.capability_count ?? '—'}</div>
                                      </div>
                                      <div style={{ background: 'var(--bg-card)', padding: 10, borderRadius: 8 }}>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Specialties</div>
                                        <div style={{ fontSize: 16, fontWeight: 800 }}>{d.specialty_count ?? '—'}</div>
                                      </div>
                                    </div>

                                    <div style={{ marginTop: 12 }}>
                                      <strong>Anomalies & Flags</strong>
                                      <div style={{ marginTop: 8 }}>
                                        <div style={{ color: 'var(--text-muted)' }}>Total flags: <strong style={{ color: '#FF4E4E' }}>{d.total_anomaly_flags ?? d.total_stat_anomalies ?? 0}</strong></div>
                                        {d.anomaly_risk_level && <div style={{ marginTop: 6 }}>Risk level: <strong>{d.anomaly_risk_level}</strong></div>}
                                        {d.llm_priority_action && <div style={{ marginTop: 6 }}>Action: <em>{d.llm_priority_action}</em></div>}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div style={{ color: 'var(--text-muted)' }}>No details available.</div>
                              )
                            })()
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Showing{' '}
              <strong style={{ color: 'var(--text-primary)' }}>
                {page * limit + 1}–{Math.min((page + 1) * limit, total)}
              </strong>
              {' '}of{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{total.toLocaleString()}</strong>
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{
                  padding: '7px 18px', borderRadius: 8, border: '1px solid var(--bg-border)',
                  background: 'var(--bg-card)', color: 'var(--text-secondary)',
                  cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--font-body)',
                  transition: 'all 150ms ease',
                }}
              >← Prev</button>
              <span style={{
                padding: '7px 14px', fontSize: 12.5,
                color: 'var(--text-secondary)', background: 'var(--bg-surface)',
                borderRadius: 8, border: '1px solid var(--bg-border)',
                fontFamily: 'var(--font-display)', fontWeight: 700,
              }}>
                {page + 1}
              </span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={(page + 1) * limit >= total}
                style={{
                  padding: '7px 18px', borderRadius: 8, border: '1px solid var(--bg-border)',
                  background: 'var(--bg-card)', color: 'var(--text-secondary)',
                  cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--font-body)',
                  transition: 'all 150ms ease',
                }}
              >Next →</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}