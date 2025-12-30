import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  Search,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  X,
  Activity,
  AlertTriangle,
  Gauge,
  BarChart3,
  Filter,
  Copy,
  Check,
  Layers,
  Zap,
  Server,
  Timer,
} from 'lucide-react'
import { useTracesFiltered, useTraceStats, useTraceServices } from '../lib/db'
import type { Trace, Span, TraceFilters, TimeRange, SpanEvent } from '../lib/types'

// ============================================================================
// Constants & Utilities
// ============================================================================

const TIME_PRESETS = [
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '6h', minutes: 360 },
  { label: '24h', minutes: 1440 },
] as const

const SERVICE_COLORS = [
  'bg-amber-500',
  'bg-emerald-500',
  'bg-cyan-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-blue-500',
  'bg-orange-500',
  'bg-teal-500',
]

function getServiceColor(serviceName: string, allServices: string[]): string {
  const index = allServices.indexOf(serviceName)
  return SERVICE_COLORS[index % SERVICE_COLORS.length]
}

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

// ============================================================================
// Mini Histogram Component
// ============================================================================

function MiniHistogram({ data, maxHeight = 32 }: { data: Array<{ bucket: string; count: number }>; maxHeight?: number }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1)

  return (
    <div className="flex items-end gap-px h-8" title="Duration distribution">
      {data.slice(0, 12).map((bucket, i) => {
        const height = (bucket.count / maxCount) * maxHeight
        return (
          <div
            key={i}
            className="w-2 bg-accent/60 rounded-t-sm transition-all hover:bg-accent"
            style={{ height: `${Math.max(height, 2)}px` }}
            title={`${bucket.bucket}: ${bucket.count}`}
          />
        )
      })}
    </div>
  )
}

// ============================================================================
// Stats Bar Component
// ============================================================================

function StatsBar({
  stats,
  isLoading,
}: {
  stats: { totalCount: number; errorCount: number; avgDuration: number; p50Duration: number; p95Duration: number; p99Duration: number; durationHistogram: Array<{ bucket: string; count: number }> } | null
  isLoading: boolean
}) {
  const errorRate = stats && stats.totalCount > 0 ? ((stats.errorCount / stats.totalCount) * 100).toFixed(1) : '0'

  return (
    <div className="grid grid-cols-6 gap-3">
      {/* Total Traces */}
      <div className="stat-card">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="w-3.5 h-3.5 text-accent" />
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Traces</span>
        </div>
        <div className="text-2xl font-semibold text-text-primary font-mono tabular-nums">
          {isLoading ? '—' : stats?.totalCount.toLocaleString() ?? 0}
        </div>
      </div>

      {/* Error Rate */}
      <div className="stat-card">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-3.5 h-3.5 text-status-error" />
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Error Rate</span>
        </div>
        <div className={`text-2xl font-semibold font-mono tabular-nums ${Number(errorRate) > 5 ? 'text-status-error' : 'text-text-primary'}`}>
          {isLoading ? '—' : `${errorRate}%`}
        </div>
      </div>

      {/* P50 */}
      <div className="stat-card">
        <div className="flex items-center gap-2 mb-1">
          <Gauge className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">P50</span>
        </div>
        <div className="text-2xl font-semibold text-text-primary font-mono tabular-nums">
          {isLoading ? '—' : formatDuration(stats?.p50Duration ?? 0)}
        </div>
      </div>

      {/* P95 */}
      <div className="stat-card">
        <div className="flex items-center gap-2 mb-1">
          <Gauge className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">P95</span>
        </div>
        <div className="text-2xl font-semibold text-text-primary font-mono tabular-nums">
          {isLoading ? '—' : formatDuration(stats?.p95Duration ?? 0)}
        </div>
      </div>

      {/* P99 */}
      <div className="stat-card">
        <div className="flex items-center gap-2 mb-1">
          <Gauge className="w-3.5 h-3.5 text-rose-500" />
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">P99</span>
        </div>
        <div className="text-2xl font-semibold text-text-primary font-mono tabular-nums">
          {isLoading ? '—' : formatDuration(stats?.p99Duration ?? 0)}
        </div>
      </div>

      {/* Histogram */}
      <div className="stat-card">
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 className="w-3.5 h-3.5 text-text-muted" />
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Distribution</span>
        </div>
        {stats?.durationHistogram && stats.durationHistogram.length > 0 ? (
          <MiniHistogram data={stats.durationHistogram} />
        ) : (
          <div className="text-xs text-text-muted">No data</div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Filter Bar Component
// ============================================================================

function FilterBar({
  filters,
  onFiltersChange,
  timeRange,
  onTimeRangeChange,
  services,
  onRefresh,
  isRefreshing,
}: {
  filters: TraceFilters
  onFiltersChange: (filters: TraceFilters) => void
  timeRange: TimeRange
  onTimeRangeChange: (range: TimeRange) => void
  services: string[]
  onRefresh: () => void
  isRefreshing: boolean
}) {
  const [showServiceDropdown, setShowServiceDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowServiceDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleService = (service: string) => {
    const newServices = filters.services.includes(service)
      ? filters.services.filter((s) => s !== service)
      : [...filters.services, service]
    onFiltersChange({ ...filters, services: newServices })
  }

  const activeFilterCount = [
    filters.status !== 'all',
    filters.services.length > 0,
    filters.minDuration !== null,
    filters.maxDuration !== null,
    filters.search !== '',
  ].filter(Boolean).length

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search operations..."
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="w-full pl-9 pr-3 py-2 bg-bg-secondary border border-border rounded-lg
                   text-sm text-text-primary placeholder:text-text-muted
                   focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent
                   transition-all"
        />
      </div>

      {/* Status Filter */}
      <div className="flex gap-1 p-1 bg-bg-secondary border border-border rounded-lg">
        {(['all', 'ok', 'error'] as const).map((status) => (
          <button
            key={status}
            onClick={() => onFiltersChange({ ...filters, status })}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              filters.status === status
                ? status === 'error'
                  ? 'bg-status-error/15 text-status-error'
                  : status === 'ok'
                  ? 'bg-status-success/15 text-status-success'
                  : 'bg-accent/10 text-accent'
                : 'text-text-muted hover:text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            {status === 'all' ? 'All' : status === 'ok' ? 'Success' : 'Errors'}
          </button>
        ))}
      </div>

      {/* Service Filter */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowServiceDropdown(!showServiceDropdown)}
          className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
            filters.services.length > 0
              ? 'bg-accent/10 border-accent/30 text-accent'
              : 'bg-bg-secondary border-border text-text-secondary hover:text-text-primary hover:border-border-hover'
          }`}
        >
          <Server className="w-3.5 h-3.5" />
          <span>Services</span>
          {filters.services.length > 0 && (
            <span className="px-1.5 py-0.5 bg-accent/20 rounded text-2xs">{filters.services.length}</span>
          )}
          <ChevronDown className={`w-3 h-3 transition-transform ${showServiceDropdown ? 'rotate-180' : ''}`} />
        </button>

        {showServiceDropdown && (
          <div className="absolute top-full left-0 mt-1 w-56 bg-bg-elevated border border-border rounded-lg shadow-elevated z-50 py-2 animate-slide-down">
            {services.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-muted">No services found</div>
            ) : (
              services.map((service) => (
                <button
                  key={service}
                  onClick={() => toggleService(service)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-bg-tertiary transition-colors"
                >
                  <div
                    className={`w-3 h-3 rounded border-2 transition-all ${
                      filters.services.includes(service)
                        ? 'bg-accent border-accent'
                        : 'border-border-hover'
                    }`}
                  >
                    {filters.services.includes(service) && <Check className="w-2 h-2 text-white" />}
                  </div>
                  <span className={`w-2 h-2 rounded-full ${getServiceColor(service, services)}`} />
                  <span className="font-mono">{service}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Duration Filter */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border border-border rounded-lg">
        <Timer className="w-3.5 h-3.5 text-text-muted" />
        <input
          type="number"
          placeholder="Min"
          value={filters.minDuration ?? ''}
          onChange={(e) => onFiltersChange({ ...filters, minDuration: e.target.value ? Number(e.target.value) : null })}
          className="w-16 bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <span className="text-text-muted">-</span>
        <input
          type="number"
          placeholder="Max"
          value={filters.maxDuration ?? ''}
          onChange={(e) => onFiltersChange({ ...filters, maxDuration: e.target.value ? Number(e.target.value) : null })}
          className="w-16 bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <span className="text-2xs text-text-muted">ms</span>
      </div>

      {/* Time Range Presets */}
      <div className="flex gap-1 p-1 bg-bg-secondary border border-border rounded-lg">
        {TIME_PRESETS.map((preset) => (
          <button
            key={preset.minutes}
            onClick={() => onTimeRangeChange({ type: 'relative', minutes: preset.minutes })}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all ${
              timeRange.type === 'relative' && timeRange.minutes === preset.minutes
                ? 'bg-accent/10 text-accent'
                : 'text-text-muted hover:text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Clear Filters */}
      {activeFilterCount > 0 && (
        <button
          onClick={() =>
            onFiltersChange({
              status: 'all',
              services: [],
              minDuration: null,
              maxDuration: null,
              search: '',
              httpStatusCodes: [],
            })
          }
          className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-3 h-3" />
          Clear ({activeFilterCount})
        </button>
      )}

      {/* Refresh */}
      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-secondary
                 hover:text-text-primary transition-colors disabled:opacity-50 ml-auto"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
        Refresh
      </button>
    </div>
  )
}

// ============================================================================
// Trace Row Component
// ============================================================================

function TraceRow({
  trace,
  isSelected,
  onSelect,
  services,
}: {
  trace: Trace
  isSelected: boolean
  onSelect: () => void
  services: string[]
}) {
  const statusCode = trace.rootSpan.attributes['http.status_code'] as number | undefined
  const method = trace.rootSpan.attributes['http.method'] as string | undefined
  const traceServices = trace.services || [trace.rootSpan.attributes['service.name'] as string || 'unknown']
  const spanCount = (trace.spans?.length || 0) + 1

  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all border-b border-border/30 group text-xs ${
        isSelected
          ? 'bg-accent/5 border-l-2 border-l-accent'
          : 'hover:bg-bg-tertiary/30 border-l-2 border-l-transparent'
      }`}
    >
      {/* Status Indicator */}
      <div
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          trace.status === 'error' ? 'bg-status-error' : 'bg-status-success'
        }`}
      />

      {/* Method Badge */}
      {method && (
        <span className={`w-10 text-center font-mono font-semibold text-2xs uppercase flex-shrink-0 ${
          method === 'GET' ? 'text-emerald-500' :
          method === 'POST' ? 'text-amber-500' :
          method === 'PUT' ? 'text-blue-500' :
          method === 'DELETE' ? 'text-rose-500' :
          method === 'PATCH' ? 'text-violet-500' :
          'text-text-muted'
        }`}>{method}</span>
      )}

      {/* Operation Path */}
      <span className="font-mono text-text-primary truncate flex-1 min-w-0">{trace.rootSpan.name}</span>

      {/* Services (inline, compact) */}
      <div className="w-24 flex items-center justify-end gap-1 flex-shrink-0 overflow-hidden">
        {traceServices.slice(0, 1).map((service, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-tertiary/80 text-2xs font-mono text-text-muted truncate max-w-[90px]"
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getServiceColor(service, services)}`} />
            <span className="truncate">{service}</span>
          </span>
        ))}
        {traceServices.length > 1 && (
          <span className="text-2xs text-text-muted flex-shrink-0">+{traceServices.length - 1}</span>
        )}
      </div>

      {/* Span Count */}
      <span className="w-8 text-center text-2xs text-text-muted font-mono tabular-nums flex-shrink-0" title={`${spanCount} spans`}>
        {spanCount}
      </span>

      {/* Status Code */}
      <span
        className={`w-9 text-center font-mono font-medium flex-shrink-0 ${
          !statusCode ? 'text-text-muted' :
          statusCode < 400 ? 'text-status-success' : 'text-status-error'
        }`}
      >
        {statusCode || '—'}
      </span>

      {/* Duration */}
      <span className="w-16 text-right font-mono text-text-secondary tabular-nums flex-shrink-0">
        {formatDuration(trace.totalDuration)}
      </span>

      {/* Time */}
      <span className="w-14 text-right text-text-muted font-mono tabular-nums flex-shrink-0">
        {formatTime(trace.timestamp)}
      </span>

      {/* Arrow */}
      <ChevronRight
        className={`w-3.5 h-3.5 text-text-muted transition-all flex-shrink-0 ${
          isSelected ? 'text-accent' : 'opacity-0 group-hover:opacity-100'
        }`}
      />
    </button>
  )
}

// ============================================================================
// Span Waterfall Component
// ============================================================================

function SpanWaterfall({
  trace,
  services,
}: {
  trace: Trace
  services: string[]
}) {
  const [collapsedSpans, setCollapsedSpans] = useState<Set<string>>(new Set())
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null)

  // Build span tree
  const spanMap = useMemo(() => {
    const map = new Map<string, Span>()
    map.set(trace.rootSpan.spanId, trace.rootSpan)
    trace.spans.forEach((span) => map.set(span.spanId, span))
    return map
  }, [trace])

  const childrenMap = useMemo(() => {
    const map = new Map<string, Span[]>()
    trace.spans.forEach((span) => {
      // Skip if span is the root span (prevent self-referencing)
      if (span.spanId === trace.rootSpan.spanId) return

      const parentId = span.parentSpanId || trace.rootSpan.spanId
      // Skip if span would be its own parent (prevent infinite recursion)
      if (parentId === span.spanId) return

      const children = map.get(parentId) || []
      children.push(span)
      map.set(parentId, children)
    })
    return map
  }, [trace])

  // Flatten tree for rendering with cycle detection
  const flattenTree = useCallback(
    (spanId: string, depth: number, visited = new Set<string>()): Array<{ span: Span; depth: number }> => {
      // Prevent infinite recursion from circular references
      if (visited.has(spanId) || depth > 100) return []
      visited.add(spanId)

      const span = spanMap.get(spanId)
      if (!span) return []

      const result: Array<{ span: Span; depth: number }> = [{ span, depth }]

      if (!collapsedSpans.has(spanId)) {
        const children = childrenMap.get(spanId) || []
        children
          .sort((a, b) => a.startTime - b.startTime)
          .forEach((child) => {
            result.push(...flattenTree(child.spanId, depth + 1, visited))
          })
      }

      return result
    },
    [spanMap, childrenMap, collapsedSpans]
  )

  const flatSpans = useMemo(() => flattenTree(trace.rootSpan.spanId, 0), [flattenTree, trace.rootSpan.spanId])

  const toggleCollapse = (spanId: string) => {
    setCollapsedSpans((prev) => {
      const next = new Set(prev)
      if (next.has(spanId)) {
        next.delete(spanId)
      } else {
        next.add(spanId)
      }
      return next
    })
  }

  // Timeline markers
  const timelineMarkers = useMemo(() => {
    const markers = []
    const intervals = [0, 0.25, 0.5, 0.75, 1]
    for (const i of intervals) {
      markers.push({
        position: i * 100,
        label: formatDuration(i * trace.totalDuration),
      })
    }
    return markers
  }, [trace.totalDuration])

  // Find min start time for offset calculation
  const minStartTime = useMemo(() => {
    return Math.min(trace.rootSpan.startTime, ...trace.spans.map((s) => s.startTime))
  }, [trace])

  return (
    <div className="flex flex-col h-full">
      {/* Timeline Ruler */}
      <div className="relative h-8 border-b border-border bg-bg-tertiary/30 flex-shrink-0">
        <div className="absolute inset-0 flex items-center px-4">
          <div className="w-48 flex-shrink-0" />
          <div className="flex-1 relative h-full">
            {timelineMarkers.map((marker, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 flex flex-col items-center"
                style={{ left: `${marker.position}%` }}
              >
                <div className="w-px h-2 bg-border-hover" />
                <span className="text-2xs text-text-muted font-mono mt-1">{marker.label}</span>
              </div>
            ))}
          </div>
          <div className="w-20 flex-shrink-0" />
        </div>
      </div>

      {/* Spans */}
      <div className="flex-1 overflow-y-auto">
        {flatSpans.map(({ span, depth }) => {
          const hasChildren = (childrenMap.get(span.spanId)?.length || 0) > 0
          const isCollapsed = collapsedSpans.has(span.spanId)
          const serviceName = span.attributes['service.name'] as string || 'unknown'
          const startOffset = span.startTime - minStartTime
          const left = (startOffset / trace.totalDuration) * 100
          const width = Math.max((span.duration / trace.totalDuration) * 100, 0.5)

          return (
            <div
              key={span.spanId}
              onClick={() => setSelectedSpan(selectedSpan?.spanId === span.spanId ? null : span)}
              className={`flex items-center gap-2 py-2 px-4 border-b border-border/30 cursor-pointer transition-colors ${
                selectedSpan?.spanId === span.spanId ? 'bg-accent/5' : 'hover:bg-bg-tertiary/30'
              }`}
            >
              {/* Collapse toggle & name */}
              <div
                className="w-48 flex-shrink-0 flex items-center gap-1"
                style={{ paddingLeft: `${depth * 16}px` }}
              >
                {hasChildren ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleCollapse(span.spanId)
                    }}
                    className="p-0.5 hover:bg-bg-tertiary rounded"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-3 h-3 text-text-muted" />
                    ) : (
                      <ChevronDown className="w-3 h-3 text-text-muted" />
                    )}
                  </button>
                ) : (
                  <div className="w-4" />
                )}
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getServiceColor(serviceName, services)}`} />
                <span className="font-mono text-xs text-text-primary truncate" title={span.name}>
                  {span.name}
                </span>
                {span.status === 'error' && (
                  <AlertTriangle className="w-3 h-3 text-status-error flex-shrink-0" />
                )}
              </div>

              {/* Timeline bar */}
              <div className="flex-1 h-6 relative">
                <div className="absolute inset-0 flex items-center">
                  {/* Gridlines */}
                  <div className="absolute inset-0 flex">
                    {[0.25, 0.5, 0.75].map((p) => (
                      <div key={p} className="absolute top-0 bottom-0 w-px bg-border/30" style={{ left: `${p * 100}%` }} />
                    ))}
                  </div>

                  {/* Span bar */}
                  <div
                    className={`absolute h-4 rounded-sm transition-all ${
                      span.status === 'error'
                        ? 'bg-status-error/80'
                        : `${getServiceColor(serviceName, services).replace('bg-', 'bg-')}/80`
                    }`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      minWidth: '4px',
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent rounded-sm" />
                  </div>
                </div>
              </div>

              {/* Duration */}
              <div className="w-20 flex-shrink-0 text-right">
                <span className="font-mono text-xs text-text-secondary tabular-nums">{formatDuration(span.duration)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Selected Span Detail */}
      {selectedSpan && (
        <SpanDetail
          span={selectedSpan}
          onClose={() => setSelectedSpan(null)}
        />
      )}
    </div>
  )
}

// ============================================================================
// Span Detail Component
// ============================================================================

function SpanDetail({ span, onClose }: { span: Span; onClose: () => void }) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['attributes']))

  const copyToClipboard = (key: string, value: string) => {
    navigator.clipboard.writeText(value)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  const attributes = Object.entries(span.attributes)

  return (
    <div className="border-t border-border bg-bg-secondary/50 animate-slide-up">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-accent" />
          <span className="font-medium text-sm text-text-primary">Span Details</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-bg-tertiary rounded transition-colors">
          <X className="w-4 h-4 text-text-muted" />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {/* Summary */}
        <div className="px-4 py-3 border-b border-border/50">
          <div className="grid grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-text-muted">Span ID</span>
              <div className="font-mono text-text-primary mt-0.5 truncate" title={span.spanId}>
                {span.spanId.slice(0, 16)}...
              </div>
            </div>
            <div>
              <span className="text-text-muted">Duration</span>
              <div className="font-mono text-text-primary mt-0.5">{formatDuration(span.duration)}</div>
            </div>
            <div>
              <span className="text-text-muted">Status</span>
              <div className={`font-mono mt-0.5 ${span.status === 'error' ? 'text-status-error' : 'text-status-success'}`}>
                {span.status}
              </div>
            </div>
            <div>
              <span className="text-text-muted">Started</span>
              <div className="font-mono text-text-primary mt-0.5">{formatTimestamp(span.startTime)}</div>
            </div>
          </div>
          {span.statusMessage && (
            <div className="mt-3 p-2 bg-status-error/10 border border-status-error/20 rounded text-xs text-status-error font-mono">
              {span.statusMessage}
            </div>
          )}
        </div>

        {/* Attributes */}
        <div>
          <button
            onClick={() => toggleSection('attributes')}
            className="w-full flex items-center justify-between px-4 py-2 hover:bg-bg-tertiary/30 transition-colors"
          >
            <span className="text-xs font-medium text-text-secondary">
              Attributes ({attributes.length})
            </span>
            <ChevronRight
              className={`w-4 h-4 text-text-muted transition-transform ${expandedSections.has('attributes') ? 'rotate-90' : ''}`}
            />
          </button>
          {expandedSections.has('attributes') && (
            <div className="px-4 pb-3">
              <div className="border border-border rounded-lg overflow-hidden">
                {attributes.map(([key, value], i) => (
                  <div
                    key={key}
                    className={`flex items-center gap-3 px-3 py-2 text-xs ${i > 0 ? 'border-t border-border/50' : ''}`}
                  >
                    <span className="font-mono text-text-muted flex-shrink-0 w-32 truncate" title={key}>
                      {key}
                    </span>
                    <span className="font-mono text-text-primary flex-1 truncate" title={String(value)}>
                      {String(value)}
                    </span>
                    <button
                      onClick={() => copyToClipboard(key, String(value))}
                      className="p-1 hover:bg-bg-tertiary rounded transition-colors flex-shrink-0"
                    >
                      {copiedKey === key ? (
                        <Check className="w-3 h-3 text-status-success" />
                      ) : (
                        <Copy className="w-3 h-3 text-text-muted" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Events */}
        {span.events && span.events.length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('events')}
              className="w-full flex items-center justify-between px-4 py-2 hover:bg-bg-tertiary/30 transition-colors"
            >
              <span className="text-xs font-medium text-text-secondary">
                Events ({span.events.length})
              </span>
              <ChevronRight
                className={`w-4 h-4 text-text-muted transition-transform ${expandedSections.has('events') ? 'rotate-90' : ''}`}
              />
            </button>
            {expandedSections.has('events') && (
              <div className="px-4 pb-3 space-y-2">
                {span.events.map((event: SpanEvent, i: number) => (
                  <div key={i} className="border border-border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-text-primary">{event.name}</span>
                      <span className="text-2xs text-text-muted font-mono">{formatTimestamp(event.timestamp)}</span>
                    </div>
                    {event.attributes && Object.keys(event.attributes).length > 0 && (
                      <div className="mt-2 text-2xs font-mono text-text-muted">
                        {JSON.stringify(event.attributes, null, 2)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Detail Panel Component
// ============================================================================

function DetailPanel({
  trace,
  services,
  onClose,
}: {
  trace: Trace
  services: string[]
  onClose: () => void
}) {
  const statusCode = trace.rootSpan.attributes['http.status_code'] as number | undefined
  const method = trace.rootSpan.attributes['http.method'] as string | undefined

  return (
    <div className="w-[520px] flex-shrink-0 border-l border-border bg-bg-secondary flex flex-col animate-slide-left">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-tertiary/30">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className={`w-3 h-3 rounded-full flex-shrink-0 ${
              trace.status === 'error' ? 'bg-status-error' : 'bg-status-success'
            }`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {method && (
                <span className="text-xs font-mono font-semibold text-text-muted uppercase">{method}</span>
              )}
              <span className="font-mono text-sm text-text-primary truncate">{trace.rootSpan.name}</span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
              <span className="font-mono">{trace.traceId.slice(0, 16)}...</span>
              <span>{trace.spans.length + 1} spans</span>
              {statusCode && (
                <span className={statusCode < 400 ? 'text-status-success' : 'text-status-error'}>{statusCode}</span>
              )}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors flex-shrink-0">
          <X className="w-4 h-4 text-text-muted" />
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-px bg-border">
        <div className="bg-bg-secondary px-4 py-3">
          <div className="text-xs text-text-muted mb-1">Total Duration</div>
          <div className="text-lg font-mono font-semibold text-text-primary">{formatDuration(trace.totalDuration)}</div>
        </div>
        <div className="bg-bg-secondary px-4 py-3">
          <div className="text-xs text-text-muted mb-1">Started</div>
          <div className="text-sm font-mono text-text-primary">{formatTimestamp(trace.timestamp)}</div>
        </div>
        <div className="bg-bg-secondary px-4 py-3">
          <div className="text-xs text-text-muted mb-1">Services</div>
          <div className="flex gap-1 flex-wrap">
            {(trace.services || []).slice(0, 4).map((service, i) => (
              <span key={i} className={`w-2 h-2 rounded-full ${getServiceColor(service, services)}`} title={service} />
            ))}
          </div>
        </div>
      </div>

      {/* Waterfall */}
      <div className="flex-1 overflow-hidden">
        <SpanWaterfall trace={trace} services={services} />
      </div>
    </div>
  )
}

// ============================================================================
// Keyboard Shortcuts Hook
// ============================================================================

function useKeyboardShortcuts({
  traces,
  selectedIndex,
  setSelectedIndex,
  selectedTraceId,
  setSelectedTraceId,
  filters,
  setFilters,
  refetch,
}: {
  traces: Trace[]
  selectedIndex: number
  setSelectedIndex: (i: number) => void
  selectedTraceId: string | null
  setSelectedTraceId: (id: string | null) => void
  filters: TraceFilters
  setFilters: (f: TraceFilters) => void
  refetch: () => void
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.key) {
        case 'j':
          e.preventDefault()
          if (selectedIndex < traces.length - 1) {
            setSelectedIndex(selectedIndex + 1)
          }
          break
        case 'k':
          e.preventDefault()
          if (selectedIndex > 0) {
            setSelectedIndex(selectedIndex - 1)
          }
          break
        case 'Enter':
          e.preventDefault()
          if (traces[selectedIndex]) {
            setSelectedTraceId(traces[selectedIndex].traceId)
          }
          break
        case 'Escape':
          e.preventDefault()
          setSelectedTraceId(null)
          break
        case 'e':
          e.preventDefault()
          setFilters({
            ...filters,
            status: filters.status === 'error' ? 'all' : 'error',
          })
          break
        case 'r':
          e.preventDefault()
          refetch()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [traces, selectedIndex, selectedTraceId, filters, setSelectedIndex, setSelectedTraceId, setFilters, refetch])
}

// ============================================================================
// Main Traces Component
// ============================================================================

export function Traces() {
  // State
  const [filters, setFilters] = useState<TraceFilters>({
    status: 'all',
    services: [],
    minDuration: null,
    maxDuration: null,
    search: '',
    httpStatusCodes: [],
  })
  const [timeRange, setTimeRange] = useState<TimeRange>({ type: 'relative', minutes: 15 })
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Data fetching
  const { data: tracesResponse, isLoading, refetch } = useTracesFiltered(filters, timeRange, 100, 0)
  const { data: stats, isLoading: statsLoading } = useTraceStats(timeRange)
  const { data: servicesResponse } = useTraceServices()

  const traces = tracesResponse?.traces || []
  const services = servicesResponse?.services?.map((s) => s.name) || []

  const selectedTrace = useMemo(() => {
    return traces.find((t) => t.traceId === selectedTraceId) || null
  }, [traces, selectedTraceId])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    traces,
    selectedIndex,
    setSelectedIndex,
    selectedTraceId,
    setSelectedTraceId,
    filters,
    setFilters,
    refetch,
  })

  // Sync selected index with trace selection
  useEffect(() => {
    if (selectedTraceId) {
      const index = traces.findIndex((t) => t.traceId === selectedTraceId)
      if (index >= 0) setSelectedIndex(index)
    }
  }, [selectedTraceId, traces])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border bg-bg-primary">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-text-primary flex items-center gap-3">
              Distributed Traces
            </h1>
            <p className="text-sm text-text-muted mt-1">
              Monitor request flows across your services
            </p>
          </div>
          <div className="text-xs text-text-muted">
            Press <kbd className="px-1.5 py-0.5 bg-bg-tertiary border border-border rounded text-text-secondary">j</kbd>
            <kbd className="px-1.5 py-0.5 bg-bg-tertiary border border-border rounded text-text-secondary ml-1">k</kbd>
            {' '}to navigate, <kbd className="px-1.5 py-0.5 bg-bg-tertiary border border-border rounded text-text-secondary ml-1">Enter</kbd>
            {' '}to select
          </div>
        </div>

        {/* Stats */}
        <StatsBar stats={stats || null} isLoading={statsLoading} />
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-border bg-bg-secondary/50">
        <FilterBar
          filters={filters}
          onFiltersChange={setFilters}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          services={services}
          onRefresh={refetch}
          isRefreshing={isLoading}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Trace List */}
        <div className="flex-1 overflow-y-auto bg-bg-primary">
          {/* Column headers */}
          <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-tertiary/70 backdrop-blur-sm text-2xs font-medium text-text-muted uppercase tracking-wider">
            <div className="w-1.5" />
            <span className="w-10 text-center">Method</span>
            <span className="flex-1">Operation</span>
            <span className="w-24 text-center">Services</span>
            <span className="w-8 text-center">Spans</span>
            <span className="w-9 text-center">Status</span>
            <span className="w-16 text-right">Duration</span>
            <span className="w-14 text-right">Time</span>
            <div className="w-3.5" />
          </div>

          {/* Loading state */}
          {isLoading && traces.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-5 h-5 text-text-muted animate-spin" />
            </div>
          )}

          {/* Empty state */}
          {!isLoading && traces.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <Filter className="w-8 h-8 mb-3 opacity-50" />
              <p className="text-sm">No traces found</p>
              <p className="text-xs mt-1">Try adjusting your filters or time range</p>
            </div>
          )}

          {/* Trace rows */}
          {traces.map((trace, i) => (
            <TraceRow
              key={trace.traceId}
              trace={trace}
              isSelected={selectedTraceId === trace.traceId || selectedIndex === i}
              onSelect={() => {
                setSelectedTraceId(trace.traceId)
                setSelectedIndex(i)
              }}
              services={services}
            />
          ))}

          {/* Load more indicator */}
          {tracesResponse?.hasMore && (
            <div className="flex items-center justify-center py-4 text-xs text-text-muted">
              <span>Showing {traces.length} of {tracesResponse.total} traces</span>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedTrace && (
          <DetailPanel
            trace={selectedTrace}
            services={services}
            onClose={() => setSelectedTraceId(null)}
          />
        )}
      </div>
    </div>
  )
}
