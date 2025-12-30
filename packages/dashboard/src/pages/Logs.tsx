import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, Pause, Play, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { useLogs } from '../lib/db'
import { api } from '../lib/api'
import type { LogEntry, LogLevel } from '../lib/types'

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}

function LogLevelBadge({ level }: { level: LogLevel }) {
  const classes: Record<LogLevel, string> = {
    debug: 'log-badge log-badge-debug',
    info: 'log-badge log-badge-info',
    warn: 'log-badge log-badge-warn',
    error: 'log-badge log-badge-error',
    fatal: 'log-badge log-badge-fatal',
  }
  return <span className={classes[level]}>{level.toUpperCase()}</span>
}

function LogRow({ log, isExpanded, onToggle }: { log: LogEntry; isExpanded: boolean; onToggle: () => void }) {
  const hasContext = log.context && Object.keys(log.context).length > 0

  return (
    <div className="border-b border-border hover:bg-bg-tertiary/30 transition-colors">
      <div
        className="flex items-start gap-3 px-4 py-2 cursor-pointer"
        onClick={onToggle}
      >
        {hasContext ? (
          isExpanded ? (
            <ChevronDown className="w-3 h-3 text-text-muted mt-1 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-text-muted mt-1 flex-shrink-0" />
          )
        ) : (
          <div className="w-3" />
        )}
        <span className="font-mono text-xs text-text-muted w-24 flex-shrink-0">
          {formatTimestamp(log.timestamp)}
        </span>
        <LogLevelBadge level={log.level} />
        <span className="font-mono text-sm text-text-primary flex-1 break-all">
          {log.message}
        </span>
        {log.traceId && (
          <span className="font-mono text-2xs text-accent/60 flex-shrink-0">
            {log.traceId.slice(0, 8)}
          </span>
        )}
      </div>

      {isExpanded && hasContext && (
        <div className="px-4 pb-3 pl-16 animate-slide-down">
          <pre className="p-3 bg-bg-primary border border-border rounded-md overflow-auto text-xs">
            <code className="font-mono text-text-secondary">
              {JSON.stringify(log.context, null, 2)}
            </code>
          </pre>
        </div>
      )}
    </div>
  )
}

export function Logs() {
  // Initial load via TanStack Query with auto-refresh as fallback
  const { data: initialLogs = [], error: queryError } = useLogs(200)
  const [streamLogs, setStreamLogs] = useState<LogEntry[]>([])
  const [isPaused, setIsPaused] = useState(false)
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all')
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isPausedRef = useRef(isPaused)

  // Combine initial logs with stream logs
  const logs = useMemo(() => {
    // Dedupe by id, preferring stream logs (newer)
    const idSet = new Set(streamLogs.map(l => l.id))
    const uniqueInitial = initialLogs.filter(l => !idSet.has(l.id))
    return [...uniqueInitial, ...streamLogs].slice(-500)
  }, [initialLogs, streamLogs])

  const error = queryError ? 'Failed to load logs' : streamError

  // Keep ref in sync
  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  // Subscribe to SSE stream for live updates
  useEffect(() => {
    const unsubscribe = api.subscribeLogs(
      (log) => {
        if (!isPausedRef.current) {
          setStreamLogs((prev) => [...prev.slice(-499), log])
        }
      },
      (err) => {
        setStreamError('Log stream disconnected')
        console.error('Log stream error:', err)
      }
    )

    return unsubscribe
  }, [])

  // Auto-scroll to bottom when new logs arrive (if not paused)
  useEffect(() => {
    if (!isPaused && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs, isPaused])

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (levelFilter !== 'all' && log.level !== levelFilter) return false
      if (search && !log.message.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [logs, levelFilter, search])

  const levelCounts = useMemo(() => {
    return logs.reduce(
      (acc, log) => {
        acc[log.level] = (acc[log.level] || 0) + 1
        return acc
      },
      {} as Record<LogLevel, number>
    )
  }, [logs])

  return (
    <div className="h-full p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Logs</h1>
        <p className="text-sm text-text-secondary mt-1">
          Real-time structured logging from your services
        </p>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-4 bg-status-error/10 text-status-error rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-6">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-text-primary">{logs.length}</span>
          <span className="text-sm text-text-secondary">total</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-log-error">{levelCounts.error || 0}</span>
          <span className="text-sm text-text-secondary">errors</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-log-warn">{levelCounts.warn || 0}</span>
          <span className="text-sm text-text-secondary">warnings</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-bg-secondary border border-border rounded-md
                     text-sm text-text-primary placeholder:text-text-muted
                     focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div className="flex gap-1 p-1 bg-bg-secondary border border-border rounded-md">
          {(['all', 'debug', 'info', 'warn', 'error'] as const).map((level) => (
            <button
              key={level}
              onClick={() => setLevelFilter(level)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                levelFilter === level
                  ? level === 'all'
                    ? 'bg-accent/10 text-accent'
                    : `bg-log-${level}/20 text-log-${level}`
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex gap-1 ml-auto">
          <button
            onClick={() => setIsPaused(!isPaused)}
            aria-label={isPaused ? 'Resume log stream' : 'Pause log stream'}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
              isPaused
                ? 'bg-status-warning/10 text-status-warning'
                : 'bg-bg-secondary text-text-secondary hover:text-text-primary'
            }`}
          >
            {isPaused ? (
              <>
                <Play className="w-3 h-3" aria-hidden="true" />
                Resume
              </>
            ) : (
              <>
                <Pause className="w-3 h-3" aria-hidden="true" />
                Pause
              </>
            )}
          </button>
          <button
            onClick={() => setStreamLogs([])}
            aria-label="Clear all logs"
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-secondary
                     hover:text-text-primary transition-colors"
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" />
            Clear
          </button>
        </div>
      </div>

      {/* Live indicator */}
      {!isPaused && (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-status-success animate-pulse" />
          <span className="text-xs text-text-muted">Live</span>
        </div>
      )}

      {/* Logs list */}
      <div className="card overflow-hidden">
        <div
          ref={containerRef}
          className="max-h-[600px] overflow-auto font-mono"
        >
          {filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-text-muted">No logs found</div>
          ) : (
            filteredLogs.map((log) => (
              <LogRow
                key={log.id}
                log={log}
                isExpanded={expandedLog === log.id}
                onToggle={() =>
                  setExpandedLog(expandedLog === log.id ? null : log.id)
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
