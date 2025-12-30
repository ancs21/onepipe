import { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Compass,
  Activity,
  BarChart3,
  ScrollText,
  Waves,
  Network,
  Database,
  Sun,
  Moon,
  Monitor,
  GitBranch,
  Clock,
  Shield,
} from 'lucide-react'
import { useTheme } from '../lib/theme'

interface LayoutProps {
  children: ReactNode
}

const navItems = [
  { path: '/services', label: 'Services', icon: Network },
  { path: '/api', label: 'API Explorer', icon: Compass },
  { path: '/traces', label: 'Traces', icon: Activity },
  { path: '/metrics', label: 'Metrics', icon: BarChart3 },
  { path: '/logs', label: 'Logs', icon: ScrollText },
  { path: '/flows', label: 'Flows', icon: Waves },
  { path: '/database', label: 'Database', icon: Database },
  { path: '/workflows', label: 'Workflows', icon: GitBranch },
  { path: '/cron', label: 'Cron Jobs', icon: Clock },
  { path: '/auth', label: 'Auth', icon: Shield },
]

function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const options = [
    { value: 'light' as const, icon: Sun, label: 'Light' },
    { value: 'dark' as const, icon: Moon, label: 'Dark' },
    { value: 'system' as const, icon: Monitor, label: 'System' },
  ]

  return (
    <div className="flex items-center gap-1 p-1 bg-bg-tertiary rounded-lg">
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          title={label}
          className={`
            p-1.5 rounded-md transition-all duration-150
            ${theme === value
              ? 'bg-bg-secondary text-accent shadow-sm'
              : 'text-text-muted hover:text-text-secondary'
            }
          `}
        >
          <Icon className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      ))}
    </div>
  )
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation()

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-bg-secondary border-r border-border flex flex-col shadow-sm flex-shrink-0">
        {/* Logo - distinctive typography with serif/sans contrast */}
        <div className="h-12 flex items-center px-5 border-b border-border">
          <div className="flex items-baseline gap-0.5">
            <span className="font-display text-xl italic text-text-primary tracking-tight">
              One
            </span>
            <span className="font-sans text-xl font-bold text-accent tracking-tight">
              Pipe
            </span>
          </div>
          <span className="ml-2.5 px-1.5 py-0.5 text-[9px] font-semibold text-accent/70 bg-accent/8 rounded-full uppercase tracking-wider">
            dev
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(({ path, label, icon: Icon }) => {
            const isActive = location.pathname === path
            return (
              <NavLink
                key={path}
                to={path}
                className={`
                  flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
                  transition-all duration-150 ease-out group relative
                  ${isActive
                    ? 'text-accent bg-accent/8 shadow-sm'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/80'
                  }
                `}
              >
                <Icon
                  className={`w-[18px] h-[18px] transition-colors duration-150 ${
                    isActive ? 'text-accent' : 'text-text-muted group-hover:text-text-secondary'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="tracking-[-0.01em]">{label}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-bg-tertiary/30 space-y-3">
          {/* Theme Toggle */}
          <ThemeToggle />

          {/* Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="status-dot status-dot-ok" />
              <span className="text-xs font-medium text-text-secondary tracking-tight">Connected</span>
            </div>
            <span className="text-[10px] text-text-muted font-mono">:3001</span>
          </div>
        </div>
      </aside>

      {/* Main content - full width for all pages, each page handles its own padding */}
      <main className="flex-1 overflow-hidden bg-bg-primary grid-bg">
        <div className="h-full overflow-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
