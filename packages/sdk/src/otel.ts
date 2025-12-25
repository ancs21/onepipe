/**
 * OpenTelemetry Tracing Module
 *
 * Provides OTEL-compatible tracing with support for:
 * - Dashboard collector (dev mode)
 * - Jaeger/Zipkin/Datadog (production)
 *
 * @example
 * ```typescript
 * import { initTracing, getTracer } from '@onepipe/sdk'
 *
 * // Auto-configured by CLI in dev mode
 * // Or manually configure for production:
 * initTracing({
 *   serviceName: 'my-service',
 *   endpoint: 'http://jaeger:4318/v1/traces'
 * })
 *
 * const tracer = getTracer('my-service')
 * await tracer.startActiveSpan('operation', async (span) => {
 *   span.setAttribute('key', 'value')
 *   // ... do work
 *   span.end()
 * })
 * ```
 */

import { trace, context, SpanStatusCode, type Tracer, type Span, type Context } from '@opentelemetry/api'
import { BasicTracerProvider, BatchSpanProcessor, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

let initialized = false
let globalProvider: BasicTracerProvider | null = null

export interface TracingOptions {
  /** Service name for traces */
  serviceName: string
  /** OTLP endpoint URL (defaults to OTEL_EXPORTER_OTLP_ENDPOINT env var or localhost:4001) */
  endpoint?: string
  /** Use simple processor instead of batch (for testing) */
  useSimpleProcessor?: boolean
  /** Batch processor config */
  batch?: {
    /** Max batch size before export (default: 512) */
    maxExportBatchSize?: number
    /** Max time to wait before export in ms (default: 5000) */
    scheduledDelayMillis?: number
  }
}

/**
 * Initialize OpenTelemetry tracing
 *
 * Should be called once at app startup. Safe to call multiple times.
 */
export function initTracing(options: TracingOptions): void {
  if (initialized) return

  const endpoint = options.endpoint
    || process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    || 'http://localhost:4001/v1/traces'

  const exporter = new OTLPTraceExporter({
    url: endpoint,
    headers: {},
  })

  // Create span processor - use simple for testing, batch for production
  const spanProcessor = options.useSimpleProcessor
    ? new SimpleSpanProcessor(exporter)
    : new BatchSpanProcessor(exporter, {
        maxExportBatchSize: options.batch?.maxExportBatchSize ?? 512,
        scheduledDelayMillis: options.batch?.scheduledDelayMillis ?? 5000,
      })

  // Create provider with resource and span processor (v2.x API)
  globalProvider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
    }),
    spanProcessors: [spanProcessor],
  })

  // Register as global tracer provider
  trace.setGlobalTracerProvider(globalProvider)
  initialized = true

  if (process.env.NODE_ENV === 'development') {
    console.debug(`[OTEL] Tracing initialized for "${options.serviceName}" → ${endpoint}`)
  }
}

/**
 * Get a tracer instance for creating spans
 */
export function getTracer(name: string, version?: string): Tracer {
  return trace.getTracer(name, version)
}

/**
 * Shutdown the tracer provider and flush pending spans
 */
export async function shutdown(): Promise<void> {
  if (globalProvider) {
    await globalProvider.shutdown()
    globalProvider = null
    initialized = false
  }
}

/**
 * Force flush all pending spans
 */
export async function flush(): Promise<void> {
  if (globalProvider) {
    await globalProvider.forceFlush()
  }
}

/**
 * Check if tracing is initialized
 */
export function isInitialized(): boolean {
  return initialized
}

// Store for active span context (workaround for Bun AsyncLocalStorage issues)
let activeSpanContext: Context | null = null

/**
 * Get the current active context (with workaround for Bun)
 */
export function getActiveContext(): Context {
  // Try OTEL's context.active() first, fall back to our stored context
  const otelContext = context.active()
  const activeSpan = trace.getSpan(otelContext)
  if (activeSpan) {
    return otelContext
  }
  return activeSpanContext || otelContext
}

/**
 * Set the active span context (for use in request handlers)
 */
export function setActiveContext(ctx: Context | null): void {
  activeSpanContext = ctx
}

/**
 * Create a child span if tracing is initialized, otherwise just execute the function.
 * Automatically handles span lifecycle, status, and error recording.
 *
 * @example
 * ```typescript
 * const result = await withSpan('db.query', {
 *   'db.system': 'postgres',
 *   'db.statement': 'SELECT * FROM users',
 * }, async () => {
 *   return await db.query('SELECT * FROM users')
 * })
 * ```
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>
): Promise<T> {
  if (!initialized) {
    return fn()
  }

  const tracer = trace.getTracer('onepipe')
  const parentContext = getActiveContext()

  // Create span with explicit parent context
  const span = tracer.startSpan(name, {}, parentContext)

  // Set attributes
  for (const [key, value] of Object.entries(attributes)) {
    span.setAttribute(key, value)
  }

  // Create new context with this span
  const spanContext = trace.setSpan(parentContext, span)

  try {
    // Run function with span context active
    const result = await context.with(spanContext, fn)
    span.setStatus({ code: SpanStatusCode.OK })
    return result
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    span.end()
  }
}

// Re-export useful OTEL types
export { SpanStatusCode, type Tracer, type Span, type Context }
