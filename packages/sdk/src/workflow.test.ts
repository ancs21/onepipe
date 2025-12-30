/**
 * Workflow Builder Tests
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { z } from 'zod'
import { Workflow } from './workflow'
import type { DBInstance } from './types'

// Mock database instance
function createMockDB(): DBInstance {
  return {
    name: 'test-db',
    type: 'postgres' as const,
    query: mock(async () => []),
    execute: mock(async () => ({ rowsAffected: 0 })),
    transaction: mock(async (fn) => fn({} as any)),
    close: mock(async () => {}),
    getTables: mock(async () => []),
    getTableSchema: mock(async () => []),
  } as DBInstance
}

describe('Workflow', () => {
  describe('Workflow.create()', () => {
    test('creates a workflow builder with name', () => {
      const builder = Workflow.create('test-workflow')
      expect(builder).toBeDefined()
    })
  })

  describe('WorkflowBuilder', () => {
    test('accepts input schema', () => {
      const InputSchema = z.object({
        orderId: z.string(),
        items: z.array(z.string()),
      })

      const builder = Workflow.create('order-workflow')
        .input(InputSchema)

      expect(builder).toBeDefined()
    })

    test('accepts output schema', () => {
      const OutputSchema = z.object({
        status: z.string(),
        total: z.number(),
      })

      const builder = Workflow.create('order-workflow')
        .output(OutputSchema)

      expect(builder).toBeDefined()
    })

    test('accepts database instance', () => {
      const db = createMockDB()

      const builder = Workflow.create('order-workflow')
        .db(db)

      expect(builder).toBeDefined()
    })

    test('throws error for non-postgres database', () => {
      const sqliteDb = {
        name: 'test-db',
        type: 'sqlite' as const,
        query: mock(async () => []),
        execute: mock(async () => ({ rowsAffected: 0 })),
        transaction: mock(async (fn) => fn({} as any)),
        close: mock(async () => {}),
        getTables: mock(async () => []),
        getTableSchema: mock(async () => []),
      } as DBInstance

      expect(() => {
        Workflow.create('test').db(sqliteDb)
      }).toThrow('Workflow requires PostgreSQL database')
    })

    test('accepts timeout as duration string', () => {
      const db = createMockDB()

      const builder = Workflow.create('order-workflow')
        .db(db)
        .timeout('30m')

      expect(builder).toBeDefined()
    })

    test('accepts retry options', () => {
      const db = createMockDB()

      const builder = Workflow.create('order-workflow')
        .db(db)
        .retry({ attempts: 3, delay: 1000, backoff: 'exponential' })

      expect(builder).toBeDefined()
    })

    test('enables tracing', () => {
      const db = createMockDB()

      const builder = Workflow.create('order-workflow')
        .db(db)
        .trace()

      expect(builder).toBeDefined()
    })

    test('accepts handler via define()', () => {
      const db = createMockDB()

      const builder = Workflow.create('order-workflow')
        .db(db)
        .define(async (_ctx, _input) => {
          return { status: 'completed' }
        })

      expect(builder).toBeDefined()
    })

    test('chains multiple options', () => {
      const db = createMockDB()
      const InputSchema = z.object({ orderId: z.string() })
      const OutputSchema = z.object({ status: z.string() })

      const builder = Workflow.create('order-workflow')
        .input(InputSchema)
        .output(OutputSchema)
        .db(db)
        .timeout('1h')
        .retry({ attempts: 3 })
        .trace()
        .define(async (_ctx, _input) => {
          return { status: 'done' }
        })

      expect(builder).toBeDefined()
    })

    test('build() requires handler', () => {
      const db = createMockDB()

      expect(() => {
        Workflow.create('test')
          .db(db)
          .build()
      }).toThrow('requires a handler')
    })

    test('build() requires database', () => {
      expect(() => {
        Workflow.create('test')
          .define(async () => ({}))
          .build()
      }).toThrow('requires a PostgreSQL database')
    })

    test('builds a workflow instance', () => {
      const db = createMockDB()

      const workflow = Workflow.create('order-workflow')
        .db(db)
        .define(async (_ctx, _input) => {
          return { result: 'ok' }
        })
        .build()

      expect(workflow).toBeDefined()
      expect(workflow.name).toBe('order-workflow')
    })
  })

  describe('WorkflowInstance', () => {
    let db: ReturnType<typeof createMockDB>

    beforeEach(() => {
      db = createMockDB()
    })

    test('has start method', () => {
      const workflow = Workflow.create('test')
        .db(db)
        .define(async () => ({}))
        .build()

      expect(typeof workflow.start).toBe('function')
    })

    test('has get method', () => {
      const workflow = Workflow.create('test')
        .db(db)
        .define(async () => ({}))
        .build()

      expect(typeof workflow.get).toBe('function')
    })

    test('has list method', () => {
      const workflow = Workflow.create('test')
        .db(db)
        .define(async () => ({}))
        .build()

      expect(typeof workflow.list).toBe('function')
    })

    test('has signal method', () => {
      const workflow = Workflow.create('test')
        .db(db)
        .define(async () => ({}))
        .build()

      expect(typeof workflow.signal).toBe('function')
    })

    test('has cancel method', () => {
      const workflow = Workflow.create('test')
        .db(db)
        .define(async () => ({}))
        .build()

      expect(typeof workflow.cancel).toBe('function')
    })

    test('has recover method', () => {
      const workflow = Workflow.create('test')
        .db(db)
        .define(async () => ({}))
        .build()

      expect(typeof workflow.recover).toBe('function')
    })

    test('get returns a workflow handle', () => {
      const workflow = Workflow.create('test')
        .db(db)
        .define(async () => ({}))
        .build()

      const handle = workflow.get('some-workflow-id')

      expect(handle).toBeDefined()
      expect(handle.workflowId).toBe('some-workflow-id')
    })
  })

  describe('WorkflowHandle', () => {
    let db: ReturnType<typeof createMockDB>

    beforeEach(() => {
      db = createMockDB()
    })

    test('has status method', () => {
      const workflow = Workflow.create('test')
        .db(db)
        .define(async () => ({}))
        .build()

      const handle = workflow.get('workflow-123')

      expect(typeof handle.status).toBe('function')
    })

    test('has result method', () => {
      const workflow = Workflow.create('test')
        .db(db)
        .define(async () => ({}))
        .build()

      const handle = workflow.get('workflow-123')

      expect(typeof handle.result).toBe('function')
    })

    test('has signal method', () => {
      const workflow = Workflow.create('test')
        .db(db)
        .define(async () => ({}))
        .build()

      const handle = workflow.get('workflow-123')

      expect(typeof handle.signal).toBe('function')
    })

    test('has cancel method', () => {
      const workflow = Workflow.create('test')
        .db(db)
        .define(async () => ({}))
        .build()

      const handle = workflow.get('workflow-123')

      expect(typeof handle.cancel).toBe('function')
    })
  })

  describe('Duration parsing', () => {
    test('parses milliseconds', () => {
      const db = createMockDB()

      // Timeout is parsed internally, we just verify it doesn't throw
      const workflow = Workflow.create('test')
        .db(db)
        .timeout('100ms')
        .define(async () => ({}))
        .build()

      expect(workflow).toBeDefined()
    })

    test('parses seconds', () => {
      const db = createMockDB()

      const workflow = Workflow.create('test')
        .db(db)
        .timeout('30s')
        .define(async () => ({}))
        .build()

      expect(workflow).toBeDefined()
    })

    test('parses minutes', () => {
      const db = createMockDB()

      const workflow = Workflow.create('test')
        .db(db)
        .timeout('5m')
        .define(async () => ({}))
        .build()

      expect(workflow).toBeDefined()
    })

    test('parses hours', () => {
      const db = createMockDB()

      const workflow = Workflow.create('test')
        .db(db)
        .timeout('2h')
        .define(async () => ({}))
        .build()

      expect(workflow).toBeDefined()
    })

    test('parses days', () => {
      const db = createMockDB()

      const workflow = Workflow.create('test')
        .db(db)
        .timeout('7d')
        .define(async () => ({}))
        .build()

      expect(workflow).toBeDefined()
    })

    test('throws on invalid duration', () => {
      const db = createMockDB()

      expect(() => {
        Workflow.create('test')
          .db(db)
          .timeout('invalid')
          .define(async () => ({}))
          .build()
      }).toThrow('Invalid duration')
    })
  })
})

describe('Workflow with typed input/output', () => {
  const OrderInput = z.object({
    orderId: z.string(),
    items: z.array(z.object({
      productId: z.string(),
      quantity: z.number(),
    })),
  })

  const OrderOutput = z.object({
    orderId: z.string(),
    status: z.enum(['pending', 'processing', 'completed', 'failed']),
    total: z.number(),
  })

  test('creates workflow with typed schemas', () => {
    const db = createMockDB()

    const workflow = Workflow.create('process-order')
      .input(OrderInput)
      .output(OrderOutput)
      .db(db)
      .define(async (ctx, input) => {
        // TypeScript should infer the types here
        const { orderId, items } = input
        const total = items.reduce((sum, item) => sum + item.quantity * 10, 0)

        return {
          orderId,
          status: 'completed' as const,
          total,
        }
      })
      .build()

    expect(workflow.name).toBe('process-order')
  })
})
