import { Link } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'

const features = [
  {
    title: 'REST API Builder',
    description: 'Fluent API for building REST endpoints with routing, CORS, OpenAPI generation, and automatic validation.',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M13.5 3H12H8C6.34315 3 5 4.34315 5 6V18C5 19.6569 6.34315 21 8 21H12M13.5 3L19 8.625M13.5 3V7.625C13.5 8.17728 13.9477 8.625 14.5 8.625H19M19 8.625V11.8125" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M17.5 15L15 17.5L17.5 20" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M20.5 15L23 17.5L20.5 20" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    title: 'Event Streaming',
    description: 'Durable event flows with append, subscribe, and real-time SSE streaming for reactive architectures.',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    title: 'Durable Workflows',
    description: 'DBOS-inspired workflows with PostgreSQL persistence, step execution, and automatic recovery.',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4m0-6v6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    title: 'Observability',
    description: 'OpenTelemetry tracing, Prometheus metrics, and structured logging built into every primitive.',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M7 16l4-4 4 4 5-6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
]

function CodeExample() {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  // GitHub-style syntax colors for dark/light
  const p = isDark ? "text-[#6e7681]" : "text-[#6e7781]" // punctuation/comment
  const k = isDark ? "text-[#ff7b72]" : "text-[#cf222e]" // keyword
  const b = isDark ? "text-[#79c0ff]" : "text-[#0550ae]" // blue/boolean
  const t = isDark ? "text-[#ffa657]" : "text-[#953800]" // type
  const f = isDark ? "text-[#d2a8ff]" : "text-[#8250df]" // function
  const s = isDark ? "text-[#a5d6ff]" : "text-[#0a3069]" // string
  const v = isDark ? "text-[#c9d1d9]" : "text-[#24292f]" // variable

  return (
    <span className={v}>
      <span className={k}>import</span> {'{ '}<span className={t}>REST</span>, <span className={t}>Workflow</span>, <span className={t}>DB</span>{' }'} <span className={k}>from</span> <span className={s}>'@onepipe/sdk'</span>{'\n'}
      {'\n'}
      <span className={k}>const</span> <span className={v}>db</span> = <span className={t}>DB</span>.<span className={f}>create</span>(<span className={s}>'main'</span>).<span className={f}>postgres</span>().<span className={f}>build</span>(){'\n'}
      {'\n'}
      <span className={k}>const</span> <span className={v}>checkout</span> = <span className={t}>Workflow</span>{'\n'}
      {'  '}.<span className={f}>create</span>(<span className={s}>'checkout'</span>){'\n'}
      {'  '}.<span className={f}>db</span>(<span className={v}>db</span>){'\n'}
      {'  '}.<span className={f}>define</span>(<span className={k}>async</span> (<span className={v}>ctx</span>, <span className={v}>order</span>) {'=> {'}{'\n'}
      {'    '}<span className={k}>const</span> <span className={v}>payment</span> = <span className={k}>await</span> <span className={v}>ctx</span>.<span className={f}>step</span>(<span className={s}>'charge'</span>, () {'=>'}{'\n'}
      {'      '}<span className={f}>stripe</span>.<span className={f}>charge</span>(<span className={v}>order</span>.<span className={v}>total</span>){'\n'}
      {'    '}){'\n'}
      {'    '}<span className={k}>await</span> <span className={v}>ctx</span>.<span className={f}>sleep</span>(<span className={s}>'5m'</span>)  <span className={p}>// survives restarts</span>{'\n'}
      {'    '}<span className={k}>return</span> {'{ '}<span className={v}>success</span>: <span className={b}>true</span>{' }'}{'\n'}
      {'  }'}).<span className={f}>build</span>()
    </span>
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

export function Index() {
  return (
    <div className="min-h-screen bg-[--bg-primary]">
      {/* WIP Banner */}
      <div className="bg-amber-500/10 border-b border-amber-500/20">
        <div className="max-w-5xl mx-auto px-6 py-2 text-center">
          <span className="text-xs text-amber-500">
            This project is a work in progress. APIs may change.
          </span>
        </div>
      </div>

      {/* Header */}
      <header className="border-b border-[--border-subtle]">
        <div className="max-w-5xl mx-auto px-6 h-12 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-sm bg-amber-500 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-black" fill="currentColor">
                <path d="M6 6h3v12H6zM11 6h3l5 12h-3z" />
              </svg>
            </div>
            <span className="font-medium text-[--text-primary] text-sm">OnePipe</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/docs" className="text-sm text-[--text-tertiary] hover:text-[--text-primary] transition-colors">
              Docs
            </Link>
            <Link to="/blog" className="text-sm text-[--text-tertiary] hover:text-[--text-primary] transition-colors">
              Blog
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <a
                href="https://github.com/ancs21/onepipe"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[--text-muted] hover:text-[--text-secondary] transition-colors"
              >
                <GitHubIcon />
              </a>
            </div>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <div className="max-w-2xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-sm bg-[--bg-secondary] border border-[--border-subtle] text-[--text-muted] text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-sm bg-amber-500" />
            Built for Bun
          </div>

          <h1 className="text-3xl md:text-4xl font-semibold text-[--text-primary] leading-tight tracking-tight">
            Stream-First Developer Platform
          </h1>

          <p className="mt-4 text-[--text-secondary] leading-relaxed max-w-xl">
            Build REST APIs, durable workflows, event streams, and reactive systems
            with a fluent builder API. Type-safe and designed for Bun.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/docs"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-sm bg-[--text-primary] text-[--bg-primary] text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Get Started
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
            <a
              href="https://github.com/ancs21/onepipe"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-sm border border-[--border-default] text-[--text-secondary] text-sm font-medium hover:bg-[--bg-hover] transition-colors"
            >
              <GitHubIcon />
              GitHub
            </a>
          </div>

          {/* Install command */}
          <div className="mt-6 inline-flex items-center gap-3 px-3 py-2 rounded-sm bg-[--bg-secondary] border border-[--border-subtle]">
            <span className="text-[--text-muted] font-mono text-sm">$</span>
            <code className="text-[--text-secondary] font-mono text-sm">bun add @onepipe/sdk</code>
            <button
              onClick={() => navigator.clipboard.writeText('bun add @onepipe/sdk')}
              className="p-1 text-[--text-muted] hover:text-[--text-secondary] transition-colors"
              aria-label="Copy"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="1"/>
                <path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/>
              </svg>
            </button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-[--border-subtle]">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <div className="grid md:grid-cols-2 gap-4">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="p-5 rounded-sm bg-[--bg-secondary] border border-[--border-subtle] hover:border-[--border-default] transition-colors"
              >
                <div className="w-8 h-8 rounded-sm bg-[--bg-tertiary] border border-[--border-subtle] flex items-center justify-center text-[--text-secondary] mb-3">
                  {feature.icon}
                </div>
                <h3 className="text-sm font-medium text-[--text-primary] mb-1">
                  {feature.title}
                </h3>
                <p className="text-[--text-muted] text-sm leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cloud Native */}
      <section className="border-t border-[--border-subtle]">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-[--text-primary] mb-2">
              Cloud Native
            </h2>
            <p className="text-[--text-muted] text-sm">
              Built for Kubernetes, Cloud Run, and modern container orchestration.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 rounded-sm bg-[--bg-secondary] border border-[--border-subtle]">
              <div className="flex items-center gap-2 mb-2">
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" strokeLinecap="round" strokeLinejoin="round"/>
                  <polyline points="22 4 12 14.01 9 11.01" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-sm font-medium text-[--text-primary]">Health Checks</span>
              </div>
              <p className="text-xs text-[--text-muted]">
                Built-in /health endpoint. Add custom checks for DB, Redis, external services.
              </p>
            </div>

            <div className="p-4 rounded-sm bg-[--bg-secondary] border border-[--border-subtle]">
              <div className="flex items-center gap-2 mb-2">
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-sm font-medium text-[--text-primary]">Graceful Shutdown</span>
              </div>
              <p className="text-xs text-[--text-muted]">
                SIGTERM handling. Finish in-flight requests, close DB connections cleanly.
              </p>
            </div>

            <div className="p-4 rounded-sm bg-[--bg-secondary] border border-[--border-subtle]">
              <div className="flex items-center gap-2 mb-2">
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" strokeWidth="2">
                  <ellipse cx="12" cy="5" rx="9" ry="3"/>
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                </svg>
                <span className="text-sm font-medium text-[--text-primary]">PostgreSQL Persistence</span>
              </div>
              <p className="text-xs text-[--text-muted]">
                Workflows, Cron jobs, and Flows survive restarts. State persists across deployments.
              </p>
            </div>

            <div className="p-4 rounded-sm bg-[--bg-secondary] border border-[--border-subtle]">
              <div className="flex items-center gap-2 mb-2">
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
                <span className="text-sm font-medium text-[--text-primary]">Distributed Locking</span>
              </div>
              <p className="text-xs text-[--text-muted]">
                Cron jobs run once across all replicas. PostgreSQL advisory locks ensure single execution.
              </p>
            </div>

            <div className="p-4 rounded-sm bg-[--bg-secondary] border border-[--border-subtle]">
              <div className="flex items-center gap-2 mb-2">
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                  <path d="M16 3.13a4 4 0 010 7.75"/>
                </svg>
                <span className="text-sm font-medium text-[--text-primary]">Multi-Instance Sync</span>
              </div>
              <p className="text-xs text-[--text-muted]">
                Signals sync via Redis pub/sub. State changes propagate instantly across all pods.
              </p>
            </div>

            <div className="p-4 rounded-sm bg-[--bg-secondary] border border-[--border-subtle]">
              <div className="flex items-center gap-2 mb-2">
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-cyan-500" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                  <line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
                <span className="text-sm font-medium text-[--text-primary]">Container Ready</span>
              </div>
              <p className="text-xs text-[--text-muted]">
                Zero config for Docker, K8s, Cloud Run. Respects PORT env var. 12-factor compliant.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Code Example */}
      <section className="border-t border-[--border-subtle]">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-[--text-primary] mb-2">
              Simple, Expressive API
            </h2>
            <p className="text-[--text-muted] text-sm">
              Build complete applications with a fluent, type-safe builder pattern.
            </p>
          </div>

          <div className="max-w-2xl">
            <div className="rounded-sm bg-[--code-bg] border border-[--code-border] overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[--code-border]">
                <span className="text-xs text-[--text-muted] font-mono">checkout.ts</span>
              </div>

              {/* Code */}
              <pre className="p-4 overflow-x-auto">
                <code className="text-[13px] font-mono leading-relaxed">
                  <CodeExample />
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[--border-subtle]">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[--text-primary] mb-1">
                Ready to build?
              </h2>
              <p className="text-[--text-muted] text-sm">
                Full documentation, examples, and guides.
              </p>
            </div>
            <Link
              to="/docs"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-sm bg-[--bg-secondary] border border-[--border-subtle] text-[--text-secondary] text-sm font-medium hover:border-[--border-default] transition-colors"
            >
              Read the Docs
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[--border-subtle]">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between text-xs text-[--text-muted]">
            <span>© {new Date().getFullYear()} OnePipe</span>
            <div className="flex items-center gap-4">
              <a href="https://github.com/ancs21/onepipe" className="hover:text-[--text-secondary] transition-colors">
                GitHub
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
