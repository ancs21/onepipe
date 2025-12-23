/**
 * Signal Builder
 *
 * Reactive key-value state with change notifications
 *
 * @example
 * ```typescript
 * import { Signal } from '@onepipe/sdk'
 * import { z } from 'zod'
 *
 * // Simple feature flag
 * const maintenanceMode = Signal
 *   .create('maintenance-mode')
 *   .schema(z.boolean())
 *   .default(false)
 *   .build()
 *
 * // Get current value
 * const isMaintenanceMode = await maintenanceMode.get()
 *
 * // Set value
 * await maintenanceMode.set(true)
 *
 * // Update with function
 * await maintenanceMode.update((current) => !current)
 *
 * // Subscribe to changes
 * maintenanceMode.subscribe((value) => {
 *   console.log('Maintenance mode:', value)
 * })
 *
 * // Complex config signal
 * const appConfig = Signal
 *   .create('app-config')
 *   .schema(z.object({
 *     maxUploadSize: z.number(),
 *     allowedFileTypes: z.array(z.string()),
 *     rateLimitPerMinute: z.number(),
 *   }))
 *   .default({
 *     maxUploadSize: 10 * 1024 * 1024,
 *     allowedFileTypes: ['jpg', 'png', 'pdf'],
 *     rateLimitPerMinute: 100,
 *   })
 *   .persist('sqlite')
 *   .build()
 *
 * // Partial update
 * await appConfig.patch({ rateLimitPerMinute: 200 })
 * ```
 */

import type { SignalOptions, SignalInstance } from './types'
import type { z } from 'zod'
import { Database } from 'bun:sqlite'

/**
 * Signal builder with fluent API
 */
export class SignalBuilder<T> {
  private options: SignalBuilderOptions<T>

  constructor(name: string) {
    this.options = {
      name,
      default: undefined as T,
      persist: 'memory',
    }
  }

  /**
   * Set validation schema
   */
  schema(schema: z.ZodType<T>): this {
    this.options.schema = schema
    return this
  }

  /**
   * Set default value
   */
  default(value: T): this {
    this.options.default = value
    return this
  }

  /**
   * Set persistence mode
   */
  persist(mode: 'memory' | 'sqlite' | 'stream'): this {
    this.options.persist = mode
    return this
  }

  /**
   * Set custom stream URL for distributed signals
   */
  streamsUrl(url: string): this {
    this.options.streamsUrl = url
    return this
  }

  /**
   * Build the signal instance
   */
  build(): SignalInstance<T> {
    return new SignalInstanceImpl(this.options)
  }
}

interface SignalBuilderOptions<T> {
  name: string
  schema?: z.ZodType<T>
  default: T
  persist: 'memory' | 'sqlite' | 'stream'
  streamsUrl?: string
}

/**
 * Signal instance implementation
 */
class SignalInstanceImpl<T> implements SignalInstance<T> {
  readonly name: string
  private options: SignalBuilderOptions<T>
  private value: T
  private subscribers: Set<(value: T) => void> = new Set()
  private db: Database | null = null
  private initialized: boolean = false

  constructor(options: SignalBuilderOptions<T>) {
    this.name = options.name
    this.options = options
    this.value = structuredClone(options.default)
  }

  /**
   * Initialize signal storage (lazy loading)
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    if (this.options.persist === 'sqlite') {
      const dbPath = `./.onepipe/signals/${this.name}.db`
      await ensureDir('./.onepipe/signals')
      this.db = new Database(dbPath)
      this.db.run(`
        CREATE TABLE IF NOT EXISTS signal (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)

      // Restore value
      const row = this.db
        .query<{ value: string }, []>(`SELECT value FROM signal WHERE key = 'value'`)
        .get()

      if (row) {
        try {
          const parsed = JSON.parse(row.value)
          if (this.options.schema) {
            this.value = this.options.schema.parse(parsed)
          } else {
            this.value = parsed
          }
        } catch {
          // Use default on parse error
        }
      }
    } else if (this.options.persist === 'stream') {
      // Load from stream server
      const streamsUrl = this.options.streamsUrl || process.env.ONEPIPE_STREAMS_URL || 'http://localhost:9999'
      try {
        const response = await fetch(`${streamsUrl}/v1/stream/signals/${this.name}?tail=1`)
        if (response.ok) {
          const messages = await response.json()
          if (Array.isArray(messages) && messages.length > 0) {
            const parsed = messages[0].data
            if (this.options.schema) {
              this.value = this.options.schema.parse(parsed)
            } else {
              this.value = parsed
            }
          }
        }
      } catch {
        // Use default on error
      }
    }
  }

  /**
   * Get current value
   */
  async get(): Promise<T> {
    await this.initialize()
    return structuredClone(this.value)
  }

  /**
   * Set new value
   */
  async set(value: T): Promise<void> {
    await this.initialize()

    // Validate
    if (this.options.schema) {
      this.options.schema.parse(value)
    }

    this.value = structuredClone(value)

    // Persist
    await this.persist()

    // Notify subscribers
    this.notify()
  }

  /**
   * Update value with function
   */
  async update(updater: (current: T) => T): Promise<void> {
    await this.initialize()
    const newValue = updater(structuredClone(this.value))
    await this.set(newValue)
  }

  /**
   * Patch object value (partial update)
   */
  async patch(partial: Partial<T>): Promise<void> {
    if (typeof this.value !== 'object' || this.value === null) {
      throw new Error('patch() can only be used with object values')
    }
    await this.update((current) => ({ ...current, ...partial }))
  }

  /**
   * Subscribe to value changes
   */
  subscribe(handler: (value: T) => void): () => void {
    this.initialize() // Fire and forget
    this.subscribers.add(handler)

    // Immediately call with current value
    handler(structuredClone(this.value))

    return () => {
      this.subscribers.delete(handler)
    }
  }

  /**
   * Wait for a specific condition
   */
  async waitFor(predicate: (value: T) => boolean, timeout?: number): Promise<T> {
    await this.initialize()

    // Check current value first
    if (predicate(this.value)) {
      return structuredClone(this.value)
    }

    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      const unsubscribe = this.subscribe((value) => {
        if (predicate(value)) {
          if (timeoutId) clearTimeout(timeoutId)
          unsubscribe()
          resolve(value)
        }
      })

      if (timeout) {
        timeoutId = setTimeout(() => {
          unsubscribe()
          reject(new Error(`Signal.waitFor timed out after ${timeout}ms`))
        }, timeout)
      }
    })
  }

  /**
   * Persist value to storage
   */
  private async persist(): Promise<void> {
    const serialized = JSON.stringify(this.value)

    if (this.options.persist === 'sqlite' && this.db) {
      this.db.run(
        `INSERT OR REPLACE INTO signal (key, value, updated_at) VALUES ('value', ?, ?)`,
        [serialized, Date.now()]
      )
    } else if (this.options.persist === 'stream') {
      const streamsUrl = this.options.streamsUrl || process.env.ONEPIPE_STREAMS_URL || 'http://localhost:9999'
      await fetch(`${streamsUrl}/v1/stream/signals/${this.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serialized,
      })
    }
  }

  /**
   * Notify all subscribers
   */
  private notify(): void {
    const value = structuredClone(this.value)
    for (const handler of this.subscribers) {
      try {
        handler(value)
      } catch (error) {
        console.error(`Signal subscriber error:`, error)
      }
    }
  }

  /**
   * Reset to default value
   */
  async reset(): Promise<void> {
    await this.set(structuredClone(this.options.default))
  }

  /**
   * Get metadata
   */
  metadata(): { name: string; subscriberCount: number; persist: string } {
    return {
      name: this.name,
      subscriberCount: this.subscribers.size,
      persist: this.options.persist,
    }
  }

  /**
   * Close and cleanup
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.subscribers.clear()
  }
}

/**
 * Ensure directory exists
 */
async function ensureDir(path: string): Promise<void> {
  try {
    const dir = Bun.file(path)
    if (!(await dir.exists())) {
      await Bun.write(`${path}/.keep`, '')
    }
  } catch {
    // Directory might already exist
  }
}

/**
 * Signal entry point
 */
export const Signal = {
  /**
   * Create a new signal builder
   */
  create<T = unknown>(name: string): SignalBuilder<T> {
    return new SignalBuilder<T>(name)
  },
}
