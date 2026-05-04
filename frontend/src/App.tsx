// src/App.tsx — Enhanced with light/dark theme, animated nav, glassmorphic header
import { useEffect, useState, createContext, useContext, useRef } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import MapExplorer from './pages/MapExplorer'
import FacilityExplorer from './pages/FacilityExplorer'
import AnomalyReport from './pages/AnomalyReport'
import DesertAnalysis from './pages/DesertAnalysis'
import ChatAgent from './pages/ChatAgent'
import { getHealth, type HealthStatus } from './api/client'

// ── Theme Context ──────────────────────────────────────────────────────────
type Theme = 'dark' | 'light'
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'dark', toggle: () => {} })
export const useTheme = () => useContext(ThemeCtx)

// ── Toast Context ──────────────────────────────────────────────────────────
type ToastMsg = { id: string; type: 'live' | 'cache'; text: string }
const ToastCtx = createContext<(type: 'live' | 'cache', text: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

// ── Toast Container ─────────────────────────────────────────────────────────
function ToastContainer({ toasts }: { toasts: ToastMsg[] }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span style={{ fontSize: 14 }}>{t.type === 'live' ? '🔴' : '💾'}</span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

// ── Navigation config ───────────────────────────────────────────────────────
const NAV = [
  { to: '/',           icon: '📊', label: 'Dashboard',       section: 'ANALYTICS' },
  { to: '/agent',      icon: '🤖', label: 'AI Agent',        section: 'ANALYTICS' },
  { to: '/map',        icon: '🗺️',  label: 'Map Explorer',   section: 'EXPLORE'   },
  { to: '/facilities', icon: '🏥', label: 'Facilities',      section: 'EXPLORE'   },
  { to: '/desert',     icon: '🌵', label: 'Desert Analysis', section: 'INTELLIGENCE' },
  { to: '/anomalies',  icon: '⚠️', label: 'Anomaly Report',  section: 'INTELLIGENCE' },
]
const SECTIONS = ['ANALYTICS', 'EXPLORE', 'INTELLIGENCE']

// ── Health badge pills ──────────────────────────────────────────────────────
const HEALTH_PILLS = [
  { key: 'faiss_loaded',           label: 'RAG',   icon: '🔍', title: 'Semantic search ready' },
  { key: 'databricks_connected',   label: 'Live',  icon: '⚡', title: 'Live data connected'   },
  { key: 'redis_connected',        label: 'Cache', icon: '💾', title: 'Cache active'           },
]

// ── App Header ─────────────────────────────────────────────────────────────
function AppHeader({ health, onThemeToggle, theme }: {
  health: HealthStatus | null
  onThemeToggle: () => void
  theme: Theme
}) {
  const loc = useLocation()
  const page = NAV.find(n => n.to === loc.pathname)
  const prevPath = useRef(loc.pathname)

  useEffect(() => { prevPath.current = loc.pathname }, [loc.pathname])

  const dotClass = !health ? 'offline' : health.status === 'healthy' ? 'healthy' : 'degraded'
  const statusText = !health
    ? 'Connecting…'
    : health.status === 'healthy' ? 'All Systems Online' : 'Degraded'

  return (
    <header className="app-header">
      <div className="header-title">
        <h1 key={loc.pathname} style={{ animation: 'fadeInLeft 260ms both' }}>
          {page?.label || 'Healthcare Intelligence'}
        </h1>
        <p>Virtue Foundation Ghana — Programme Officer Intelligence Platform</p>
      </div>

      <div className="header-right">
        {/* Health micro-pills */}
        {health && (
          <div style={{ display: 'flex', gap: 6 }}>
            {HEALTH_PILLS.filter(p => (health as any)[p.key]).map(p => (
              <span
                key={p.key}
                title={p.title}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 999,
                  fontSize: 11, fontWeight: 600,
                  background: 'rgba(0,212,177,0.1)',
                  border: '1px solid rgba(0,212,177,0.18)',
                  color: 'var(--accent-teal)',
                  fontFamily: 'var(--font-display)',
                  letterSpacing: '0.04em',
                  animation: 'fadeIn 300ms both',
                }}
              >
                <span style={{ fontSize: 12 }}>{p.icon}</span>
                {p.label}
              </span>
            ))}
          </div>
        )}

        {/* Status */}
        <div className="status-pill">
          <span className={`status-dot ${dotClass}`} />
          <span style={{ fontSize: 12, fontWeight: 500 }}>{statusText}</span>
        </div>

        {/* Theme toggle */}
        <button
          className="theme-toggle"
          onClick={onThemeToggle}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>
    </header>
  )
}

// ── Sidebar ─────────────────────────────────────────────────────────────────
function AppSidebar() {
  const loc = useLocation()

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo" style={{ cursor: 'default' }}>
        <div className="sidebar-logo-icon">🏥</div>
        <div className="sidebar-logo-text">
          <h2>Virtue Foundation</h2>
          <span>Ghana Healthcare Intel</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        {SECTIONS.map(section => {
          const items = NAV.filter(n => n.section === section)
          return (
            <div key={section}>
              <div className="nav-section-label">{section}</div>
              {items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                  {/* Active indicator dot on right */}
                  {loc.pathname === item.to && (
                    <span style={{
                      marginLeft: 'auto',
                      width: 5, height: 5,
                      borderRadius: '50%',
                      background: 'var(--accent-primary)',
                      boxShadow: '0 0 6px var(--accent-primary)',
                      flexShrink: 0,
                    }} />
                  )}
                </NavLink>
              ))}
            </div>
          )
        })}
      </nav>

      {/* Footer data source */}
      <div className="sidebar-footer">
        <div className="datasource-label">Data Sources</div>
        <div className="datasource-name">Databricks Unity Catalog</div>
        <div className="datasource-sub">virtue_foundation.ghana</div>
        <div className="version">v1.0.0 · Hackathon Build</div>
      </div>
    </aside>
  )
}

// ── Route-level page wrapper (adds key-based re-animation) ─────────────────
function PageWrapper({ children }: { children: React.ReactNode }) {
  const loc = useLocation()
  return (
    <div key={loc.pathname} style={{ animation: 'fadeInUp 280ms cubic-bezier(0.34,1.56,0.64,1) both' }}>
      {children}
    </div>
  )
}

// ── App Content ─────────────────────────────────────────────────────────────
function AppContent({ theme, onThemeToggle }: { theme: Theme; onThemeToggle: () => void }) {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [waking, setWaking] = useState(false)
  const [toasts, setToasts] = useState<ToastMsg[]>([])

  const showToast = (type: 'live' | 'cache', text: string) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev.slice(-2), { id, type, text }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4200)
  }

  useEffect(() => {
    const wakingTimer = setTimeout(() => setWaking(true), 2800)
    getHealth()
      .then(h => { clearTimeout(wakingTimer); setWaking(false); setHealth(h) })
      .catch(() => { clearTimeout(wakingTimer); setWaking(false); setHealth(null) })
    return () => clearTimeout(wakingTimer)
  }, [])

  return (
    <ToastCtx.Provider value={showToast}>
      {waking && (
        <div className="wakeup-banner">
          <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
          <span>Waking up backend… Render.com free tier — typically 30–60s</span>
        </div>
      )}

      <div className="app-shell" style={{ marginTop: waking ? 40 : 0, transition: 'margin-top 300ms ease' }}>
        <AppSidebar />

        <main className="main-content">
          <AppHeader health={health} onThemeToggle={onThemeToggle} theme={theme} />

          <Routes>
            <Route path="/"           element={<PageWrapper><Dashboard /></PageWrapper>} />
            <Route path="/agent"      element={<PageWrapper><ChatAgent /></PageWrapper>} />
            <Route path="/map"        element={<PageWrapper><MapExplorer /></PageWrapper>} />
            <Route path="/facilities" element={<PageWrapper><FacilityExplorer /></PageWrapper>} />
            <Route path="/desert"     element={<PageWrapper><DesertAnalysis /></PageWrapper>} />
            <Route path="/anomalies"  element={<PageWrapper><AnomalyReport /></PageWrapper>} />
          </Routes>
        </main>
      </div>

      <ToastContainer toasts={toasts} />
    </ToastCtx.Provider>
  )
}

// ── Root App ────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    // Persist preference
    return (localStorage.getItem('vf-theme') as Theme) || 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('vf-theme', theme)
  }, [theme])

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  return (
    <ThemeCtx.Provider value={{ theme, toggle }}>
      <BrowserRouter>
        <AppContent theme={theme} onThemeToggle={toggle} />
      </BrowserRouter>
    </ThemeCtx.Provider>
  )
}