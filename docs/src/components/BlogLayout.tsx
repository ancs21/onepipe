import { Link, useLocation } from 'react-router-dom'
import { useState, type ReactNode } from 'react'
import { useTheme } from '../context/ThemeContext'

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

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      onClick={toggleTheme}
      className="p-1.5 text-[--text-muted] hover:text-[--text-secondary] transition-colors"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

export function BlogLayout({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()

  const navLinks = [
    { href: '/docs', label: 'Docs' },
    { href: '/blog', label: 'Blog' },
    { href: '/docs/api', label: 'API' },
  ]

  return (
    <div className="min-h-screen bg-[--bg-primary]">
      {/* WIP Banner */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500/10 border-b border-amber-500/20">
        <div className="max-w-4xl mx-auto px-6 py-1.5 text-center">
          <span className="text-xs text-amber-500">
            Work in progress. APIs may change.
          </span>
        </div>
      </div>

      {/* Header */}
      <header className="fixed top-7 left-0 right-0 z-50 h-12 border-b border-[--border-subtle] bg-[--bg-primary]/95 backdrop-blur-sm">
        <div className="h-full max-w-4xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Logo />
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => {
                const isActive = location.pathname === link.href ||
                  (link.href === '/blog' && location.pathname.startsWith('/blog'))
                return (
                  <Link
                    key={link.href}
                    to={link.href}
                    className={`px-2.5 py-1.5 text-sm transition-colors ${
                      isActive
                        ? 'text-[--text-primary]'
                        : 'text-[--text-muted] hover:text-[--text-secondary]'
                    }`}
                  >
                    {link.label}
                  </Link>
                )
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
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

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="absolute top-[4.75rem] left-0 right-0 bottom-0 bg-[--bg-primary] border-t border-[--border-subtle] overflow-y-auto p-4">
            <nav className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2 text-[--text-secondary] hover:text-[--text-primary] hover:bg-[--bg-hover] rounded-sm transition-colors text-sm"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="pt-[4.75rem]">
        <div className="max-w-4xl mx-auto px-6 py-12">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[--border-subtle]">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between text-xs text-[--text-muted]">
            <span>&copy; {new Date().getFullYear()} OnePipe</span>
            <div className="flex items-center gap-4">
              <Link to="/docs" className="hover:text-[--text-secondary] transition-colors">
                Docs
              </Link>
              <Link to="/blog" className="hover:text-[--text-secondary] transition-colors">
                Blog
              </Link>
              <a
                href="https://github.com/ancs21/onepipe"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[--text-secondary] transition-colors"
              >
                GitHub
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
