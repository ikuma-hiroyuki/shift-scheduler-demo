import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import ThemePicker from './ThemePicker'
import { useSidebarPatternStore } from '../stores/sidebarPattern'
import { patternBackgroundImage } from '../constants/sidebarPatterns'
import logoUrl from '../assets/images/logo.svg'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
}

const NAV: NavItem[] = [
  {
    to: '/shift',
    label: '稼働表',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0" strokeWidth="1.5" stroke="currentColor">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 3v4M16 3v4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/employees',
    label: '従業員',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0" strokeWidth="1.5" stroke="currentColor">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/work-patterns',
    label: '作業パターン',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0" strokeWidth="1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="4.5" width="7" height="7" rx="1" />
        <rect x="13.5" y="4.5" width="7" height="7" rx="1" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    to: '/employee-priorities',
    label: '優先パターン',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0" strokeWidth="1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l2.6 5.6 6.1.6-4.6 4.2 1.3 6L12 16.8 6.6 19.4l1.3-6L3.3 9.2l6.1-.6L12 3z" />
      </svg>
    ),
  },
  {
    to: '/day-templates',
    label: '日テンプレート',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0" strokeWidth="1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="5.5" width="17" height="14" rx="1.5" />
        <path d="M3.5 9.5h17" />
        <path d="M8 4v3M16 4v3" />
        <path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16h2M11 16h2" />
      </svg>
    ),
  },
  {
    to: '/choice-groups',
    label: '選択グループ',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0" strokeWidth="1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="9" r="3" />
        <circle cx="17" cy="9" r="3" />
        <circle cx="12" cy="17" r="3" />
        <path d="M9.2 11.2l2 3.6M14.8 11.2l-2 3.6M10 9h4" />
      </svg>
    ),
  },
  {
    to: '/pattern-triggers',
    label: '発生条件',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0" strokeWidth="1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v3" />
        <path d="M12 18v3" />
        <path d="M3 12h3" />
        <path d="M18 12h3" />
        <circle cx="12" cy="12" r="4" />
        <path d="M9 9l-2-2M15 9l2-2M9 15l-2 2M15 15l2 2" />
      </svg>
    ),
  },
]

const ADMIN_NAV: NavItem[] = [
  {
    to: '/admin/users',
    label: 'ユーザー管理',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0" strokeWidth="1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="3" />
        <path d="M3 19c1-3 3.2-4.5 6-4.5s5 1.5 6 4.5" />
        <circle cx="17.5" cy="11" r="2.5" />
        <path d="M14.5 19c.5-2 1.7-3 3-3s2.5 1 3 3" />
      </svg>
    ),
  },
  {
    to: '/admin/roles',
    label: '役職',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0" strokeWidth="1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
        <circle cx="6" cy="6" r="1" fill="currentColor" />
        <circle cx="6" cy="12" r="1" fill="currentColor" />
        <circle cx="6" cy="18" r="1" fill="currentColor" />
      </svg>
    ),
  },
]

const STORAGE_KEY = 'sidebar_collapsed'

export default function Layout() {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const currentUser = useAuthStore((s) => s.currentUser)
  const sidebarPatternId = useSidebarPatternStore((s) => s.patternId)
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(STORAGE_KEY) === '1',
  )
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const sidebarWidth = collapsed ? 'w-[68px]' : 'w-60'

  return (
    <div className="min-h-screen flex bg-cream-100 text-ink">
      {/* Mobile top bar (≤ md) */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 h-12 bg-brand-500 text-white flex items-center px-3 border-b border-white/15">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="メニューを開く"
          className="p-2 rounded hover:bg-white/10 transition-colors"
        >
          <BurgerIcon />
        </button>
        <span
          className="ml-2 text-[11px] tracking-[0.32em] uppercase text-cream-200"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          Demo Mart
        </span>
      </div>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-brand-900/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          ${sidebarWidth}
          shrink-0 bg-brand-500 text-white flex flex-col
          transition-[width] duration-200 ease-out
          md:sticky md:top-0 md:h-screen
          fixed inset-y-0 left-0 z-50 h-screen
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
        `}
        style={{ backgroundImage: patternBackgroundImage(sidebarPatternId) }}
      >
        {/* Logo */}
        <div className={`flex items-center justify-center border-b border-white/15 ${collapsed ? 'px-2 py-3' : 'px-4 py-4'}`}>
          <img
            src={logoUrl}
            alt="Demo Mart"
            className={collapsed ? 'h-7 w-auto' : 'h-10 w-auto'}
          />
        </div>

        {/* Header / brand */}
        <div className={`px-4 pt-5 pb-5 border-b border-white/15 flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed && (
            <div className="overflow-hidden">
              <span
                className="block text-[11px] tracking-[0.32em] uppercase text-cream-200"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Demo Mart
              </span>
              <h1
                className="mt-1 text-[17px] leading-tight font-medium whitespace-nowrap"
                style={{ fontFamily: 'var(--font-display)', fontVariationSettings: '"opsz" 96' }}
              >
                稼働表自動作成
              </h1>
            </div>
          )}
          {/* Desktop collapse toggle */}
          <button
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'メニューを展開' : 'メニューを折りたたむ'}
            className="hidden md:inline-flex p-2 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
          >
            {collapsed ? <BurgerIcon /> : <ChevronLeftIcon />}
          </button>
          {/* Mobile close button */}
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="メニューを閉じる"
            className="md:hidden p-2 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-2 py-5 space-y-1 overflow-y-auto">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/shift'}
              onClick={() => setMobileOpen(false)}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 px-3 py-2.5 rounded-md transition-all ${
                  collapsed ? 'justify-center' : ''
                } ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r transition-all ${
                      isActive ? 'bg-cream-200' : 'bg-transparent'
                    }`}
                  />
                  <span className="opacity-90">{item.icon}</span>
                  {!collapsed && (
                    <span className="text-sm font-medium tracking-wide whitespace-nowrap">{item.label}</span>
                  )}
                </>
              )}
            </NavLink>
          ))}

          {currentUser?.is_admin && (
            <>
              {!collapsed && (
                <div
                  className="px-3 pt-4 pb-1 text-[10px] tracking-[0.3em] uppercase text-white/40"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  Admin
                </div>
              )}
              {ADMIN_NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 px-3 py-2.5 rounded-md transition-all ${
                      collapsed ? 'justify-center' : ''
                    } ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'text-white/80 hover:text-white hover:bg-white/10'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r transition-all ${
                          isActive ? 'bg-cream-200' : 'bg-transparent'
                        }`}
                      />
                      <span className="opacity-90">{item.icon}</span>
                      {!collapsed && (
                        <span className="text-sm font-medium tracking-wide whitespace-nowrap">
                          {item.label}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className={`px-3 py-3 border-t border-white/15 ${collapsed ? 'flex justify-center' : ''}`}>
          <ThemePicker collapsed={collapsed} />
        </div>

        <div className={`px-3 py-4 border-t border-white/15 ${collapsed ? 'flex justify-center' : ''}`}>
          <button
            onClick={handleLogout}
            title={collapsed ? 'ログアウト' : undefined}
            className={`text-xs text-white/80 hover:text-white transition-colors flex items-center ${
              collapsed ? 'p-2' : 'w-full justify-between px-2'
            }`}
          >
            {collapsed ? (
              <LogoutIcon />
            ) : (
              <>
                <span>ログアウト</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>↗</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 pt-12 md:pt-0">
        <Outlet />
      </main>
    </div>
  )
}

function BurgerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" strokeWidth="1.7" stroke="currentColor" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}
function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" strokeWidth="1.7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" strokeWidth="1.7" stroke="currentColor" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}
function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" strokeWidth="1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4h5v16h-5" />
      <path d="M3 12h11m0 0l-4-4m4 4l-4 4" />
    </svg>
  )
}
