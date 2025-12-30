/**
 * Lifecycle Management for Cloud-Native OnePipe Applications
 *
 * Provides graceful shutdown handling, health checks, and readiness probes
 * for Kubernetes, Cloud Run, and other container orchestration platforms.
 *
 * @example
 * ```typescript
 * import { Lifecycle } from '@onepipe/sdk'
 *
 * const lifecycle = Lifecycle.create()
 *   .onShutdown(async () => {
 *     await db.close()
 *     await cache.disconnect()
 *   })
 *   .healthCheck('db', async () => db.query('SELECT 1'))
 *   .healthCheck('redis', async () => cache.ping())
 *   .build()
 *
 * // In your serve() call:
 * serve({ lifecycle })
 * ```
 */

import { flush as flushTracing, shutdown as shutdownTracing } from './otel'

// ============================================================================
// Types
// ============================================================================

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface HealthCheckResult {
  name: string
  status: HealthStatus
  latencyMs: number
  message?: string
}

export interface HealthResponse {
  status: HealthStatus
  timestamp: string
  uptime: number
  checks: HealthCheckResult[]
}

export interface ReadinessResponse {
  ready: boolean
  timestamp: string
  checks: HealthCheckResult[]
}

export type HealthCheckFn = () => Promise<void> | void

export interface ShutdownHook {
  name: string
  priority: number // Lower runs first
  handler: () => Promise<void> | void
}

export interface LifecycleOptions {
  /**
   * Grace period for shutdown in milliseconds
   * @default 30000 (30 seconds)
   */
  shutdownTimeout?: number

  /**
   * Whether to flush OTEL traces on shutdown
   * @default true
   */
  flushTracingOnShutdown?: boolean
}

export interface LifecycleInstance {
  /**
   * Check if the application is alive (for K8s liveness probe)
   * Returns 200 if process is running
   */
  liveness(): Response

  /**
   * Check if the application is ready to receive traffic (for K8s readiness probe)
   * Returns 200 only if all health checks pass
   */
  readiness(): Promise<Response>

  /**
   * Detailed health check with all component statuses
   */
  health(): Promise<Response>

  /**
   * Trigger graceful shutdown
   */
  shutdown(): Promise<void>

  /**
   * Register the lifecycle with process signals
   */
  register(): void

  /**
   * Check if shutdown is in progress
   */
  isShuttingDown(): boolean
}

// ============================================================================
// Builder
// ============================================================================

interface LifecycleBuilderState {
  healthChecks: Map<string, HealthCheckFn>
  shutdownHooks: ShutdownHook[]
  options: LifecycleOptions
}

class LifecycleBuilder {
  private state: LifecycleBuilderState = {
    healthChecks: new Map(),
    shutdownHooks: [],
    options: {
      shutdownTimeout: 30000,
      flushTracingOnShutdown: true,
    },
  }

  /**
   * Set shutdown timeout
   */
  timeout(ms: number): this {
    this.state.options.shutdownTimeout = ms
    return this
  }

  /**
   * Add a health check for a component
   */
  healthCheck(name: string, check: HealthCheckFn): this {
    this.state.healthChecks.set(name, check)
    return this
  }

  /**
   * Add a shutdown hook
   * @param priority Lower numbers run first (default: 100)
   */
  onShutdown(handler: () => Promise<void> | void, priority?: number): this
  onShutdown(name: string, handler: () => Promise<void> | void, priority?: number): this
  onShutdown(
    nameOrHandler: string | (() => Promise<void> | void),
    handlerOrPriority?: (() => Promise<void> | void) | number,
    priority?: number
  ): this {
    const defaultPriority = 100
    if (typeof nameOrHandler === 'function') {
      this.state.shutdownHooks.push({
        name: `shutdown-hook-${this.state.shutdownHooks.length}`,
        priority: typeof handlerOrPriority === 'number' ? handlerOrPriority : defaultPriority,
        handler: nameOrHandler,
      })
    } else {
      this.state.shutdownHooks.push({
        name: nameOrHandler,
        priority: priority ?? defaultPriority,
        handler: handlerOrPriority as () => Promise<void> | void,
      })
    }
    return this
  }

  /**
   * Disable tracing flush on shutdown
   */
  noTracingFlush(): this {
    this.state.options.flushTracingOnShutdown = false
    return this
  }

  /**
   * Build the lifecycle instance
   */
  build(): LifecycleInstance {
    return new LifecycleInstanceImpl(this.state)
  }
}

// ============================================================================
// Implementation
// ============================================================================

class LifecycleInstanceImpl implements LifecycleInstance {
  private healthChecks: Map<string, HealthCheckFn>
  private shutdownHooks: ShutdownHook[]
  private options: LifecycleOptions
  private startTime: number
  private shuttingDown = false
  private registered = false

  constructor(state: LifecycleBuilderState) {
    this.healthChecks = state.healthChecks
    this.shutdownHooks = state.shutdownHooks
    this.options = state.options
    this.startTime = Date.now()
  }

  liveness(): Response {
    return new Response(
      JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  async readiness(): Promise<Response> {
    const checks = await this.runHealthChecks()
    const allHealthy = checks.every((c) => c.status === 'healthy')

    const response: ReadinessResponse = {
      ready: allHealthy,
      timestamp: new Date().toISOString(),
      checks,
    }

    return new Response(JSON.stringify(response), {
      status: allHealthy ? 200 : 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async health(): Promise<Response> {
    const checks = await this.runHealthChecks()
    const status = this.aggregateStatus(checks)

    const response: HealthResponse = {
      status,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      checks,
    }

    return new Response(JSON.stringify(response), {
      status: status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return
    }
    this.shuttingDown = true

    console.log('\n[lifecycle] Graceful shutdown initiated...')

    // Sort hooks by priority (lower first)
    const sortedHooks = [...this.shutdownHooks].sort((a, b) => a.priority - b.priority)

    // Create timeout promise
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Shutdown timeout after ${this.options.shutdownTimeout}ms`))
      }, this.options.shutdownTimeout)
    })

    try {
      // Run all hooks with timeout
      await Promise.race([
        (async () => {
          for (const hook of sortedHooks) {
            console.log(`[lifecycle] Running shutdown hook: ${hook.name}`)
            try {
              await hook.handler()
              console.log(`[lifecycle] ✓ ${hook.name} completed`)
            } catch (error) {
              console.error(`[lifecycle] ✗ ${hook.name} failed:`, error)
            }
          }

          // Flush tracing if enabled
          if (this.options.flushTracingOnShutdown) {
            console.log('[lifecycle] Flushing traces...')
            try {
              await flushTracing()
              await shutdownTracing()
              console.log('[lifecycle] ✓ Traces flushed')
            } catch (error) {
              console.error('[lifecycle] ✗ Failed to flush traces:', error)
            }
          }
        })(),
        timeoutPromise,
      ])

      console.log('[lifecycle] Graceful shutdown complete')
    } catch (error) {
      console.error('[lifecycle] Shutdown error:', error)
    }
  }

  register(): void {
    if (this.registered) {
      return
    }
    this.registered = true

    // Handle SIGTERM (K8s, Docker, Cloud Run)
    process.on('SIGTERM', async () => {
      console.log('\n[lifecycle] Received SIGTERM')
      await this.shutdown()
      process.exit(0)
    })

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', async () => {
      console.log('\n[lifecycle] Received SIGINT')
      await this.shutdown()
      process.exit(0)
    })

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      console.error('[lifecycle] Uncaught exception:', error)
      await this.shutdown()
      process.exit(1)
    })

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason) => {
      console.error('[lifecycle] Unhandled rejection:', reason)
      await this.shutdown()
      process.exit(1)
    })

    console.log('[lifecycle] Signal handlers registered')
  }

  isShuttingDown(): boolean {
    return this.shuttingDown
  }

  // ========================================================================
  // Private helpers
  // ========================================================================

  private async runHealthChecks(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = []

    for (const [name, check] of this.healthChecks) {
      const start = Date.now()
      try {
        await check()
        results.push({
          name,
          status: 'healthy',
          latencyMs: Date.now() - start,
        })
      } catch (error) {
        results.push({
          name,
          status: 'unhealthy',
          latencyMs: Date.now() - start,
          message: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return results
  }

  private aggregateStatus(checks: HealthCheckResult[]): HealthStatus {
    if (checks.length === 0) {
      return 'healthy'
    }

    const hasUnhealthy = checks.some((c) => c.status === 'unhealthy')
    const hasDegraded = checks.some((c) => c.status === 'degraded')

    if (hasUnhealthy) return 'unhealthy'
    if (hasDegraded) return 'degraded'
    return 'healthy'
  }
}

// ============================================================================
// Factory
// ============================================================================

export const Lifecycle = {
  /**
   * Create a new lifecycle builder
   */
  create(): LifecycleBuilder {
    return new LifecycleBuilder()
  },
}

export type { LifecycleBuilder }
