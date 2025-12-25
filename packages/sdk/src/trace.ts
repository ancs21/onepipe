/**
 * Trace - Distributed Tracing Builder
 *
 * OpenTelemetry-compatible tracing for observability
 *
 * @example
 * ```typescript
 * import { Trace } from '@onepipe/sdk'
 *
 * const tracer = Trace
 *   .create('my-service')
 *   .exporter('console')
 *   .build()
 *
 * // Manual span creation
 * await tracer.span('process-order', async (span) => {
 *   span.setAttribute('orderId', '123')
 *   await processOrder()
 *   span.setStatus('ok')
 * })
 *
 * // Wrap a function for automatic tracing
 * const tracedFn = tracer.wrap('fetchUser', async (userId: string) => {
 *   return await db.query('SELECT * FROM users WHERE id = ?', [userId])
 * })
 * ```
 */

export interface SpanContext {
  traceId: string
  spanId: string
  parentSpanId?: string
}

export interface Span {
  readonly name: string
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly startTime: number
  endTime?: number
  status: 'unset' | 'ok' | 'error'
  attributes: Record<string, SpanAttributeValue>

  setAttribute(key: string, value: SpanAttributeValue): void
  setStatus(status: 'ok' | 'error', message?: string): void
  addEvent(name: string, attributes?: Record<string, SpanAttributeValue>): void
  end(): void
}

export type SpanAttributeValue = string | number | boolean | string[] | number[] | boolean[]

export interface SpanEvent {
  name: string
  timestamp: number
  attributes?: Record<string, SpanAttributeValue>
}

export interface TraceExporter {
  export(spans: SpanData[]): Promise<void>
}

export interface SpanData {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTime: number
  endTime: number
  status: 'unset' | 'ok' | 'error'
  statusMessage?: string
  attributes: Record<string, SpanAttributeValue>
  events: SpanEvent[]
}

/**
 * Generate random hex ID
 */
function generateId(length: number): string {
  const bytes = new Uint8Array(length / 2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Span implementation
 */
class SpanImpl implements Span {
  readonly name: string
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly startTime: number
  endTime?: number
  status: 'unset' | 'ok' | 'error' = 'unset'
  statusMessage?: string
  attributes: Record<string, SpanAttributeValue> = {}
  events: SpanEvent[] = []

  private onEnd: (span: SpanImpl) => void

  constructor(
    name: string,
    context: SpanContext,
    onEnd: (span: SpanImpl) => void
  ) {
    this.name = name
    this.traceId = context.traceId
    this.spanId = context.spanId
    this.parentSpanId = context.parentSpanId
    this.startTime = performance.now()
    this.onEnd = onEnd
  }

  setAttribute(key: string, value: SpanAttributeValue): void {
    this.attributes[key] = value
  }

  setStatus(status: 'ok' | 'error', message?: string): void {
    this.status = status
    this.statusMessage = message
  }

  addEvent(name: string, attributes?: Record<string, SpanAttributeValue>): void {
    this.events.push({
      name,
      timestamp: performance.now(),
      attributes,
    })
  }

  end(): void {
    if (this.endTime) return // Already ended
    this.endTime = performance.now()
    this.onEnd(this)
  }

  toData(): SpanData {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      startTime: this.startTime,
      endTime: this.endTime || performance.now(),
      status: this.status,
      statusMessage: this.statusMessage,
      attributes: this.attributes,
      events: this.events,
    }
  }
}

/**
 * Console exporter - prints spans to console
 */
class ConsoleExporter implements TraceExporter {
  async export(spans: SpanData[]): Promise<void> {
    for (const span of spans) {
      const duration = (span.endTime - span.startTime).toFixed(2)
      const status = span.status === 'ok' ? '✓' : span.status === 'error' ? '✗' : '○'
      console.log(
        `[TRACE] ${status} ${span.name} (${duration}ms) [${span.traceId.slice(0, 8)}:${span.spanId.slice(0, 8)}]`
      )
      if (Object.keys(span.attributes).length > 0) {
        console.log(`        attrs:`, span.attributes)
      }
      if (span.events.length > 0) {
        for (const event of span.events) {
          console.log(`        event: ${event.name}`, event.attributes || '')
        }
      }
    }
  }
}

/**
 * OTLP exporter - sends spans to OTLP endpoint
 */
class OTLPExporter implements TraceExporter {
  private endpoint: string
  private headers: Record<string, string>

  constructor(endpoint: string, headers?: Record<string, string>) {
    this.endpoint = endpoint
    this.headers = headers || {}
  }

  async export(spans: SpanData[]): Promise<void> {
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: spans.map((span) => ({
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                name: span.name,
                startTimeUnixNano: Math.floor(span.startTime * 1000000),
                endTimeUnixNano: Math.floor(span.endTime * 1000000),
                status: {
                  code: span.status === 'ok' ? 1 : span.status === 'error' ? 2 : 0,
                  message: span.statusMessage,
                },
                attributes: Object.entries(span.attributes).map(([key, value]) => ({
                  key,
                  value: { stringValue: String(value) },
                })),
                events: span.events.map((event) => ({
                  name: event.name,
                  timeUnixNano: Math.floor(event.timestamp * 1000000),
                  attributes: event.attributes
                    ? Object.entries(event.attributes).map(([key, value]) => ({
                        key,
                        value: { stringValue: String(value) },
                      }))
                    : [],
                })),
              })),
            },
          ],
        },
      ],
    }

    try {
      await fetch(`${this.endpoint}/v1/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      console.error('[TRACE] Failed to export spans:', error)
    }
  }
}

/**
 * Noop exporter - discards all spans
 */
class NoopExporter implements TraceExporter {
  async export(): Promise<void> {
    // Do nothing
  }
}

/**
 * Dashboard exporter - sends spans to OnePipe Dashboard
 */
class DashboardExporter implements TraceExporter {
  private endpoint: string
  private serviceName: string

  constructor(serviceName: string, endpoint?: string) {
    this.serviceName = serviceName
    this.endpoint = endpoint || process.env.ONEPIPE_DASHBOARD_URL || 'http://localhost:4001'
  }

  async export(spans: SpanData[]): Promise<void> {
    // Group spans by traceId
    const traceMap = new Map<string, SpanData[]>()
    for (const span of spans) {
      const existing = traceMap.get(span.traceId) || []
      existing.push(span)
      traceMap.set(span.traceId, existing)
    }

    // Send each trace
    for (const [traceId, traceSpans] of traceMap) {
      const rootSpan = traceSpans.find(s => !s.parentSpanId) || traceSpans[0]
      const trace = {
        traceId,
        rootSpan: {
          traceId,
          spanId: rootSpan.spanId,
          parentSpanId: rootSpan.parentSpanId,
          name: rootSpan.name,
          startTime: rootSpan.startTime,
          endTime: rootSpan.endTime,
          duration: rootSpan.endTime - rootSpan.startTime,
          status: rootSpan.status === 'error' ? 'error' : 'ok',
          statusMessage: rootSpan.statusMessage,
          attributes: {
            ...rootSpan.attributes,
            'service.name': this.serviceName,
          },
          events: rootSpan.events,
        },
        spans: traceSpans.map(s => ({
          traceId: s.traceId,
          spanId: s.spanId,
          parentSpanId: s.parentSpanId,
          name: s.name,
          startTime: s.startTime,
          endTime: s.endTime,
          duration: s.endTime - s.startTime,
          status: s.status === 'error' ? 'error' : 'ok',
          statusMessage: s.statusMessage,
          attributes: {
            ...s.attributes,
            'service.name': this.serviceName,
          },
          events: s.events,
        })),
        totalDuration: rootSpan.endTime - rootSpan.startTime,
        status: rootSpan.status === 'error' ? 'error' : 'ok',
        timestamp: Date.now(),
        services: [this.serviceName],
        spanCount: traceSpans.length,
      }

      try {
        await fetch(`${this.endpoint}/api/dashboard/traces`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trace),
        })
      } catch {
        // Dashboard not running, ignore
      }
    }
  }
}

export interface TracerInstance {
  readonly name: string
  span<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T>
  wrap<TArgs extends unknown[], TResult>(
    name: string,
    fn: (...args: TArgs) => Promise<TResult>
  ): (...args: TArgs) => Promise<TResult>
  startSpan(name: string, parentContext?: SpanContext): Span
  context(): SpanContext | undefined
  withContext<T>(context: SpanContext, fn: () => Promise<T>): Promise<T>
  flush(): Promise<void>
}

/**
 * Trace builder with fluent API
 */
class TraceBuilder {
  private serviceName: string
  private exporterType: 'console' | 'otlp' | 'noop' | 'dashboard' = 'console'
  private otlpEndpoint?: string
  private otlpHeaders?: Record<string, string>
  private dashboardEndpoint?: string
  private batchSize: number = 100
  private flushInterval: number = 5000

  constructor(name: string) {
    this.serviceName = name
  }

  /**
   * Set exporter type
   */
  exporter(type: 'console' | 'otlp' | 'noop' | 'dashboard'): this {
    this.exporterType = type
    return this
  }

  /**
   * Set OTLP endpoint
   */
  otlp(endpoint: string, headers?: Record<string, string>): this {
    this.exporterType = 'otlp'
    this.otlpEndpoint = endpoint
    this.otlpHeaders = headers
    return this
  }

  /**
   * Set dashboard endpoint (for OnePipe Dashboard)
   */
  dashboard(endpoint?: string): this {
    this.exporterType = 'dashboard'
    this.dashboardEndpoint = endpoint
    return this
  }

  /**
   * Set batch configuration
   */
  batch(size: number, intervalMs: number): this {
    this.batchSize = size
    this.flushInterval = intervalMs
    return this
  }

  /**
   * Build the tracer instance
   */
  build(): TracerInstance {
    let exporter: TraceExporter

    switch (this.exporterType) {
      case 'otlp':
        if (!this.otlpEndpoint) {
          throw new Error('OTLP exporter requires an endpoint. Use .otlp(endpoint)')
        }
        exporter = new OTLPExporter(this.otlpEndpoint, this.otlpHeaders)
        break
      case 'dashboard':
        exporter = new DashboardExporter(this.serviceName, this.dashboardEndpoint)
        break
      case 'noop':
        exporter = new NoopExporter()
        break
      case 'console':
      default:
        exporter = new ConsoleExporter()
    }

    return new TracerImpl(this.serviceName, exporter, this.batchSize, this.flushInterval)
  }
}

/**
 * Tracer implementation
 */
class TracerImpl implements TracerInstance {
  readonly name: string
  private exporter: TraceExporter
  private pendingSpans: SpanData[] = []
  private batchSize: number
  private flushInterval: number
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private currentContext: SpanContext | undefined

  constructor(
    name: string,
    exporter: TraceExporter,
    batchSize: number,
    flushInterval: number
  ) {
    this.name = name
    this.exporter = exporter
    this.batchSize = batchSize
    this.flushInterval = flushInterval

    // Start flush timer
    this.flushTimer = setInterval(() => {
      this.flush()
    }, flushInterval)
  }

  /**
   * Create and run a span
   */
  async span<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    const span = this.startSpan(name, this.currentContext)
    const prevContext = this.currentContext
    this.currentContext = {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
    }

    try {
      const result = await fn(span)
      if (span.status === 'unset') {
        span.setStatus('ok')
      }
      return result
    } catch (error) {
      span.setStatus('error', error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      span.end()
      this.currentContext = prevContext
    }
  }

  /**
   * Wrap a function with automatic tracing
   */
  wrap<TArgs extends unknown[], TResult>(
    name: string,
    fn: (...args: TArgs) => Promise<TResult>
  ): (...args: TArgs) => Promise<TResult> {
    return async (...args: TArgs): Promise<TResult> => {
      return this.span(name, async (span) => {
        span.setAttribute('args.count', args.length)
        return fn(...args)
      })
    }
  }

  /**
   * Start a new span manually
   */
  startSpan(name: string, parentContext?: SpanContext): Span {
    const context: SpanContext = {
      traceId: parentContext?.traceId || generateId(32),
      spanId: generateId(16),
      parentSpanId: parentContext?.spanId,
    }

    return new SpanImpl(name, context, (span) => {
      this.pendingSpans.push(span.toData())
      if (this.pendingSpans.length >= this.batchSize) {
        this.flush()
      }
    })
  }

  /**
   * Get current span context
   */
  context(): SpanContext | undefined {
    return this.currentContext
  }

  /**
   * Execute function with specific context
   */
  async withContext<T>(context: SpanContext, fn: () => Promise<T>): Promise<T> {
    const prevContext = this.currentContext
    this.currentContext = context
    try {
      return await fn()
    } finally {
      this.currentContext = prevContext
    }
  }

  /**
   * Flush pending spans
   */
  async flush(): Promise<void> {
    if (this.pendingSpans.length === 0) return

    const spans = this.pendingSpans
    this.pendingSpans = []

    try {
      await this.exporter.export(spans)
    } catch (error) {
      console.error('[TRACE] Flush failed:', error)
      // Re-add failed spans (with limit to prevent memory issues)
      if (this.pendingSpans.length < this.batchSize * 10) {
        this.pendingSpans.unshift(...spans)
      }
    }
  }

  /**
   * Stop the tracer and flush remaining spans
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    await this.flush()
  }
}

/**
 * Global tracer for convenience
 */
let globalTracer: TracerInstance | null = null

/**
 * Trace entry point
 */
export const Trace = {
  /**
   * Create a new tracer builder
   */
  create(name: string): TraceBuilder {
    return new TraceBuilder(name)
  },

  /**
   * Set global tracer
   */
  setGlobal(tracer: TracerInstance): void {
    globalTracer = tracer
  },

  /**
   * Get global tracer
   */
  getGlobal(): TracerInstance | null {
    return globalTracer
  },

  /**
   * Create a span using global tracer
   */
  async span<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    if (!globalTracer) {
      // No-op if no global tracer
      return fn({
        name,
        traceId: '',
        spanId: '',
        startTime: 0,
        status: 'unset',
        attributes: {},
        setAttribute: () => {},
        setStatus: () => {},
        addEvent: () => {},
        end: () => {},
      })
    }
    return globalTracer.span(name, fn)
  },
}

export type { TraceBuilder, TracerInstance as TracerImpl }
