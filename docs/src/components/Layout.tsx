import { Link, useLocation } from 'react-router-dom'
import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useTheme } from '../context/ThemeContext'

// Navigation structure with collapsible sections
const navigation = [
  {
    title: 'Getting Started',
    id: 'getting-started',
    items: [
      { title: 'Introduction', href: '/docs' },
    ],
  },
  {
    title: 'Core Primitives',
    id: 'core',
    items: [
      { title: 'REST API', href: '/docs/rest' },
      { title: 'Database', href: '/docs/db' },
      { title: 'Server', href: '/docs/server' },
      { title: 'Cache', href: '/docs/cache' },
    ],
  },
  {
    title: 'Event-Driven',
    id: 'events',
    items: [
      { title: 'Flows', href: '/docs/flow' },
      { title: 'Projections', href: '/docs/projection' },
      { title: 'Signals', href: '/docs/signal' },
      { title: 'Channels', href: '/docs/channel' },
    ],
  },
  {
    title: 'Durability',
    id: 'durability',
    items: [
      { title: 'Workflows', href: '/docs/workflow' },
      { title: 'Cron Jobs', href: '/docs/cron' },
    ],
  },
  {
    title: 'Infrastructure',
    id: 'infra',
    items: [
      { title: 'Authentication', href: '/docs/auth' },
      { title: 'Storage', href: '/docs/storage' },
      { title: 'Migrations', href: '/docs/migration' },
      { title: 'Configuration', href: '/docs/config' },
    ],
  },
  {
    title: 'Integrations',
    id: 'integrations',
    items: [
      { title: 'Better Auth', href: '/docs/better-auth' },
      { title: 'Drizzle ORM', href: '/docs/drizzle' },
    ],
  },
  {
    title: 'Observability',
    id: 'observability',
    items: [
      { title: 'Tracing', href: '/docs/tracing' },
      { title: 'HTTP Client', href: '/docs/http-client' },
      { title: 'Service Communication', href: '/docs/service-client' },
      { title: 'Metrics & Logging', href: '/docs/observability' },
    ],
  },
  {
    title: 'Client SDK',
    id: 'client',
    items: [
      { title: 'Client & React', href: '/docs/client' },
    ],
  },
  {
    title: 'Tools',
    id: 'tools',
    items: [
      { title: 'CLI', href: '/docs/cli' },
    ],
  },
  {
    title: 'Reference',
    id: 'reference',
    items: [
      { title: 'Error Handling', href: '/docs/errors' },
      { title: 'Examples', href: '/docs/examples' },
      { title: 'API Reference', href: '/docs/api' },
    ],
  },
]

// Get all docs in order for prev/next navigation
const allDocs = navigation.flatMap(group => group.items)

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 group">
      <div className="w-6 h-6 rounded-sm bg-amber-500 flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-black" fill="currentColor">
          <path d="M6 6h3v12H6zM11 6h3l5 12h-3z" />
        </svg>
      </div>
      <span className="font-medium text-[--text-primary] text-sm">OnePipe</span>
    </Link>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`w-4 h-4 text-[--text-muted] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" strokeLinecap="round" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      onClick={toggleTheme}
      className="p-1.5 text-[--text-muted] hover:text-[--text-secondary] transition-colors"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

// Collapsible sidebar section
function SidebarSection({
  group,
  isActive,
  onNavigate
}: {
  group: typeof navigation[0]
  isActive: boolean
  onNavigate?: () => void
}) {
  const location = useLocation()
  const storageKey = `sidebar-${group.id}`

  const [expanded, setExpanded] = useState(() => {
    if (typeof window === 'undefined') return true
    const stored = sessionStorage.getItem(storageKey)
    if (stored !== null) return stored === 'true'
    // Auto-expand if current page is in this section
    return group.items.some(item => item.href === location.pathname)
  })

  useEffect(() => {
    sessionStorage.setItem(storageKey, String(expanded))
  }, [expanded, storageKey])

  // Auto-expand when navigating to a page in this section
  useEffect(() => {
    if (group.items.some(item => item.href === location.pathname)) {
      setExpanded(true)
    }
  }, [location.pathname, group.items])

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-[--text-muted] hover:text-[--text-tertiary] transition-colors"
      >
        <span>{group.title}</span>
        <ChevronIcon expanded={expanded} />
      </button>

      <div
        className={`overflow-hidden transition-all duration-150 ease-out ${
          expanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <ul className="py-1">
          {group.items.map((item) => {
            const isItemActive = location.pathname === item.href
            return (
              <li key={item.href}>
                <Link
                  to={item.href}
                  onClick={onNavigate}
                  className={`
                    block px-2 py-1.5 text-[13px] rounded-sm transition-colors duration-75
                    ${isItemActive
                      ? 'text-[--text-primary] bg-[--bg-active]'
                      : 'text-[--text-tertiary] hover:text-[--text-secondary] hover:bg-[--bg-hover]'
                    }
                  `}
                >
                  {item.title}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation()

  return (
    <nav className="py-4 px-2">
      {navigation.map((group) => {
        const isActive = group.items.some(item => item.href === location.pathname)
        return (
          <SidebarSection
            key={group.id}
            group={group}
            isActive={isActive}
            onNavigate={onNavigate}
          />
        )
      })}
    </nav>
  )
}

// Table of contents extracted from page headings
function TableOfContents() {
  const [headings, setHeadings] = useState<{ id: string; text: string; level: number }[]>([])
  const [activeId, setActiveId] = useState('')

  useEffect(() => {
    // Extract headings from the page
    const article = document.querySelector('article')
    if (!article) return

    const elements = article.querySelectorAll('h2, h3')
    const extracted = Array.from(elements).map((el) => ({
      id: el.id || el.textContent?.toLowerCase().replace(/\s+/g, '-') || '',
      text: el.textContent || '',
      level: parseInt(el.tagName[1]),
    }))

    setHeadings(extracted)

    // Set up intersection observer for active heading
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        })
      },
      { rootMargin: '-80px 0px -80% 0px' }
    )

    elements.forEach((el) => {
      if (el.id) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [])

  if (headings.length === 0) return null

  return (
    <nav className="py-4">
      <h4 className="px-2 text-xs font-medium uppercase tracking-wider text-[--text-muted] mb-3">
        On this page
      </h4>
      <ul className="space-y-1">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={`
                block px-2 py-1 text-[13px] transition-colors duration-75
                ${heading.level === 3 ? 'pl-4' : ''}
                ${activeId === heading.id
                  ? 'text-[--text-primary]'
                  : 'text-[--text-muted] hover:text-[--text-secondary]'
                }
              `}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// Previous/Next chapter navigation
function ChapterNavigation() {
  const location = useLocation()
  const currentIndex = allDocs.findIndex(doc => doc.href === location.pathname)

  const prev = currentIndex > 0 ? allDocs[currentIndex - 1] : null
  const next = currentIndex < allDocs.length - 1 ? allDocs[currentIndex + 1] : null

  if (!prev && !next) return null

  return (
    <div className="flex items-center justify-between mt-12 pt-6 border-t border-[--border-subtle]">
      {prev ? (
        <Link
          to={prev.href}
          className="group flex flex-col gap-1 text-left"
        >
          <span className="text-xs text-[--text-muted]">Previous</span>
          <span className="text-sm text-[--text-secondary] group-hover:text-[--text-primary] transition-colors">
            ← {prev.title}
          </span>
        </Link>
      ) : <div />}

      {next ? (
        <Link
          to={next.href}
          className="group flex flex-col gap-1 text-right"
        >
          <span className="text-xs text-[--text-muted]">Next</span>
          <span className="text-sm text-[--text-secondary] group-hover:text-[--text-primary] transition-colors">
            {next.title} →
          </span>
        </Link>
      ) : <div />}
    </div>
  )
}

// Search modal trigger
function SearchButton() {
  const handleClick = useCallback(() => {
    // TODO: Implement search modal
    console.log('Search triggered')
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        handleClick()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleClick])

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 px-3 py-1.5 text-sm text-[--text-muted] bg-[--bg-secondary] border border-[--border-subtle] rounded-sm hover:border-[--border-default] hover:text-[--text-tertiary] transition-all duration-75"
    >
      <SearchIcon />
      <span className="hidden sm:inline">Search docs...</span>
      <kbd className="hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-[--text-muted] bg-[--bg-tertiary] border border-[--border-subtle] rounded-sm">
        ⌘K
      </kbd>
    </button>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-[--bg-primary]">
      {/* WIP Banner */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500/10 border-b border-amber-500/20">
        <div className="max-w-[1400px] mx-auto px-4 py-1.5 text-center">
          <span className="text-xs text-amber-500">
            Work in progress. APIs may change.
          </span>
        </div>
      </div>

      {/* Header */}
      <header className="fixed top-7 left-0 right-0 z-50 h-12 border-b border-[--border-subtle] bg-[--bg-primary]/95 backdrop-blur-sm">
        <div className="h-full max-w-[1400px] mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Logo />

            <nav className="hidden md:flex items-center gap-1">
              <Link
                to="/docs"
                className="px-2.5 py-1.5 text-sm text-[--text-secondary] hover:text-[--text-primary] transition-colors"
              >
                Docs
              </Link>
              <Link
                to="/blog"
                className="px-2.5 py-1.5 text-sm text-[--text-muted] hover:text-[--text-secondary] transition-colors"
              >
                Blog
              </Link>
              <Link
                to="/docs/api"
                className="px-2.5 py-1.5 text-sm text-[--text-muted] hover:text-[--text-secondary] transition-colors"
              >
                API
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <SearchButton />

            <ThemeToggle />

            <a
              href="https://github.com/ancs21/onepipe"
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-[--text-muted] hover:text-[--text-secondary] transition-colors"
              aria-label="GitHub"
            >
              <GitHubIcon />
            </a>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-1.5 text-[--text-muted] hover:text-[--text-secondary] transition-colors"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="absolute top-[4.75rem] left-0 right-0 bottom-0 bg-[--bg-primary] border-t border-[--border-subtle] overflow-y-auto">
            <Sidebar onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        </div>
      )}

      {/* Main layout */}
      <div className="pt-[4.75rem]">
        <div className="max-w-[1400px] mx-auto flex">
          {/* Left sidebar */}
          <aside className="hidden md:block w-56 shrink-0 border-r border-[--border-subtle]">
            <div className="fixed top-[4.75rem] w-56 h-[calc(100vh-4.75rem)] overflow-y-auto scrollbar-thin">
              <Sidebar />
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0">
            <div className="max-w-3xl mx-auto px-6 lg:px-8 py-10">
              <article className="prose">
                {children}
              </article>
              <ChapterNavigation />
            </div>
          </main>

          {/* Right sidebar - Table of Contents */}
          <aside className="hidden xl:block w-52 shrink-0">
            <div className="fixed top-[4.75rem] w-52 h-[calc(100vh-4.75rem)] overflow-y-auto scrollbar-thin border-l border-[--border-subtle]">
              <TableOfContents />
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
