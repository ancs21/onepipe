/**
 * Server - Combines multiple REST APIs into a single server
 *
 * @example
 * ```typescript
 * const server = Server.create()
 *   .port(3001)
 *   .use(todosApi)
 *   .use(usersApi)
 *   .flow(orderEvents)
 *   .signal(appConfig)
 *   .db(database)
 *   .start()
 *
 * // Export for client type inference
 * export type App = typeof server
 * ```
 */

import type { RESTInstance, DBInstance, FlowInstance, SignalInstance, ServerInstance } from './types'

interface ServerState {
  port: number
  apis: RESTInstance[]
  flows: Map<string, FlowInstance<unknown>>
  signals: Map<string, SignalInstance<unknown>>
  databases: Map<string, DBInstance>
}

/**
 * Server Builder - Combines multiple REST APIs, Flows, and Signals
 *
 * Generic type parameters accumulate as you add resources:
 * - TAPIs: Record of API name -> RESTInstance
 * - TFlows: Record of flow name -> FlowInstance
 * - TSignals: Record of signal name -> SignalInstance
 */
class ServerBuilder<
  TAPIs extends Record<string, RESTInstance> = Record<string, never>,
  TFlows extends Record<string, FlowInstance<unknown>> = Record<string, never>,
  TSignals extends Record<string, SignalInstance<unknown>> = Record<string, never>,
> {
  private state: ServerState

  private constructor() {
    this.state = {
      port: 3001,
      apis: [],
      flows: new Map(),
      signals: new Map(),
      databases: new Map(),
    }
  }

  /**
   * Create a new server builder
   */
  static create(): ServerBuilder {
    return new ServerBuilder()
  }

  /**
   * Set the port
   */
  port(port: number): this {
    this.state.port = port
    return this
  }

  /**
   * Add a REST API
   */
  use<T extends RESTInstance>(api: T): ServerBuilder<TAPIs & Record<T['name'], T>, TFlows, TSignals> {
    this.state.apis.push(api)
    return this as unknown as ServerBuilder<TAPIs & Record<T['name'], T>, TFlows, TSignals>
  }

  /**
   * Register a Flow for client access
   */
  flow<T extends FlowInstance<unknown>>(flow: T): ServerBuilder<TAPIs, TFlows & Record<T['name'], T>, TSignals> {
    this.state.flows.set(flow.name, flow)
    return this as unknown as ServerBuilder<TAPIs, TFlows & Record<T['name'], T>, TSignals>
  }

  /**
   * Register a Signal for client access
   */
  signal<T extends SignalInstance<unknown>>(signal: T): ServerBuilder<TAPIs, TFlows, TSignals & Record<T['name'], T>> {
    this.state.signals.set(signal.name, signal)
    return this as unknown as ServerBuilder<TAPIs, TFlows, TSignals & Record<T['name'], T>>
  }

  /**
   * Add a database instance
   */
  db(database: DBInstance): this {
    this.state.databases.set(database.name, database)
    return this
  }

  /**
   * Start the server and return typed instance
   */
  start(): ServerInstance<TAPIs, TFlows, TSignals> {
    const { port, apis, flows, signals, databases } = this.state

    // Build a map of basePath -> handler for efficient routing
    const handlers = apis.map((api) => ({
      basePath: api.basePath,
      handler: api.handler(),
    }))

    // Convert maps to typed records for the return value
    const apisRecord = Object.fromEntries(apis.map((a) => [a.name, a])) as TAPIs
    const flowsRecord = Object.fromEntries(flows) as TFlows
    const signalsRecord = Object.fromEntries(signals) as TSignals

    // Internal endpoints handler for dashboard introspection
    const handleInternalEndpoints = async (req: Request, pathname: string): Promise<Response | null> => {
      const headers = { 'Content-Type': 'application/json' }

      // GET /__onepipe/db/:name/tables - List tables
      const tablesMatch = pathname.match(/^\/__onepipe\/db\/([^/]+)\/tables$/)
      if (tablesMatch && req.method === 'GET') {
        const dbName = decodeURIComponent(tablesMatch[1])
        const db = databases.get(dbName)
        if (!db) {
          return new Response(JSON.stringify({ error: 'Database not found' }), {
            status: 404,
            headers,
          })
        }
        try {
          const tables = await db.getTables()
          return new Response(JSON.stringify(tables), { headers })
        } catch (error) {
          return new Response(JSON.stringify({ error: 'Failed to get tables' }), {
            status: 500,
            headers,
          })
        }
      }

      // GET /__onepipe/db/:name/tables/:tableName - Get table schema
      const schemaMatch = pathname.match(/^\/__onepipe\/db\/([^/]+)\/tables\/([^/]+)$/)
      if (schemaMatch && req.method === 'GET') {
        const dbName = decodeURIComponent(schemaMatch[1])
        const tableName = decodeURIComponent(schemaMatch[2])
        const db = databases.get(dbName)
        if (!db) {
          return new Response(JSON.stringify({ error: 'Database not found' }), {
            status: 404,
            headers,
          })
        }
        try {
          const schema = await db.getTableSchema(tableName)
          return new Response(JSON.stringify(schema), { headers })
        } catch (error) {
          return new Response(JSON.stringify({ error: 'Failed to get schema' }), {
            status: 500,
            headers,
          })
        }
      }

      // POST /__onepipe/db/:name/query - Execute query
      const queryMatch = pathname.match(/^\/__onepipe\/db\/([^/]+)\/query$/)
      if (queryMatch && req.method === 'POST') {
        const dbName = decodeURIComponent(queryMatch[1])
        const db = databases.get(dbName)
        if (!db) {
          return new Response(JSON.stringify({ error: 'Database not found' }), {
            status: 404,
            headers,
          })
        }
        try {
          const body = await req.json() as { sql?: string }
          if (!body.sql) {
            return new Response(JSON.stringify({ error: 'SQL required' }), {
              status: 400,
              headers,
            })
          }
          // Only allow SELECT for safety
          if (!body.sql.trim().toUpperCase().startsWith('SELECT')) {
            return new Response(JSON.stringify({ error: 'Only SELECT allowed' }), {
              status: 400,
              headers,
            })
          }
          const results = await db.query(body.sql)
          return new Response(JSON.stringify({ rows: results }), { headers })
        } catch (error) {
          return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Query failed' }), {
            status: 500,
            headers,
          })
        }
      }

      // ================================================================
      // Flow Endpoints
      // ================================================================

      // GET /__onepipe/flows/:name/events - Read events
      const flowEventsMatch = pathname.match(/^\/__onepipe\/flows\/([^/]+)\/events$/)
      if (flowEventsMatch && req.method === 'GET') {
        const flowName = decodeURIComponent(flowEventsMatch[1])
        const flow = flows.get(flowName)
        if (!flow) {
          return new Response(JSON.stringify({ error: 'Flow not found' }), { status: 404, headers })
        }
        const url = new URL(req.url)
        const tail = url.searchParams.get('tail')
        const limit = url.searchParams.get('limit')
        const offset = url.searchParams.get('offset')
        const events = await flow.read({
          tail: tail ? parseInt(tail) : undefined,
          limit: limit ? parseInt(limit) : undefined,
          offset: offset || undefined,
        })
        return new Response(JSON.stringify(events), { headers })
      }

      // POST /__onepipe/flows/:name/events - Append event
      if (flowEventsMatch && req.method === 'POST') {
        const flowName = decodeURIComponent(flowEventsMatch[1])
        const flow = flows.get(flowName)
        if (!flow) {
          return new Response(JSON.stringify({ error: 'Flow not found' }), { status: 404, headers })
        }
        const body = await req.json()
        await flow.append(body)
        return new Response(JSON.stringify({ success: true }), { status: 201, headers })
      }

      // GET /__onepipe/flows/:name/stream - SSE subscription
      const flowStreamMatch = pathname.match(/^\/__onepipe\/flows\/([^/]+)\/stream$/)
      if (flowStreamMatch && req.method === 'GET') {
        const flowName = decodeURIComponent(flowStreamMatch[1])
        const flow = flows.get(flowName)
        if (!flow) {
          return new Response(JSON.stringify({ error: 'Flow not found' }), { status: 404, headers })
        }

        // SSE stream
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder()
            const unsubscribe = flow.subscribe((event) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
            })
            // Keep connection alive with heartbeat
            const heartbeat = setInterval(() => {
              controller.enqueue(encoder.encode(': heartbeat\n\n'))
            }, 30000)
            // Cleanup on close
            req.signal.addEventListener('abort', () => {
              unsubscribe()
              clearInterval(heartbeat)
              controller.close()
            })
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      }

      // ================================================================
      // Signal Endpoints
      // ================================================================

      // GET /__onepipe/signals/:name - Get value
      const signalMatch = pathname.match(/^\/__onepipe\/signals\/([^/]+)$/)
      if (signalMatch && req.method === 'GET') {
        const signalName = decodeURIComponent(signalMatch[1])
        const signal = signals.get(signalName)
        if (!signal) {
          return new Response(JSON.stringify({ error: 'Signal not found' }), { status: 404, headers })
        }
        const value = await signal.get()
        return new Response(JSON.stringify(value), { headers })
      }

      // PUT /__onepipe/signals/:name - Set value
      if (signalMatch && req.method === 'PUT') {
        const signalName = decodeURIComponent(signalMatch[1])
        const signal = signals.get(signalName)
        if (!signal) {
          return new Response(JSON.stringify({ error: 'Signal not found' }), { status: 404, headers })
        }
        const body = await req.json()
        await signal.set(body)
        return new Response(JSON.stringify(body), { headers })
      }

      // PATCH /__onepipe/signals/:name - Patch value
      if (signalMatch && req.method === 'PATCH') {
        const signalName = decodeURIComponent(signalMatch[1])
        const signal = signals.get(signalName) as SignalInstance<Record<string, unknown>> | undefined
        if (!signal) {
          return new Response(JSON.stringify({ error: 'Signal not found' }), { status: 404, headers })
        }
        const body = await req.json() as Record<string, unknown>
        await signal.patch(body)
        const value = await signal.get()
        return new Response(JSON.stringify(value), { headers })
      }

      // GET /__onepipe/signals/:name/stream - SSE subscription
      const signalStreamMatch = pathname.match(/^\/__onepipe\/signals\/([^/]+)\/stream$/)
      if (signalStreamMatch && req.method === 'GET') {
        const signalName = decodeURIComponent(signalStreamMatch[1])
        const signal = signals.get(signalName)
        if (!signal) {
          return new Response(JSON.stringify({ error: 'Signal not found' }), { status: 404, headers })
        }

        // SSE stream
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder()
            const unsubscribe = signal.subscribe((value) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
            })
            const heartbeat = setInterval(() => {
              controller.enqueue(encoder.encode(': heartbeat\n\n'))
            }, 30000)
            req.signal.addEventListener('abort', () => {
              unsubscribe()
              clearInterval(heartbeat)
              controller.close()
            })
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      }

      return null
    }

    const server = Bun.serve({
      port,
      fetch: async (req) => {
        const url = new URL(req.url)
        const pathname = url.pathname

        // Handle internal OnePipe endpoints
        if (pathname.startsWith('/__onepipe/')) {
          const response = await handleInternalEndpoints(req, pathname)
          if (response) return response
        }

        // Find matching API by basePath
        for (const { basePath, handler } of handlers) {
          if (pathname.startsWith(basePath)) {
            return handler(req)
          }
        }

        // No matching API found
        return new Response(JSON.stringify({ error: 'Not Found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })

    const apiNames = apis.map((a) => a.name).join(', ')
    console.log(`Server running on http://localhost:${port}`)
    console.log(`APIs: ${apiNames}`)

    // Register databases with dashboard
    const dashboardUrl = process.env.ONEPIPE_DASHBOARD_URL
    if (dashboardUrl && databases.size > 0) {
      for (const [name, db] of databases) {
        fetch(`${dashboardUrl}/api/dashboard/databases`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, type: db.type }),
        }).catch(() => {
          // Dashboard not running, ignore
        })
      }
    }

    // Register flows with dashboard
    if (dashboardUrl && flows.size > 0) {
      for (const [name] of flows) {
        fetch(`${dashboardUrl}/api/dashboard/flows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        }).catch(() => {})
      }
    }

    // Register signals with dashboard
    if (dashboardUrl && signals.size > 0) {
      for (const [name] of signals) {
        fetch(`${dashboardUrl}/api/dashboard/signals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        }).catch(() => {})
      }
    }

    // Return typed server instance
    return {
      port,
      apis: apisRecord,
      flows: flowsRecord,
      signals: signalsRecord,
      stop: () => server.stop(),
    }
  }
}

/**
 * Create a new server
 */
export const Server = {
  create: ServerBuilder.create,
}

export type { ServerBuilder }
