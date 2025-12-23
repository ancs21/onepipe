/**
 * Flow Builder Tests
 */

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { z } from 'zod'
import { Flow } from './flow'

describe('Flow', () => {
  describe('Flow.create()', () => {
    test('creates a flow builder with name', () => {
      const builder = Flow.create('test-flow')
      expect(builder).toBeDefined()
    })

    test('builds a flow instance', () => {
      const flow = Flow.create('orders').build()
      expect(flow).toBeDefined()
      expect(flow.name).toBe('orders')
    })
  })

  describe('FlowBuilder', () => {
    test('accepts a zod schema', () => {
      const OrderSchema = z.object({
        id: z.string(),
        amount: z.number(),
      })

      const flow = Flow.create('orders')
        .schema(OrderSchema)
        .build()

      expect(flow.name).toBe('orders')
    })

    test('accepts retention options', () => {
      const flow = Flow.create('events')
        .retention({ maxAge: '30d', maxBytes: 1024 * 1024 * 100 })
        .build()

      expect(flow.name).toBe('events')
    })

    test('enables tracing', () => {
      const flow = Flow.create('metrics')
        .trace()
        .build()

      expect(flow.name).toBe('metrics')
    })

    test('sets custom stream URL', () => {
      const flow = Flow.create('remote')
        .streamsUrl('http://streams.example.com:9999')
        .build()

      expect(flow.name).toBe('remote')
    })

    test('chains multiple options', () => {
      const Schema = z.object({ type: z.string() })

      const flow = Flow.create('events')
        .schema(Schema)
        .retention({ maxAge: '7d' })
        .trace()
        .build()

      expect(flow.name).toBe('events')
    })
  })

  describe('FlowInstance', () => {
    test('has append method', () => {
      const flow = Flow.create('test').build()
      expect(typeof flow.append).toBe('function')
    })

    test('has read method', () => {
      const flow = Flow.create('test').build()
      expect(typeof flow.read).toBe('function')
    })

    test('has subscribe method', () => {
      const flow = Flow.create('test').build()
      expect(typeof flow.subscribe).toBe('function')
    })

    test('has stream method', () => {
      const flow = Flow.create('test').build()
      expect(typeof flow.stream).toBe('function')
    })

    test('subscribe returns unsubscribe function', () => {
      const flow = Flow.create('test').build()
      const handler = mock(() => {})

      const unsubscribe = flow.subscribe(handler)

      expect(typeof unsubscribe).toBe('function')
    })
  })
})

describe('Flow with schema validation', () => {
  const OrderEventSchema = z.discriminatedUnion('type', [
    z.object({
      type: z.literal('created'),
      orderId: z.string(),
      items: z.array(z.string()),
    }),
    z.object({
      type: z.literal('shipped'),
      orderId: z.string(),
      trackingId: z.string(),
    }),
  ])

  test('creates flow with discriminated union schema', () => {
    const flow = Flow.create('order-events')
      .schema(OrderEventSchema)
      .build()

    expect(flow.name).toBe('order-events')
  })
})
