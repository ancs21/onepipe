import { useEffect, useState, useCallback } from 'react'
import { Command } from 'cmdk'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Network,
  Compass,
  Activity,
  BarChart3,
  ScrollText,
  Waves,
  Database,
  Sun,
  Moon,
  Monitor,
  RefreshCw,
  Trash2,
  Search,
} from 'lucide-react'
import { useTheme } from '../lib/theme'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const pages = [
  { path: '/services', label: 'Services', icon: Network, shortcut: '⌘1' },
  { path: '/api', label: 'API Explorer', icon: Compass, shortcut: '⌘2' },
  { path: '/traces', label: 'Traces', icon: Activity, shortcut: '⌘3' },
  { path: '/metrics', label: 'Metrics', icon: BarChart3, shortcut: '⌘4' },
  { path: '/logs', label: 'Logs', icon: ScrollText, shortcut: '⌘5' },
  { path: '/flows', label: 'Flows', icon: Waves, shortcut: '⌘6' },
  { path: '/database', label: 'Database', icon: Database, shortcut: '⌘7' },
]

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { theme, setTheme } = useTheme()
  const [search, setSearch] = useState('')

  // Reset search when opening
  useEffect(() => {
    if (open) {
      setSearch('')
    }
  }, [open])

  const runCommand = useCallback((command: () => void) => {
    onOpenChange(false)
    command()
  }, [onOpenChange])

  // Handle escape key
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
      if (e.key === 'Escape') {
        onOpenChange(false)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog */}
      <div className="absolute left-1/2 top-[20%] -translate-x-1/2 w-full max-w-xl animate-slide-down">
        <Command
          className="bg-bg-secondary border border-border rounded-xl shadow-elevated overflow-hidden"
          shouldFilter={true}
        >
          <div className="flex items-center gap-2 px-4 border-b border-border">
            <Search className="w-4 h-4 text-text-muted" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Type a command or search..."
              className="flex-1 h-12 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
            />
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-text-muted bg-bg-tertiary rounded">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-80 overflow-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-text-muted">
              No results found.
            </Command.Empty>

            {/* Navigation */}
            <Command.Group heading="Navigation" className="mb-2">
              <div className="px-2 py-1.5 text-xs font-medium text-text-muted uppercase tracking-wider">
                Navigation
              </div>
              {pages.map(({ path, label, icon: Icon, shortcut }) => (
                <Command.Item
                  key={path}
                  value={label}
                  onSelect={() => runCommand(() => navigate(path))}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer
                    text-sm text-text-secondary
                    data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent
                    ${location.pathname === path ? 'bg-bg-tertiary' : ''}
                  `}
                >
                  <Icon className="w-4 h-4" strokeWidth={1.75} />
                  <span className="flex-1">{label}</span>
                  <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-text-muted bg-bg-tertiary rounded">
                    {shortcut}
                  </kbd>
                </Command.Item>
              ))}
            </Command.Group>

            {/* Theme */}
            <Command.Group heading="Theme" className="mb-2">
              <div className="px-2 py-1.5 text-xs font-medium text-text-muted uppercase tracking-wider">
                Theme
              </div>
              <Command.Item
                value="Light theme"
                onSelect={() => runCommand(() => setTheme('light'))}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer
                  text-sm text-text-secondary
                  data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent
                  ${theme === 'light' ? 'bg-bg-tertiary' : ''}
                `}
              >
                <Sun className="w-4 h-4" strokeWidth={1.75} />
                <span className="flex-1">Light theme</span>
              </Command.Item>
              <Command.Item
                value="Dark theme"
                onSelect={() => runCommand(() => setTheme('dark'))}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer
                  text-sm text-text-secondary
                  data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent
                  ${theme === 'dark' ? 'bg-bg-tertiary' : ''}
                `}
              >
                <Moon className="w-4 h-4" strokeWidth={1.75} />
                <span className="flex-1">Dark theme</span>
              </Command.Item>
              <Command.Item
                value="System theme"
                onSelect={() => runCommand(() => setTheme('system'))}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer
                  text-sm text-text-secondary
                  data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent
                  ${theme === 'system' ? 'bg-bg-tertiary' : ''}
                `}
              >
                <Monitor className="w-4 h-4" strokeWidth={1.75} />
                <span className="flex-1">System theme</span>
              </Command.Item>
            </Command.Group>

            {/* Actions */}
            <Command.Group heading="Actions">
              <div className="px-2 py-1.5 text-xs font-medium text-text-muted uppercase tracking-wider">
                Actions
              </div>
              <Command.Item
                value="Refresh data"
                onSelect={() => runCommand(() => window.location.reload())}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-sm text-text-secondary data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent"
              >
                <RefreshCw className="w-4 h-4" strokeWidth={1.75} />
                <span className="flex-1">Refresh data</span>
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-text-muted bg-bg-tertiary rounded">
                  ⌘R
                </kbd>
              </Command.Item>
              <Command.Item
                value="Clear logs"
                onSelect={() => runCommand(() => {
                  // This would need to be connected to the logs page
                  console.log('Clear logs')
                })}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-sm text-text-secondary data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent"
              >
                <Trash2 className="w-4 h-4" strokeWidth={1.75} />
                <span className="flex-1">Clear logs</span>
              </Command.Item>
            </Command.Group>
          </Command.List>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-bg-tertiary/50">
            <div className="flex items-center gap-4 text-[11px] text-text-muted">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-bg-tertiary rounded text-[10px]">↑↓</kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-bg-tertiary rounded text-[10px]">↵</kbd>
                Select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-bg-tertiary rounded text-[10px]">ESC</kbd>
                Close
              </span>
            </div>
            <span className="text-[10px] text-text-muted font-mono">⌘K</span>
          </div>
        </Command>
      </div>
    </div>
  )
}
