/**
 * Dashboard Data Collector
 *
 * Collects and aggregates data from SDK modules for dashboard display
 */

import type { RESTInstance, FlowInstance } from '@onepipe/sdk'
import { TraceStore } from './trace-store'

// Types
export interface RouteInfo {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  auth: boolean
}

export interface SpanEvent {
  name: string
  timestamp: number
  attributes?: Record<string, string | number | boolean>
}

export interface SpanData {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTime: number
  endTime: number
  duration: number
  status: 'ok' | 'error' | 'unset'
  statusMessage?: string
  attributes: Record<string, string | number | boolean>
  events?: SpanEvent[]
}

export interface TraceData {
  traceId: string
  rootSpan: SpanData
  spans: SpanData[]
  totalDuration: number
  status: 'ok' | 'error'
  timestamp: number
  services?: string[]
  spanCount?: number
}

export interface TraceFilterParams {
  limit: number
  offset: number
  status?: 'ok' | 'error' | 'all' | null
  services?: string[]
  minDuration?: number | null
  maxDuration?: number | null
  startTime?: number | null
  endTime?: number | null
  search?: string
  httpStatus?: number[]
  sortBy?: 'time' | 'duration'
  sortOrder?: 'asc' | 'desc'
}

export interface TraceStats {
  totalCount: number
  errorCount: number
  avgDuration: number
  p50Duration: number
  p95Duration: number
  p99Duration: number
  services: Array<{
    name: string
    requestCount: number
    errorCount: number
    avgDuration: number
  }>
  errorsByType: Record<string, number>
  durationHistogram: Array<{ bucket: string; count: number }>
}

export interface LogEntry {
  id: string
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  message: string
  timestamp: string
  service?: string
  traceId?: string
  context?: Record<string, unknown>
}

export interface FlowEvent {
  id: string
  flowName: string
  data: unknown
  timestamp: number
  offset: string
}

export interface FlowInfo {
  name: string
  eventCount: number
  lastOffset?: string
  events: FlowEvent[]
}

export interface ServiceInfo {
  name: string
  type: 'rest' | 'flow' | 'db' | 'auth'
  basePath?: string
  routes: RouteInfo[]
  requestCount: number
  errorCount: number
}

export interface ServiceDependency {
  source: string
  target: string
  callCount: number
  errorCount: number
  totalLatency: number
}

export interface ServiceGraph {
  services: ServiceInfo[]
  dependencies: { source: string; target: string; callCount: number; errorCount: number; avgLatency: number }[]
}

export interface DatabaseInfo {
  name: string
  type: 'postgres' | 'mysql' | 'sqlite'
}

// Ring buffer for storing recent items
class RingBuffer<T> {
  private buffer: T[] = []
  private maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  push(item: T): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift()
    }
    this.buffer.push(item)
  }

  getAll(): T[] {
    return [...this.buffer]
  }

  clear(): void {
    this.buffer = []
  }

  get length(): number {
    return this.buffer.length
  }
}

/**
 * Dashboard Collector - aggregates data from SDK modules
 */
export class DashboardCollector {
  private routes: RouteInfo[] = []
  private traceStore: TraceStore
  private logs = new RingBuffer<LogEntry>(5000)
  private flows: Map<string, FlowInfo> = new Map()
  private services: Map<string, ServiceInfo> = new Map()
  private dependencies: Map<string, ServiceDependency> = new Map()
  private databases: Map<string, DatabaseInfo> = new Map()
  private databaseConnections: Map<string, { url: string }> = new Map()
  private logSubscribers: Set<(log: LogEntry) => void> = new Set()
  private logIdCounter = 0

  constructor() {
    this.traceStore = new TraceStore()
  }

  /**
   * Register REST API routes
   */
  registerRest(api: RESTInstance): void {
    // Create service from API
    const service: ServiceInfo = {
      name: api.name,
      type: 'rest',
      routes: [],
      requestCount: 0,
      errorCount: 0,
    }

    for (const route of api.routes) {
      const routeInfo: RouteInfo = {
        method: route.method,
        path: `${api.basePath}${route.path}`,
        auth: !route.options?.public,
      }
      this.routes.push(routeInfo)
      service.routes.push(routeInfo)
    }

    this.services.set(api.name, service)
  }

  /**
   * Register routes directly (from SDK registration)
   */
  registerRoutes(routes: RouteInfo[], serviceName?: string): void {
    // Derive service name from base path if not provided
    const derivedServiceName = serviceName || this.deriveServiceName(routes)

    // Get or create service
    let service = this.services.get(derivedServiceName)
    if (!service) {
      service = {
        name: derivedServiceName,
        type: 'rest',
        routes: [],
        requestCount: 0,
        errorCount: 0,
      }
      this.services.set(derivedServiceName, service)
    }

    for (const route of routes) {
      // Avoid duplicates in global routes
      const existsGlobal = this.routes.some(
        (r) => r.method === route.method && r.path === route.path
      )
      if (!existsGlobal) {
        this.routes.push(route)
      }

      // Add to service routes
      const existsService = service.routes.some(
        (r) => r.method === route.method && r.path === route.path
      )
      if (!existsService) {
        service.routes.push(route)
      }
    }
  }

  /**
   * Derive service name from routes' base path
   */
  private deriveServiceName(routes: RouteInfo[]): string {
    if (routes.length === 0) return 'unknown-service'

    // Extract common base path like /api/todos -> todos-api
    const firstPath = routes[0].path
    const match = firstPath.match(/^\/api\/([^/]+)/)
    if (match) {
      return `${match[1]}-api`
    }

    // Fallback: use first path segment
    const segments = firstPath.split('/').filter(Boolean)
    return segments[0] ? `${segments[0]}-service` : 'api-service'
  }

  /**
   * Register a flow
   */
  registerFlow<T>(flow: FlowInstance<T>): void {
    this.flows.set(flow.name, {
      name: flow.name,
      eventCount: 0,
      lastOffset: undefined,
      events: [],
    })
  }

  /**
   * Register a flow by name (from SDK)
   */
  registerFlowByName(name: string): void {
    if (!this.flows.has(name)) {
      this.flows.set(name, {
        name,
        eventCount: 0,
        lastOffset: undefined,
        events: [],
      })
    }
  }

  /**
   * Add an event to a flow
   */
  addFlowEvent(event: FlowEvent): void {
    let flow = this.flows.get(event.flowName)
    if (!flow) {
      flow = {
        name: event.flowName,
        eventCount: 0,
        lastOffset: undefined,
        events: [],
      }
      this.flows.set(event.flowName, flow)
    }

    flow.events.push(event)
    flow.eventCount++
    flow.lastOffset = event.offset

    // Keep only last 100 events per flow
    if (flow.events.length > 100) {
      flow.events = flow.events.slice(-100)
    }
  }

  /**
   * Get events for a specific flow
   */
  getFlowEvents(flowName: string): FlowEvent[] {
    const flow = this.flows.get(flowName)
    return flow?.events || []
  }

  /**
   * Record a trace and update service metrics
   */
  addTrace(trace: TraceData): void {
    this.traceStore.addTrace(trace)

    // Extract service info from trace spans
    for (const span of trace.spans) {
      const serviceName = span.attributes['service.name'] as string
      if (!serviceName) continue

      // Update or create service
      let service = this.services.get(serviceName)
      if (!service) {
        service = {
          name: serviceName,
          type: 'rest',
          routes: [],
          requestCount: 0,
          errorCount: 0,
        }
        this.services.set(serviceName, service)
      }

      service.requestCount++
      if (span.status === 'error') {
        service.errorCount++
      }

      // Track route for this service
      const route = span.attributes['http.route'] as string
      const method = span.attributes['http.method'] as string
      if (route && method) {
        const exists = service.routes.some(
          (r) => r.method === method && r.path === route
        )
        if (!exists) {
          service.routes.push({
            method: method as RouteInfo['method'],
            path: route,
            auth: false,
          })
        }
      }

      // Track dependencies (if span has target service)
      const targetService = span.attributes['target.service'] as string
      if (targetService && targetService !== serviceName) {
        const depKey = `${serviceName}->${targetService}`
        let dep = this.dependencies.get(depKey)
        if (!dep) {
          dep = {
            source: serviceName,
            target: targetService,
            callCount: 0,
            errorCount: 0,
            totalLatency: 0,
          }
          this.dependencies.set(depKey, dep)
        }
        dep.callCount++
        dep.totalLatency += span.duration

        // Track errors (HTTP status >= 400 or span status error)
        const httpStatus = span.attributes['http.status_code'] as number | undefined
        const spanStatus = span.status?.code
        if ((httpStatus && httpStatus >= 400) || spanStatus === 2) {
          dep.errorCount++
        }
      }
    }
  }

  /**
   * Record a log entry
   */
  addLog(entry: Omit<LogEntry, 'id'>): void {
    const log: LogEntry = {
      ...entry,
      id: `log-${++this.logIdCounter}`,
    }
    this.logs.push(log)

    // Notify subscribers
    for (const subscriber of this.logSubscribers) {
      subscriber(log)
    }
  }

  /**
   * Subscribe to new log entries
   */
  subscribeLogs(callback: (log: LogEntry) => void): () => void {
    this.logSubscribers.add(callback)
    return () => this.logSubscribers.delete(callback)
  }

  /**
   * Get all registered routes
   */
  getRoutes(): RouteInfo[] {
    return this.routes
  }

  /**
   * Get recent traces
   */
  getTraces(limit = 50): TraceData[] {
    const result = this.traceStore.getTraces({
      limit,
      offset: 0,
      sortBy: 'time',
      sortOrder: 'desc',
    })
    return result.traces
  }

  /**
   * Get a single trace by ID
   */
  getTrace(traceId: string): TraceData | undefined {
    return this.traceStore.getTrace(traceId) || undefined
  }

  /**
   * Get traces with filtering, pagination, and sorting
   */
  getTracesFiltered(params: TraceFilterParams): { traces: TraceData[]; total: number; hasMore: boolean } {
    return this.traceStore.getTraces(params)
  }

  /**
   * Extract unique service names from a trace
   */
  private extractServicesFromTrace(trace: TraceData): string[] {
    if (trace.services) return trace.services
    const services = new Set<string>()
    for (const span of trace.spans) {
      const serviceName = span.attributes['service.name'] as string
      if (serviceName) services.add(serviceName)
    }
    return Array.from(services)
  }

  /**
   * Get trace statistics
   */
  getTraceStats(startTime?: number, endTime?: number, _services?: string[]): TraceStats {
    // Note: service filtering is not supported in SQLite stats query yet
    return this.traceStore.getStats(startTime, endTime)
  }

  /**
   * Get list of available services from traces
   */
  getAvailableServices(): Array<{ name: string; traceCount: number; lastSeen: number }> {
    const services = this.traceStore.getServices()
    return services.map((s) => ({
      name: s.name,
      traceCount: s.requestCount,
      lastSeen: Date.now(), // TraceStore doesn't track lastSeen yet
    })).sort((a, b) => b.traceCount - a.traceCount)
  }

  /**
   * Get recent logs
   */
  getLogs(limit = 100): LogEntry[] {
    return this.logs.getAll().slice(-limit)
  }

  /**
   * Get all registered flows
   */
  getFlows(): FlowInfo[] {
    return Array.from(this.flows.values())
  }

  /**
   * Get service graph (services + dependencies)
   */
  getServiceGraph(): ServiceGraph {
    const services = Array.from(this.services.values())
    const dependencies = Array.from(this.dependencies.values()).map((dep) => ({
      source: dep.source,
      target: dep.target,
      callCount: dep.callCount,
      errorCount: dep.errorCount,
      avgLatency: dep.callCount > 0 ? Math.round(dep.totalLatency / dep.callCount) : 0,
    }))

    return { services, dependencies }
  }

  /**
   * Update flow info
   */
  updateFlow(name: string, eventCount: number, lastOffset?: string): void {
    const flow = this.flows.get(name)
    if (flow) {
      flow.eventCount = eventCount
      flow.lastOffset = lastOffset
    }
  }

  /**
   * Register a database
   */
  registerDatabase(info: DatabaseInfo & { url?: string }): void {
    this.databases.set(info.name, {
      name: info.name,
      type: info.type,
    })
    if (info.url) {
      this.databaseConnections.set(info.name, { url: info.url })
    }
  }

  /**
   * Get all registered databases
   */
  getDatabases(): DatabaseInfo[] {
    return Array.from(this.databases.values())
  }

  /**
   * Get database connection info (for proxying queries)
   */
  getDatabaseConnection(name: string): { url: string } | undefined {
    return this.databaseConnections.get(name)
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.traceStore.clear()
    this.logs.clear()
  }
}

// Global collector instance
let globalCollector: DashboardCollector | null = null

export function getCollector(): DashboardCollector {
  if (!globalCollector) {
    globalCollector = new DashboardCollector()
  }
  return globalCollector
}

export function setCollector(collector: DashboardCollector): void {
  globalCollector = collector
}
