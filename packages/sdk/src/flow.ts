/**
 * Flow - Durable Event Stream Builder
 *
 * @example
 * ```typescript
 * const orderEvents = Flow
 *   .create('order-events')
 *   .schema(OrderEventSchema)
 *   .retention({ maxAge: '30d' })
 *   .trace()
 *   .build()
 *
 * await orderEvents.append({ type: 'created', orderId: '123' })
 * ```
 */

import type { z } from 'zod'
import type {
  FlowOptions,
  FlowInstance,
  RetentionOptions,
  ReadOptions,
  StreamOptions,
} from './types'

// Flow builder state
interface FlowBuilderState<T> {
  name: string
  schema?: z.ZodType<T>
  retention?: RetentionOptions
  trace: boolean
  streamUrl?: string
}

/**
 * Flow Builder - Fluent API for creating durable streams
 */
class FlowBuilder<T = unknown> {
  private state: FlowBuilderState<T>

  private constructor(name: string) {
    this.state = {
      name,
      trace: false,
    }
  }

  /**
   * Create a new Flow builder
   */
  static create(name: string): FlowBuilder<unknown> {
    return new FlowBuilder(name)
  }

  /**
   * Set the schema for flow messages (Zod)
   */
  schema<TSchema>(schema: z.ZodType<TSchema>): FlowBuilder<TSchema> {
    const builder = this as unknown as FlowBuilder<TSchema>
    builder.state.schema = schema
    return builder
  }

  /**
   * Set retention policy
   */
  retention(options: RetentionOptions): this {
    this.state.retention = options
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
   * Set custom stream URL (defaults to config)
   */
  url(streamUrl: string): this {
    this.state.streamUrl = streamUrl
    return this
  }

  /**
   * Alias for url() - Set custom stream URL
   */
  streamsUrl(streamUrl: string): this {
    return this.url(streamUrl)
  }

  /**
   * Build the Flow instance
   */
  build(): FlowInstance<T> {
    return new FlowInstanceImpl<T>(this.state)
  }
}

/**
 * Flow instance implementation
 */
class FlowInstanceImpl<T> implements FlowInstance<T> {
  readonly name: string
  private schema?: z.ZodType<T>
  private retention?: RetentionOptions
  private traceEnabled: boolean
  private streamUrl: string
  private subscribers: Set<(data: T) => void> = new Set()
  private events: Array<{ id: string; data: T; timestamp: number; offset: string }> = []
  private eventCounter = 0

  constructor(state: FlowBuilderState<T>) {
    this.name = state.name
    this.schema = state.schema
    this.retention = state.retention
    this.traceEnabled = state.trace
    this.streamUrl = state.streamUrl || this.getDefaultStreamUrl()

    // Register with dashboard
    this.registerWithDashboard()
  }

  private getDefaultStreamUrl(): string {
    // Get from environment or config
    const baseUrl = process.env.ONEPIPE_STREAMS_URL
    if (baseUrl) {
      return `${baseUrl}/v1/stream/flows/${this.name}`
    }
    // No external stream server - use local storage
    return ''
  }

  /**
   * Register flow with dashboard
   */
  private async registerWithDashboard(): Promise<void> {
    const dashboardUrl = process.env.ONEPIPE_DASHBOARD_URL || 'http://localhost:4001'

    if (!process.env.ONEPIPE_DASHBOARD && process.env.NODE_ENV === 'production') {
      return
    }

    try {
      await fetch(`${dashboardUrl}/api/dashboard/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.name }),
      })
    } catch {
      // Dashboard not running, ignore
    }
  }

  /**
   * Append data to the flow
   */
  async append(data: T): Promise<void> {
    // Validate with schema if present
    if (this.schema) {
      this.schema.parse(data)
    }

    const startTime = this.traceEnabled ? performance.now() : 0
    const eventId = crypto.randomUUID()
    const offset = String(++this.eventCounter).padStart(10, '0')
    const timestamp = Date.now()

    // Store locally
    this.events.push({ id: eventId, data, timestamp, offset })

    // Keep only last 1000 events
    if (this.events.length > 1000) {
      this.events = this.events.slice(-1000)
    }

    // Notify local subscribers
    this.subscribers.forEach((handler) => handler(data))

    // Report to dashboard
    this.reportEventToDashboard(eventId, data, timestamp, offset)

    // If external stream URL is configured, also send there
    if (this.streamUrl) {
      try {
        await fetch(this.streamUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
      } catch {
        // External stream not available, ignore
      }
    }

    if (this.traceEnabled) {
      const duration = performance.now() - startTime
      console.debug(`[Flow:${this.name}] append took ${duration.toFixed(2)}ms`)
    }
  }

  /**
   * Report event to dashboard
   */
  private async reportEventToDashboard(id: string, data: T, timestamp: number, offset: string): Promise<void> {
    const dashboardUrl = process.env.ONEPIPE_DASHBOARD_URL
    if (!dashboardUrl) return

    try {
      await fetch(`${dashboardUrl}/api/dashboard/flows/${encodeURIComponent(this.name)}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, flowName: this.name, data, timestamp, offset }),
      })
    } catch {
      // Dashboard not running, ignore
    }
  }

  /**
   * Read messages from the flow
   */
  async read(options: ReadOptions = {}): Promise<T[]> {
    // Use local storage if no external stream URL
    if (!this.streamUrl) {
      return this.readFromLocalStorage(options)
    }

    // External stream URL
    const params = new URLSearchParams()
    if (options.offset) params.set('offset', options.offset)
    if (options.tail) params.set('tail', String(options.tail))
    if (options.limit) params.set('limit', String(options.limit))

    const url = `${this.streamUrl}?${params.toString()}`

    try {
      const response = await fetch(url)

      if (!response.ok) {
        // Stream not found - fallback to local storage
        if (response.status === 404) {
          return this.readFromLocalStorage(options)
        }
        throw new Error(`Failed to read from flow: ${response.statusText}`)
      }

      const data = await response.json() as T | T[]
      return Array.isArray(data) ? data : [data]
    } catch (error) {
      // Network error or stream server not available - fallback to local storage
      if (error instanceof TypeError || (error as Error).message.includes('fetch')) {
        return this.readFromLocalStorage(options)
      }
      throw error
    }
  }

  /**
   * Read from local storage (fallback)
   */
  private readFromLocalStorage(options: ReadOptions = {}): T[] {
    let result = [...this.events]

    // Apply offset filter
    if (options.offset) {
      const offsetIndex = result.findIndex((e) => e.offset > options.offset!)
      result = offsetIndex >= 0 ? result.slice(offsetIndex) : []
    }

    // Apply tail filter
    if (options.tail) {
      result = result.slice(-options.tail)
    }

    // Apply limit
    if (options.limit && result.length > options.limit) {
      result = result.slice(0, options.limit)
    }

    return result.map((e) => e.data)
  }

  /**
   * Subscribe to live updates
   */
  subscribe(handler: (data: T) => void): () => void {
    this.subscribers.add(handler)

    // Start SSE connection if first subscriber
    if (this.subscribers.size === 1) {
      this.startLiveConnection()
    }

    // Return unsubscribe function
    return () => {
      this.subscribers.delete(handler)
    }
  }

  /**
   * Stream messages as async iterable
   */
  async *stream(options: StreamOptions = {}): AsyncIterable<T> {
    // Non-live or no external URL: use local read
    if (!options.live || !this.streamUrl) {
      const messages = await this.read(options)
      for (const message of messages) {
        yield message
      }
      return
    }

    // External stream with SSE
    const params = new URLSearchParams()
    if (options.offset) params.set('offset', options.offset)
    params.set('live', options.live === true ? 'sse' : options.live)

    const url = `${this.streamUrl}?${params.toString()}`

    // @ts-ignore - EventSource constructor signature varies between environments
    const eventSource = new EventSource(url) as {
      onmessage: ((event: { data: string }) => void) | null
      onerror: ((event: unknown) => void) | null
      close: () => void
    }

    try {
      while (true) {
        const event = await new Promise<{ data: string }>((resolve, reject) => {
          eventSource.onmessage = (e) => resolve(e)
          eventSource.onerror = reject
        })

        const data = JSON.parse(event.data)
        if (Array.isArray(data)) {
          for (const item of data) {
            yield item as T
          }
        } else {
          yield data as T
        }
      }
    } finally {
      eventSource.close()
    }
  }

  private startLiveConnection(): void {
    // No external stream URL - local subscribe only (already handled by append())
    if (!this.streamUrl) {
      return
    }

    // Check if EventSource is available (not in all Bun versions)
    if (typeof globalThis.EventSource === 'undefined') {
      return
    }

    const url = `${this.streamUrl}?live=sse`
    let reconnectAttempts = 0
    const maxReconnectDelay = 30000

    const connect = () => {
      if (this.subscribers.size === 0) return

      // @ts-ignore - EventSource constructor signature varies between environments
      const eventSource = new EventSource(url) as {
        onopen: (() => void) | null
        onmessage: ((event: { data: string }) => void) | null
        onerror: ((event: unknown) => void) | null
        close: () => void
        readyState: number
      }

      eventSource.onopen = () => {
        reconnectAttempts = 0
      }

      eventSource.onmessage = (event: { data: string }) => {
        try {
          const data = JSON.parse(event.data)
          const messages = Array.isArray(data) ? data : [data]
          for (const message of messages) {
            this.subscribers.forEach((handler) => handler(message as T))
          }
        } catch {
          // Ignore parse errors
        }
      }

      eventSource.onerror = () => {
        eventSource.close()
        if (this.subscribers.size === 0) return

        const baseDelay = Math.min(1000 * Math.pow(2, reconnectAttempts), maxReconnectDelay)
        const delay = baseDelay + Math.random() * 1000
        reconnectAttempts++
        setTimeout(connect, delay)
      }
    }

    connect()
  }
}

/**
 * Create a new Flow
 */
export const Flow = {
  create: FlowBuilder.create,
}

export type { FlowBuilder, FlowInstance }
