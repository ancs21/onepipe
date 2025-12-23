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
} from './types'
import { Database } from 'bun:sqlite'

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
   * Build the projection instance
   */
  build(): ProjectionInstance<TState> {
    if (!this.options.from) {
      throw new Error('Projection requires a source flow. Use .from(flow)')
    }
    return new ProjectionInstanceImpl(this.options)
  }
}

interface ProjectionBuilderOptions<TState, TEvent> {
  name: string
  from?: FlowInstance<TEvent> | string
  initial: TState
  reduce: (state: TState, event: TEvent) => TState
  keyExtractor?: (event: TEvent) => string
  snapshot: SnapshotOptions
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
  private unsubscribe: (() => void) | null = null
  private initialized: boolean = false

  constructor(options: ProjectionBuilderOptions<TState, TEvent>) {
    this.name = options.name
    this.options = options
    this.state = structuredClone(options.initial)
  }

  /**
   * Initialize projection (lazy loading)
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    // Setup snapshot storage
    if (this.options.snapshot.storage === 'sqlite') {
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
        this.applyEvent(event)
      }

      // Subscribe to new events
      this.unsubscribe = flow.subscribe((event) => {
        this.applyEvent(event)
      })
    }
  }

  /**
   * Apply an event to the state
   */
  private applyEvent(event: TEvent): void {
    if (this.options.keyExtractor) {
      // Entity projection
      const key = this.options.keyExtractor(event)
      const entityState = (this.state as Map<string, unknown>).get(key) || structuredClone(this.options.initial)
      const newEntityState = this.options.reduce(entityState as TState, event)
      ;(this.state as Map<string, unknown>).set(key, newEntityState)
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
      this.saveSnapshot()
    }
  }

  /**
   * Save snapshot to storage
   */
  private saveSnapshot(): void {
    if (this.options.snapshot.storage === 'sqlite' && this.snapshotDb) {
      const serialized = JSON.stringify(
        this.state instanceof Map ? Object.fromEntries(this.state) : this.state
      )
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
    if (this.options.snapshot.storage === 'sqlite' && this.snapshotDb) {
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
   */
  subscribe(handler: (state: TState) => void): () => void {
    this.initialize() // Fire and forget initialization
    this.subscribers.add(handler)
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
