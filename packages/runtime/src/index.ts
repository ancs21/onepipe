/**
 * OnePipe Runtime
 *
 * Bun-native HTTP server for OnePipe applications
 *
 * @example API-only app
 * ```typescript
 * import { serve } from '@onepipe/runtime'
 * import { ordersAPI, orderEvents, processPayment } from './app'
 *
 * serve({
 *   port: 3000,
 *   rest: [ordersAPI],
 *   channels: [processPayment],
 *   flows: [orderEvents],
 * })
 * ```
 *
 * @example Fullstack app with HTML (React, etc.)
 * ```typescript
 * import { serve } from '@onepipe/runtime'
 * import index from './index.html'
 * import { api, auth } from './app'
 *
 * serve({
 *   port: 3000,
 *   rest: [api],
 *   auth,
 *   html: index,  // Enables Bun's HTML imports with HMR
 * })
 * ```
 */

import type { ServeOptions, RESTInstance, ChannelInstance, FlowInstance, WorkflowInstance, CronInstance, DBInstance, AuthInstance, LifecycleInstance, CacheInstance } from '@onepipe/sdk'
import { Log, Lifecycle } from '@onepipe/sdk'
import { getAuthStore } from './auth-store'

// Create runtime logger
const logger = Log.create('runtime').console().build()

interface DatabaseRegistration {
  name: string
  instance: DBInstance
}

interface RuntimeOptions extends ServeOptions {
  /**
   * Workflow instances to register
   */
  workflows?: WorkflowInstance<unknown, unknown>[]

  /**
   * Cron job instances to register
   */
  cron?: CronInstance<unknown>[]

  /**
   * Database instances to expose via dashboard API
   */
  databases?: DatabaseRegistration[]

  /**
   * Cache instance for health checks
   */
  cache?: CacheInstance

  /**
   * Lifecycle instance for health checks and graceful shutdown
   * If not provided, a default one will be created
   */
  lifecycle?: LifecycleInstance

  /**
   * Enable embedded Unbroken Protocol server for development
   */
  embeddedStreams?: boolean

  /**
   * Base URL for stream server
   */
  streamsUrl?: string

  /**
   * HTML file for fullstack apps (enables Bun's HTML imports with HMR)
   * @example html: import("./index.html")
   */
  html?: unknown

  /**
   * Additional routes (Bun routes pattern)
   */
  routes?: Record<string, unknown>
}

interface RuntimeServer {
  port: number
  hostname: string
  stop(): void
  /** Trigger graceful shutdown */
  shutdown(): Promise<void>
}

/**
 * Start OnePipe server using Bun.serve
 */
export function serve(options: RuntimeOptions): RuntimeServer {
  const {
    port = 3000,
    hostname = '0.0.0.0',
    rest = [],
    channels = [],
    flows = [],
    projections = [],
    signals = [],
    auth,
    workflows = [],
    cron = [],
    databases = [],
    cache,
    embeddedStreams = true,
    html,
    routes: customRoutes = {},
  } = options

  // Create or use provided lifecycle
  let lifecycle = options.lifecycle
  if (!lifecycle) {
    const builder = Lifecycle.create()

    // Add health checks for databases
    for (const { name, instance } of databases) {
      builder.healthCheck(`db:${name}`, async () => {
        await instance.query('SELECT 1')
      })
    }

    // Add health check for cache if provided
    if (cache) {
      builder.healthCheck('cache', async () => {
        await cache.get('__health_check__')
      })
    }

    // Add shutdown hooks for databases
    for (const { name, instance } of databases) {
      builder.onShutdown(`close:${name}`, async () => {
        await instance.close()
      }, 50) // Priority 50 - close DBs early
    }

    // Add shutdown hook for cache
    if (cache) {
      builder.onShutdown('close:cache', async () => {
        await cache.close()
      }, 50)
    }

    lifecycle = builder.build()
  }

  // Register signal handlers for graceful shutdown
  lifecycle.register()

  // Start embedded stream server in development
  if (embeddedStreams && process.env.NODE_ENV !== 'production') {
    startEmbeddedStreams()
  }

  // Build combined request handler for API routes
  const apiHandler = createHandler({ rest, channels, flows, projections, signals, auth, workflows, cron, databases, lifecycle })

  // Build routes object for Bun.serve
  const routes: Record<string, unknown> = {}

  // Add auth routes if configured
  if (auth) {
    routes[`${auth.basePath}/*`] = (req: Request) => auth.handler()(req)
  }

  // Add REST API routes
  for (const api of rest) {
    routes[`${api.basePath}/*`] = (req: Request) => apiHandler(req)
  }

  // Add internal OnePipe routes
  routes['/__onepipe/*'] = (req: Request) => apiHandler(req)

  // Health check routes (K8s/Cloud Run compatible)
  routes['/health'] = () => lifecycle.health()      // Detailed health with component status
  routes['/_health'] = () => lifecycle.liveness()   // K8s liveness probe (always 200 if running)
  routes['/ready'] = () => lifecycle.readiness()    // K8s readiness probe (checks dependencies)

  routes['/rpc/*'] = (req: Request) => apiHandler(req)
  routes['/openapi.json'] = (req: Request) => apiHandler(req)

  // Add custom routes
  Object.assign(routes, customRoutes)

  // Add HTML fallback for SPA (must be last)
  if (html) {
    routes['/*'] = html
  }

  // Start Bun server with routes
  const server = Bun.serve({
    port,
    hostname,
    routes,
    development: process.env.NODE_ENV !== 'production' && {
      hmr: true,
      console: true,
    },
  })

  console.log(`
┌─────────────────────────────────────────────────┐
│                                                 │
│   ⚡ OnePipe Server                             │
│                                                 │
│   http://${hostname}:${port}                         │
│                                                 │
│   REST APIs:     ${rest.length.toString().padStart(2)} registered              │
│   Channels:      ${channels.length.toString().padStart(2)} registered              │
│   Flows:         ${flows.length.toString().padStart(2)} registered              │
│   Projections:   ${projections.length.toString().padStart(2)} registered              │
│   Signals:       ${signals.length.toString().padStart(2)} registered              │
│   Workflows:     ${workflows.length.toString().padStart(2)} registered              │
│   Cron Jobs:     ${cron.length.toString().padStart(2)} registered              │
│   Databases:     ${databases.length.toString().padStart(2)} registered              │
│                                                 │
└─────────────────────────────────────────────────┘
`)

  // Log registered routes
  for (const api of rest) {
    for (const route of api.routes) {
      console.log(`  ${route.method.padEnd(7)} ${api.basePath}${route.path}`)
    }
  }

  return {
    port: server.port,
    hostname: server.hostname,
    stop: () => server.stop(),
    shutdown: async () => {
      await lifecycle.shutdown()
      server.stop()
    },
  }
}

/**
 * Create combined request handler
 */
function createHandler(options: {
  rest: RESTInstance[]
  channels: ChannelInstance<unknown, unknown>[]
  flows: FlowInstance<unknown>[]
  projections: unknown[]
  signals: unknown[]
  auth?: AuthInstance
  workflows: WorkflowInstance<unknown, unknown>[]
  cron: CronInstance<unknown>[]
  databases: DatabaseRegistration[]
  lifecycle: LifecycleInstance
}): (req: Request) => Promise<Response> {
  const { rest, channels, auth, workflows, cron, databases } = options

  // Build route map for REST APIs
  const restHandlers = new Map<string, (req: Request) => Promise<Response>>()

  for (const api of rest) {
    restHandlers.set(api.basePath, api.handler())
  }

  // Build channel handlers
  const channelHandlers = new Map<string, ChannelInstance<unknown, unknown>>()

  for (const channel of channels) {
    channelHandlers.set(channel.name, channel)
  }

  // Build workflow handlers
  const workflowMap = new Map<string, WorkflowInstance<unknown, unknown>>()
  for (const workflow of workflows) {
    workflowMap.set(workflow.name, workflow)
  }

  // Build cron handlers
  const cronMap = new Map<string, CronInstance<unknown>>()
  for (const job of cron) {
    cronMap.set(job.name, job)
  }

  // Build database handlers
  const dbMap = new Map<string, DBInstance>()
  for (const { name, instance } of databases) {
    dbMap.set(name, instance)
  }

  return async (req: Request): Promise<Response> => {
    const start = Date.now()
    const url = new URL(req.url)
    const pathname = url.pathname

    // Helper to log request after response
    const logRequest = (response: Response) => {
      logger.info('request', {
        method: req.method,
        path: pathname,
        status: response.status,
        duration: Date.now() - start,
      })
      return response
    }

    // Check for auth routes first (forward to better-auth handler)
    if (auth && pathname.startsWith(auth.basePath)) {
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true',
          },
        })
      }
      const response = await auth.handler()(req)
      // Add CORS headers to response
      const newHeaders = new Headers(response.headers)
      newHeaders.set('Access-Control-Allow-Origin', '*')
      newHeaders.set('Access-Control-Allow-Credentials', 'true')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      })
    }

    // Check for REST API match
    for (const [basePath, handler] of restHandlers) {
      if (pathname.startsWith(basePath)) {
        const response = await handler(req)
        return logRequest(response)
      }
    }

    // Check for channel RPC call (/rpc/{channelName})
    if (pathname.startsWith('/rpc/')) {
      const channelName = pathname.slice(5)
      const channel = channelHandlers.get(channelName)

      if (channel && req.method === 'POST') {
        try {
          const input = await req.json()
          const result = await channel.call(input)

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (error) {
          return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        }
      }

      if (channel && req.method === 'GET') {
        // Get channel history
        const history = await channel.history({ limit: 100 })
        return new Response(JSON.stringify(history), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // =========================================================================
    // Dashboard API endpoints (/__onepipe/*)
    // =========================================================================

    // GET /__onepipe/workflows - List all workflows
    if (pathname === '/__onepipe/workflows' && req.method === 'GET') {
      const workflowList = workflows.map(w => ({
        name: w.name,
        runningCount: 0,  // Would need to query DB for actual counts
        completedCount: 0,
        failedCount: 0,
      }))
      return new Response(JSON.stringify(workflowList), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /__onepipe/workflows/:name/executions - List workflow executions
    const workflowExecMatch = pathname.match(/^\/__onepipe\/workflows\/([^/]+)\/executions$/)
    if (workflowExecMatch && req.method === 'GET') {
      const workflowName = decodeURIComponent(workflowExecMatch[1])
      const workflow = workflowMap.get(workflowName)
      if (workflow) {
        try {
          const status = url.searchParams.get('status') || undefined
          const executions = await workflow.list({ status: status as 'running' | 'completed' | 'failed' | undefined, limit: 50 })
          return new Response(JSON.stringify(executions), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /__onepipe/workflows/execution/:id - Get single workflow execution
    const workflowSingleMatch = pathname.match(/^\/__onepipe\/workflows\/execution\/([^/]+)$/)
    if (workflowSingleMatch && req.method === 'GET') {
      const workflowId = decodeURIComponent(workflowSingleMatch[1])
      // Find the workflow that owns this execution
      for (const workflow of workflows) {
        try {
          const handle = workflow.get(workflowId)
          const status = await handle.status()
          return new Response(JSON.stringify({
            workflowId,
            workflowName: workflow.name,
            status,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch {
          // Not found in this workflow, try next
        }
      }
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /__onepipe/cron - List all cron jobs
    if (pathname === '/__onepipe/cron' && req.method === 'GET') {
      const cronList = cron.map(c => ({
        name: c.name,
        schedule: c.schedule,
        timezone: 'UTC',
        enabled: c.isRunning(),
        nextScheduledTime: c.nextRun()?.toISOString(),
      }))
      return new Response(JSON.stringify(cronList), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /__onepipe/cron/:name/history - Get cron execution history
    const cronHistoryMatch = pathname.match(/^\/__onepipe\/cron\/([^/]+)\/history$/)
    if (cronHistoryMatch && req.method === 'GET') {
      const jobName = decodeURIComponent(cronHistoryMatch[1])
      const job = cronMap.get(jobName)
      if (job) {
        try {
          const history = await job.history({ limit: 50 })
          return new Response(JSON.stringify(history), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // =========================================================================
    // Database API endpoints (/__onepipe/db/*)
    // =========================================================================

    // GET /__onepipe/db - List all databases
    if (pathname === '/__onepipe/db' && req.method === 'GET') {
      const dbList = Array.from(dbMap.entries()).map(([name, instance]) => ({
        name,
        type: instance.type,
      }))
      return new Response(JSON.stringify(dbList), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /__onepipe/db/:name/tables - List tables in a database
    const dbTablesMatch = pathname.match(/^\/__onepipe\/db\/([^/]+)\/tables$/)
    if (dbTablesMatch && req.method === 'GET') {
      const dbName = decodeURIComponent(dbTablesMatch[1])
      const db = dbMap.get(dbName)
      if (!db) {
        return new Response(JSON.stringify({ error: 'Database not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      try {
        const tables = await db.getTables()
        return new Response(JSON.stringify(tables), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // GET /__onepipe/db/:name/tables/:table - Get table schema
    const dbSchemaMatch = pathname.match(/^\/__onepipe\/db\/([^/]+)\/tables\/([^/]+)$/)
    if (dbSchemaMatch && req.method === 'GET') {
      const dbName = decodeURIComponent(dbSchemaMatch[1])
      const tableName = decodeURIComponent(dbSchemaMatch[2])
      const db = dbMap.get(dbName)
      if (!db) {
        return new Response(JSON.stringify({ error: 'Database not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      try {
        const schema = await db.getTableSchema(tableName)
        return new Response(JSON.stringify(schema), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // POST /__onepipe/db/:name/query - Execute SQL query
    const dbQueryMatch = pathname.match(/^\/__onepipe\/db\/([^/]+)\/query$/)
    if (dbQueryMatch && req.method === 'POST') {
      const dbName = decodeURIComponent(dbQueryMatch[1])
      const db = dbMap.get(dbName)
      if (!db) {
        return new Response(JSON.stringify({ error: 'Database not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      try {
        const body = await req.json() as { sql: string }
        const { sql } = body
        if (!sql) {
          return new Response(JSON.stringify({ error: 'SQL query is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        // Only allow SELECT queries for safety
        const trimmedSql = sql.trim().toUpperCase()
        if (!trimmedSql.startsWith('SELECT') && !trimmedSql.startsWith('PRAGMA')) {
          return new Response(JSON.stringify({ error: 'Only SELECT and PRAGMA queries are allowed' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const rows = await db.query(sql)
        return new Response(JSON.stringify({ rows, rowCount: Array.isArray(rows) ? rows.length : 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // =========================================================================
    // Auth API endpoints (/__onepipe/auth/*)
    // Dashboard dev tools for testing auth-protected APIs
    // =========================================================================

    const authStore = getAuthStore()

    // GET /__onepipe/auth/stats - Get auth statistics
    if (pathname === '/__onepipe/auth/stats' && req.method === 'GET') {
      const stats = authStore.getStats()
      return new Response(JSON.stringify({
        configured: !!auth,
        name: auth?.name || 'dev-auth',
        basePath: auth?.basePath || '/api/auth',
        totalUsers: stats.totalUsers,
        activeSessions: stats.activeSessions,
        recentLogins: 0,
        recentFailures: 0,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /__onepipe/auth/users - List users
    if (pathname === '/__onepipe/auth/users' && req.method === 'GET') {
      const search = url.searchParams.get('search') || undefined
      const users = authStore.listUsers(search)
      return new Response(JSON.stringify(users), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // POST /__onepipe/auth/users - Create user
    if (pathname === '/__onepipe/auth/users' && req.method === 'POST') {
      try {
        const body = await req.json() as { email?: string; password?: string; name?: string; role?: string }
        if (!body.email || !body.password) {
          return new Response(JSON.stringify({ error: 'Email and password are required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const user = authStore.createUser(body.email, body.password, body.name, body.role)
        return new Response(JSON.stringify({ user }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create user'
        const isUnique = message.includes('UNIQUE constraint')
        return new Response(JSON.stringify({ error: isUnique ? 'Email already exists' : message }), {
          status: isUnique ? 409 : 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // DELETE /__onepipe/auth/users/:id - Delete user
    const deleteUserMatch = pathname.match(/^\/__onepipe\/auth\/users\/([^/]+)$/)
    if (deleteUserMatch && req.method === 'DELETE') {
      const userId = deleteUserMatch[1]
      const deleted = authStore.deleteUser(userId)
      if (!deleted) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // POST /__onepipe/auth/tokens - Generate token for user
    if (pathname === '/__onepipe/auth/tokens' && req.method === 'POST') {
      try {
        const body = await req.json() as { userId?: string; expiresIn?: number }
        if (!body.userId) {
          return new Response(JSON.stringify({ error: 'userId is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const expiresIn = body.expiresIn || 7 * 24 * 60 * 60 // 7 days default
        const result = authStore.generateToken(body.userId, expiresIn)
        if (!result) {
          return new Response(JSON.stringify({ error: 'User not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to generate token' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // POST /__onepipe/auth/impersonate - Get impersonation URL
    if (pathname === '/__onepipe/auth/impersonate' && req.method === 'POST') {
      try {
        const body = await req.json() as { userId?: string }
        if (!body.userId) {
          return new Response(JSON.stringify({ error: 'userId is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const baseUrl = `http://localhost:${options.port || 3001}`
        const result = authStore.generateImpersonationUrl(body.userId, baseUrl)
        if (!result) {
          return new Response(JSON.stringify({ error: 'User not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to generate impersonation URL' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // GET /__onepipe/auth/sessions - List active sessions
    if (pathname === '/__onepipe/auth/sessions' && req.method === 'GET') {
      const userId = url.searchParams.get('userId') || undefined
      const sessions = authStore.listSessions(userId)
      return new Response(JSON.stringify(sessions), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // DELETE /__onepipe/auth/sessions/:id - Revoke session
    const deleteSessionMatch = pathname.match(/^\/__onepipe\/auth\/sessions\/([^/]+)$/)
    if (deleteSessionMatch && req.method === 'DELETE') {
      const sessionId = deleteSessionMatch[1]
      const revoked = authStore.revokeSession(sessionId)
      if (!revoked) {
        return new Response(JSON.stringify({ error: 'Session not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /__onepipe/auth/events - List auth events (placeholder - would need event logging)
    if (pathname === '/__onepipe/auth/events' && req.method === 'GET') {
      // TODO: Implement event logging in AuthStore
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Note: /health, /_health, and /ready are now handled by lifecycle routes
    // See routes configuration in serve()

    // OpenAPI aggregate spec
    if (pathname === '/openapi.json') {
      const specs = rest.map((api) => ({
        name: api.name,
        basePath: api.basePath,
        routes: api.routes.length,
      }))

      return new Response(JSON.stringify({ apis: specs }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Not found
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

/**
 * Start embedded Unbroken Protocol server for development
 *
 * Cloud-native configuration:
 * - UNBROKEN_STREAMS_URL: External stream service URL (production)
 *   When set, no embedded server is started - connect to external service
 * - ONEPIPE_STREAMS_PORT: Port for embedded server (default: 9999)
 *
 * Storage backends (checked in order):
 * 1. External service (UNBROKEN_STREAMS_URL) - recommended for production
 * 2. File-based (default for local development)
 */
async function startEmbeddedStreams(): Promise<void> {
  // Check if external stream service is configured (production mode)
  const externalStreamsUrl = process.env.UNBROKEN_STREAMS_URL
  if (externalStreamsUrl) {
    try {
      const response = await fetch(`${externalStreamsUrl}/health`)
      if (response.ok) {
        console.log(`  ✓ External streams service: ${externalStreamsUrl}`)
        return
      }
    } catch {
      console.warn(`  ⚠ External streams service unavailable: ${externalStreamsUrl}`)
      console.warn(`    Application will continue but streams may not work`)
    }
    return // Don't start embedded server when external is configured
  }

  const streamsPort = parseInt(process.env.ONEPIPE_STREAMS_PORT || '9999', 10)

  try {
    // Check if server is already running
    const response = await fetch(`http://localhost:${streamsPort}/health`)
    if (response.ok) {
      console.log(`  ✓ Streams server already running on port ${streamsPort}`)
      return
    }
  } catch {
    // Server not running, start it
  }

  try {
    // Dynamic import to avoid bundling issues
    const { UnbrokenServer, FileBackedStreamStore } = await import('@unbroken-protocol/server')

    // Use file-based storage for development
    const dataDir = './.onepipe/streams'
    await Bun.write(`${dataDir}/.gitkeep`, '')

    const store = new FileBackedStreamStore({
      dataDir,
    })

    const server = new UnbrokenServer({
      store,
      port: streamsPort,
    })

    await server.start()
    console.log(`  ✓ Embedded streams server started on port ${streamsPort}`)
    console.log(`    For production, set UNBROKEN_STREAMS_URL to use external service`)
  } catch (error) {
    console.warn(`  ⚠ Could not start embedded streams server:`, error)
    console.warn(`    Make sure @unbroken-protocol/server is installed`)
  }
}

export type { RuntimeOptions, RuntimeServer }
