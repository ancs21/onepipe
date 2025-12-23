/**
 * Channel Builder Tests
 */

import { describe, test, expect, mock } from 'bun:test'
import { z } from 'zod'
import { Channel } from './channel'

describe('Channel', () => {
  describe('Channel.create()', () => {
    test('creates a channel builder with name', () => {
      const builder = Channel.create('process-order')
      expect(builder).toBeDefined()
    })

    test('builds a channel instance', () => {
      const channel = Channel.create('process-order')
        .handler(async (input) => ({ success: true }))
        .build()

      expect(channel).toBeDefined()
      expect(channel.name).toBe('process-order')
    })
  })

  describe('ChannelBuilder', () => {
    test('accepts input schema', () => {
      const InputSchema = z.object({
        orderId: z.string(),
        amount: z.number(),
      })

      const channel = Channel.create('process-payment')
        .input(InputSchema)
        .handler(async (input) => ({ success: true }))
        .build()

      expect(channel.name).toBe('process-payment')
    })

    test('accepts output schema', () => {
      const OutputSchema = z.object({
        success: z.boolean(),
        transactionId: z.string().optional(),
      })

      const channel = Channel.create('process-payment')
        .output(OutputSchema)
        .handler(async () => ({ success: true }))
        .build()

      expect(channel.name).toBe('process-payment')
    })

    test('accepts both input and output schemas', () => {
      const InputSchema = z.object({ amount: z.number() })
      const OutputSchema = z.object({ success: z.boolean() })

      const channel = Channel.create('charge')
        .input(InputSchema)
        .output(OutputSchema)
        .handler(async (input) => ({ success: input.amount > 0 }))
        .build()

      expect(channel.name).toBe('charge')
    })

    test('sets timeout', () => {
      const channel = Channel.create('slow-operation')
        .timeout('30s')
        .handler(async () => ({}))
        .build()

      expect(channel.name).toBe('slow-operation')
    })

    test('sets retry options', () => {
      const channel = Channel.create('flaky-operation')
        .retry({ attempts: 3, backoff: 'exponential', delay: 1000 })
        .handler(async () => ({}))
        .build()

      expect(channel.name).toBe('flaky-operation')
    })

    test('enables tracing', () => {
      const channel = Channel.create('traced')
        .trace()
        .handler(async () => ({}))
        .build()

      expect(channel.name).toBe('traced')
    })

    test('chains multiple options', () => {
      const channel = Channel.create('full-featured')
        .input(z.object({ id: z.string() }))
        .output(z.object({ result: z.string() }))
        .timeout('10s')
        .retry({ attempts: 2 })
        .trace()
        .handler(async (input) => ({ result: input.id }))
        .build()

      expect(channel.name).toBe('full-featured')
    })
  })

  describe('ChannelInstance', () => {
    test('has call method', () => {
      const channel = Channel.create('test')
        .handler(async () => ({}))
        .build()

      expect(typeof channel.call).toBe('function')
    })

    test('has history method', () => {
      const channel = Channel.create('test')
        .handler(async () => ({}))
        .build()

      expect(typeof channel.history).toBe('function')
    })

    test('call executes handler', async () => {
      const handlerMock = mock(async (input: { value: number }) => ({
        doubled: input.value * 2,
      }))

      const channel = Channel.create('double')
        .input(z.object({ value: z.number() }))
        .output(z.object({ doubled: z.number() }))
        .handler(handlerMock)
        .build()

      const result = await channel.call({ value: 5 })

      expect(handlerMock).toHaveBeenCalled()
      expect(handlerMock).toHaveBeenCalledTimes(1)
      expect(result.doubled).toBe(10)
    })

    test('call passes input to handler', async () => {
      const channel = Channel.create('echo')
        .input(z.object({ message: z.string() }))
        .output(z.object({ echo: z.string() }))
        .handler(async (input) => ({
          echo: input.message,
        }))
        .build()

      const result = await channel.call({ message: 'hello' })

      expect(result.echo).toBe('hello')
    })

    test('handler receives context', async () => {
      let receivedContext: unknown = null

      const channel = Channel.create('with-context')
        .input(z.object({}))
        .output(z.object({}))
        .handler(async (_input, ctx) => {
          receivedContext = ctx
          return {}
        })
        .build()

      await channel.call({})

      expect(receivedContext).toBeDefined()
      expect(typeof (receivedContext as { emit: unknown }).emit).toBe('function')
      expect(typeof (receivedContext as { span: unknown }).span).toBe('function')
    })

    test('handler can emit to flows', async () => {
      const channel = Channel.create('with-emit')
        .input(z.object({}))
        .output(z.object({ emitted: z.boolean() }))
        .handler(async (_input, ctx) => {
          // Emit should be callable
          expect(typeof ctx.emit).toBe('function')
          return { emitted: true }
        })
        .build()

      const result = await channel.call({})
      expect(result.emitted).toBe(true)
    })
  })

  describe('Error handling', () => {
    test('propagates handler errors', async () => {
      const channel = Channel.create('failing')
        .handler(async () => {
          throw new Error('Handler failed')
        })
        .build()

      await expect(channel.call({})).rejects.toThrow('Handler failed')
    })

    test('validates input schema', async () => {
      const channel = Channel.create('validated')
        .input(z.object({ required: z.string() }))
        .handler(async (input) => input)
        .build()

      // Should throw on invalid input
      await expect(channel.call({} as any)).rejects.toThrow()
    })
  })

  describe('Complex scenarios', () => {
    test('processes order workflow', async () => {
      interface OrderInput {
        orderId: string
        items: string[]
        total: number
      }

      interface OrderOutput {
        success: boolean
        orderId: string
        processedAt: number
      }

      const processOrder = Channel.create('process-order')
        .input(z.object({
          orderId: z.string(),
          items: z.array(z.string()),
          total: z.number(),
        }))
        .output(z.object({
          success: z.boolean(),
          orderId: z.string(),
          processedAt: z.number(),
        }))
        .handler(async (input) => ({
          success: true,
          orderId: input.orderId,
          processedAt: Date.now(),
        }))
        .build()

      const result = await processOrder.call({
        orderId: 'order-123',
        items: ['item-1', 'item-2'],
        total: 99.99,
      })

      expect(result.success).toBe(true)
      expect(result.orderId).toBe('order-123')
      expect(result.processedAt).toBeGreaterThan(0)
    })
  })
})
