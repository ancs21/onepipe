/**
 * Signal Builder Tests
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { z } from 'zod'
import { Signal } from './signal'
import { rm } from 'node:fs/promises'

describe('Signal', () => {
  describe('Signal.create()', () => {
    test('creates a signal builder with name', () => {
      const builder = Signal.create('config')
      expect(builder).toBeDefined()
    })

    test('builds a signal instance', () => {
      const signal = Signal.create('test')
        .default('initial')
        .build()

      expect(signal).toBeDefined()
      expect(signal.name).toBe('test')
    })
  })

  describe('SignalBuilder', () => {
    test('sets schema', () => {
      const schema = z.object({
        enabled: z.boolean(),
        maxSize: z.number(),
      })

      const signal = Signal.create('config')
        .schema(schema)
        .default({ enabled: false, maxSize: 100 })
        .build()

      expect(signal.name).toBe('config')
    })

    test('sets default value', () => {
      const signal = Signal.create('counter')
        .default(0)
        .build()

      expect(signal.name).toBe('counter')
    })

    test('sets memory persistence', () => {
      const signal = Signal.create('ephemeral')
        .default('value')
        .persist('memory')
        .build()

      expect(signal.name).toBe('ephemeral')
    })

    test('sets sqlite persistence', () => {
      const signal = Signal.create('persistent')
        .default('value')
        .persist('sqlite')
        .build()

      expect(signal.name).toBe('persistent')
    })

    test('sets stream persistence', () => {
      const signal = Signal.create('distributed')
        .default('value')
        .persist('stream')
        .build()

      expect(signal.name).toBe('distributed')
    })

    test('sets custom streams URL', () => {
      const signal = Signal.create('remote')
        .default('value')
        .persist('stream')
        .streamsUrl('http://streams.example.com:9999')
        .build()

      expect(signal.name).toBe('remote')
    })

    test('chains multiple options', () => {
      const signal = Signal.create('full')
        .schema(z.string())
        .default('initial')
        .persist('sqlite')
        .build()

      expect(signal.name).toBe('full')
    })
  })

  describe('SignalInstance', () => {
    test('has get method', () => {
      const signal = Signal.create('test').default(0).build()
      expect(typeof signal.get).toBe('function')
    })

    test('has set method', () => {
      const signal = Signal.create('test').default(0).build()
      expect(typeof signal.set).toBe('function')
    })

    test('has update method', () => {
      const signal = Signal.create('test').default(0).build()
      expect(typeof signal.update).toBe('function')
    })

    test('has subscribe method', () => {
      const signal = Signal.create('test').default(0).build()
      expect(typeof signal.subscribe).toBe('function')
    })
  })

  describe('Signal operations (memory)', () => {
    test('get returns default value initially', async () => {
      const signal = Signal.create('test')
        .default(42)
        .persist('memory')
        .build()

      const value = await signal.get()
      expect(value).toBe(42)
    })

    test('set updates value', async () => {
      const signal = Signal.create('test')
        .default(0)
        .persist('memory')
        .build()

      await signal.set(100)
      const value = await signal.get()

      expect(value).toBe(100)
    })

    test('update applies function to value', async () => {
      const signal = Signal.create<number>('counter')
        .default(0)
        .persist('memory')
        .build()

      await signal.update((current) => current + 1)
      await signal.update((current) => current + 1)
      await signal.update((current) => current + 1)

      const value = await signal.get()
      expect(value).toBe(3)
    })

    test('subscribe receives updates', async () => {
      const signal = Signal.create<number>('observable')
        .default(0)
        .persist('memory')
        .build()

      const values: number[] = []
      const unsubscribe = signal.subscribe((value) => {
        values.push(value)
      })

      await signal.set(1)
      await signal.set(2)
      await signal.set(3)

      unsubscribe()

      // Should have received initial value and 3 updates
      expect(values).toContain(0)
      expect(values).toContain(1)
      expect(values).toContain(2)
      expect(values).toContain(3)
    })

    test('unsubscribe stops updates', async () => {
      const signal = Signal.create<number>('test')
        .default(0)
        .persist('memory')
        .build()

      const values: number[] = []
      const unsubscribe = signal.subscribe((value) => {
        values.push(value)
      })

      await signal.set(1)
      unsubscribe()
      await signal.set(2)
      await signal.set(3)

      // Should only have initial and first update
      expect(values).not.toContain(2)
      expect(values).not.toContain(3)
    })
  })

  describe('Object signals', () => {
    interface Config {
      maxSize: number
      enabled: boolean
      tags: string[]
    }

    test('handles object default', async () => {
      const signal = Signal.create<Config>('config')
        .default({ maxSize: 100, enabled: true, tags: [] })
        .persist('memory')
        .build()

      const value = await signal.get()
      expect(value.maxSize).toBe(100)
      expect(value.enabled).toBe(true)
      expect(value.tags).toEqual([])
    })

    test('updates entire object', async () => {
      const signal = Signal.create<Config>('config')
        .default({ maxSize: 100, enabled: true, tags: [] })
        .persist('memory')
        .build()

      await signal.set({ maxSize: 200, enabled: false, tags: ['new'] })

      const value = await signal.get()
      expect(value.maxSize).toBe(200)
      expect(value.enabled).toBe(false)
      expect(value.tags).toEqual(['new'])
    })

    test('partial update with patch', async () => {
      const signal = Signal.create<Config>('config')
        .default({ maxSize: 100, enabled: true, tags: [] })
        .persist('memory')
        .build()

      await signal.patch({ maxSize: 200 })

      const value = await signal.get()
      expect(value.maxSize).toBe(200)
      expect(value.enabled).toBe(true) // Unchanged
    })
  })

  describe('Schema validation', () => {
    test('validates on set', async () => {
      const signal = Signal.create<number>('validated')
        .schema(z.number().min(0).max(100))
        .default(50)
        .persist('memory')
        .build()

      // Valid value should work
      await signal.set(75)
      expect(await signal.get()).toBe(75)

      // Invalid value should throw
      await expect(signal.set(150)).rejects.toThrow()
    })

    test('validates complex objects', async () => {
      const ConfigSchema = z.object({
        port: z.number().int().min(1).max(65535),
        host: z.string().min(1),
        secure: z.boolean(),
      })

      const signal = Signal.create('server-config')
        .schema(ConfigSchema)
        .default({ port: 3000, host: 'localhost', secure: false })
        .persist('memory')
        .build()

      // Valid
      await signal.set({ port: 8080, host: '0.0.0.0', secure: true })

      // Invalid port
      await expect(
        signal.set({ port: 70000, host: 'localhost', secure: false })
      ).rejects.toThrow()
    })
  })

  describe('waitFor', () => {
    test('resolves immediately if condition met', async () => {
      const signal = Signal.create<number>('test')
        .default(10)
        .persist('memory')
        .build()

      const value = await signal.waitFor((v) => v > 5)
      expect(value).toBe(10)
    })

    test('waits for condition to be met', async () => {
      const signal = Signal.create<number>('test')
        .default(0)
        .persist('memory')
        .build()

      // Start waiting
      const waitPromise = signal.waitFor((v) => v >= 5)

      // Update value
      setTimeout(async () => {
        await signal.set(5)
      }, 10)

      const value = await waitPromise
      expect(value).toBe(5)
    })

    test('times out if condition not met', async () => {
      const signal = Signal.create<number>('test')
        .default(0)
        .persist('memory')
        .build()

      await expect(
        signal.waitFor((v) => v >= 100, 50)
      ).rejects.toThrow('timed out')
    })
  })

  describe('reset', () => {
    test('resets to default value', async () => {
      const signal = Signal.create<number>('resettable')
        .default(0)
        .persist('memory')
        .build()

      await signal.set(100)
      expect(await signal.get()).toBe(100)

      await signal.reset()
      expect(await signal.get()).toBe(0)
    })
  })

  describe('metadata', () => {
    test('returns signal metadata', () => {
      const signal = Signal.create('test')
        .default('value')
        .persist('sqlite')
        .build()

      const meta = signal.metadata()

      expect(meta.name).toBe('test')
      expect(meta.persist).toBe('sqlite')
      expect(typeof meta.subscriberCount).toBe('number')
    })
  })

  describe('Feature flag pattern', () => {
    test('boolean feature flag', async () => {
      const darkMode = Signal.create<boolean>('dark-mode')
        .schema(z.boolean())
        .default(false)
        .persist('memory')
        .build()

      expect(await darkMode.get()).toBe(false)

      await darkMode.set(true)
      expect(await darkMode.get()).toBe(true)
    })

    test('percentage rollout', async () => {
      const rollout = Signal.create<number>('feature-rollout')
        .schema(z.number().min(0).max(100))
        .default(0)
        .persist('memory')
        .build()

      await rollout.set(25) // 25% rollout
      expect(await rollout.get()).toBe(25)

      await rollout.update((current) => Math.min(current + 25, 100))
      expect(await rollout.get()).toBe(50)
    })
  })
})

// SQLite persistence tests
describe('Signal SQLite persistence', () => {
  const cleanupDirs = async () => {
    try {
      await rm('./.onepipe/signals', { recursive: true, force: true })
    } catch {
      // Ignore
    }
  }

  beforeEach(cleanupDirs)
  afterEach(cleanupDirs)

  test('persists value to sqlite', async () => {
    const signal1 = Signal.create<number>('persistent-counter')
      .default(0)
      .persist('sqlite')
      .build()

    await signal1.set(42)
    signal1.close()

    // Create new instance with same name
    const signal2 = Signal.create<number>('persistent-counter')
      .default(0)
      .persist('sqlite')
      .build()

    // Should restore persisted value
    const value = await signal2.get()
    expect(value).toBe(42)

    signal2.close()
  })
})
