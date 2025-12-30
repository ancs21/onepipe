/**
 * Projection Builder
 *
 * Derive materialized views from event streams
 *
 * @example
 * ```typescript
 * import { Projection, Flow } from '@onepipe/sdk'
 * import { z } from 'zod'
 *
 * // Define event schema
 * const OrderEvent = z.discriminatedUnion('type', [
 *   z.object({ type: z.literal('created'), orderId: z.string(), items: z.array(z.string()) }),
 *   z.object({ type: z.literal('paid'), orderId: z.string(), amount: z.number() }),
 *   z.object({ type: z.literal('shipped'), orderId: z.string(), trackingId: z.string() }),
 * ])
 *
 * const orderEvents = Flow.create('orders').schema(OrderEvent).build()
 *
 * // Create projection for order stats
 * const orderStats = Projection
 *   .create('order-stats')
 *   .from(orderEvents)
 *   .initial({ totalOrders: 0, totalRevenue: 0, shipped: 0 })
 *   .reduce((state, event) => {
 *     switch (event.type) {
 *       case 'created':
 *         return { ...state, totalOrders: state.totalOrders + 1 }
 *       case 'paid':
 *         return { ...state, totalRevenue: state.totalRevenue + event.amount }
 *       case 'shipped':
 *         return { ...state, shipped: state.shipped + 1 }
 *     }
 *   })
 *   .snapshot({ every: 100, storage: 'sqlite' })
 *   .build()
 *
 * // Use projection
 * const stats = await orderStats.get()
 * console.log(stats) // { totalOrders: 150, totalRevenue: 45000, shipped: 120 }
 *
 * // Subscribe to changes
 * orderStats.subscribe((state) => {
 *   console.log('Stats updated:', state)
 * })
 *
 * // Entity projection (keyed by ID)
 * const orders = Projection
 *   .create('orders-by-id')
 *   .from(orderEvents)
 *   .keyBy((event) => event.orderId)
 *   .initial({ status: 'pending', items: [], trackingId: null })
 *   .reduce((state, event) => {
 *     switch (event.type) {
 *       case 'created':
 *         return { ...state, items: event.items, status: 'created' }
 *       case 'paid':
 *         return { ...state, status: 'paid' }
 *       case 'shipped':
 *         return { ...state, status: 'shipped', trackingId: event.trackingId }
 *     }
 *   })
 *   .build()
 *
 * // Get specific entity
 * const order = await orders.get('order-123')
 * ```
 */

import type {
  ProjectionOptions,
  ProjectionInstance,
  SnapshotOptions,
  FlowInstance,
  DBInstance,
} from './types'
import { Database } from 'bun:sqlite'
import { registerPrimitive } from './manifest'

/**
 * Projection builder with fluent API
 */
export class ProjectionBuilder<TState, TEvent> {
  private options: ProjectionBuilderOptions<TState, TEvent>

  constructor(name: string) {
    this.options = {
      name,
      initial: {} as TState,
      reduce: (state) => state,
      snapshot: { every: 0, storage: 'memory', onStartup: 'restore' },
    }
  }

  /**
   * Set the source flow to project from
   */
  from(flow: FlowInstance<TEvent> | string): this {
    this.options.from = flow
    return this
  }

  /**
   * Set initial state
   */
  initial(state: TState): this {
    this.options.initial = state
    return this
  }

  /**
   * Set reducer function
   */
  reduce(reducer: (state: TState, event: TEvent) => TState): this {
    this.options.reduce = reducer
    return this
  }

  /**
   * Enable entity keying (creates a Map of states by key)
   */
  keyBy(keyExtractor: (event: TEvent) => string): ProjectionBuilder<Map<string, TState>, TEvent> {
    const newBuilder = this as unknown as ProjectionBuilder<Map<string, TState>, TEvent>
    ;(newBuilder.options as unknown as ProjectionBuilderOptions<Map<string, TState>, TEvent>).keyExtractor = keyExtractor
    return newBuilder
  }

  /**
   * Configure snapshotting
   */
  snapshot(options: SnapshotOptions): this {
    this.options.snapshot = { ...this.options.snapshot, ...options }
    return this
  }

  /**
   * Configure PostgreSQL persistence for cloud-native deployments.
   * State and offsets are stored in the database and shared across instances.
   *
   * @example
   * ```typescript
   * const stats = Projection.create('order-stats')
   *   .from(orderEvents)
   *   .initial({ totalOrders: 0 })
   *   .reduce((state, event) => ({ totalOrders: state.totalOrders + 1 }))
   *   .db(database)  // Enable PostgreSQL persistence
   *   .build()
   * ```
   */
  db(database: DBInstance): this {
    this.options.db = database
    this.options.snapshot = { ...this.options.snapshot, storage: 'postgresql' }
    return this
  }

  /**
   * Build the projection instance
   */
  build(): ProjectionInstance<TState> {
    if (!this.options.from) {
      throw new Error('Projection requires a source flow. Use .from(flow)')
    }
    // Register with manifest for CLI auto-discovery
    registerPrimitive({
      primitive: 'projection',
      name: this.options.name,
      infrastructure: this.options.db ? 'postgresql' : undefined,
      config: { persistence: this.options.db ? 'postgres' : 'memory' },
    })
    return new ProjectionInstanceImpl(this.options)
  }
}

interface ProjectionBuilderOptions<TState, TEvent> {
  name: string
  from?: FlowInstance<TEvent> | string
  initial: TState
  reduce: (state: TState, event: TEvent) => TState
  keyExtractor?: (event: TEvent) => string
  snapshot: SnapshotOptions & { storage?: 'memory' | 'sqlite' | 'postgresql' }
  /** Database for PostgreSQL persistence (cloud-native mode) */
  db?: DBInstance
}

/**
 * Projection instance implementation
 */
class ProjectionInstanceImpl<TState, TEvent> implements ProjectionInstance<TState> {
  readonly name: string
  private options: ProjectionBuilderOptions<TState, TEvent>
  private state: TState
  private subscribers: Set<(state: TState) => void> = new Set()
  private eventCount: number = 0
  private lastOffset: string = ''
  private snapshotDb: Database | null = null
  private db?: DBInstance
  private dbInitialized: boolean = false
  private unsubscribe: (() => void) | null = null
  private initialized: boolean = false
  private initializePromise: Promise<void> | null = null

  constructor(options: ProjectionBuilderOptions<TState, TEvent>) {
    this.name = options.name
    this.options = options
    this.state = structuredClone(options.initial)
    this.db = options.db
  }

  /**
   * Initialize projection (lazy loading)
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

    // Setup snapshot storage
    if (this.options.snapshot.storage === 'postgresql' && this.db) {
      await this.initializeDatabase()
    } else if (this.options.snapshot.storage === 'sqlite') {
      const dbPath = `./.onepipe/projections/${this.name}.db`
      await Bun.write(dbPath, '') // Ensure file exists
      this.snapshotDb = new Database(dbPath)
      this.snapshotDb.run(`
        CREATE TABLE IF NOT EXISTS snapshots (
          id INTEGER PRIMARY KEY,
          state TEXT NOT NULL,
          offset TEXT NOT NULL,
          event_count INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `)
    }

    // Restore from snapshot
    if (this.options.snapshot.onStartup === 'restore') {
      await this.restoreFromSnapshot()
    }

    // Subscribe to flow for live updates
    const flow = this.options.from
    if (flow && typeof flow !== 'string') {
      // Read historical events from last offset
      const events = await flow.read({ offset: this.lastOffset || undefined })
      for (const event of events) {
        await this.applyEvent(event)
      }

      // Subscribe to new events
      this.unsubscribe = flow.subscribe((event) => {
        this.applyEvent(event)
      })
    }
  }

  /**
   * Initialize PostgreSQL table for projection state
   */
  private async initializeDatabase(): Promise<void> {
    if (!this.db || this.dbInitialized) return

    try {
      // Create projection state table if it doesn't exist
      await this.db.query(`
        DO $$
        BEGIN
          CREATE TABLE IF NOT EXISTS _onepipe_projection_state (
            name TEXT PRIMARY KEY,
            state JSONB NOT NULL,
            last_offset TEXT NOT NULL DEFAULT '',
            event_count BIGINT NOT NULL DEFAULT 0,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
        EXCEPTION WHEN duplicate_table OR duplicate_object THEN
          NULL;
        END $$
      `)

      // Create entity state table for keyed projections
      await this.db.query(`
        DO $$
        BEGIN
          CREATE TABLE IF NOT EXISTS _onepipe_projection_entities (
            projection_name TEXT NOT NULL,
            entity_key TEXT NOT NULL,
            state JSONB NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            PRIMARY KEY (projection_name, entity_key)
          );
        EXCEPTION WHEN duplicate_table OR duplicate_object THEN
          NULL;
        END $$
      `).catch(() => {}) // Ignore if exists

      // Create index for efficient queries
      await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_projection_entities_name
        ON _onepipe_projection_entities (projection_name)
      `).catch(() => {}) // Ignore index creation errors

      this.dbInitialized = true
    } catch (error) {
      const errorMsg = String(error)
      if (errorMsg.includes('already exists') || errorMsg.includes('duplicate')) {
        this.dbInitialized = true
        return
      }
      console.error(`[Projection:${this.name}] Failed to initialize database:`, error)
    }
  }

  /**
   * Apply an event to the state
   */
  private async applyEvent(event: TEvent): Promise<void> {
    if (this.options.keyExtractor) {
      // Entity projection
      const key = this.options.keyExtractor(event)
      const entityState = (this.state as Map<string, unknown>).get(key) || structuredClone(this.options.initial)
      const newEntityState = this.options.reduce(entityState as TState, event)
      ;(this.state as Map<string, unknown>).set(key, newEntityState)

      // Persist entity to PostgreSQL
      if (this.db && this.dbInitialized) {
        try {
          await this.db.query(
            `INSERT INTO _onepipe_projection_entities (projection_name, entity_key, state, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (projection_name, entity_key) DO UPDATE
             SET state = $3, updated_at = NOW()`,
            [this.name, key, JSON.stringify(newEntityState)]
          )
        } catch (error) {
          console.error(`[Projection:${this.name}] Failed to persist entity:`, error)
        }
      }
    } else {
      // Aggregate projection
      this.state = this.options.reduce(this.state, event)
    }

    this.eventCount++

    // Notify subscribers
    for (const handler of this.subscribers) {
      handler(this.state)
    }

    // Checkpoint snapshot
    if (
      this.options.snapshot.every &&
      this.options.snapshot.every > 0 &&
      this.eventCount % this.options.snapshot.every === 0
    ) {
      await this.saveSnapshot()
    }
  }

  /**
   * Save snapshot to storage
   */
  private async saveSnapshot(): Promise<void> {
    const serialized = JSON.stringify(
      this.state instanceof Map ? Object.fromEntries(this.state) : this.state
    )

    if (this.options.snapshot.storage === 'postgresql' && this.db) {
      try {
        await this.db.query(
          `INSERT INTO _onepipe_projection_state (name, state, last_offset, event_count, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (name) DO UPDATE
           SET state = $2, last_offset = $3, event_count = $4, updated_at = NOW()`,
          [this.name, serialized, this.lastOffset, this.eventCount]
        )
      } catch (error) {
        console.error(`[Projection:${this.name}] Failed to save snapshot:`, error)
      }
    } else if (this.options.snapshot.storage === 'sqlite' && this.snapshotDb) {
      this.snapshotDb.run(
        `INSERT INTO snapshots (state, offset, event_count, created_at) VALUES (?, ?, ?, ?)`,
        [serialized, this.lastOffset, this.eventCount, Date.now()]
      )
    }
  }

  /**
   * Restore from latest snapshot
   */
  private async restoreFromSnapshot(): Promise<void> {
    if (this.options.snapshot.storage === 'postgresql' && this.db) {
      try {
        // Restore aggregate state
        const result = await this.db.query<{ state: unknown; last_offset: string; event_count: number }>(
          `SELECT state, last_offset, event_count FROM _onepipe_projection_state WHERE name = $1`,
          [this.name]
        )

        if (result.length > 0) {
          const row = result[0]
          const parsed = typeof row.state === 'string' ? JSON.parse(row.state) : row.state
          if (this.options.keyExtractor) {
            this.state = new Map(Object.entries(parsed)) as unknown as TState
          } else {
            this.state = parsed
          }
          this.lastOffset = row.last_offset
          this.eventCount = row.event_count
        }

        // Restore entity states for keyed projections
        if (this.options.keyExtractor) {
          const entities = await this.db.query<{ entity_key: string; state: unknown }>(
            `SELECT entity_key, state FROM _onepipe_projection_entities WHERE projection_name = $1`,
            [this.name]
          )

          const stateMap = this.state as Map<string, unknown>
          for (const entity of entities) {
            const parsed = typeof entity.state === 'string' ? JSON.parse(entity.state) : entity.state
            stateMap.set(entity.entity_key, parsed)
          }
        }
      } catch (error) {
        console.error(`[Projection:${this.name}] Failed to restore from snapshot:`, error)
      }
    } else if (this.options.snapshot.storage === 'sqlite' && this.snapshotDb) {
      const row = this.snapshotDb
        .query<{ state: string; offset: string; event_count: number }, []>(
          `SELECT state, offset, event_count FROM snapshots ORDER BY id DESC LIMIT 1`
        )
        .get()

      if (row) {
        const parsed = JSON.parse(row.state)
        if (this.options.keyExtractor) {
          this.state = new Map(Object.entries(parsed)) as unknown as TState
        } else {
          this.state = parsed
        }
        this.lastOffset = row.offset
        this.eventCount = row.event_count
      }
    }
  }

  /**
   * Get current state
   */
  async get(): Promise<TState>
  async get(key: string): Promise<TState | undefined>
  async get(key?: string): Promise<TState | undefined> {
    await this.initialize()

    if (key !== undefined && this.options.keyExtractor) {
      return (this.state as Map<string, TState>).get(key)
    }
    return this.state
  }

  /**
   * Get all keys (for entity projections)
   */
  async keys(): Promise<string[]> {
    await this.initialize()
    if (this.options.keyExtractor) {
      return Array.from((this.state as Map<string, unknown>).keys())
    }
    return []
  }

  /**
   * Get all values (for entity projections)
   */
  async values(): Promise<TState[]> {
    await this.initialize()
    if (this.options.keyExtractor) {
      return Array.from((this.state as Map<string, TState>).values())
    }
    return [this.state]
  }

  /**
   * Subscribe to state changes
   * Initialization completes before handler receives current state
   */
  subscribe(handler: (state: TState) => void): () => void {
    this.subscribers.add(handler)

    // Initialize then call handler with current state
    this.initialize().then(() => {
      if (this.subscribers.has(handler)) {
        handler(structuredClone(this.state))
      }
    }).catch((error) => {
      console.error(`[Projection:${this.name}] Initialize error in subscribe:`, error)
    })

    return () => {
      this.subscribers.delete(handler)
    }
  }

  /**
   * Subscribe to specific key changes (for entity projections)
   */
  subscribeKey(key: string, handler: (state: TState | undefined) => void): () => void {
    let lastValue: TState | undefined

    const wrappedHandler = (state: TState) => {
      if (this.options.keyExtractor) {
        const currentValue = (state as Map<string, TState>).get(key)
        if (currentValue !== lastValue) {
          lastValue = currentValue
          handler(currentValue)
        }
      }
    }

    return this.subscribe(wrappedHandler)
  }

  /**
   * Rebuild projection from scratch
   */
  async rebuild(): Promise<void> {
    this.state = structuredClone(this.options.initial)
    this.eventCount = 0
    this.lastOffset = ''

    // Clear snapshots
    if (this.snapshotDb) {
      this.snapshotDb.run(`DELETE FROM snapshots`)
    }

    // Re-read all events
    const flow = this.options.from
    if (flow && typeof flow !== 'string') {
      const events = await flow.read({})
      for (const event of events) {
        this.applyEvent(event)
      }
    }
  }

  /**
   * Get projection metadata
   */
  metadata(): { eventCount: number; lastOffset: string; subscriberCount: number } {
    return {
      eventCount: this.eventCount,
      lastOffset: this.lastOffset,
      subscriberCount: this.subscribers.size,
    }
  }

  /**
   * Stop projection and cleanup
   */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
    if (this.snapshotDb) {
      this.snapshotDb.close()
      this.snapshotDb = null
    }
  }
}

/**
 * Projection entry point
 */
export const Projection = {
  /**
   * Create a new projection builder
   */
  create<TState = unknown, TEvent = unknown>(name: string): ProjectionBuilder<TState, TEvent> {
    return new ProjectionBuilder<TState, TEvent>(name)
  },
}
