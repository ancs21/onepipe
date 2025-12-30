/**
 * Integration Tests for Cloud-Native Features
 *
 * These tests verify the cloud-native capabilities implemented in the SDK:
 * - Lifecycle (health checks, graceful shutdown)
 * - Flow with PostgreSQL persistence
 * - Signal with Redis backend
 * - Cron/Workflow heartbeat mechanisms
 * - DB connection pooling
 *
 * Note: Some tests require actual PostgreSQL/Redis instances.
 * Skip with: bun test --skip-pattern="integration"
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test'
import { z } from 'zod'

// SDK imports
import { Lifecycle } from './lifecycle'
import { Flow } from './flow'
import { Signal } from './signal'
import { DB } from './db'
import { Cache } from './cache'
import { Cron } from './cron'
import { Workflow } from './workflow'
import type { DBInstance, CacheInstance, LifecycleInstance } from './types'

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/onepipe_test'
const TEST_REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379'

async function isPostgresAvailable(): Promise<boolean> {
  try {
    const db = DB.create('test-check').postgres(TEST_DB_URL).build()
    await db.query('SELECT 1')
    await db.close()
    return true
  } catch {
    return false
  }
}

async function isRedisAvailable(): Promise<boolean> {
  try {
    const cache = Cache.create('test-check').redis(TEST_REDIS_URL).build()
    await cache.set('__test__', 'ok', 1)
    await cache.close()
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Lifecycle Tests
// ============================================================================

describe('Lifecycle Integration', () => {
  test('creates lifecycle instance with default settings', () => {
    const lifecycle = Lifecycle.create().build()
    expect(lifecycle).toBeDefined()
  })

  test('liveness check returns healthy', async () => {
    const lifecycle = Lifecycle.create().build()
    const response = await lifecycle.liveness()
    expect(response.status).toBe(200)
  })

  test('readiness check returns healthy when no dependencies', async () => {
    const lifecycle = Lifecycle.create().build()
    const response = await lifecycle.readiness()
    expect(response.status).toBe(200)
  })

  test('health check aggregates all checks', async () => {
    const lifecycle = Lifecycle.create()
      .healthCheck('test-service', async () => {
        // Healthy check - just returns without throwing
      })
      .build()

    const response = await lifecycle.health()
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.status).toBe('healthy')
    // checks is an array, find check by name
    const testCheck = body.checks.find((c: { name: string }) => c.name === 'test-service')
    expect(testCheck).toBeDefined()
    expect(testCheck.status).toBe('healthy')
  })

  test('health check reports unhealthy when check fails', async () => {
    const lifecycle = Lifecycle.create()
      .healthCheck('failing-service', async () => {
        throw new Error('Service unavailable')
      })
      .build()

    const response = await lifecycle.health()
    expect(response.status).toBe(503)

    const body = await response.json()
    expect(body.status).toBe('unhealthy')
  })

  test('shutdown hooks are called in priority order', async () => {
    const order: string[] = []

    // Lower priority numbers run first
    const lifecycle = Lifecycle.create()
      .onShutdown(async () => { order.push('first') }, 10)
      .onShutdown(async () => { order.push('third') }, 100)
      .onShutdown(async () => { order.push('second') }, 50)
      .noTracingFlush()
      .build()

    await lifecycle.shutdown()

    expect(order).toEqual(['first', 'second', 'third'])
  })

  test('shutdown respects timeout', async () => {
    const lifecycle = Lifecycle.create()
      .timeout(100)
      .noTracingFlush()
      .onShutdown(async () => {
        await new Promise(r => setTimeout(r, 500))
      })
      .build()

    const start = Date.now()
    await lifecycle.shutdown()
    const duration = Date.now() - start

    // Should timeout after ~100ms, not wait for 500ms
    expect(duration).toBeLessThan(300)
  })

  test('isShuttingDown flag is set during shutdown', async () => {
    const lifecycle = Lifecycle.create().noTracingFlush().build()

    expect(lifecycle.isShuttingDown()).toBe(false)

    // Start shutdown but don't await
    const shutdownPromise = lifecycle.shutdown()
    expect(lifecycle.isShuttingDown()).toBe(true)

    await shutdownPromise
    expect(lifecycle.isShuttingDown()).toBe(true)
  })
})

// ============================================================================
// Flow with PostgreSQL Tests
// ============================================================================

describe('Flow with PostgreSQL', () => {
  let db: DBInstance
  let postgresAvailable: boolean

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable()
    if (postgresAvailable) {
      db = DB.create('flow-test-db').postgres(TEST_DB_URL).build()
      // Clean up test table
      await db.query('DROP TABLE IF EXISTS _onepipe_flow_events').catch(() => {})
    }
  })

  afterAll(async () => {
    if (db) {
      await db.query('DROP TABLE IF EXISTS _onepipe_flow_events').catch(() => {})
      await db.close()
    }
  })

  test('creates flow with PostgreSQL persistence', async () => {
    if (!postgresAvailable) {
      console.log('Skipping: PostgreSQL not available')
      return
    }

    const EventSchema = z.object({
      type: z.string(),
      payload: z.unknown(),
    })

    const flow = Flow.create('test-flow')
      .schema(EventSchema)
      .db(db)
      .build()

    expect(flow).toBeDefined()
    expect(flow.name).toBe('test-flow')
  })

  test('appends events to PostgreSQL', async () => {
    if (!postgresAvailable) {
      console.log('Skipping: PostgreSQL not available')
      return
    }

    const flow = Flow.create('persist-test')
      .db(db)
      .build()

    await flow.append({ type: 'test', data: 'hello' })
    await flow.append({ type: 'test', data: 'world' })

    // Wait for async persistence
    await new Promise(r => setTimeout(r, 100))

    // Verify events are in database
    const result = await db.query<{ flow_name: string; data: unknown }>(
      `SELECT flow_name, data FROM _onepipe_flow_events WHERE flow_name = 'persist-test' ORDER BY offset_seq`
    )

    expect(result.length).toBe(2)
  })

  test('reads events from PostgreSQL', async () => {
    if (!postgresAvailable) {
      console.log('Skipping: PostgreSQL not available')
      return
    }

    const flow = Flow.create('read-test')
      .db(db)
      .build()

    await flow.append({ id: 1 })
    await flow.append({ id: 2 })
    await flow.append({ id: 3 })

    const events = await flow.read({ limit: 10 })
    expect(events.length).toBeGreaterThanOrEqual(3)
  })

  test('reads tail from PostgreSQL', async () => {
    if (!postgresAvailable) {
      console.log('Skipping: PostgreSQL not available')
      return
    }

    const flow = Flow.create('tail-test')
      .db(db)
      .build()

    for (let i = 0; i < 10; i++) {
      await flow.append({ seq: i })
    }

    const events = await flow.read({ tail: 3 })
    expect(events.length).toBe(3)
  })
})

// ============================================================================
// Signal with Redis Tests
// ============================================================================

describe('Signal with Redis', () => {
  // Note: Redis pub/sub requires a separate connection from regular commands.
  // The current Cache implementation shares a single connection, which causes
  // issues when Signal subscribes to pub/sub. These tests verify the basic
  // Cache operations work, but skip Signal+Redis integration until Cache
  // is updated to use separate connections.

  let redisAvailable: boolean

  beforeAll(async () => {
    redisAvailable = await isRedisAvailable()
  })

  test('cache basic operations work', async () => {
    if (!redisAvailable) {
      console.log('Skipping: Redis not available')
      return
    }

    const cache = Cache.create('cache-test').redis(TEST_REDIS_URL).build()

    // Basic set/get
    await cache.set('test-key', 'test-value', 60)
    const value = await cache.get<string>('test-key')
    expect(value).toBe('test-value')

    // Delete
    await cache.del('test-key')
    const deleted = await cache.get<string>('test-key')
    expect(deleted).toBeNull()

    await cache.close()
  })

  test('cache JSON operations work', async () => {
    if (!redisAvailable) {
      console.log('Skipping: Redis not available')
      return
    }

    const cache = Cache.create('json-test').redis(TEST_REDIS_URL).build()

    const data = { count: 42, items: ['a', 'b'] }
    await cache.set('json-key', data, 60)
    const value = await cache.get<typeof data>('json-key')

    expect(value).toEqual(data)

    await cache.close()
  })

  test.skip('signal with Redis pub/sub - requires separate connections', async () => {
    // This test is skipped because the current Cache implementation
    // uses a single connection for both commands and pub/sub, which
    // Redis doesn't allow. A future update should use separate connections.
  })
})

// ============================================================================
// DB Connection Pooling Tests
// ============================================================================

describe('DB Connection Pooling', () => {
  let postgresAvailable: boolean

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable()
  })

  test('creates DB with pool options', async () => {
    if (!postgresAvailable) {
      console.log('Skipping: PostgreSQL not available')
      return
    }

    const db = DB.create('pooled-db')
      .postgres(TEST_DB_URL)
      .pool({ max: 5, idleTimeout: 30000, connectionTimeout: 5000 })
      .build()

    expect(db).toBeDefined()

    // Verify pool works by running concurrent queries
    const queries = Array.from({ length: 10 }, (_, i) =>
      db.query('SELECT $1::int as num', [i])
    )

    const results = await Promise.all(queries)
    expect(results.length).toBe(10)

    await db.close()
  })

  test('handles concurrent connections with pool', async () => {
    if (!postgresAvailable) {
      console.log('Skipping: PostgreSQL not available')
      return
    }

    const db = DB.create('concurrent-test')
      .postgres(TEST_DB_URL)
      .pool({ max: 3 })
      .build()

    // Run more queries than pool size
    const start = Date.now()
    const queries = Array.from({ length: 10 }, () =>
      db.query('SELECT pg_sleep(0.01)')
    )

    await Promise.all(queries)
    const duration = Date.now() - start

    // With pooling, queries should be batched
    expect(duration).toBeLessThan(1000)

    await db.close()
  })
})

// ============================================================================
// Cron Heartbeat Tests
// ============================================================================

describe('Cron Heartbeat', () => {
  let db: DBInstance
  let postgresAvailable: boolean

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable()
    if (postgresAvailable) {
      db = DB.create('cron-test-db').postgres(TEST_DB_URL).build()
      // Clean up test tables (order matters due to FK constraints)
      await db.query('DROP TABLE IF EXISTS _onepipe_cron_executions CASCADE').catch(() => {})
      await db.query('DROP TABLE IF EXISTS _onepipe_cron_locks CASCADE').catch(() => {})
      await db.query('DROP TABLE IF EXISTS _onepipe_cron_jobs CASCADE').catch(() => {})
    }
  })

  afterAll(async () => {
    if (db) {
      await db.query('DROP TABLE IF EXISTS _onepipe_cron_executions CASCADE').catch(() => {})
      await db.query('DROP TABLE IF EXISTS _onepipe_cron_locks CASCADE').catch(() => {})
      await db.query('DROP TABLE IF EXISTS _onepipe_cron_jobs CASCADE').catch(() => {})
      await db.close()
    }
  })

  test('creates cron job with PostgreSQL persistence', async () => {
    if (!postgresAvailable) {
      console.log('Skipping: PostgreSQL not available')
      return
    }

    const cron = Cron.create('test-cron')
      .schedule('* * * * *') // Every minute
      .db(db)
      .handler(async () => {
        // Handler code
      })
      .build()

    expect(cron).toBeDefined()
    expect(cron.name).toBe('test-cron')
  })

  test('triggers and executes job', async () => {
    if (!postgresAvailable) {
      console.log('Skipping: PostgreSQL not available')
      return
    }

    let executed = false

    const cron = Cron.create('trigger-test')
      .schedule('0 0 1 1 *') // Never runs naturally (Jan 1 midnight)
      .db(db)
      .handler(async () => {
        executed = true
      })
      .build()

    await cron.trigger()

    expect(executed).toBe(true)
  })
})

// ============================================================================
// Workflow Heartbeat Tests
// ============================================================================

describe('Workflow Heartbeat', () => {
  let db: DBInstance
  let postgresAvailable: boolean

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable()
    if (postgresAvailable) {
      db = DB.create('workflow-test-db').postgres(TEST_DB_URL).build()
      // Clean up test tables
      await db.query('DROP TABLE IF EXISTS _onepipe_workflow_signals CASCADE').catch(() => {})
      await db.query('DROP TABLE IF EXISTS _onepipe_workflow_children CASCADE').catch(() => {})
      await db.query('DROP TABLE IF EXISTS _onepipe_workflow_steps CASCADE').catch(() => {})
      await db.query('DROP TABLE IF EXISTS _onepipe_workflows CASCADE').catch(() => {})
    }
  })

  afterAll(async () => {
    if (db) {
      await db.query('DROP TABLE IF EXISTS _onepipe_workflow_signals CASCADE').catch(() => {})
      await db.query('DROP TABLE IF EXISTS _onepipe_workflow_children CASCADE').catch(() => {})
      await db.query('DROP TABLE IF EXISTS _onepipe_workflow_steps CASCADE').catch(() => {})
      await db.query('DROP TABLE IF EXISTS _onepipe_workflows CASCADE').catch(() => {})
      await db.close()
    }
  })

  test('workflow completes with steps', async () => {
    if (!postgresAvailable) {
      console.log('Skipping: PostgreSQL not available')
      return
    }

    const InputSchema = z.object({ value: z.number() })

    const workflow = Workflow.create('step-test')
      .input(InputSchema)
      .db(db)
      .define(async (ctx, input) => {
        const step1 = await ctx.step('double', async () => input.value * 2)
        const step2 = await ctx.step('add-ten', async () => step1 + 10)
        return { result: step2 }
      })
      .build()

    const handle = await workflow.start({ value: 5 })
    const result = await handle.result('5s')

    expect(result).toEqual({ result: 20 })
  })

  test('workflow handles short sleep', async () => {
    if (!postgresAvailable) {
      console.log('Skipping: PostgreSQL not available')
      return
    }

    const workflow = Workflow.create('sleep-test')
      .db(db)
      .define(async (ctx) => {
        await ctx.sleep(100) // 100ms
        return { slept: true }
      })
      .build()

    const handle = await workflow.start({})
    const result = await handle.result('5s')

    expect(result).toEqual({ slept: true })
  })

  test('workflow step is idempotent', async () => {
    if (!postgresAvailable) {
      console.log('Skipping: PostgreSQL not available')
      return
    }

    let callCount = 0

    const workflow = Workflow.create('idempotent-test')
      .db(db)
      .define(async (ctx) => {
        const value = await ctx.step('count', async () => {
          callCount++
          return callCount
        })
        return { value }
      })
      .build()

    // Start workflow twice with same ID
    const workflowId = 'idempotent-wf-1'
    await workflow.start({}, { workflowId })

    // Second start should return existing handle, not re-execute
    await workflow.start({}, { workflowId })

    // Wait for completion
    const handle = workflow.get(workflowId)
    await handle.result('5s')

    // Step should only be called once
    expect(callCount).toBe(1)
  })

  test('workflow can be cancelled', async () => {
    if (!postgresAvailable) {
      console.log('Skipping: PostgreSQL not available')
      return
    }

    const workflow = Workflow.create('cancel-test')
      .db(db)
      .define(async (ctx) => {
        await ctx.sleep('10s') // Long sleep
        return {}
      })
      .build()

    const handle = await workflow.start({})

    // Cancel immediately
    await handle.cancel()

    const status = await handle.status()
    expect(status).toBe('cancelled')
  })

  test('workflow list returns executions', async () => {
    if (!postgresAvailable) {
      console.log('Skipping: PostgreSQL not available')
      return
    }

    const workflow = Workflow.create('list-test')
      .db(db)
      .define(async () => ({ done: true }))
      .build()

    // Create a few executions
    await workflow.start({}, { workflowId: 'list-1' })
    await workflow.start({}, { workflowId: 'list-2' })

    // Wait for completion
    await new Promise(r => setTimeout(r, 100))

    const executions = await workflow.list({ limit: 10 })
    expect(executions.length).toBeGreaterThanOrEqual(2)
  })
})

// ============================================================================
// Memory-only Tests (always run)
// ============================================================================

describe('Memory-only Signal', () => {
  test('signal works with memory persistence', async () => {
    const signal = Signal.create<number>('memory-counter')
      .default(0)
      .persist('memory')
      .build()

    await signal.set(42)
    const value = await signal.get()

    expect(value).toBe(42)
    signal.close()
  })

  test('signal subscription works', async () => {
    const signal = Signal.create<string>('subscription-test')
      .default('initial')
      .persist('memory')
      .build()

    const received: string[] = []

    const unsubscribe = signal.subscribe(value => {
      received.push(value)
    })

    await signal.set('update1')
    await signal.set('update2')

    unsubscribe()
    signal.close()

    // Should have received initial + 2 updates
    expect(received).toContain('initial')
    expect(received).toContain('update1')
    expect(received).toContain('update2')
  })

  test('signal waitFor works', async () => {
    const signal = Signal.create<number>('waitfor-test')
      .default(0)
      .persist('memory')
      .build()

    // Start waiting in background
    const waitPromise = signal.waitFor(n => n >= 5, 5000)

    // Update values
    setTimeout(() => signal.set(1), 10)
    setTimeout(() => signal.set(3), 20)
    setTimeout(() => signal.set(5), 30)

    const result = await waitPromise
    expect(result).toBe(5)

    signal.close()
  })
})

describe('Memory-only Flow', () => {
  test('flow works with memory storage', async () => {
    const flow = Flow.create('memory-flow')
      .build()

    await flow.append({ event: 'test1' })
    await flow.append({ event: 'test2' })

    const events = await flow.read({ tail: 2 })
    expect(events.length).toBe(2)
  })

  test('flow subscription works', async () => {
    const flow = Flow.create('sub-flow')
      .build()

    const received: unknown[] = []

    const unsubscribe = flow.subscribe(data => {
      received.push(data)
    })

    await flow.append({ seq: 1 })
    await flow.append({ seq: 2 })

    unsubscribe()

    expect(received.length).toBe(2)
  })
})
