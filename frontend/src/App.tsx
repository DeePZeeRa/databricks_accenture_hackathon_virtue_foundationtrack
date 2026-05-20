// src/App.tsx — v4 · Full top-nav layout, animated, responsive, mobile-ready
import {
  useEffect, useState, createContext, useContext,
  useRef, useCallback,
} from 'react'
import {
  BrowserRouter, Routes, Route, NavLink, useLocation,
} from 'react-router-dom'
import Dashboard        from './pages/Dashboard'
import MapExplorer      from './pages/MapExplorer'
import FacilityExplorer from './pages/FacilityExplorer'
import AnomalyReport    from './pages/AnomalyReport'
import DesertAnalysis   from './pages/DesertAnalysis'
import ChatAgent        from './pages/ChatAgent'
import { getHealth, type HealthStatus } from './api/client'

// ── Theme Context ─────────────────────────────────────────────────────────────
export type Theme = 'dark' | 'light'
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'dark', toggle: () => {},
})
export const useTheme = () => useContext(ThemeCtx)

// ── Toast Context ─────────────────────────────────────────────────────────────
type ToastMsg = { id: string; type: 'live' | 'cache' | 'info'; text: string }
const ToastCtx = createContext<(type: 'live' | 'cache' | 'info', text: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

// ── Nav config ────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { to: '/',           icon: '📊', label: 'Dashboard',       short: 'Dash'    },
  { to: '/agent',      icon: '🤖', label: 'AI Agent',        short: 'Agent'   },
  { to: '/map',        icon: '🗺️',  label: 'Map Explorer',   short: 'Map'     },
  { to: '/facilities', icon: '🏥', label: 'Facilities',      short: 'Facilit.'},
  { to: '/desert',     icon: '🌵', label: 'Desert Analysis', short: 'Desert'  },
  { to: '/anomalies',  icon: '⚠️', label: 'Anomaly Report',  short: 'Anomaly' },
]

const HEALTH_PILLS = [
  { key: 'faiss_loaded',         label: 'RAG',   icon: '🔍', title: 'Vector index loaded'   },
  { key: 'databricks_connected', label: 'Live',  icon: '⚡', title: 'Databricks connected'  },
  { key: 'redis_connected',      label: 'Cache', icon: '💾', title: 'Redis cache active'    },
]

// ── Toast Container ───────────────────────────────────────────────────────────
function ToastContainer({ toasts }: { toasts: ToastMsg[] }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span style={{ fontSize: 14 }}>
            {t.type === 'live' ? '🔴' : t.type === 'info' ? 'ℹ️' : '💾'}
          </span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

// ── Animated mobile menu overlay ──────────────────────────────────────────────
function MobileMenu({
  open, onClose, health, theme, onThemeToggle,
}: {
  open: boolean
  onClose: () => void
  health: HealthStatus | null
  theme: Theme
  onThemeToggle: () => void
}) {
  const loc = useLocation()

  // Close on route change
  useEffect(() => { if (open) onClose() }, [loc.pathname]) // eslint-disable-line

  if (!open) return null
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 190,
          background: 'rgba(6,9,26,0.7)',
          backdropFilter: 'blur(4px)',
          animation: 'fadeIn 200ms both',
        }}
      />
      {/* Slide-down menu */}
      <div style={{
        position: 'fixed', top: 60, left: 0, right: 0, zIndex: 200,
        background: 'var(--bg-nav)',
        borderBottom: '1px solid var(--bg-border)',
        boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
        animation: 'slideDownMenu 280ms cubic-bezier(0.34,1.56,0.64,1) both',
        padding: '10px 0 16px',
      }}>
        {NAV_ITEMS.map((item, i) => {
          const active = loc.pathname === item.to || (item.to !== '/' && loc.pathname.startsWith(item.to))
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onClose}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '12px 24px',
                color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                textDecoration: 'none',
                fontSize: 14, fontWeight: active ? 700 : 500,
                fontFamily: 'var(--font-display)',
                borderLeft: `3px solid ${active ? 'var(--accent-primary)' : 'transparent'}`,
                background: active ? 'rgba(255,78,78,0.1)' : 'transparent',
                transition: 'all 150ms ease',
                animation: `fadeInLeft ${150 + i * 40}ms both`,
              }}
            >
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              {item.label}
            </NavLink>
          )
        })}

        {/* Bottom row in mobile menu */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 24px', marginTop: 4,
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}>
          {health && HEALTH_PILLS.filter(p => (health as any)[p.key]).map(p => (
            <span key={p.key} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 9px', borderRadius: 999, fontSize: 10, fontWeight: 700,
              background: 'rgba(0,212,177,0.12)', color: 'var(--accent-teal)',
              border: '1px solid rgba(0,212,177,0.2)', fontFamily: 'var(--font-display)',
            }}>
              {p.icon} {p.label}
            </span>
          ))}
          <button
            onClick={onThemeToggle}
            style={{
              marginLeft: 'auto', padding: '6px 12px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.07)',
              color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 13,
            }}
          >
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Top Navbar ────────────────────────────────────────────────────────────────
function TopNav({
  health, theme, onThemeToggle,
}: {
  health: HealthStatus | null
  theme: Theme
  onThemeToggle: () => void
}) {
  const loc       = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled]     = useState(false)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const navRef       = useRef<HTMLDivElement>(null)

  // Scroll shadow
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 4)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  // Animated active indicator
  useEffect(() => {
    if (!navRef.current || !indicatorRef.current) return
    const activeEl = navRef.current.querySelector<HTMLElement>('.nav-top-item.active')
    if (!activeEl) { indicatorRef.current.style.opacity = '0'; return }
    const navRect  = navRef.current.getBoundingClientRect()
    const itemRect = activeEl.getBoundingClientRect()
    indicatorRef.current.style.opacity    = '1'
    indicatorRef.current.style.left       = `${itemRect.left - navRect.left}px`
    indicatorRef.current.style.width      = `${itemRect.width}px`
  }, [loc.pathname])

  const isLocalFallback = health && !health.databricks_connected && health.faiss_loaded
  const dotClass = !health ? 'offline'
    : health.status === 'healthy' ? 'healthy'
    : isLocalFallback ? 'fallback' : 'degraded'

  return (
    <>
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        height: 60,
        display: 'flex', alignItems: 'center',
        padding: '0 20px',
        background: 'var(--bg-nav)',
        borderBottom: `1px solid ${scrolled ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)'}`,
        boxShadow: scrolled ? '0 4px 24px rgba(0,0,0,0.35)' : 'none',
        backdropFilter: 'blur(16px)',
        transition: 'box-shadow 300ms ease, border-color 300ms ease',
        gap: 0,
        // Animated gradient top strip
        borderTop: '2px solid transparent',
        backgroundImage: `
          linear-gradient(var(--bg-nav), var(--bg-nav)),
          linear-gradient(90deg, var(--accent-primary), var(--accent-violet), var(--accent-teal), var(--accent-primary))
        `,
        backgroundOrigin: 'border-box',
        backgroundClip: 'padding-box, border-box',
        animation: 'fadeInDown 300ms both',
      }}>

        {/* ── Logo ── */}
        <NavLink to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0, marginRight: 24 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-violet))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 17, boxShadow: '0 3px 12px rgba(255,78,78,0.35)',
            flexShrink: 0, transition: 'transform 300ms cubic-bezier(0.34,1.56,0.64,1)',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = 'scale(1.1) rotate(-5deg)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = 'scale(1)'}
          >🏥</div>
          <div className="logo-text-block" style={{ lineHeight: 1.2 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, color: '#fff', letterSpacing: '0.01em' }}>
              Virtue Foundation
            </div>
            <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.04em' }}>
              Ghana Healthcare Intel
            </div>
          </div>
        </NavLink>

        {/* ── Desktop Nav Items ── */}
        <div
          ref={navRef}
          className="nav-items-desktop"
          style={{
            display: 'flex', alignItems: 'center', gap: 2,
            flex: 1, position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Gliding active indicator */}
          <div
            ref={indicatorRef}
            style={{
              position: 'absolute', bottom: -8, height: 2,
              background: 'var(--accent-primary)',
              borderRadius: 999,
              boxShadow: '0 0 8px rgba(255,78,78,0.6)',
              transition: 'left 300ms cubic-bezier(0.34,1.56,0.64,1), width 300ms cubic-bezier(0.34,1.56,0.64,1), opacity 200ms',
              opacity: 0,
              pointerEvents: 'none',
              zIndex: 2,
            }}
          />

          {NAV_ITEMS.map((item, i) => {
            const active = loc.pathname === item.to || (item.to !== '/' && loc.pathname.startsWith(item.to))
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={`nav-top-item${active ? ' active' : ''}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 12px', borderRadius: 8,
                  color: active ? '#fff' : 'rgba(255,255,255,0.5)',
                  textDecoration: 'none',
                  fontSize: 12.5, fontWeight: active ? 700 : 500,
                  fontFamily: 'var(--font-display)',
                  letterSpacing: '0.01em',
                  background: active ? 'rgba(255,78,78,0.14)' : 'transparent',
                  border: `1px solid ${active ? 'rgba(255,78,78,0.2)' : 'transparent'}`,
                  transition: 'all 180ms ease',
                  whiteSpace: 'nowrap',
                  animation: `fadeInDown ${200 + i * 40}ms both`,
                  position: 'relative',
                  overflow: 'hidden',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.color = 'rgba(255,255,255,0.88)'
                    el.style.background = 'rgba(255,255,255,0.06)'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.color = 'rgba(255,255,255,0.5)'
                    el.style.background = 'transparent'
                  }
                }}
              >
                <span style={{ fontSize: 14 }}>{item.icon}</span>
                <span className="nav-item-label">{item.label}</span>
                {/* Ripple-style ping on active */}
                {active && (
                  <span style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                    width: 5, height: 5, borderRadius: '50%',
                    background: 'var(--accent-primary)',
                    boxShadow: '0 0 6px var(--accent-primary)',
                    animation: 'pulse-dot 2s ease-in-out infinite',
                  }} />
                )}
              </NavLink>
            )
          })}
        </div>

        {/* ── Right side: pills + status + theme ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 16 }}>
          {/* Health pills */}
          <div className="health-pills-row" style={{ display: 'flex', gap: 5 }}>
            {health && HEALTH_PILLS.filter(p => (health as any)[p.key]).map(p => (
              <span key={p.key} title={p.title} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 700,
                background: 'rgba(0,212,177,0.1)', color: 'var(--accent-teal)',
                border: '1px solid rgba(0,212,177,0.2)',
                fontFamily: 'var(--font-display)', letterSpacing: '0.04em',
                animation: 'fadeIn 300ms both', whiteSpace: 'nowrap',
              }}>
                {p.icon} {p.label}
              </span>
            ))}
          </div>

          {/* Status dot */}
          <div className="status-pill" style={{ padding: '4px 10px' }}>
            <span className={`status-dot ${dotClass}`} />
            <span className="status-text" style={{ fontSize: 11.5, fontWeight: 500, whiteSpace: 'nowrap' }}>
              {!health ? 'Connecting…'
                : health.status === 'healthy' ? 'Online'
                : isLocalFallback ? 'Fallback'
                : 'Degraded'}
            </span>
          </div>

          {/* Theme toggle */}
          <button
            className="theme-toggle"
            onClick={onThemeToggle}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {/* Hamburger (mobile only) */}
          <button
            className="hamburger-btn"
            onClick={() => setMobileOpen(v => !v)}
            aria-label="Toggle menu"
            style={{
              display: 'none', // shown via CSS media query
              flexDirection: 'column', gap: 5, padding: '8px',
              background: 'none', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8, cursor: 'pointer',
            }}
          >
            <span style={{ display: 'block', width: 20, height: 1.5, background: mobileOpen ? 'transparent' : '#fff', transition: 'all 200ms ease' }} />
            <span style={{
              display: 'block', width: 20, height: 1.5, background: '#fff',
              transition: 'all 200ms ease',
              transform: mobileOpen ? 'rotate(45deg) translate(4px, 4px)' : 'none',
            }} />
            <span style={{
              display: 'block', width: 20, height: 1.5, background: '#fff',
              transition: 'all 200ms ease',
              transform: mobileOpen ? 'rotate(-45deg) translate(4px, -4px)' : 'none',
            }} />
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      <MobileMenu
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        health={health}
        theme={theme}
        onThemeToggle={onThemeToggle}
      />
    </>
  )
}

// ── Page wrapper (re-animates on route change) ────────────────────────────────
function PageWrapper({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return (
    <div
      key={pathname}
      style={{ animation: 'pageEnter 280ms cubic-bezier(0.34,1.56,0.64,1) both' }}
    >
      {children}
    </div>
  )
}

// ── Breadcrumb bar ────────────────────────────────────────────────────────────
function Breadcrumb() {
  const loc  = useLocation()
  const page = NAV_ITEMS.find(n => n.to === loc.pathname || (n.to !== '/' && loc.pathname.startsWith(n.to)))
  if (!page || page.to === '/') return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 28px',
      fontSize: 11.5, color: 'var(--text-muted)',
      borderBottom: '1px solid var(--bg-border)',
      background: 'var(--bg-base)',
      fontFamily: 'var(--font-display)',
      animation: 'fadeIn 200ms both',
    }}>
      <NavLink to="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Dashboard</NavLink>
      <span style={{ opacity: 0.4 }}>›</span>
      <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
        {page.icon} {page.label}
      </span>
    </div>
  )
}

// ── App Content ───────────────────────────────────────────────────────────────
function AppContent({ theme, onThemeToggle }: { theme: Theme; onThemeToggle: () => void }) {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [waking, setWaking] = useState(false)
  const [toasts, setToasts] = useState<ToastMsg[]>([])

  const showToast = useCallback((type: 'live' | 'cache' | 'info', text: string) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev.slice(-2), { id, type, text }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4400)
  }, [])

  useEffect(() => {
    const wakeTimer = setTimeout(() => setWaking(true), 2800)
    getHealth()
      .then(h => { clearTimeout(wakeTimer); setWaking(false); setHealth(h) })
      .catch(() => { clearTimeout(wakeTimer); setWaking(false); setHealth(null) })
    return () => clearTimeout(wakeTimer)
  }, [])

  return (
    <ToastCtx.Provider value={showToast}>
      {/* Wakeup banner */}
      {waking && (
        <div className="wakeup-banner">
          <div className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />
          <span>Waking up backend… Render.com free tier — typically 30–60 s</span>
        </div>
      )}

      {/* App shell — full-width, no sidebar */}
      <div
        className="app-shell-topnav"
        style={{ marginTop: waking ? 40 : 0, transition: 'margin-top 300ms ease' }}
      >
        <TopNav health={health} theme={theme} onThemeToggle={onThemeToggle} />

        <Breadcrumb />

        <main style={{
          flex: 1,
          minHeight: 'calc(100vh - 60px)',
          background: 'var(--bg-base)',
          backgroundImage: 'var(--mesh-1), var(--mesh-2), var(--mesh-3)',
        }}>
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

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem('vf-theme') as Theme) || 'dark',
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('vf-theme', theme)
  }, [theme])

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))

  return (
    <ThemeCtx.Provider value={{ theme, toggle }}>
      <BrowserRouter>
        <AppContent theme={theme} onThemeToggle={toggle} />
      </BrowserRouter>
    </ThemeCtx.Provider>
  )
}