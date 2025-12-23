/**
 * Cache Builder Tests
 *
 * Note: Integration tests require a running Redis server.
 * These tests focus on builder configuration and API shape.
 */

import { describe, test, expect } from 'bun:test'
import { Cache } from './cache'

describe('Cache', () => {
  describe('Cache.create()', () => {
    test('creates a cache builder with name', () => {
      const builder = Cache.create('main')
      expect(builder).toBeDefined()
    })
  })

  describe('CacheBuilder', () => {
    test('configures Redis connection', () => {
      const cache = Cache.create('redis')
        .redis('redis://localhost:6379')
        .build()

      expect(cache.name).toBe('redis')
    })

    test('sets key prefix', () => {
      const cache = Cache.create('prefixed')
        .redis('redis://localhost:6379')
        .prefix('myapp:')
        .build()

      expect(cache.name).toBe('prefixed')
    })

    test('sets default TTL', () => {
      const cache = Cache.create('ttl')
        .redis('redis://localhost:6379')
        .ttl(3600)
        .build()

      expect(cache.name).toBe('ttl')
    })

    test('sets max connections', () => {
      const cache = Cache.create('pooled')
        .redis('redis://localhost:6379')
        .maxConnections(10)
        .build()

      expect(cache.name).toBe('pooled')
    })

    test('configures cluster mode', () => {
      const cache = Cache.create('cluster')
        .redis('redis://localhost:6379')
        .cluster([
          'redis://node1:6379',
          'redis://node2:6379',
          'redis://node3:6379',
        ])
        .build()

      expect(cache.name).toBe('cluster')
    })

    test('chains multiple options', () => {
      const cache = Cache.create('full')
        .redis('redis://localhost:6379')
        .prefix('app:')
        .ttl(1800)
        .maxConnections(20)
        .build()

      expect(cache.name).toBe('full')
    })
  })

  describe('CacheInstance API', () => {
    test('has get method', () => {
      const cache = Cache.create('test')
        .redis('redis://localhost:6379')
        .build()

      expect(typeof cache.get).toBe('function')
    })

    test('has set method', () => {
      const cache = Cache.create('test')
        .redis('redis://localhost:6379')
        .build()

      expect(typeof cache.set).toBe('function')
    })

    test('has del method', () => {
      const cache = Cache.create('test')
        .redis('redis://localhost:6379')
        .build()

      expect(typeof cache.del).toBe('function')
    })

    test('has exists method', () => {
      const cache = Cache.create('test')
        .redis('redis://localhost:6379')
        .build()

      expect(typeof cache.exists).toBe('function')
    })

    test('has ttl method', () => {
      const cache = Cache.create('test')
        .redis('redis://localhost:6379')
        .build()

      expect(typeof cache.ttl).toBe('function')
    })

    test('has expire method', () => {
      const cache = Cache.create('test')
        .redis('redis://localhost:6379')
        .build()

      expect(typeof cache.expire).toBe('function')
    })

    test('has incr method', () => {
      const cache = Cache.create('test')
        .redis('redis://localhost:6379')
        .build()

      expect(typeof cache.incr).toBe('function')
    })

    test('has decr method', () => {
      const cache = Cache.create('test')
        .redis('redis://localhost:6379')
        .build()

      expect(typeof cache.decr).toBe('function')
    })
  })

  describe('Hash operations API', () => {
    test('has hset method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.hset).toBe('function')
    })

    test('has hget method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.hget).toBe('function')
    })

    test('has hgetall method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.hgetall).toBe('function')
    })

    test('has hdel method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.hdel).toBe('function')
    })
  })

  describe('List operations API', () => {
    test('has lpush method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.lpush).toBe('function')
    })

    test('has rpush method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.rpush).toBe('function')
    })

    test('has lpop method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.lpop).toBe('function')
    })

    test('has rpop method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.rpop).toBe('function')
    })

    test('has lrange method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.lrange).toBe('function')
    })
  })

  describe('Set operations API', () => {
    test('has sadd method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.sadd).toBe('function')
    })

    test('has srem method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.srem).toBe('function')
    })

    test('has smembers method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.smembers).toBe('function')
    })

    test('has sismember method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.sismember).toBe('function')
    })
  })

  describe('Pub/Sub API', () => {
    test('has publish method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.publish).toBe('function')
    })

    test('has subscribe method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.subscribe).toBe('function')
    })
  })

  describe('Context API', () => {
    test('has context method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.context).toBe('function')
    })

    test('context returns simplified interface', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      const ctx = cache.context()

      expect(typeof ctx.get).toBe('function')
      expect(typeof ctx.set).toBe('function')
      expect(typeof ctx.del).toBe('function')
      expect(typeof ctx.exists).toBe('function')
      expect(typeof ctx.incr).toBe('function')
      expect(typeof ctx.decr).toBe('function')
    })
  })

  describe('Lifecycle', () => {
    test('has close method', () => {
      const cache = Cache.create('test').redis('redis://localhost:6379').build()
      expect(typeof cache.close).toBe('function')
    })
  })
})

// Integration tests (require Redis)
describe.skip('Cache Integration (requires Redis)', () => {
  test('set and get value', async () => {
    const cache = Cache.create('test')
      .redis('redis://localhost:6379')
      .prefix('test:')
      .build()

    await cache.set('key', { name: 'value' })
    const result = await cache.get('key')

    expect(result).toEqual({ name: 'value' })

    await cache.del('key')
    await cache.close()
  })

  test('set with TTL', async () => {
    const cache = Cache.create('test')
      .redis('redis://localhost:6379')
      .build()

    await cache.set('expires', 'soon', { ttl: 1 })
    const ttl = await cache.ttl('expires')

    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(1)

    await cache.close()
  })
})
