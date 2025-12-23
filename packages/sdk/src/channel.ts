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
   * Build the Channel instance
   */
  build(): ChannelInstance<TInput, TOutput> {
    if (!this.state.handler) {
      throw new Error(`Channel "${this.state.name}" requires a handler`)
    }
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
