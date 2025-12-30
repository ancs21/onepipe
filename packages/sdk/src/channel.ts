/**
 * Channel - RPC over Streams (Replayable)
 *
 * @example
 * ```typescript
 * const processPayment = Channel
 *   .create('payments.process')
 *   .input(z.object({ orderId: z.string(), amount: z.number() }))
 *   .output(z.object({ transactionId: z.string(), status: z.string() }))
 *   .handler(async (input, ctx) => {
 *     const result = await chargeCard(input)
 *     await ctx.emit('payment-events', { type: 'charged', ...result })
 *     return result
 *   })
 *   .retry({ attempts: 3 })
 *   .trace()
 *   .build()
 *
 * const result = await processPayment.call({ orderId: '123', amount: 99.99 })
 * ```
 */

import type { z } from 'zod'
import type {
  ChannelOptions,
  ChannelContext,
  ChannelHandler,
  ChannelInstance,
  ChannelCall,
  RetryOptions,
  DBInstance,
  AuthInstance,
} from './types'
import { registerPrimitive } from './manifest'

// Channel builder state
interface ChannelBuilderState<TInput, TOutput> {
  name: string
  inputSchema?: z.ZodType<TInput>
  outputSchema?: z.ZodType<TOutput>
  handler?: ChannelHandler<TInput, TOutput>
  retry?: RetryOptions
  timeout?: number
  trace: boolean
  auth?: AuthInstance
  db?: DBInstance
  streamUrl?: string
  /** Function to extract idempotency key from input */
  idempotencyKeyFn?: (input: TInput) => string
  /** TTL for idempotency records in milliseconds (default: 24 hours) */
  idempotencyTtl?: number
}

/**
 * Channel Builder - Fluent API for creating RPC channels
 */
class ChannelBuilder<TInput = unknown, TOutput = unknown> {
  private state: ChannelBuilderState<TInput, TOutput>

  private constructor(name: string) {
    this.state = {
      name,
      trace: false,
    }
  }

  /**
   * Create a new Channel builder
   */
  static create(name: string): ChannelBuilder<unknown, unknown> {
    return new ChannelBuilder(name)
  }

  /**
   * Set input schema (Zod)
   */
  input<T>(schema: z.ZodType<T>): ChannelBuilder<T, TOutput> {
    const builder = this as unknown as ChannelBuilder<T, TOutput>
    builder.state.inputSchema = schema
    return builder
  }

  /**
   * Set output schema (Zod)
   */
  output<T>(schema: z.ZodType<T>): ChannelBuilder<TInput, T> {
    const builder = this as unknown as ChannelBuilder<TInput, T>
    builder.state.outputSchema = schema
    return builder
  }

  /**
   * Set the handler function
   */
  handler(fn: ChannelHandler<TInput, TOutput>): this {
    this.state.handler = fn
    return this
  }

  /**
   * Configure retry behavior
   */
  retry(options: RetryOptions): this {
    this.state.retry = options
    return this
  }

  /**
   * Set timeout (e.g., '30s', '5m')
   */
  timeout(duration: string): this {
    this.state.timeout = this.parseDuration(duration)
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
   * Require authentication
   */
  auth(instance: AuthInstance): this {
    this.state.auth = instance
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
   * Set custom stream URL
   */
  url(streamUrl: string): this {
    this.state.streamUrl = streamUrl
    return this
  }

  /**
   * Enable idempotency for this channel.
   * When enabled, duplicate calls with the same key return cached results.
   * Requires a database connection via .db() for PostgreSQL persistence.
   *
   * @example
   * ```typescript
   * const payment = Channel.create('process-payment')
   *   .input(PaymentSchema)
   *   .db(database)
   *   .idempotency((input) => input.orderId)  // Use orderId as key
   *   .handler(async (input) => { ... })
   *   .build()
   * ```
   */
  idempotency(keyFn: (input: TInput) => string, ttl?: number): this {
    this.state.idempotencyKeyFn = keyFn
    this.state.idempotencyTtl = ttl
    return this
  }

  /**
   * Build the Channel instance
   */
  build(): ChannelInstance<TInput, TOutput> {
    if (!this.state.handler) {
      throw new Error(`Channel "${this.state.name}" requires a handler`)
    }
    // Warn if idempotency is enabled without database
    if (this.state.idempotencyKeyFn && !this.state.db) {
      console.warn(`[Channel:${this.state.name}] Idempotency requires .db() for persistence across instances`)
    }
    // Register with manifest for CLI auto-discovery
    registerPrimitive({
      primitive: 'channel',
      name: this.state.name,
      infrastructure: this.state.db ? 'postgresql' : undefined,
      config: { idempotency: !!this.state.idempotencyKeyFn },
    })
    return new ChannelInstanceImpl<TInput, TOutput>(this.state)
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)(ms|s|m|h)$/)
    if (!match) throw new Error(`Invalid duration: ${duration}`)

    const value = parseInt(match[1], 10)
    const unit = match[2]

    switch (unit) {
      case 'ms': return value
      case 's': return value * 1000
      case 'm': return value * 60 * 1000
      case 'h': return value * 60 * 60 * 1000
      default: return value
    }
  }
}

/**
 * Channel instance implementation
 */
class ChannelInstanceImpl<TInput, TOutput> implements ChannelInstance<TInput, TOutput> {
  readonly name: string
  private inputSchema?: z.ZodType<TInput>
  private outputSchema?: z.ZodType<TOutput>
  private handler: ChannelHandler<TInput, TOutput>
  private retry?: RetryOptions
  private timeout?: number
  private traceEnabled: boolean
  private auth?: AuthInstance
  private db?: DBInstance
  private streamUrl: string
  private idempotencyKeyFn?: (input: TInput) => string
  private idempotencyTtl: number
  private dbInitialized: boolean = false

  constructor(state: ChannelBuilderState<TInput, TOutput>) {
    this.name = state.name
    this.inputSchema = state.inputSchema
    this.outputSchema = state.outputSchema
    this.handler = state.handler!
    this.retry = state.retry
    this.timeout = state.timeout
    this.traceEnabled = state.trace
    this.auth = state.auth
    this.db = state.db
    this.streamUrl = state.streamUrl || this.getDefaultStreamUrl()
    this.idempotencyKeyFn = state.idempotencyKeyFn
    this.idempotencyTtl = state.idempotencyTtl || 24 * 60 * 60 * 1000 // 24 hours default

    // Initialize database for idempotency if configured
    if (this.db && this.idempotencyKeyFn) {
      this.initializeDatabase()
    }
  }

  /**
   * Initialize PostgreSQL table for idempotency tracking
   */
  private async initializeDatabase(): Promise<void> {
    if (!this.db || this.dbInitialized) return

    try {
      await this.db.query(`
        DO $$
        BEGIN
          CREATE TABLE IF NOT EXISTS _onepipe_channel_idempotency (
            channel_name TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            result JSONB,
            error TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            PRIMARY KEY (channel_name, idempotency_key)
          );
        EXCEPTION WHEN duplicate_table OR duplicate_object THEN
          NULL;
        END $$
      `)

      // Create index for cleanup of expired records
      await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_channel_idempotency_expires
        ON _onepipe_channel_idempotency (expires_at)
      `).catch(() => {})

      this.dbInitialized = true
    } catch (error) {
      const errorMsg = String(error)
      if (errorMsg.includes('already exists') || errorMsg.includes('duplicate')) {
        this.dbInitialized = true
        return
      }
      console.error(`[Channel:${this.name}] Failed to initialize idempotency table:`, error)
    }
  }

  /**
   * Check for existing idempotency record
   */
  private async checkIdempotency(key: string): Promise<{ hit: boolean; result?: TOutput; error?: string; pending?: boolean }> {
    if (!this.db) return { hit: false }

    await this.initializeDatabase()

    try {
      const result = await this.db.query<{ result: TOutput | null; error: string | null; status: string }>(
        `SELECT result, error, status FROM _onepipe_channel_idempotency
         WHERE channel_name = $1 AND idempotency_key = $2 AND expires_at > NOW()`,
        [this.name, key]
      )

      if (result.length === 0) {
        return { hit: false }
      }

      const record = result[0]
      if (record.status === 'pending') {
        return { hit: true, pending: true }
      }
      if (record.error) {
        return { hit: true, error: record.error }
      }
      return { hit: true, result: record.result as TOutput }
    } catch (error) {
      console.error(`[Channel:${this.name}] Failed to check idempotency:`, error)
      return { hit: false }
    }
  }

  /**
   * Store idempotency record
   */
  private async storeIdempotency(key: string, result?: TOutput, error?: string): Promise<void> {
    if (!this.db) return

    try {
      await this.db.query(
        `INSERT INTO _onepipe_channel_idempotency (channel_name, idempotency_key, result, error, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + $6 * INTERVAL '1 millisecond')
         ON CONFLICT (channel_name, idempotency_key) DO UPDATE
         SET result = $3, error = $4, status = $5`,
        [this.name, key, result ? JSON.stringify(result) : null, error || null, error ? 'failed' : 'completed', this.idempotencyTtl]
      )
    } catch (err) {
      console.error(`[Channel:${this.name}] Failed to store idempotency:`, err)
    }
  }

  /**
   * Mark idempotency record as pending (to prevent concurrent execution)
   */
  private async markPending(key: string): Promise<boolean> {
    if (!this.db) return true // Allow execution without DB

    await this.initializeDatabase()

    try {
      // Use INSERT with conflict handling to ensure atomicity
      const result = await this.db.query<{ channel_name: string }>(
        `INSERT INTO _onepipe_channel_idempotency (channel_name, idempotency_key, status, expires_at)
         VALUES ($1, $2, 'pending', NOW() + $3 * INTERVAL '1 millisecond')
         ON CONFLICT (channel_name, idempotency_key) DO NOTHING
         RETURNING channel_name`,
        [this.name, key, this.idempotencyTtl]
      )
      return result.length > 0 // True if we inserted (no conflict)
    } catch (error) {
      console.error(`[Channel:${this.name}] Failed to mark pending:`, error)
      return true // Allow execution on error
    }
  }

  private getDefaultStreamUrl(): string {
    const baseUrl = process.env.ONEPIPE_STREAMS_URL || 'http://localhost:9999'
    return `${baseUrl}/v1/stream/channels/${this.name}`
  }

  /**
   * Call the channel with input
   */
  async call(input: TInput): Promise<TOutput> {
    // Validate input
    if (this.inputSchema) {
      this.inputSchema.parse(input)
    }

    // Check idempotency if configured
    let idempotencyKey: string | undefined
    if (this.idempotencyKeyFn) {
      idempotencyKey = this.idempotencyKeyFn(input)

      // Check for existing result
      const existing = await this.checkIdempotency(idempotencyKey)
      if (existing.hit) {
        if (existing.pending) {
          // Another instance is processing - wait and retry
          await new Promise(resolve => setTimeout(resolve, 100))
          return this.call(input)
        }
        if (existing.error) {
          throw new Error(existing.error)
        }
        if (existing.result !== undefined) {
          if (this.traceEnabled) {
            console.debug(`[Channel:${this.name}] Idempotency hit for key: ${idempotencyKey}`)
          }
          return existing.result
        }
      }

      // Mark as pending to prevent concurrent execution
      const acquired = await this.markPending(idempotencyKey)
      if (!acquired) {
        // Another instance just started processing - wait and retry
        await new Promise(resolve => setTimeout(resolve, 100))
        return this.call(input)
      }
    }

    const callId = crypto.randomUUID()
    const startTime = Date.now()

    // Record call to stream
    await this.recordCall(callId, input)

    // Build context
    const ctx = this.buildContext()

    // Execute with retry logic
    let lastError: Error | undefined
    const maxAttempts = this.retry?.attempts || 1
    const backoff = this.retry?.backoff || 'linear'
    const baseDelay = this.retry?.delay || 1000

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Execute handler with timeout
        const result = await this.executeWithTimeout(
          () => this.handler(input, ctx),
          this.timeout
        )

        // Validate output
        if (this.outputSchema) {
          this.outputSchema.parse(result)
        }

        // Record success
        const duration = Date.now() - startTime
        await this.recordResponse(callId, result, undefined, duration)

        // Store idempotency result
        if (idempotencyKey) {
          await this.storeIdempotency(idempotencyKey, result)
        }

        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (attempt < maxAttempts) {
          const delay = backoff === 'exponential'
            ? baseDelay * Math.pow(2, attempt - 1)
            : baseDelay * attempt

          await new Promise((resolve) => setTimeout(resolve, delay))

          if (this.traceEnabled) {
            console.debug(
              `[Channel:${this.name}] Retry attempt ${attempt + 1}/${maxAttempts} after ${delay}ms`
            )
          }
        }
      }
    }

    // Record failure
    const duration = Date.now() - startTime
    await this.recordResponse(callId, undefined, lastError!.message, duration)

    // Store idempotency failure
    if (idempotencyKey) {
      await this.storeIdempotency(idempotencyKey, undefined, lastError!.message)
    }

    throw lastError
  }

  /**
   * Get call history
   */
  async history(options?: { since?: string; limit?: number }): Promise<ChannelCall<TInput, TOutput>[]> {
    const params = new URLSearchParams()

    if (options?.limit) {
      params.set('tail', String(options.limit))
    }

    const url = `${this.streamUrl}/calls?${params.toString()}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`Failed to get channel history: ${response.statusText}`)
    }

    return response.json() as Promise<ChannelCall<TInput, TOutput>[]>
  }

  private buildContext(): ChannelContext {
    const self = this

    return {
      user: undefined, // Set by auth middleware

      span(name: string): void {
        if (self.traceEnabled) {
          console.debug(`[Channel:${self.name}] Span: ${name}`)
        }
        // TODO: Implement proper tracing
      },

      async emit<T>(flow: string, data: T): Promise<void> {
        const baseUrl = process.env.ONEPIPE_STREAMS_URL || 'http://localhost:9999'
        const url = `${baseUrl}/v1/stream/flows/${flow}`

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })

        if (!response.ok) {
          throw new Error(`Failed to emit to flow "${flow}": ${response.statusText}`)
        }
      },

      db: self.db as any,
    }
  }

  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout?: number
  ): Promise<T> {
    if (!timeout) {
      return fn()
    }

    return Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Channel timeout')), timeout)
      ),
    ])
  }

  private async recordCall(callId: string, input: TInput): Promise<void> {
    try {
      const url = `${this.streamUrl}/calls`
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: callId,
          input,
          timestamp: Date.now(),
        }),
      })
    } catch (error) {
      // Don't fail the call if recording fails
      console.error(`[Channel:${this.name}] Failed to record call:`, error)
    }
  }

  private async recordResponse(
    callId: string,
    output: TOutput | undefined,
    error: string | undefined,
    duration: number
  ): Promise<void> {
    try {
      const url = `${this.streamUrl}/responses`
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId,
          output,
          error,
          duration,
          timestamp: Date.now(),
        }),
      })
    } catch (err) {
      console.error(`[Channel:${this.name}] Failed to record response:`, err)
    }
  }
}

/**
 * Create a new Channel
 */
export const Channel = {
  create: ChannelBuilder.create,
}

export type { ChannelBuilder, ChannelInstance }
