// src/api/client.ts — complete API client with SSE streaming support
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// ── Type Definitions ──────────────────────────────────────────────────────────

export interface Facility {
  unique_id: string
  name: string
  region_normalised: string
  facility_type_clean: string
  city_clean: string
  organization_type_clean?: string
  latitude?: number
  longitude?: number
  number_doctors_int?: number
  capacity_int?: number
  data_completeness_score?: number
  medical_desert_score?: number
  desert_label?: string
  has_emergency_medicine?: boolean
  has_surgery?: boolean
  has_icu?: boolean
  has_obstetrics?: boolean
  has_pediatrics?: boolean
  has_radiology?: boolean
  has_infectious_disease?: boolean
  has_mental_health?: boolean
  is_hospital?: boolean
  is_clinic?: boolean
  is_ngo?: boolean
  is_public?: boolean
  is_private?: boolean
  accepts_volunteers_bool?: boolean
  email?: string
  official_website?: string
  procedure_count?: number
  equipment_count?: number
  capability_count?: number
  specialty_count?: number
  total_stat_anomalies?: number
  capability_is_valid?: boolean
  capability_confidence?: number
  color?: string
  specialties_enriched?: string[]
  idp_citations?: string[]
  mds_label?: string
}

export interface FacilityDetail extends Facility {
  phone_numbers?: string[]
  official_phone?: string
  procedure_enriched?: string[]
  equipment_enriched?: string[]
  capability_enriched?: string[]
  specialties_enriched?: string[]
  description?: string
  organizationdescription?: string
  address_line1?: string
  address_line2?: string
  address_line3?: string
  address_city?: string
  address_state_or_region?: string
  address_zip_or_postcode?: string
  year_established?: string
  source_url?: string
  // idp_citations?: string[]
  capability_anomalies?: string[]
  total_anomaly_flags?: number
  anomaly_risk_level?: string
  llm_priority_action?: string
  llm_data_quality_score?: number
  llm_clinical_assessment?: string
  llm_false_positive_reason?: string
  stat_anomaly_capability_inflation?: boolean
  stat_anomaly_hospital_no_doctors?: boolean
  stat_anomaly_clinic_claims_icu?: boolean
  stat_anomaly_ghost_facility?: boolean
  stat_anomaly_specialty_mismatch?: boolean
  stat_anomaly_procedure_breadth?: boolean
  enhanced_type_capability_mismatch?: boolean
  enhanced_ghost_hospital?: boolean
  enhanced_procedures_no_equipment?: boolean
  enhanced_low_idp_confidence?: boolean
  enhanced_suspicious_completeness?: boolean
  enhanced_icu_no_infrastructure?: boolean
}

export interface RegionalSummary {
  region_normalised: string
  total_facilities: number
  hospital_count: number
  clinic_count?: number
  ngo_count: number
  avg_doctors?: number
  total_doctors: number
  total_beds: number
  emergency_medicine_facilities?: number
  obstetrics_facilities?: number
  surgery_facilities?: number
  pediatrics_facilities?: number
  icu_facilities?: number
  infectious_disease_facilities?: number
  radiology_facilities?: number
  mental_health_facilities?: number
  missing_critical_specialties?: string[]
  critical_specialty_gap_count?: number
  recommended_actions?: string[]
  medical_desert_score?: number
  desert_label?: string
  region_centroid_lat?: number
  region_centroid_lon?: number
  rag_ready_count?: number
  total_region_anomalies?: number
  volunteer_facilities?: number
}

export interface DesertScore {
  region: string
  total_facilities: number
  hospital_count: number
  ngo_count?: number
  total_beds: number
  total_doctors: number
  population_estimate?: number
  facilities_per_100k?: number
  beds_per_10k?: number
  doctors_per_10k?: number
  critical_specialties_covered: number
  critical_specialties_missing?: string[]
  density_component?: number
  specialist_component?: number
  infrastructure_component?: number
  completeness_component?: number
  medical_desert_score: number
  mds_label: string
  centroid_lat?: number
  centroid_lon?: number
  recommended_actions?: string[]
  avg_data_completeness?: number
}

export interface AnomalyRecord {
  unique_id?: string
  name: string
  city_clean?: string
  region_normalised?: string
  facility_type_clean?: string
  facility_tier_label?: string
  service_maturity_label?: string
  latitude?: number
  longitude?: number
  number_doctors_int?: number
  capacity_int?: number
  // Core anomaly scoring
  total_anomaly_flags?: number
  composite_anomaly_score?: number
  anomaly_risk_level?: string
  // Ghost & data poverty
  ghost_probability_score?: number
  ghost_review_priority?: string
  data_poverty_flag?: boolean
  // Risk dimensions
  quality_risk_score?: number
  clinical_risk_score?: number
  operational_risk_score?: number
  integrity_risk_score?: number
  // Continuity
  continuity_risk_score?: number
  continuity_risk_flags?: string[]
  high_continuity_risk?: boolean
  // Readiness scores
  emergency_readiness_score?: number
  critical_care_score?: number
  service_richness_score?: number
  infrastructure_completeness_score?: number
  referral_complexity_score?: number
  healthcare_maturity_score?: number
  // LLM outputs
  llm_priority_action?: string
  llm_data_quality_score?: number
  llm_confirmed_anomaly_count?: number
  llm_anomaly_severity?: string
  llm_clinical_assessment?: string
  llm_false_positive_reason?: string
  llm_recommended_quality_category?: string
  // Stat anomaly flags
  stat_anomaly_capability_inflation?: boolean
  stat_anomaly_hospital_no_doctors?: boolean
  stat_anomaly_clinic_claims_icu?: boolean
  stat_anomaly_ghost_facility?: boolean
  stat_anomaly_procedure_breadth?: boolean
  stat_anomaly_specialty_mismatch?: boolean
  // Enhanced ML anomaly flags
  enhanced_type_capability_mismatch?: boolean
  enhanced_ghost_hospital?: boolean
  enhanced_procedures_no_equipment?: boolean
  enhanced_low_idp_confidence?: boolean
  enhanced_suspicious_completeness?: boolean
  enhanced_icu_no_infrastructure?: boolean
  enhanced_implausible_doctor_bed_ratio?: boolean
  enhanced_em_without_surgical_support?: boolean
  enhanced_high_quality_risk?: boolean
  enhanced_peer_capability_outlier?: boolean
  enhanced_maturity_infra_mismatch?: boolean
  enhanced_graph_dependency_gap?: boolean
  enhanced_richness_equipment_mismatch?: boolean
  // Peer / graph analysis
  capability_dependency_gaps?: string[]
  capability_graph_summary?: Record<string, unknown>
  peer_capability_zscore?: number
  peer_outlier_high_cap?: boolean
  peer_outlier_low_equip?: boolean
  quality_flag_taxonomy?: string
  // Data quality
  data_completeness_score?: number
  capability_confidence?: number
  capability_is_valid?: boolean
  medical_desert_score?: number
  desert_label?: string
  // Enriched lists (for problems/actions view)
  specialties_enriched?: string[]
  capability_enriched?: string[]
  procedure_enriched?: string[]
  capability_anomalies?: string[]
}

export interface FacilityStats {
  total_facilities: number
  hospitals: number
  clinics: number
  ngos: number
  volunteer_facilities: number
  regions_covered: number
  avg_completeness: number
  critical_desert_regions: number
  avg_desert_score: number
}

export interface StreamingChunk {
  chunk_type: 'thinking' | 'sql_result' | 'rag_result' | 'geo_result' |
  'anomaly_result' | 'desert_result' | 'medical_reasoning' |
  'planning' | 'ngo_result' | 'web_result' |
  'final_answer' | 'citations' | 'done' | 'error'
  content: string
  metadata?: Record<string, unknown>
  timestamp: string
}

export interface ChatHistoryEntry {
  id: string
  query: string
  answer: string
  query_type: string
  processing_time_s: number
  citations_count: number
  created_at: number
}

export interface CitationItem {
  id: number
  facility_name: string
  region: string
  city: string
  facility_type: string
  similarity_score: number
  source: string
  snippet: string
  desert_label: string
  unique_id: string
  idp_citations: string[]
}

export interface StepCitation {
  step_id: string
  step_name: string
  step_number: number
  confidence: number
  input_data: string
  output_data: string
  data_sources: string[]
  timestamp: number
}

export interface RegionalPriority {
  region_normalised: string
  // actual gold_regional_priority columns
  facility_count?: number
  avg_desert_score?: number
  avg_emergency_gap?: number
  avg_continuity_fragility?: number
  avg_anomaly_density?: number
  avg_ghost_density?: number
  avg_low_infra_density?: number
  avg_low_staff_density?: number
  avg_low_equipment_density?: number
  avg_low_maturity_density?: number
  critical_facility_count?: number
  high_risk_facility_count?: number
  high_continuity_risk_count?: number
  avg_emergency_readiness?: number
  avg_data_completeness?: number
  regional_priority_score?: number
  priority_tier?: string
  recommended_interventions?: string[]
}

export interface WebResult {
  title: string
  snippet: string
  url: string
  source: string
  timestamp?: number
}

export interface HealthStatus {
  status: 'healthy' | 'degraded'
  databricks_connected: boolean
  redis_connected: boolean
  faiss_loaded: boolean
  faiss_strategy: string
  uptime_seconds: number
  version: string
}

// ── HTTP Helper ────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<{ data: T; dataSource: string }> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${text || res.statusText}`)
  }
  const data = await res.json()
  const dataSource = res.headers.get('X-Data-Source') || 'databricks'
  return { data, dataSource }
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function getHealth(): Promise<HealthStatus> {
  const { data } = await apiFetch<HealthStatus>('/health')
  return data
}

// ── Facilities ─────────────────────────────────────────────────────────────────

export type FacilityFilterParams = {
  region?: string
  facility_type?: string
  search?: string
  volunteer?: boolean
  has_emergency?: boolean
  has_surgery?: boolean
  has_icu?: boolean
  has_obstetrics?: boolean
  has_pediatrics?: boolean
  has_radiology?: boolean
  has_infectious_disease?: boolean
  has_mental_health?: boolean
  desert_label?: string
  limit?: number
  offset?: number
}

export async function getFacilities(params: FacilityFilterParams = {}): Promise<{ total: number; items: Facility[]; dataSource: string }> {
  const qp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== null) qp.set(k, String(v))
  }
  const path = `/api/v1/facilities${qp.toString() ? '?' + qp.toString() : ''}`
  const { data, dataSource } = await apiFetch<{ total: number; items: Facility[] }>(path)
  return { ...data, dataSource }
}

export async function getFacilityStats(): Promise<{ data: FacilityStats; dataSource: string }> {
  const { data, dataSource } = await apiFetch<FacilityStats>('/api/v1/facilities/statistics')
  return { data, dataSource }
}

export async function getFacilitiesMap(params: { region?: string; facility_type?: string } = {}): Promise<{ data: GeoJSON.FeatureCollection; dataSource: string }> {
  const qp = new URLSearchParams()
  if (params.region) qp.set('region', params.region)
  if (params.facility_type) qp.set('facility_type', params.facility_type)
  const path = `/api/v1/facilities/map${qp.toString() ? '?' + qp.toString() : ''}`
  const { data, dataSource } = await apiFetch<GeoJSON.FeatureCollection>(path)
  return { data, dataSource }
}

export async function getFacilityDetail(uniqueId: string): Promise<FacilityDetail> {
  const { data } = await apiFetch<FacilityDetail>(`/api/v1/facilities/${uniqueId}`)
  return data
}

// ── Regions & Desert ───────────────────────────────────────────────────────────

export async function getRegions(): Promise<string[]> {
  const { data } = await apiFetch<{ regions: string[] }>('/api/v1/regions')
  return data.regions
}

export async function getRegionalSummary(): Promise<RegionalSummary[]> {
  const { data } = await apiFetch<RegionalSummary[]>('/api/v1/regions/summary')
  return data
}

export async function getDesertScores(): Promise<DesertScore[]> {
  const { data } = await apiFetch<DesertScore[]>('/api/v1/desert/scores')
  return data
}

export async function getSpecialtyGaps(): Promise<unknown[]> {
  const { data } = await apiFetch<unknown[]>('/api/v1/regions/specialty-gaps')
  return data
}

// ── Anomalies ──────────────────────────────────────────────────────────────────

export async function getAnomalies(params: { risk_level?: string; region?: string; limit?: number; offset?: number } = {}): Promise<{ total: number; items: AnomalyRecord[] }> {
  const qp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qp.set(k, String(v))
  }
  const { data } = await apiFetch<{ total: number; items: AnomalyRecord[] }>(
    `/api/v1/anomalies${qp.toString() ? '?' + qp.toString() : ''}`
  )
  return data
}

export async function getAnomalySummary(): Promise<Record<string, unknown>> {
  const { data } = await apiFetch<Record<string, unknown>>('/api/v1/anomalies/summary')
  return data
}

// ── Regional Priority ──────────────────────────────────────────────────────────

export async function getRegionalPriority(): Promise<{ data: RegionalPriority[]; dataSource: string }> {
  const { data, dataSource } = await apiFetch<RegionalPriority[]>('/api/v1/regions/priority')
  return { data, dataSource }
}

// ── Agent Streaming ────────────────────────────────────────────────────────────

export function createSSEStream(
  query: string,
  sessionId: string = 'default',
  onChunk: (chunk: StreamingChunk) => void,
  onDone: () => void,
  onError: (error: string) => void,
  webSearchEnabled: boolean = false,
): () => void {
  const controller = new AbortController()
  let done = false

  const run = async () => {
    try {
      const res = await fetch(`${BASE}/api/v1/agent/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, session_id: sessionId, stream: true, web_search_enabled: webSearchEnabled }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        onError(`HTTP ${res.status}: ${res.statusText}`)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (!done) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim()
            if (!jsonStr) continue
            try {
              const chunk: StreamingChunk = JSON.parse(jsonStr)
              onChunk(chunk)
              if (chunk.chunk_type === 'done' || chunk.chunk_type === 'error') {
                if (chunk.chunk_type === 'error') onError(chunk.content)
                done = true
                onDone()
                return
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }
      onDone()
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        onError(String(e))
      }
    }
  }

  run()
  return () => {
    done = true
    controller.abort()
  }
}

export async function getAgentSuggestions(): Promise<string[]> {
  const { data } = await apiFetch<{ suggestions: string[] }>('/api/v1/agent/suggestions')
  return data.suggestions
}

export async function getAgentHistory(sessionId: string, limit: number = 20): Promise<ChatHistoryEntry[]> {
  const qp = new URLSearchParams()
  if (sessionId) qp.set('session_id', sessionId)
  if (limit) qp.set('limit', String(limit))
  const { data } = await apiFetch<{ session_id: string; items: ChatHistoryEntry[] }>(
    `/api/v1/agent/history${qp.toString() ? '?' + qp.toString() : ''}`
  )
  return data.items || []
}

export async function clearAgentHistory(sessionId: string): Promise<void> {
  const qp = new URLSearchParams()
  if (sessionId) qp.set('session_id', sessionId)
  await apiFetch<{ session_id: string; cleared: boolean }>(
    `/api/v1/agent/history${qp.toString() ? '?' + qp.toString() : ''}`,
    { method: 'DELETE' }
  )
}

// ── Exports ────────────────────────────────────────────────────────────────────

export function exportFacilitiesUrl(params: { region?: string; facility_type?: string } = {}): string {
  const qp = new URLSearchParams()
  if (params.region) qp.set('region', params.region)
  if (params.facility_type) qp.set('facility_type', params.facility_type)
  return `${BASE}/api/v1/export/facilities${qp.toString() ? '?' + qp.toString() : ''}`
}

export function exportDesertUrl(): string {
  return `${BASE}/api/v1/export/desert-scores`
}

export function exportAnomaliesUrl(riskLevel?: string): string {
  return `${BASE}/api/v1/export/anomalies${riskLevel ? '?risk_level=' + riskLevel : ''}`
}
