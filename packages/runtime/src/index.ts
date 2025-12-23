/**
 * OnePipe Runtime
 *
 * Bun-native HTTP server for OnePipe applications
 *
 * @example
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
 */

import type { ServeOptions, RESTInstance, ChannelInstance, FlowInstance } from '@onepipe/sdk'

interface RuntimeOptions extends ServeOptions {
  /**
   * Enable embedded Unbroken Protocol server for development
   */
  embeddedStreams?: boolean

  /**
   * Base URL for stream server
   */
  streamsUrl?: string
}

interface RuntimeServer {
  port: number
  hostname: string
  stop(): void
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
    embeddedStreams = true,
  } = options

  // Start embedded stream server in development
  if (embeddedStreams && process.env.NODE_ENV !== 'production') {
    startEmbeddedStreams()
  }

  // Build combined request handler
  const handler = createHandler({ rest, channels, flows, projections, signals })

  // Start Bun server
  const server = Bun.serve({
    port,
    hostname,
    fetch: handler,
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
}): (req: Request) => Promise<Response> {
  const { rest, channels } = options

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

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const pathname = url.pathname

    // Check for REST API match
    for (const [basePath, handler] of restHandlers) {
      if (pathname.startsWith(basePath)) {
        return handler(req)
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

    // Health check
    if (pathname === '/health' || pathname === '/_health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

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
 */
async function startEmbeddedStreams(): Promise<void> {
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

    const store = new FileBackedStreamStore({
      dataDir: './.onepipe/streams',
    })

    const server = new UnbrokenServer({
      store,
      port: streamsPort,
    })

    await server.start()
    console.log(`  ✓ Embedded streams server started on port ${streamsPort}`)
  } catch (error) {
    console.warn(`  ⚠ Could not start embedded streams server:`, error)
    console.warn(`    Make sure @unbroken-protocol/server is installed`)
  }
}

export type { RuntimeOptions, RuntimeServer }
