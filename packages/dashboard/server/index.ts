/**
 * OnePipe Dashboard Server
 *
 * Serves the dashboard UI and provides API endpoints for dashboard data
 */

import { getCollector, DashboardCollector, setCollector, type RouteInfo, type TraceData, type SpanData } from './collector'
import type { RESTInstance, FlowInstance } from '@onepipe/sdk'

// =============================================================================
// OTLP Types and Helpers
// =============================================================================

interface OTLPAttribute {
  key: string
  value: {
    stringValue?: string
    intValue?: string
    doubleValue?: number
    boolValue?: boolean
    arrayValue?: { values: OTLPAttribute['value'][] }
  }
}

interface OTLPSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind?: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes?: OTLPAttribute[]
  status?: { code?: number; message?: string }
  events?: Array<{
    name: string
    timeUnixNano: string
    attributes?: OTLPAttribute[]
  }>
}

interface OTLPPayload {
  resourceSpans?: Array<{
    resource?: { attributes?: OTLPAttribute[] }
    scopeSpans?: Array<{
      scope?: { name?: string; version?: string }
      spans?: OTLPSpan[]
    }>
  }>
}

function getAttributeValue(attr: OTLPAttribute): string | number | boolean {
  const v = attr.value
  if (v.stringValue !== undefined) return v.stringValue
  if (v.intValue !== undefined) return parseInt(v.intValue, 10)
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.boolValue !== undefined) return v.boolValue
  return ''
}

function convertOTLPAttributes(attrs?: OTLPAttribute[]): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}
  if (!attrs) return result
  for (const attr of attrs) {
    result[attr.key] = getAttributeValue(attr)
  }
  return result
}

function convertOTLPSpan(span: OTLPSpan, serviceName: string): SpanData {
  const startNano = BigInt(span.startTimeUnixNano)
  const endNano = BigInt(span.endTimeUnixNano)
  const durationMs = Number(endNano - startNano) / 1_000_000

  return {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    startTime: Number(startNano / BigInt(1_000_000)),
    endTime: Number(endNano / BigInt(1_000_000)),
    duration: durationMs,
    status: span.status?.code === 2 ? 'error' : 'ok',
    statusMessage: span.status?.message,
    attributes: {
      ...convertOTLPAttributes(span.attributes),
      'service.name': serviceName,
    },
    events: span.events?.map(e => ({
      name: e.name,
      timestamp: Number(BigInt(e.timeUnixNano) / BigInt(1_000_000)),
      attributes: convertOTLPAttributes(e.attributes),
    })),
  }
}

function convertOTLPToTraces(otlp: OTLPPayload): TraceData[] {
  const traces: TraceData[] = []

  for (const resourceSpan of otlp.resourceSpans || []) {
    // Extract service name from resource attributes
    const serviceName = resourceSpan.resource?.attributes?.find(
      a => a.key === 'service.name'
    )?.value?.stringValue || 'unknown'

    for (const scopeSpan of resourceSpan.scopeSpans || []) {
      // Group spans by traceId
      const spansByTrace = new Map<string, OTLPSpan[]>()
      for (const span of scopeSpan.spans || []) {
        const traceId = span.traceId
        if (!spansByTrace.has(traceId)) {
          spansByTrace.set(traceId, [])
        }
        spansByTrace.get(traceId)!.push(span)
      }

      // Convert each trace group
      for (const [traceId, spans] of spansByTrace) {
        const rootSpan = spans.find(s => !s.parentSpanId) || spans[0]
        const convertedSpans = spans.map(s => convertOTLPSpan(s, serviceName))
        const rootConverted = convertOTLPSpan(rootSpan, serviceName)

        traces.push({
          traceId,
          rootSpan: rootConverted,
          spans: convertedSpans,
          totalDuration: rootConverted.duration,
          status: rootConverted.status === 'error' ? 'error' : 'ok',
          timestamp: Date.now(),
          services: [serviceName],
          spanCount: spans.length,
        })
      }
    }
  }

  return traces
}

// =============================================================================
// Security Configuration
// =============================================================================

const ALLOWED_ORIGINS = ['http://localhost:4000', 'http://localhost:3000', 'http://127.0.0.1:4000']
const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const MAX_LIMIT = 1000
const MAX_BODY_SIZE = 1024 * 1024 // 1MB
const RATE_LIMIT = 100 // requests per minute per IP

// Rate limiter storage
const rateLimiter = new Map<string, { count: number; reset: number }>()

// =============================================================================
// Validation Helpers
// =============================================================================

function validateMethod(method: string): method is (typeof VALID_METHODS)[number] {
  return VALID_METHODS.includes(method.toUpperCase() as (typeof VALID_METHODS)[number])
}

function validateLimit(limitStr: string | null, defaultVal: number): number {
  if (!limitStr) return defaultVal
  const n = parseInt(limitStr, 10)
  if (Number.isNaN(n) || n < 1) return defaultVal
  return Math.min(n, MAX_LIMIT)
}

function validatePath(path: string): boolean {
  // Must start with / and not contain path traversal
  return path.startsWith('/') && !path.includes('..') && !path.includes('\0')
}

function validateId(id: string): boolean {
  // Allow alphanumeric, hyphens, underscores (common ID formats)
  return /^[a-zA-Z0-9_-]+$/.test(id)
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimiter.get(ip)

  if (!entry || now > entry.reset) {
    rateLimiter.set(ip, { count: 1, reset: now + 60000 })
    return true
  }

  if (entry.count >= RATE_LIMIT) {
    return false
  }

  entry.count++
  return true
}

function getCorsOrigin(requestOrigin: string | null): string {
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin
  }
  return ALLOWED_ORIGINS[0]
}

function isValidRouteInfo(route: unknown): route is RouteInfo {
  if (!route || typeof route !== 'object') return false
  const r = route as Record<string, unknown>
  return (
    typeof r.method === 'string' &&
    VALID_METHODS.includes(r.method.toUpperCase() as (typeof VALID_METHODS)[number]) &&
    typeof r.path === 'string' &&
    r.path.startsWith('/') &&
    typeof r.auth === 'boolean'
  )
}

interface DashboardOptions {
  port?: number
  collector?: DashboardCollector
}

/**
 * Dashboard Builder
 */
class DashboardBuilder {
  private options: DashboardOptions = {
    port: 4000,
  }
  private restApis: RESTInstance[] = []
  private flows: FlowInstance<unknown>[] = []

  /**
   * Set the port for the dashboard server
   */
  port(port: number): this {
    this.options.port = port
    return this
  }

  /**
   * Register a REST API for the API Explorer
   */
  rest(api: RESTInstance): this {
    this.restApis.push(api)
    return this
  }

  /**
   * Register a flow for the Flows viewer
   */
  flow<T>(flow: FlowInstance<T>): this {
    this.flows.push(flow as FlowInstance<unknown>)
    return this
  }

  /**
   * Use a custom collector
   */
  collector(collector: DashboardCollector): this {
    this.options.collector = collector
    return this
  }

  /**
   * Start the dashboard server
   */
  async start(): Promise<{ port: number; stop: () => void }> {
    const collector = this.options.collector || getCollector()
    setCollector(collector)

    // Register REST APIs
    for (const api of this.restApis) {
      collector.registerRest(api)
    }

    // Register flows
    for (const flow of this.flows) {
      collector.registerFlow(flow)
    }

    const port = this.options.port!

    // Create dashboard API handler
    const dashboardHandler = createDashboardHandler(collector, this.restApis)

    // Get the dist directory path
    const distDir = new URL('../dist', import.meta.url).pathname

    // Start server
    const server = Bun.serve({
      port,
      fetch: async (req) => {
        const url = new URL(req.url)

        // OTLP trace receiver endpoint (standard OpenTelemetry protocol)
        if (url.pathname === '/v1/traces' && req.method === 'POST') {
          try {
            const otlpPayload = await req.json() as OTLPPayload
            const traces = convertOTLPToTraces(otlpPayload)
            for (const trace of traces) {
              collector.addTrace(trace)
            }
            return new Response('', {
              status: 200,
              headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
              },
            })
          } catch (error) {
            console.error('[OTLP] Failed to process traces:', error)
            return new Response(JSON.stringify({ error: 'Invalid OTLP payload' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            })
          }
        }

        // OTLP CORS preflight
        if (url.pathname === '/v1/traces' && req.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
            },
          })
        }

        // Dashboard API routes
        if (url.pathname.startsWith('/api/dashboard')) {
          return dashboardHandler(req)
        }

        // Serve static files from dist/
        let filePath = url.pathname === '/' ? '/index.html' : url.pathname
        const file = Bun.file(`${distDir}${filePath}`)

        if (await file.exists()) {
          return new Response(file)
        }

        // SPA fallback - serve index.html for client-side routing
        const indexFile = Bun.file(`${distDir}/index.html`)
        if (await indexFile.exists()) {
          return new Response(indexFile)
        }

        return new Response('Not Found', { status: 404 })
      },
    })

    console.log(`Dashboard running on http://localhost:${port}`)

    return {
      port,
      stop: () => server.stop(),
    }
  }
}

/**
 * Create dashboard API handler
 */
function createDashboardHandler(
  collector: DashboardCollector,
  _restApis: RESTInstance[]
) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const path = url.pathname.replace('/api/dashboard', '')

    // Get client IP for rate limiting
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

    // Check rate limit
    if (!checkRateLimit(clientIp)) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      })
    }

    // Dynamic CORS headers based on request origin
    const requestOrigin = req.headers.get('origin')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': getCorsOrigin(requestOrigin),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers })
    }

    try {
      // GET /routes - List all registered routes
      if (path === '/routes' && req.method === 'GET') {
        return new Response(JSON.stringify(collector.getRoutes()), { headers })
      }

      // POST /routes - Register routes from SDK
      if (path === '/routes' && req.method === 'POST') {
        // Check content length
        const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
        if (contentLength > MAX_BODY_SIZE) {
          return new Response(JSON.stringify({ error: 'Payload Too Large' }), {
            status: 413,
            headers,
          })
        }

        const body = await req.json() as { routes?: unknown[]; serviceName?: string }

        // Validate routes array
        if (!body.routes || !Array.isArray(body.routes)) {
          return new Response(JSON.stringify({ error: 'Invalid request: routes array required' }), {
            status: 400,
            headers,
          })
        }

        // Validate each route
        const validRoutes: RouteInfo[] = []
        for (const route of body.routes) {
          if (isValidRouteInfo(route)) {
            validRoutes.push({
              method: route.method.toUpperCase() as RouteInfo['method'],
              path: route.path,
              auth: route.auth,
            })
          }
        }

        // Pass service name if provided
        const serviceName = typeof body.serviceName === 'string' ? body.serviceName : undefined
        collector.registerRoutes(validRoutes, serviceName)
        return new Response(JSON.stringify({ success: true }), { headers })
      }

      // POST /traces - Record a trace from SDK
      if (path === '/traces' && req.method === 'POST') {
        const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
        if (contentLength > MAX_BODY_SIZE) {
          return new Response(JSON.stringify({ error: 'Payload Too Large' }), {
            status: 413,
            headers,
          })
        }

        const trace = await req.json()
        collector.addTrace(trace)
        return new Response(JSON.stringify({ success: true }), { headers })
      }

      // POST /logs - Record a log entry from SDK
      if (path === '/logs' && req.method === 'POST') {
        const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
        if (contentLength > MAX_BODY_SIZE) {
          return new Response(JSON.stringify({ error: 'Payload Too Large' }), {
            status: 413,
            headers,
          })
        }

        const log = await req.json()
        collector.addLog(log)
        return new Response(JSON.stringify({ success: true }), { headers })
      }

      // GET /traces - Get traces with filtering
      if (path === '/traces' && req.method === 'GET') {
        const params = {
          limit: validateLimit(url.searchParams.get('limit'), 50),
          offset: parseInt(url.searchParams.get('offset') || '0', 10),
          status: url.searchParams.get('status') as 'ok' | 'error' | null,
          services: url.searchParams.get('services')?.split(',').filter(Boolean) || [],
          minDuration: url.searchParams.get('minDuration') ? parseInt(url.searchParams.get('minDuration')!, 10) : null,
          maxDuration: url.searchParams.get('maxDuration') ? parseInt(url.searchParams.get('maxDuration')!, 10) : null,
          startTime: url.searchParams.get('startTime') ? parseInt(url.searchParams.get('startTime')!, 10) : null,
          endTime: url.searchParams.get('endTime') ? parseInt(url.searchParams.get('endTime')!, 10) : null,
          search: url.searchParams.get('search') || '',
          httpStatus: url.searchParams.get('httpStatus')?.split(',').map(Number).filter((n) => !isNaN(n)) || [],
          sortBy: (url.searchParams.get('sortBy') as 'time' | 'duration') || 'time',
          sortOrder: (url.searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
        }

        const result = collector.getTracesFiltered(params)
        return new Response(JSON.stringify(result), { headers })
      }

      // GET /traces/stats - Get trace statistics
      if (path === '/traces/stats' && req.method === 'GET') {
        const startTime = url.searchParams.get('startTime') ? parseInt(url.searchParams.get('startTime')!, 10) : undefined
        const endTime = url.searchParams.get('endTime') ? parseInt(url.searchParams.get('endTime')!, 10) : undefined
        const services = url.searchParams.get('services')?.split(',').filter(Boolean)

        const stats = collector.getTraceStats(startTime, endTime, services)
        return new Response(JSON.stringify(stats), { headers })
      }

      // GET /traces/services - Get available services
      if (path === '/traces/services' && req.method === 'GET') {
        const services = collector.getAvailableServices()
        return new Response(JSON.stringify({ services }), { headers })
      }

      // GET /traces/:id - Get single trace
      const traceMatch = path.match(/^\/traces\/([^/]+)$/)
      if (traceMatch && traceMatch[1] !== 'stats' && traceMatch[1] !== 'services' && req.method === 'GET') {
        const traceId = traceMatch[1]
        if (!validateId(traceId)) {
          return new Response(JSON.stringify({ error: 'Invalid trace ID format' }), {
            status: 400,
            headers,
          })
        }

        const trace = collector.getTrace(traceId)
        if (!trace) {
          return new Response(JSON.stringify({ error: 'Trace not found' }), {
            status: 404,
            headers,
          })
        }
        return new Response(JSON.stringify(trace), { headers })
      }

      // GET /logs - Get recent logs
      if (path === '/logs' && req.method === 'GET') {
        const limit = validateLimit(url.searchParams.get('limit'), 100)
        return new Response(JSON.stringify(collector.getLogs(limit)), { headers })
      }

      // GET /logs/stream - SSE stream for logs
      if (path === '/logs/stream' && req.method === 'GET') {
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder()

            const unsubscribe = collector.subscribeLogs((log) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(log)}\n\n`))
            })

            // Keep connection alive
            const interval = setInterval(() => {
              controller.enqueue(encoder.encode(': keepalive\n\n'))
            }, 30000)

            // Cleanup on close
            req.signal.addEventListener('abort', () => {
              unsubscribe()
              clearInterval(interval)
              controller.close()
            })
          },
        })

        return new Response(stream, {
          headers: {
            ...headers,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      }

      // GET /metrics - Get current metrics
      if (path === '/metrics' && req.method === 'GET') {
        return new Response(
          JSON.stringify({
            counters: [],
            gauges: [],
            histograms: [],
            requestRate: [],
            latencyP50: [],
            latencyP99: [],
          }),
          { headers }
        )
      }

      // GET /flows - List all flows
      if (path === '/flows' && req.method === 'GET') {
        return new Response(JSON.stringify(collector.getFlows()), { headers })
      }

      // POST /flows - Register a flow from SDK
      if (path === '/flows' && req.method === 'POST') {
        const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
        if (contentLength > MAX_BODY_SIZE) {
          return new Response(JSON.stringify({ error: 'Payload Too Large' }), {
            status: 413,
            headers,
          })
        }

        const body = await req.json() as { name?: string }
        if (!body.name || typeof body.name !== 'string' || body.name.length > 100) {
          return new Response(JSON.stringify({ error: 'Invalid flow name' }), {
            status: 400,
            headers,
          })
        }

        collector.registerFlowByName(body.name)
        return new Response(JSON.stringify({ success: true }), { headers })
      }

      // GET /flows/:name/events - Get flow events
      const flowEventsMatch = path.match(/^\/flows\/([^/]+)\/events$/)
      if (flowEventsMatch && req.method === 'GET') {
        const flowName = decodeURIComponent(flowEventsMatch[1])
        if (!flowName || flowName.length > 100) {
          return new Response(JSON.stringify({ error: 'Invalid flow name' }), {
            status: 400,
            headers,
          })
        }
        return new Response(JSON.stringify(collector.getFlowEvents(flowName)), { headers })
      }

      // POST /flows/:name/events - Add event to flow from SDK
      if (flowEventsMatch && req.method === 'POST') {
        const flowName = decodeURIComponent(flowEventsMatch[1])
        if (!flowName || flowName.length > 100) {
          return new Response(JSON.stringify({ error: 'Invalid flow name' }), {
            status: 400,
            headers,
          })
        }

        const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
        if (contentLength > MAX_BODY_SIZE) {
          return new Response(JSON.stringify({ error: 'Payload Too Large' }), {
            status: 413,
            headers,
          })
        }

        const event = await req.json() as { id?: string; data?: unknown; timestamp?: number; offset?: string }
        if (!event.id || !event.timestamp || !event.offset) {
          return new Response(JSON.stringify({ error: 'Invalid event data' }), {
            status: 400,
            headers,
          })
        }

        collector.addFlowEvent({
          id: event.id,
          flowName,
          data: event.data,
          timestamp: event.timestamp,
          offset: event.offset,
        })
        return new Response(JSON.stringify({ success: true }), { headers })
      }

      // GET /services - Get service graph
      if (path === '/services' && req.method === 'GET') {
        const graph = collector.getServiceGraph()

        // Also fetch auth stats from app server and include as a service if configured
        const appPort = process.env.APP_PORT || '3001'
        try {
          const authResponse = await fetch(`http://localhost:${appPort}/__onepipe/auth/stats`, {
            signal: AbortSignal.timeout(2000),
          })
          if (authResponse.ok) {
            const authStats = await authResponse.json() as { configured?: boolean; name?: string; basePath?: string }
            if (authStats.configured && authStats.name) {
              graph.services.push({
                name: authStats.name,
                type: 'auth',
                basePath: authStats.basePath || '/api/auth',
                requestCount: 0,
                errorCount: 0,
                routes: [],
              })
            }
          }
        } catch {
          // App server not available, skip auth
        }

        return new Response(JSON.stringify(graph), { headers })
      }

      // GET /databases - List all databases
      if (path === '/databases' && req.method === 'GET') {
        return new Response(JSON.stringify(collector.getDatabases()), { headers })
      }

      // POST /databases - Register a database from SDK
      if (path === '/databases' && req.method === 'POST') {
        const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
        if (contentLength > MAX_BODY_SIZE) {
          return new Response(JSON.stringify({ error: 'Payload Too Large' }), {
            status: 413,
            headers,
          })
        }

        const body = await req.json() as { name?: string; type?: string; url?: string }
        if (!body.name || typeof body.name !== 'string' || body.name.length > 100) {
          return new Response(JSON.stringify({ error: 'Invalid database name' }), {
            status: 400,
            headers,
          })
        }
        if (!body.type || !['postgres', 'mysql', 'sqlite'].includes(body.type)) {
          return new Response(JSON.stringify({ error: 'Invalid database type' }), {
            status: 400,
            headers,
          })
        }

        collector.registerDatabase({
          name: body.name,
          type: body.type as 'postgres' | 'mysql' | 'sqlite',
          url: body.url,
        })
        return new Response(JSON.stringify({ success: true }), { headers })
      }

      // GET /databases/:name/tables - Get tables for a database (proxy to app)
      const dbTablesMatch = path.match(/^\/databases\/([^/]+)\/tables$/)
      if (dbTablesMatch && req.method === 'GET') {
        const dbName = decodeURIComponent(dbTablesMatch[1])
        if (!dbName || dbName.length > 100) {
          return new Response(JSON.stringify({ error: 'Invalid database name' }), {
            status: 400,
            headers,
          })
        }

        // Proxy to app server
        const appPort = process.env.APP_PORT || '3001'
        try {
          const response = await fetch(`http://localhost:${appPort}/__onepipe/db/${dbName}/tables`, {
            signal: AbortSignal.timeout(2000),
          })
          const data = await response.json()
          return new Response(JSON.stringify(data), { headers })
        } catch {
          return new Response(JSON.stringify({ error: 'Failed to connect to app' }), {
            status: 502,
            headers,
          })
        }
      }

      // GET /databases/:name/tables/:tableName - Get table schema (proxy to app)
      const dbSchemaMatch = path.match(/^\/databases\/([^/]+)\/tables\/([^/]+)$/)
      if (dbSchemaMatch && req.method === 'GET') {
        const dbName = decodeURIComponent(dbSchemaMatch[1])
        const tableName = decodeURIComponent(dbSchemaMatch[2])
        if (!dbName || dbName.length > 100 || !tableName || tableName.length > 100) {
          return new Response(JSON.stringify({ error: 'Invalid name' }), {
            status: 400,
            headers,
          })
        }

        // Validate table name format
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
          return new Response(JSON.stringify({ error: 'Invalid table name format' }), {
            status: 400,
            headers,
          })
        }

        // Proxy to app server
        const appPort = process.env.APP_PORT || '3001'
        try {
          const response = await fetch(`http://localhost:${appPort}/__onepipe/db/${dbName}/tables/${tableName}`, {
            signal: AbortSignal.timeout(2000),
          })
          const data = await response.json()
          return new Response(JSON.stringify(data), { headers })
        } catch {
          return new Response(JSON.stringify({ error: 'Failed to connect to app' }), {
            status: 502,
            headers,
          })
        }
      }

      // GET /databases/:name/query - Execute a query (proxy to app)
      const dbQueryMatch = path.match(/^\/databases\/([^/]+)\/query$/)
      if (dbQueryMatch && req.method === 'POST') {
        const dbName = decodeURIComponent(dbQueryMatch[1])
        if (!dbName || dbName.length > 100) {
          return new Response(JSON.stringify({ error: 'Invalid database name' }), {
            status: 400,
            headers,
          })
        }

        const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
        if (contentLength > MAX_BODY_SIZE) {
          return new Response(JSON.stringify({ error: 'Payload Too Large' }), {
            status: 413,
            headers,
          })
        }

        const body = await req.json() as { sql?: string }
        if (!body.sql || typeof body.sql !== 'string') {
          return new Response(JSON.stringify({ error: 'SQL query required' }), {
            status: 400,
            headers,
          })
        }

        // Only allow SELECT queries for safety
        const normalizedSql = body.sql.trim().toUpperCase()
        if (!normalizedSql.startsWith('SELECT')) {
          return new Response(JSON.stringify({ error: 'Only SELECT queries are allowed' }), {
            status: 400,
            headers,
          })
        }

        // Proxy to app server
        const appPort = process.env.APP_PORT || '3001'
        try {
          const response = await fetch(`http://localhost:${appPort}/__onepipe/db/${dbName}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: body.sql }),
            signal: AbortSignal.timeout(5000), // 5s for queries
          })
          const data = await response.json()
          return new Response(JSON.stringify(data), { headers })
        } catch {
          return new Response(JSON.stringify({ error: 'Failed to connect to app' }), {
            status: 502,
            headers,
          })
        }
      }

      // =======================================================================
      // Workflow Endpoints
      // =======================================================================

      // GET /workflows - List all workflows
      if (path === '/workflows' && req.method === 'GET') {
        const appPort = process.env.APP_PORT || '3001'
        try {
          const response = await fetch(`http://localhost:${appPort}/__onepipe/workflows`, {
            signal: AbortSignal.timeout(2000),
          })
          const data = await response.json()
          return new Response(JSON.stringify(data), { headers })
        } catch {
          // Return empty array if app not connected
          return new Response(JSON.stringify([]), { headers })
        }
      }

      // GET /workflows/:name/executions - Get workflow executions
      const workflowExecutionsMatch = path.match(/^\/workflows\/([^/]+)\/executions$/)
      if (workflowExecutionsMatch && req.method === 'GET') {
        const workflowName = decodeURIComponent(workflowExecutionsMatch[1])
        if (!workflowName || workflowName.length > 100) {
          return new Response(JSON.stringify({ error: 'Invalid workflow name' }), {
            status: 400,
            headers,
          })
        }

        const status = url.searchParams.get('status')
        const appPort = process.env.APP_PORT || '3001'
        try {
          const queryParams = status && status !== 'all' ? `?status=${status}` : ''
          const response = await fetch(
            `http://localhost:${appPort}/__onepipe/workflows/${encodeURIComponent(workflowName)}/executions${queryParams}`
          )
          const data = await response.json()
          return new Response(JSON.stringify(data), { headers })
        } catch {
          return new Response(JSON.stringify([]), { headers })
        }
      }

      // GET /workflows/execution/:id - Get single workflow execution
      const workflowExecutionMatch = path.match(/^\/workflows\/execution\/([^/]+)$/)
      if (workflowExecutionMatch && req.method === 'GET') {
        const workflowId = decodeURIComponent(workflowExecutionMatch[1])
        if (!workflowId || workflowId.length > 200) {
          return new Response(JSON.stringify({ error: 'Invalid workflow ID' }), {
            status: 400,
            headers,
          })
        }

        const appPort = process.env.APP_PORT || '3001'
        try {
          const response = await fetch(
            `http://localhost:${appPort}/__onepipe/workflows/execution/${encodeURIComponent(workflowId)}`
          )
          if (!response.ok) {
            return new Response(JSON.stringify({ error: 'Workflow execution not found' }), {
              status: 404,
              headers,
            })
          }
          const data = await response.json()
          return new Response(JSON.stringify(data), { headers })
        } catch {
          return new Response(JSON.stringify({ error: 'Failed to connect to app' }), {
            status: 502,
            headers,
          })
        }
      }

      // =======================================================================
      // Cron Endpoints
      // =======================================================================

      // GET /cron - List all cron jobs
      if (path === '/cron' && req.method === 'GET') {
        const appPort = process.env.APP_PORT || '3001'
        try {
          const response = await fetch(`http://localhost:${appPort}/__onepipe/cron`, {
            signal: AbortSignal.timeout(2000),
          })
          const data = await response.json()
          return new Response(JSON.stringify(data), { headers })
        } catch {
          // Return empty array if app not connected
          return new Response(JSON.stringify([]), { headers })
        }
      }

      // GET /cron/:name/history - Get cron execution history
      const cronHistoryMatch = path.match(/^\/cron\/([^/]+)\/history$/)
      if (cronHistoryMatch && req.method === 'GET') {
        const jobName = decodeURIComponent(cronHistoryMatch[1])
        if (!jobName || jobName.length > 100) {
          return new Response(JSON.stringify({ error: 'Invalid job name' }), {
            status: 400,
            headers,
          })
        }

        const appPort = process.env.APP_PORT || '3001'
        try {
          const response = await fetch(
            `http://localhost:${appPort}/__onepipe/cron/${encodeURIComponent(jobName)}/history`
          )
          const data = await response.json()
          return new Response(JSON.stringify(data), { headers })
        } catch {
          return new Response(JSON.stringify([]), { headers })
        }
      }

      // =======================================================================
      // Auth Endpoints (proxy to app or return mock data)
      // =======================================================================

      // GET /auth/stats - Get auth statistics
      if (path === '/auth/stats' && req.method === 'GET') {
        const appPort = process.env.APP_PORT || '3001'
        try {
          const response = await fetch(`http://localhost:${appPort}/__onepipe/auth/stats`, {
            signal: AbortSignal.timeout(2000),
          })
          if (response.ok) {
            const data = await response.json()
            return new Response(JSON.stringify(data), { headers })
          }
        } catch {
          // App not connected or auth not configured
        }
        // Return empty stats when auth not available
        return new Response(JSON.stringify({
          configured: false,
          totalUsers: 0,
          activeSessions: 0,
          recentLogins: 0,
          recentFailures: 0,
        }), { headers })
      }

      // GET /auth/users - Get users list
      if (path === '/auth/users' && req.method === 'GET') {
        const search = url.searchParams.get('search') || ''
        const appPort = process.env.APP_PORT || '3001'
        try {
          const response = await fetch(`http://localhost:${appPort}/__onepipe/auth/users?search=${encodeURIComponent(search)}`, {
            signal: AbortSignal.timeout(2000),
          })
          if (response.ok) {
            const data = await response.json()
            return new Response(JSON.stringify(data), { headers })
          }
        } catch {
          // App not connected
        }
        return new Response(JSON.stringify([]), { headers })
      }

      // POST /auth/users - Create user
      if (path === '/auth/users' && req.method === 'POST') {
        const appPort = process.env.APP_PORT || '3001'
        try {
          const body = await req.json()
          const response = await fetch(`http://localhost:${appPort}/__onepipe/auth/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(2000),
          })
          const data = await response.json()
          return new Response(JSON.stringify(data), {
            status: response.status,
            headers,
          })
        } catch {
          return new Response(JSON.stringify({ error: 'App not connected' }), {
            status: 502,
            headers,
          })
        }
      }

      // DELETE /auth/users/:id - Delete user
      const deleteUserMatch = path.match(/^\/auth\/users\/([^/]+)$/)
      if (deleteUserMatch && req.method === 'DELETE') {
        const userId = decodeURIComponent(deleteUserMatch[1])
        if (!userId || userId.length > 100) {
          return new Response(JSON.stringify({ error: 'Invalid user ID' }), {
            status: 400,
            headers,
          })
        }

        const appPort = process.env.APP_PORT || '3001'
        try {
          const response = await fetch(`http://localhost:${appPort}/__onepipe/auth/users/${encodeURIComponent(userId)}`, {
            method: 'DELETE',
            signal: AbortSignal.timeout(2000),
          })
          const data = await response.json()
          return new Response(JSON.stringify(data), {
            status: response.status,
            headers,
          })
        } catch {
          return new Response(JSON.stringify({ error: 'App not connected' }), {
            status: 502,
            headers,
          })
        }
      }

      // POST /auth/tokens - Generate token for user
      if (path === '/auth/tokens' && req.method === 'POST') {
        const appPort = process.env.APP_PORT || '3001'
        try {
          const body = await req.json()
          const response = await fetch(`http://localhost:${appPort}/__onepipe/auth/tokens`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(2000),
          })
          const data = await response.json()
          return new Response(JSON.stringify(data), {
            status: response.status,
            headers,
          })
        } catch {
          return new Response(JSON.stringify({ error: 'App not connected' }), {
            status: 502,
            headers,
          })
        }
      }

      // POST /auth/impersonate - Get impersonation URL
      if (path === '/auth/impersonate' && req.method === 'POST') {
        const appPort = process.env.APP_PORT || '3001'
        try {
          const body = await req.json()
          const response = await fetch(`http://localhost:${appPort}/__onepipe/auth/impersonate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(2000),
          })
          const data = await response.json()
          return new Response(JSON.stringify(data), {
            status: response.status,
            headers,
          })
        } catch {
          return new Response(JSON.stringify({ error: 'App not connected' }), {
            status: 502,
            headers,
          })
        }
      }

      // GET /auth/sessions - Get active sessions
      if (path === '/auth/sessions' && req.method === 'GET') {
        const userId = url.searchParams.get('userId') || ''
        const appPort = process.env.APP_PORT || '3001'
        try {
          const response = await fetch(`http://localhost:${appPort}/__onepipe/auth/sessions?userId=${encodeURIComponent(userId)}`, {
            signal: AbortSignal.timeout(2000),
          })
          if (response.ok) {
            const data = await response.json()
            return new Response(JSON.stringify(data), { headers })
          }
        } catch {
          // App not connected
        }
        return new Response(JSON.stringify([]), { headers })
      }

      // DELETE /auth/sessions/:id - Revoke a session
      const sessionRevokeMatch = path.match(/^\/auth\/sessions\/([^/]+)$/)
      if (sessionRevokeMatch && req.method === 'DELETE') {
        const sessionId = decodeURIComponent(sessionRevokeMatch[1])
        if (!sessionId || sessionId.length > 100) {
          return new Response(JSON.stringify({ error: 'Invalid session ID' }), {
            status: 400,
            headers,
          })
        }

        const appPort = process.env.APP_PORT || '3001'
        try {
          const response = await fetch(`http://localhost:${appPort}/__onepipe/auth/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE',
            signal: AbortSignal.timeout(2000),
          })
          if (response.ok) {
            return new Response(JSON.stringify({ success: true }), { headers })
          }
          return new Response(JSON.stringify({ error: 'Failed to revoke session' }), {
            status: response.status,
            headers,
          })
        } catch {
          return new Response(JSON.stringify({ error: 'App not connected' }), {
            status: 502,
            headers,
          })
        }
      }

      // GET /auth/events - Get auth events log
      if (path === '/auth/events' && req.method === 'GET') {
        const limit = validateLimit(url.searchParams.get('limit'), 50)
        const appPort = process.env.APP_PORT || '3001'
        try {
          const response = await fetch(`http://localhost:${appPort}/__onepipe/auth/events?limit=${limit}`, {
            signal: AbortSignal.timeout(2000),
          })
          if (response.ok) {
            const data = await response.json()
            return new Response(JSON.stringify(data), { headers })
          }
        } catch {
          // App not connected
        }
        return new Response(JSON.stringify([]), { headers })
      }

      // =======================================================================
      // Request Proxy
      // =======================================================================

      // POST /request - Proxy API request
      if (path === '/request' && req.method === 'POST') {
        const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
        if (contentLength > MAX_BODY_SIZE) {
          return new Response(JSON.stringify({ error: 'Payload Too Large' }), {
            status: 413,
            headers,
          })
        }

        const body = await req.json() as {
          method?: string
          path?: string
          body?: unknown
          headers?: Record<string, string>
        }

        // Validate method
        if (!body.method || !validateMethod(body.method)) {
          return new Response(
            JSON.stringify({ error: 'Invalid HTTP method' }),
            { status: 400, headers }
          )
        }

        // Validate path
        if (!body.path || !validatePath(body.path)) {
          return new Response(
            JSON.stringify({ error: 'Invalid request path' }),
            { status: 400, headers }
          )
        }

        // Get app port from environment or default to 3001
        const appPort = process.env.APP_PORT || '3001'

        // Create a request to the target API (always localhost)
        const startTime = performance.now()
        const targetUrl = `http://localhost:${appPort}${body.path}`

        try {
          const response = await fetch(targetUrl, {
            method: body.method,
            headers: {
              'Content-Type': 'application/json',
              ...body.headers,
            },
            body: body.body ? JSON.stringify(body.body) : undefined,
          })

          const duration = performance.now() - startTime
          let responseBody: unknown = null
          try {
            responseBody = await response.json()
          } catch {
            // Response is not JSON, ignore
          }
          const responseHeaders: Record<string, string> = {}
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value
          })

          return new Response(
            JSON.stringify({
              status: response.status,
              headers: responseHeaders,
              body: responseBody,
              duration,
            }),
            { headers }
          )
        } catch (error) {
          const duration = performance.now() - startTime
          return new Response(
            JSON.stringify({
              status: 0,
              headers: {},
              body: { error: error instanceof Error ? error.message : 'Request failed' },
              duration,
            }),
            { headers }
          )
        }
      }

      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers,
      })
    } catch (error) {
      console.error('Dashboard API error:', error)
      return new Response(
        JSON.stringify({ error: 'Internal Server Error' }),
        { status: 500, headers }
      )
    }
  }
}

/**
 * Dashboard entry point
 */
export const Dashboard = {
  create(): DashboardBuilder {
    return new DashboardBuilder()
  },
}

export { DashboardCollector, getCollector, setCollector }
export type { DashboardOptions }

// Auto-start when run directly
if (import.meta.main) {
  const port = parseInt(process.env.DASHBOARD_PORT || '4000', 10)
  Dashboard.create().port(port).start()
}
