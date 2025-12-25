/**
 * REST - RESTful API Builder
 *
 * @example
 * ```typescript
 * const ordersAPI = REST
 *   .create('orders')
 *   .basePath('/api/orders')
 *   .db(postgres)
 *   .auth(onepipeAuth)
 *
 *   .get('/', async (ctx) => {
 *     return ctx.db`SELECT * FROM orders`
 *   })
 *
 *   .post('/', async (ctx) => {
 *     const input = ctx.body()
 *     return ctx.created({ id: '123', ...input })
 *   })
 *
 *   .trace()
 *   .openapi({ title: 'Orders API' })
 *   .build()
 * ```
 */

import type {
  RESTOptions,
  RESTContext,
  RESTHandler,
  RESTInstance,
  RouteDefinition,
  RouteOptions,
  DBInstance,
  CacheInstance,
  AuthInstance,
  UploadedFile,
} from './types'
import { APIError } from './types'
import { Trace, type TracerInstance } from './trace'
import { initTracing, getTracer, SpanStatusCode, setActiveContext, type Tracer } from './otel'
import { trace, context } from '@opentelemetry/api'

// Internal type for parsed multipart data
interface ParsedMultipart {
  fields: Record<string, string>
  files: Array<UploadedFile & { fieldName: string }>
}

// REST builder state
interface RESTBuilderState {
  name: string
  basePath: string
  routes: RouteDefinition[]
  db?: DBInstance
  cache?: CacheInstance
  auth?: AuthInstance
  trace: boolean
  openapi?: OpenAPIOptions
  cors?: CORSOptions
  maxBodySize?: number
}

// Default max body size: 10MB
const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024

interface OpenAPIOptions {
  title?: string
  version?: string
  description?: string
}

interface CORSOptions {
  origin?: string | string[]
  methods?: string[]
  headers?: string[]
}

/**
 * REST Builder - Fluent API for creating REST endpoints
 */
class RESTBuilder {
  private state: RESTBuilderState

  private constructor(name: string) {
    this.state = {
      name,
      basePath: '',
      routes: [],
      trace: false,
    }
  }

  /**
   * Create a new REST builder
   */
  static create(name: string): RESTBuilder {
    return new RESTBuilder(name)
  }

  /**
   * Set the base path for all routes
   */
  basePath(path: string): this {
    this.state.basePath = path.replace(/\/$/, '') // Remove trailing slash
    return this
  }

  /**
   * Inject database connection
   */
  db(instance: DBInstance): this {
    this.state.db = instance
    return this
  }

  /**
   * Inject cache connection
   */
  cache(instance: CacheInstance): this {
    this.state.cache = instance
    return this
  }

  /**
   * Require authentication for all routes
   */
  auth(instance: AuthInstance): this {
    this.state.auth = instance
    return this
  }

  /**
   * Add GET route
   */
  get(path: string, handler: RESTHandler): this
  get(path: string, options: RouteOptions, handler: RESTHandler): this
  get(path: string, optionsOrHandler: RouteOptions | RESTHandler, handler?: RESTHandler): this {
    const [opts, h] = this.parseRouteArgs(optionsOrHandler, handler)
    this.state.routes.push({ method: 'GET', path, handler: h, options: opts })
    return this
  }

  /**
   * Add POST route
   */
  post(path: string, handler: RESTHandler): this
  post(path: string, options: RouteOptions, handler: RESTHandler): this
  post(path: string, optionsOrHandler: RouteOptions | RESTHandler, handler?: RESTHandler): this {
    const [opts, h] = this.parseRouteArgs(optionsOrHandler, handler)
    this.state.routes.push({ method: 'POST', path, handler: h, options: opts })
    return this
  }

  /**
   * Add PUT route
   */
  put(path: string, handler: RESTHandler): this
  put(path: string, options: RouteOptions, handler: RESTHandler): this
  put(path: string, optionsOrHandler: RouteOptions | RESTHandler, handler?: RESTHandler): this {
    const [opts, h] = this.parseRouteArgs(optionsOrHandler, handler)
    this.state.routes.push({ method: 'PUT', path, handler: h, options: opts })
    return this
  }

  /**
   * Add PATCH route
   */
  patch(path: string, handler: RESTHandler): this
  patch(path: string, options: RouteOptions, handler: RESTHandler): this
  patch(path: string, optionsOrHandler: RouteOptions | RESTHandler, handler?: RESTHandler): this {
    const [opts, h] = this.parseRouteArgs(optionsOrHandler, handler)
    this.state.routes.push({ method: 'PATCH', path, handler: h, options: opts })
    return this
  }

  /**
   * Add DELETE route
   */
  delete(path: string, handler: RESTHandler): this
  delete(path: string, options: RouteOptions, handler: RESTHandler): this
  delete(path: string, optionsOrHandler: RouteOptions | RESTHandler, handler?: RESTHandler): this {
    const [opts, h] = this.parseRouteArgs(optionsOrHandler, handler)
    this.state.routes.push({ method: 'DELETE', path, handler: h, options: opts })
    return this
  }

  /**
   * Enable distributed tracing
   */
  trace(): this {
    this.state.trace = true
    return this
  }

  /**
   * Enable OpenAPI spec generation
   */
  openapi(options?: OpenAPIOptions): this {
    this.state.openapi = options || {}
    return this
  }

  /**
   * Configure CORS - requires explicit origin configuration
   */
  cors(options: CORSOptions): this {
    if (!options.origin) {
      throw new Error('CORS requires explicit origin configuration. Use { origin: "https://example.com" } or { origin: ["https://a.com", "https://b.com"] }')
    }
    this.state.cors = options
    return this
  }

  /**
   * Set maximum request body size (default: 10MB)
   */
  maxBodySize(bytes: number): this {
    this.state.maxBodySize = bytes
    return this
  }

  /**
   * Build the REST instance
   */
  build(): RESTInstance {
    return new RESTInstanceImpl(this.state)
  }

  private parseRouteArgs(
    optionsOrHandler: RouteOptions | RESTHandler,
    handler?: RESTHandler
  ): [RouteOptions | undefined, RESTHandler] {
    if (typeof optionsOrHandler === 'function') {
      return [undefined, optionsOrHandler]
    }
    return [optionsOrHandler, handler!]
  }
}

/**
 * REST instance implementation
 */
class RESTInstanceImpl implements RESTInstance {
  readonly name: string
  readonly basePath: string
  readonly routes: RouteDefinition[]

  private db?: DBInstance
  private cache?: CacheInstance
  private auth?: AuthInstance
  private traceEnabled: boolean
  private tracer: Tracer | null = null
  private openapi?: OpenAPIOptions
  private cors?: CORSOptions
  private maxBodySizeBytes: number

  constructor(state: RESTBuilderState) {
    this.name = state.name
    this.basePath = state.basePath
    this.routes = state.routes
    this.db = state.db
    this.cache = state.cache
    this.auth = state.auth
    this.traceEnabled = state.trace
    this.openapi = state.openapi
    this.cors = state.cors
    this.maxBodySizeBytes = state.maxBodySize ?? DEFAULT_MAX_BODY_SIZE

    // Initialize OTEL tracing if enabled
    if (this.traceEnabled) {
      initTracing({ serviceName: this.name })
      this.tracer = getTracer(this.name)
    }

    // Auto-register routes with dashboard in dev mode
    this.registerWithDashboard()
  }

  /**
   * Register routes with the dashboard API (for dev mode)
   */
  private async registerWithDashboard(): Promise<void> {
    // Check if dashboard is enabled
    const dashboardUrl = process.env.ONEPIPE_DASHBOARD_URL || 'http://localhost:4001'

    // Only register if ONEPIPE_DASHBOARD is set or we're in dev
    if (!process.env.ONEPIPE_DASHBOARD && process.env.NODE_ENV === 'production') {
      return
    }

    const routes = this.routes.map((route) => ({
      method: route.method,
      path: route.path === '/' ? this.basePath : `${this.basePath}${route.path}`,
      auth: !!this.auth && !route.options?.public,
    }))

    try {
      await fetch(`${dashboardUrl}/api/dashboard/routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routes, serviceName: this.name }),
      })
    } catch {
      // Dashboard not running, ignore silently
    }
  }

  /**
   * Create request handler for Bun.serve
   */
  handler(): (req: Request) => Promise<Response> {
    return async (req: Request): Promise<Response> => {
      const url = new URL(req.url)
      const path = url.pathname

      // Handle CORS preflight
      if (req.method === 'OPTIONS' && this.cors) {
        return this.corsResponse()
      }

      // Handle OpenAPI spec request
      if (this.openapi && path === `${this.basePath}/openapi.json`) {
        return this.openapiResponse()
      }

      // Find matching route
      const { route, pathExists } = this.findRoute(req.method, path)
      if (!route) {
        // If path exists but method doesn't match, return 405
        if (pathExists) {
          return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
            status: 405,
            headers: this.responseHeaders(),
          })
        }
        return new Response(JSON.stringify({ error: 'Not Found' }), {
          status: 404,
          headers: this.responseHeaders(),
        })
      }

      // Check authentication
      let authenticatedUser: unknown = undefined
      if (this.auth && !route.options?.public) {
        const authResult = await this.auth.middleware()(req)
        if (!authResult.authenticated) {
          const err = authResult.error instanceof APIError
            ? authResult.error
            : APIError.unauthenticated(
                typeof authResult.error === 'string' ? authResult.error : 'Unauthorized'
              )
          return new Response(JSON.stringify(err.toJSON()), {
            status: err.status,
            headers: this.responseHeaders(),
          })
        }
        authenticatedUser = authResult.user
      }

      // Check body size limit
      const contentLength = parseInt(req.headers.get('content-length') || '0')
      if (contentLength > this.maxBodySizeBytes) {
        return new Response(JSON.stringify({ error: 'Payload Too Large' }), {
          status: 413,
          headers: this.responseHeaders(),
        })
      }

      // Parse body before building context
      let parsedBody: unknown = null
      let parsedMultipart: ParsedMultipart | null = null
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        try {
          const contentType = req.headers.get('content-type') || ''
          if (contentType.includes('application/json')) {
            parsedBody = await req.json()
          } else if (contentType.includes('multipart/form-data')) {
            parsedMultipart = await this.parseMultipart(req)
            // Also set parsedBody to fields for backward compatibility
            parsedBody = parsedMultipart.fields
          } else if (contentType.includes('text/')) {
            parsedBody = await req.text()
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            const text = await req.text()
            parsedBody = Object.fromEntries(new URLSearchParams(text))
          } else if (req.body) {
            parsedBody = await req.arrayBuffer()
          }
        } catch {
          parsedBody = null
        }
      }

      // Build context
      const ctx = this.buildContext(req, route, path, parsedBody, parsedMultipart, authenticatedUser)

      // Execute handler with OTEL tracing if enabled
      if (this.tracer) {
        return this.tracer.startActiveSpan(`${req.method} ${path}`, async (span) => {
          span.setAttribute('http.method', req.method)
          span.setAttribute('http.route', path)
          span.setAttribute('http.url', req.url)
          span.setAttribute('service.name', this.name)

          // Store the active context for child spans (workaround for Bun AsyncLocalStorage)
          const spanContext = trace.setSpan(context.active(), span)
          setActiveContext(spanContext)

          try {
            const result = await route.handler(ctx)

            if (result instanceof Response) {
              span.setAttribute('http.status_code', result.status)
              span.setStatus({
                code: result.status >= 400 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
              })
              return result
            }

            span.setAttribute('http.status_code', 200)
            span.setStatus({ code: SpanStatusCode.OK })
            return new Response(JSON.stringify(result), {
              status: 200,
              headers: this.responseHeaders(),
            })
          } catch (error) {
            console.error(`[REST:${this.name}] Error:`, error)

            // Handle APIError with typed error codes (Encore-compatible)
            if (error instanceof APIError) {
              span.setAttribute('http.status_code', error.status)
              span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
              span.end()
              return new Response(
                JSON.stringify(error.toJSON()),
                {
                  status: error.status,
                  headers: this.responseHeaders(),
                }
              )
            }

            // Return generic error message for unknown errors (don't expose internal details)
            span.setAttribute('http.status_code', 500)
            span.setStatus({ code: SpanStatusCode.ERROR, message: 'Internal Server Error' })
            span.end()
            return new Response(
              JSON.stringify({ code: 'Internal', message: 'Internal Server Error' }),
              {
                status: 500,
                headers: this.responseHeaders(),
              }
            )
          } finally {
            setActiveContext(null) // Clear context after request
            span.end()
          }
        })
      }

      // Non-traced execution path
      try {
        const result = await route.handler(ctx)

        if (result instanceof Response) {
          return result
        }

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: this.responseHeaders(),
        })
      } catch (error) {
        console.error(`[REST:${this.name}] Error:`, error)

        if (error instanceof APIError) {
          return new Response(
            JSON.stringify(error.toJSON()),
            {
              status: error.status,
              headers: this.responseHeaders(),
            }
          )
        }

        return new Response(
          JSON.stringify({ code: 'Internal', message: 'Internal Server Error' }),
          {
            status: 500,
            headers: this.responseHeaders(),
          }
        )
      }
    }
  }

  private findRoute(method: string, pathname: string): { route: RouteDefinition | undefined; pathExists: boolean } {
    let pathExists = false

    for (const route of this.routes) {
      const fullPath = `${this.basePath}${route.path}`
      const match = this.matchPath(fullPath, pathname)
      if (match) {
        pathExists = true
        if (route.method === method) {
          return { route, pathExists: true }
        }
      }
    }

    return { route: undefined, pathExists }
  }

  private matchPath(pattern: string, pathname: string): Record<string, string> | null {
    // Normalize trailing slashes - treat /api/todos and /api/todos/ as equivalent
    const normalizedPattern = pattern.replace(/\/+$/, '') || '/'
    const normalizedPathname = pathname.replace(/\/+$/, '') || '/'

    // Convert pattern to regex (e.g., /users/:id -> /users/([^/]+))
    const paramNames: string[] = []
    const regexPattern = normalizedPattern.replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name)
      return '([^/]+)'
    })

    const regex = new RegExp(`^${regexPattern}$`)
    const match = normalizedPathname.match(regex)

    if (!match) return null

    const params: Record<string, string> = {}
    paramNames.forEach((name, index) => {
      params[name] = match[index + 1]
    })

    return params
  }

  private buildContext(
    req: Request,
    route: RouteDefinition,
    pathname: string,
    parsedBody: unknown,
    parsedMultipart: ParsedMultipart | null,
    authenticatedUser?: unknown
  ): RESTContext {
    const url = new URL(req.url)
    const fullPath = `${this.basePath}${route.path}`
    const params = this.matchPath(fullPath, pathname) || {}

    const query: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      query[key] = value
    })

    // Capture responseHeaders in closure
    const defaultHeaders = this.responseHeaders()
    const responseHeaders = new Headers(defaultHeaders)

    const ctx: RESTContext = {
      params,
      query,
      headers: req.headers,
      responseHeaders,
      user: authenticatedUser, // Set by auth middleware
      // @ts-expect-error - Will be properly typed when DB is injected
      db: this.db,
      cache: this.cache,

      body<T>(): T {
        return parsedBody as T
      },

      file(name: string): UploadedFile | undefined {
        if (!parsedMultipart) return undefined
        return parsedMultipart.files.find(f => f.fieldName === name)
      },

      files(name?: string): UploadedFile[] {
        if (!parsedMultipart) return []
        if (name) {
          return parsedMultipart.files.filter(f => f.fieldName === name)
        }
        return parsedMultipart.files
      },

      formField(name: string): string | undefined {
        if (!parsedMultipart) return undefined
        return parsedMultipart.fields[name]
      },

      formFields(): Record<string, string> {
        if (!parsedMultipart) return {}
        return { ...parsedMultipart.fields }
      },

      json<T>(data: T, status = 200): Response {
        return new Response(JSON.stringify(data), {
          status,
          headers: responseHeaders,
        })
      },

      created<T>(data: T): Response {
        return new Response(JSON.stringify(data), {
          status: 201,
          headers: responseHeaders,
        })
      },

      noContent(): Response {
        return new Response(null, {
          status: 204,
          headers: responseHeaders,
        })
      },

      notFound(message = 'Not Found'): Response {
        return new Response(JSON.stringify({ error: message }), {
          status: 404,
          headers: responseHeaders,
        })
      },

      unauthorized(message = 'Unauthorized'): Response {
        return new Response(JSON.stringify({ error: message }), {
          status: 401,
          headers: responseHeaders,
        })
      },

      forbidden(message = 'Forbidden'): Response {
        return new Response(JSON.stringify({ error: message }), {
          status: 403,
          headers: responseHeaders,
        })
      },

      badRequest(message = 'Bad Request'): Response {
        return new Response(JSON.stringify({ error: message }), {
          status: 400,
          headers: responseHeaders,
        })
      },
    }

    return ctx
  }

  /**
   * Parse multipart/form-data request
   */
  private async parseMultipart(req: Request): Promise<ParsedMultipart> {
    const formData = await req.formData()
    const fields: Record<string, string> = {}
    const files: Array<UploadedFile & { fieldName: string }> = []

    for (const [name, value] of formData.entries()) {
      if (typeof value === 'object' && value !== null && 'arrayBuffer' in value) {
        const file = value as File
        files.push({
          fieldName: name,
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          arrayBuffer: () => file.arrayBuffer(),
          text: () => file.text(),
          blob: () => file,
          stream: () => file.stream(),
        })
      } else {
        fields[name] = String(value)
      }
    }

    return { fields, files }
  }

  private responseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.cors) {
      headers['Access-Control-Allow-Origin'] = Array.isArray(this.cors.origin)
        ? this.cors.origin.join(', ')
        : this.cors.origin || '*'
      headers['Access-Control-Allow-Methods'] = this.cors.methods?.join(', ') || 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
      headers['Access-Control-Allow-Headers'] = this.cors.headers?.join(', ') || 'Content-Type, Authorization'
    }

    return headers
  }

  private corsResponse(): Response {
    return new Response(null, {
      status: 204,
      headers: this.responseHeaders(),
    })
  }

  private openapiResponse(): Response {
    const spec = {
      openapi: '3.0.0',
      info: {
        title: this.openapi?.title || this.name,
        version: this.openapi?.version || '1.0.0',
        description: this.openapi?.description,
      },
      paths: this.generateOpenAPIPaths(),
    }

    return new Response(JSON.stringify(spec, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private generateOpenAPIPaths(): Record<string, unknown> {
    const paths: Record<string, unknown> = {}

    for (const route of this.routes) {
      const path = `${this.basePath}${route.path}`.replace(/:([^/]+)/g, '{$1}')

      if (!paths[path]) {
        paths[path] = {}
      }

      (paths[path] as Record<string, unknown>)[route.method.toLowerCase()] = {
        summary: `${route.method} ${route.path}`,
        responses: {
          '200': { description: 'Success' },
          '400': { description: 'Bad Request' },
          '401': { description: 'Unauthorized' },
          '404': { description: 'Not Found' },
          '500': { description: 'Internal Server Error' },
        },
      }
    }

    return paths
  }
}

/**
 * Create a new REST API
 */
export const REST = {
  create: RESTBuilder.create,
}

export type { RESTBuilder, RESTInstance }
