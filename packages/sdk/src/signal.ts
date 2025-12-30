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

import type { SignalOptions, SignalInstance, CacheInstance, DBInstance } from './types'
import type { z } from 'zod'
import { Database } from 'bun:sqlite'
import { registerPrimitive } from './manifest'

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
   * Configure Redis cache for cloud-native deployments.
   * Values are stored in Redis and pub/sub is used for cross-instance notifications.
   *
   * @example
   * ```typescript
   * const config = Signal.create('app-config')
   *   .schema(ConfigSchema)
   *   .default({ maxUploadSize: 10_000_000 })
   *   .cache(redisCache)  // Enable Redis persistence
   *   .build()
   * ```
   */
  cache(cacheInstance: CacheInstance): this {
    this.options.cache = cacheInstance
    this.options.persist = 'redis'
    return this
  }

  /**
   * Configure PostgreSQL for cloud-native deployments.
   * Values are stored in PostgreSQL and polling is used for cross-instance sync.
   * This avoids Redis dependency entirely.
   *
   * @example
   * ```typescript
   * const config = Signal.create('app-config')
   *   .schema(ConfigSchema)
   *   .default({ maxUploadSize: 10_000_000 })
   *   .db(postgres)  // Enable PostgreSQL persistence
   *   .build()
   * ```
   */
  db(database: DBInstance): this {
    this.options.database = database
    this.options.persist = 'postgres'
    return this
  }

  /**
   * Set polling interval for cross-instance sync (PostgreSQL mode).
   * Default is 1000ms (1 second).
   *
   * @param ms Polling interval in milliseconds
   */
  pollInterval(ms: number): this {
    this.options.pollInterval = ms
    return this
  }

  /**
   * Build the signal instance
   */
  build(): SignalInstance<T> {
    // Register with manifest for CLI auto-discovery
    const infrastructure = this.options.persist === 'redis'
      ? 'redis'
      : this.options.persist === 'postgres'
        ? 'postgresql'
        : undefined

    registerPrimitive({
      primitive: 'signal',
      name: this.options.name,
      infrastructure,
      config: { persistence: this.options.persist },
    })
    return new SignalInstanceImpl(this.options)
  }
}

interface SignalBuilderOptions<T> {
  name: string
  schema?: z.ZodType<T>
  default: T
  persist: 'memory' | 'sqlite' | 'stream' | 'redis' | 'postgres'
  streamsUrl?: string
  cache?: CacheInstance
  database?: DBInstance
  pollInterval?: number
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
  private initializePromise: Promise<void> | null = null
  private redisUnsubscribe?: () => void
  private pollTimer?: ReturnType<typeof setInterval>
  private lastVersion: number = 0

  constructor(options: SignalBuilderOptions<T>) {
    this.name = options.name
    this.options = options
    this.value = structuredClone(options.default)
  }

  /**
   * Initialize signal storage (lazy loading)
   * Uses a cached promise to prevent race conditions
   */
  private async initialize(): Promise<void> {
    // Return cached promise if already initializing/initialized
    if (this.initializePromise) return this.initializePromise

    this.initializePromise = this.doInitialize()
    return this.initializePromise
  }

  private async doInitialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    if (this.options.persist === 'redis' && this.options.cache) {
      // Redis persistence (cloud-native mode)
      const redisKey = `signal:${this.name}`
      try {
        const stored = await this.options.cache.get<string>(redisKey)
        if (stored) {
          const parsed = JSON.parse(stored)
          if (this.options.schema) {
            this.value = this.options.schema.parse(parsed)
          } else {
            this.value = parsed as T
          }
        }

        // Subscribe to Redis pub/sub for cross-instance updates
        const channel = `signal:${this.name}:changed`
        this.redisUnsubscribe = this.options.cache.subscribe(channel, (message) => {
          try {
            const parsed = typeof message === 'string' ? JSON.parse(message) : message
            if (this.options.schema) {
              this.value = this.options.schema.parse(parsed)
            } else {
              this.value = parsed as T
            }
            // Notify local subscribers (but not the one that triggered the change)
            this.notify()
          } catch {
            // Ignore invalid messages
          }
        })
      } catch (error) {
        console.error(`[Signal:${this.name}] Redis initialization failed:`, error)
      }
    } else if (this.options.persist === 'sqlite') {
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
    } else if (this.options.persist === 'postgres' && this.options.database) {
      // PostgreSQL persistence with polling for cross-instance sync
      try {
        // Create table if not exists
        await this.options.database.query(`
          CREATE TABLE IF NOT EXISTS _onepipe_signal_values (
            name TEXT PRIMARY KEY,
            value JSONB NOT NULL,
            version BIGINT DEFAULT 1,
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `)

        // Load existing value
        const rows = await this.options.database.query<{ value: unknown; version: number }>(
          `SELECT value, version FROM _onepipe_signal_values WHERE name = $1`,
          [this.name]
        )

        if (rows.length > 0) {
          const parsed = rows[0].value
          this.lastVersion = rows[0].version
          if (this.options.schema) {
            this.value = this.options.schema.parse(parsed)
          } else {
            this.value = parsed as T
          }
        }

        // Start polling for cross-instance updates
        const pollInterval = this.options.pollInterval || 1000
        this.pollTimer = setInterval(() => this.pollForChanges(), pollInterval)
      } catch (error) {
        console.error(`[Signal:${this.name}] PostgreSQL initialization failed:`, error)
      }
    }
  }

  /**
   * Poll PostgreSQL for changes from other instances
   */
  private async pollForChanges(): Promise<void> {
    if (this.options.persist !== 'postgres' || !this.options.database) return

    try {
      const rows = await this.options.database.query<{ value: unknown; version: number }>(
        `SELECT value, version FROM _onepipe_signal_values WHERE name = $1 AND version > $2`,
        [this.name, this.lastVersion]
      )

      if (rows.length > 0) {
        const parsed = rows[0].value
        this.lastVersion = rows[0].version
        if (this.options.schema) {
          this.value = this.options.schema.parse(parsed)
        } else {
          this.value = parsed as T
        }
        // Notify local subscribers of external change
        this.notify()
      }
    } catch {
      // Ignore polling errors
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
   * Initialization completes before handler is called with current value
   */
  subscribe(handler: (value: T) => void): () => void {
    this.subscribers.add(handler)

    // Initialize then call handler with current value
    // This ensures handler receives the persisted value, not the default
    this.initialize().then(() => {
      // Only call if still subscribed (handler might have unsubscribed)
      if (this.subscribers.has(handler)) {
        handler(structuredClone(this.value))
      }
    }).catch((error) => {
      console.error(`[Signal:${this.name}] Initialize error in subscribe:`, error)
      // Still call handler with default value on error
      if (this.subscribers.has(handler)) {
        handler(structuredClone(this.value))
      }
    })

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

    if (this.options.persist === 'redis' && this.options.cache) {
      // Redis persistence with pub/sub notification
      const redisKey = `signal:${this.name}`
      const channel = `signal:${this.name}:changed`
      try {
        await this.options.cache.set(redisKey, serialized)
        // Publish change to other instances
        await this.options.cache.publish(channel, serialized)
      } catch (error) {
        console.error(`[Signal:${this.name}] Redis persist failed:`, error)
      }
    } else if (this.options.persist === 'sqlite' && this.db) {
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
    } else if (this.options.persist === 'postgres' && this.options.database) {
      // PostgreSQL persistence with version increment
      try {
        const rows = await this.options.database.query<{ version: number }>(
          `INSERT INTO _onepipe_signal_values (name, value, version, updated_at)
           VALUES ($1, $2, 1, NOW())
           ON CONFLICT (name) DO UPDATE SET
             value = $2,
             version = _onepipe_signal_values.version + 1,
             updated_at = NOW()
           RETURNING version`,
          [this.name, serialized]
        )
        if (rows.length > 0) {
          this.lastVersion = rows[0].version
        }
      } catch (error) {
        console.error(`[Signal:${this.name}] PostgreSQL persist failed:`, error)
      }
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
    // Stop PostgreSQL polling
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
    // Unsubscribe from Redis pub/sub
    if (this.redisUnsubscribe) {
      this.redisUnsubscribe()
      this.redisUnsubscribe = undefined
    }
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
