/**
 * Cache Builder
 *
 * Redis-based caching with builder pattern
 *
 * @example
 * ```typescript
 * import { Cache } from '@onepipe/sdk'
 *
 * const cache = Cache
 *   .create('main')
 *   .redis('redis://localhost:6379')
 *   .prefix('myapp:')
 *   .ttl(3600)
 *   .build()
 *
 * // Usage
 * await cache.set('user:123', { name: 'Alice' })
 * const user = await cache.get('user:123')
 * await cache.del('user:123')
 *
 * // With TTL override
 * await cache.set('session:abc', data, { ttl: 1800 })
 *
 * // Atomic operations
 * await cache.incr('counter')
 * await cache.decr('counter')
 *
 * // Hash operations
 * await cache.hset('user:123', 'name', 'Alice')
 * await cache.hget('user:123', 'name')
 * await cache.hgetall('user:123')
 *
 * // List operations
 * await cache.lpush('queue', item)
 * await cache.rpop('queue')
 *
 * // Set operations
 * await cache.sadd('tags', 'typescript')
 * await cache.smembers('tags')
 *
 * // Pub/Sub
 * cache.subscribe('events', (message) => console.log(message))
 * cache.publish('events', { type: 'update' })
 * ```
 */

import type { CacheOptions, CacheInstance, CacheContext } from './types'
import { withSpan, isInitialized as isTracingInitialized } from './otel'

/**
 * Safely parse JSON and remove prototype pollution vectors
 */
function safeJsonParse<T>(value: string): T {
  const parsed = JSON.parse(value)
  if (parsed && typeof parsed === 'object') {
    // Remove prototype pollution vectors
    delete parsed.__proto__
    delete parsed.constructor
    delete parsed.prototype
  }
  return parsed as T
}

/**
 * Cache builder with fluent API
 */
export class CacheBuilder {
  private options: CacheOptions

  constructor(name: string) {
    this.options = {
      name,
      url: 'redis://localhost:6379',
      prefix: '',
      defaultTtl: 0,
      trace: false,
    }
  }

  /**
   * Set Redis connection URL
   */
  redis(url: string): this {
    this.options.url = url
    return this
  }

  /**
   * Set key prefix
   */
  prefix(prefix: string): this {
    this.options.prefix = prefix
    return this
  }

  /**
   * Set default TTL in seconds (0 = no expiry)
   */
  ttl(seconds: number): this {
    this.options.defaultTtl = seconds
    return this
  }

  /**
   * Set max connections in pool
   */
  maxConnections(max: number): this {
    this.options.maxConnections = max
    return this
  }

  /**
   * Enable cluster mode
   */
  cluster(nodes: string[]): this {
    this.options.cluster = nodes
    return this
  }

  /**
   * Enable tracing for cache operations
   */
  trace(): this {
    this.options.trace = true
    return this
  }

  /**
   * Build the cache instance
   */
  build(): CacheInstance {
    return new RedisCacheInstance(this.options)
  }
}

/**
 * Redis cache implementation
 */
class RedisCacheInstance implements CacheInstance {
  readonly name: string
  private options: CacheOptions
  private client: RedisClient | null = null
  private subscribers: Map<string, Set<(message: unknown) => void>> = new Map()

  constructor(options: CacheOptions) {
    this.name = options.name
    this.options = options
  }

  private prefixKey(key: string): string {
    return this.options.prefix ? `${this.options.prefix}${key}` : key
  }

  private async getClient(): Promise<RedisClient> {
    if (!this.client) {
      this.client = await createRedisClient(this.options)
    }
    return this.client
  }

  /**
   * Get a value from cache
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    // Create OTEL child span if tracing is enabled
    if (this.options.trace && isTracingInitialized()) {
      return withSpan('cache.get', {
        'cache.system': 'redis',
        'cache.operation': 'get',
        'cache.key': key,
      }, async () => {
        const client = await this.getClient()
        const value = await client.get(this.prefixKey(key))
        if (value === null) return null
        try {
          return safeJsonParse<T>(value)
        } catch {
          return value as T
        }
      })
    }

    const client = await this.getClient()
    const value = await client.get(this.prefixKey(key))
    if (value === null) return null
    try {
      return safeJsonParse<T>(value)
    } catch {
      return value as T
    }
  }

  /**
   * Set a value in cache
   */
  async set<T = unknown>(key: string, value: T, options?: { ttl?: number }): Promise<void> {
    // Create OTEL child span if tracing is enabled
    if (this.options.trace && isTracingInitialized()) {
      return withSpan('cache.set', {
        'cache.system': 'redis',
        'cache.operation': 'set',
        'cache.key': key,
      }, async () => {
        const client = await this.getClient()
        const serialized = typeof value === 'string' ? value : JSON.stringify(value)
        const ttl = options?.ttl ?? this.options.defaultTtl ?? 0

        if (ttl > 0) {
          await client.setex(this.prefixKey(key), ttl, serialized)
        } else {
          await client.set(this.prefixKey(key), serialized)
        }
      })
    }

    const client = await this.getClient()
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    const ttl = options?.ttl ?? this.options.defaultTtl ?? 0

    if (ttl > 0) {
      await client.setex(this.prefixKey(key), ttl, serialized)
    } else {
      await client.set(this.prefixKey(key), serialized)
    }
  }

  /**
   * Delete a key from cache
   */
  async del(key: string): Promise<void> {
    // Create OTEL child span if tracing is enabled
    if (this.options.trace && isTracingInitialized()) {
      return withSpan('cache.del', {
        'cache.system': 'redis',
        'cache.operation': 'del',
        'cache.key': key,
      }, async () => {
        const client = await this.getClient()
        await client.del(this.prefixKey(key))
      })
    }

    const client = await this.getClient()
    await client.del(this.prefixKey(key))
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    const client = await this.getClient()
    return await client.exists(this.prefixKey(key))
  }

  /**
   * Get TTL of a key in seconds
   */
  async ttl(key: string): Promise<number> {
    const client = await this.getClient()
    return await client.ttl(this.prefixKey(key))
  }

  /**
   * Set expiry on a key
   */
  async expire(key: string, seconds: number): Promise<void> {
    const client = await this.getClient()
    await client.expire(this.prefixKey(key), seconds)
  }

  /**
   * Increment a numeric value
   */
  async incr(key: string, by: number = 1): Promise<number> {
    const client = await this.getClient()
    return await client.incrby(this.prefixKey(key), by)
  }

  /**
   * Decrement a numeric value
   */
  async decr(key: string, by: number = 1): Promise<number> {
    const client = await this.getClient()
    return await client.decrby(this.prefixKey(key), by)
  }

  /**
   * Set hash field
   */
  async hset(key: string, field: string, value: unknown): Promise<void> {
    const client = await this.getClient()
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    await client.hset(this.prefixKey(key), field, serialized)
  }

  /**
   * Get hash field
   */
  async hget<T = unknown>(key: string, field: string): Promise<T | null> {
    const client = await this.getClient()
    const value = await client.hget(this.prefixKey(key), field)
    if (value === null) return null
    try {
      return safeJsonParse<T>(value)
    } catch {
      return value as T
    }
  }

  /**
   * Get all hash fields
   */
  async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
    const client = await this.getClient()
    const value = await client.hgetall(this.prefixKey(key))
    if (!value || Object.keys(value).length === 0) return null

    // Parse JSON values safely
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      try {
        result[k] = safeJsonParse(v as string)
      } catch {
        result[k] = v
      }
    }
    return result as T
  }

  /**
   * Delete hash field
   */
  async hdel(key: string, field: string): Promise<void> {
    const client = await this.getClient()
    await client.hdel(this.prefixKey(key), field)
  }

  /**
   * Push to left of list
   */
  async lpush<T = unknown>(key: string, value: T): Promise<number> {
    const client = await this.getClient()
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    return await client.lpush(this.prefixKey(key), serialized)
  }

  /**
   * Push to right of list
   */
  async rpush<T = unknown>(key: string, value: T): Promise<number> {
    const client = await this.getClient()
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    return await client.rpush(this.prefixKey(key), serialized)
  }

  /**
   * Pop from left of list
   */
  async lpop<T = unknown>(key: string): Promise<T | null> {
    const client = await this.getClient()
    const value = await client.lpop(this.prefixKey(key))
    if (value === null) return null
    try {
      return safeJsonParse<T>(value)
    } catch {
      return value as T
    }
  }

  /**
   * Pop from right of list
   */
  async rpop<T = unknown>(key: string): Promise<T | null> {
    const client = await this.getClient()
    const value = await client.rpop(this.prefixKey(key))
    if (value === null) return null
    try {
      return safeJsonParse<T>(value)
    } catch {
      return value as T
    }
  }

  /**
   * Get list range
   */
  async lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]> {
    const client = await this.getClient()
    const values = await client.lrange(this.prefixKey(key), start, stop)
    return values.map((v) => {
      try {
        return safeJsonParse<T>(v)
      } catch {
        return v as T
      }
    })
  }

  /**
   * Add to set
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    const client = await this.getClient()
    return await client.sadd(this.prefixKey(key), ...members)
  }

  /**
   * Remove from set
   */
  async srem(key: string, ...members: string[]): Promise<number> {
    const client = await this.getClient()
    return await client.srem(this.prefixKey(key), ...members)
  }

  /**
   * Get all set members
   */
  async smembers(key: string): Promise<string[]> {
    const client = await this.getClient()
    return await client.smembers(this.prefixKey(key))
  }

  /**
   * Check if member exists in set
   */
  async sismember(key: string, member: string): Promise<boolean> {
    const client = await this.getClient()
    return await client.sismember(this.prefixKey(key), member)
  }

  /**
   * Publish message to channel
   */
  async publish(channel: string, message: unknown): Promise<void> {
    const client = await this.getClient()
    const serialized = typeof message === 'string' ? message : JSON.stringify(message)
    await client.publish(this.prefixKey(channel), serialized)
  }

  /**
   * Subscribe to channel
   */
  subscribe(channel: string, callback: (message: unknown) => void): () => void {
    const prefixedChannel = this.prefixKey(channel)

    if (!this.subscribers.has(prefixedChannel)) {
      this.subscribers.set(prefixedChannel, new Set())

      // Setup subscription
      this.getClient().then((client) => {
        client.subscribe(prefixedChannel, (message: string) => {
          const callbacks = this.subscribers.get(prefixedChannel)
          if (callbacks) {
            let parsed: unknown
            try {
              parsed = safeJsonParse(message)
            } catch {
              parsed = message
            }
            for (const cb of callbacks) {
              cb(parsed)
            }
          }
        })
      })
    }

    this.subscribers.get(prefixedChannel)!.add(callback)

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscribers.get(prefixedChannel)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.subscribers.delete(prefixedChannel)
          this.getClient().then((client) => {
            client.unsubscribe(prefixedChannel)
          })
        }
      }
    }
  }

  /**
   * Get cache context for request handlers
   */
  context(): CacheContext {
    return {
      get: this.get.bind(this),
      set: this.set.bind(this),
      del: this.del.bind(this),
      exists: this.exists.bind(this),
      incr: this.incr.bind(this),
      decr: this.decr.bind(this),
    }
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit()
      this.client = null
    }
  }
}

/**
 * Redis client interface
 */
interface RedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  setex(key: string, seconds: number, value: string): Promise<void>
  del(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  ttl(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<void>
  incrby(key: string, by: number): Promise<number>
  decrby(key: string, by: number): Promise<number>
  hset(key: string, field: string, value: string): Promise<void>
  hget(key: string, field: string): Promise<string | null>
  hgetall(key: string): Promise<Record<string, string> | null>
  hdel(key: string, field: string): Promise<void>
  lpush(key: string, value: string): Promise<number>
  rpush(key: string, value: string): Promise<number>
  lpop(key: string): Promise<string | null>
  rpop(key: string): Promise<string | null>
  lrange(key: string, start: number, stop: number): Promise<string[]>
  sadd(key: string, ...members: string[]): Promise<number>
  srem(key: string, ...members: string[]): Promise<number>
  smembers(key: string): Promise<string[]>
  sismember(key: string, member: string): Promise<boolean>
  publish(channel: string, message: string): Promise<void>
  subscribe(channel: string, callback: (message: string) => void): void
  unsubscribe(channel: string): void
  quit(): Promise<void>
}

/**
 * Create Redis client
 * Uses native TCP connection via Bun
 */
async function createRedisClient(options: CacheOptions): Promise<RedisClient> {
  const url = new URL(options.url)
  const host = url.hostname || 'localhost'
  const port = parseInt(url.port || '6379', 10)
  const password = url.password || undefined
  const db = url.pathname ? parseInt(url.pathname.slice(1), 10) : 0

  // Socket data for Redis connection
  interface SocketData {
    pendingResolve: ((value: unknown) => void) | null
    subscribeCallbacks: Map<string, (message: string) => void>
  }

  // Simple Redis protocol implementation
  const socket = await Bun.connect<SocketData>({
    hostname: host,
    port,
    data: {
      pendingResolve: null,
      subscribeCallbacks: new Map(),
    },
    socket: {
      data(socket, data) {
        // Handle incoming data
        const response = data.toString()
        const socketData = socket.data
        if (socketData.pendingResolve) {
          socketData.pendingResolve(parseRedisResponse(response))
          socketData.pendingResolve = null
        }
        if (socketData.subscribeCallbacks) {
          // Handle pub/sub messages
          const lines = response.split('\r\n')
          if (lines[0] === '*3' && lines[2] === '$7' && lines[3] === 'message') {
            const channel = lines[5]
            const message = lines[7]
            const callback = socketData.subscribeCallbacks.get(channel)
            if (callback) {
              callback(message)
            }
          }
        }
      },
      open() {},
      close() {},
      error(_socket, error) {
        console.error('Redis connection error:', error)
      },
    },
  })

  async function sendCommand(...args: (string | number)[]): Promise<unknown> {
    const command = encodeRedisCommand(args)
    return new Promise((resolve) => {
      socket.data.pendingResolve = resolve
      socket.write(command)
    })
  }

  // Authenticate if password provided
  if (password) {
    await sendCommand('AUTH', password)
  }

  // Select database if not 0
  if (db > 0) {
    await sendCommand('SELECT', db)
  }

  return {
    async get(key) {
      const result = await sendCommand('GET', key)
      return result as string | null
    },
    async set(key, value) {
      await sendCommand('SET', key, value)
    },
    async setex(key, seconds, value) {
      await sendCommand('SETEX', key, seconds, value)
    },
    async del(key) {
      await sendCommand('DEL', key)
    },
    async exists(key) {
      const result = await sendCommand('EXISTS', key)
      return result === 1
    },
    async ttl(key) {
      return (await sendCommand('TTL', key)) as number
    },
    async expire(key, seconds) {
      await sendCommand('EXPIRE', key, seconds)
    },
    async incrby(key, by) {
      return (await sendCommand('INCRBY', key, by)) as number
    },
    async decrby(key, by) {
      return (await sendCommand('DECRBY', key, by)) as number
    },
    async hset(key, field, value) {
      await sendCommand('HSET', key, field, value)
    },
    async hget(key, field) {
      const result = await sendCommand('HGET', key, field)
      return result as string | null
    },
    async hgetall(key) {
      const result = await sendCommand('HGETALL', key)
      if (!Array.isArray(result) || result.length === 0) return null
      const obj: Record<string, string> = {}
      for (let i = 0; i < result.length; i += 2) {
        obj[result[i]] = result[i + 1]
      }
      return obj
    },
    async hdel(key, field) {
      await sendCommand('HDEL', key, field)
    },
    async lpush(key, value) {
      return (await sendCommand('LPUSH', key, value)) as number
    },
    async rpush(key, value) {
      return (await sendCommand('RPUSH', key, value)) as number
    },
    async lpop(key) {
      const result = await sendCommand('LPOP', key)
      return result as string | null
    },
    async rpop(key) {
      const result = await sendCommand('RPOP', key)
      return result as string | null
    },
    async lrange(key, start, stop) {
      return (await sendCommand('LRANGE', key, start, stop)) as string[]
    },
    async sadd(key, ...members) {
      return (await sendCommand('SADD', key, ...members)) as number
    },
    async srem(key, ...members) {
      return (await sendCommand('SREM', key, ...members)) as number
    },
    async smembers(key) {
      return (await sendCommand('SMEMBERS', key)) as string[]
    },
    async sismember(key, member) {
      const result = await sendCommand('SISMEMBER', key, member)
      return result === 1
    },
    async publish(channel, message) {
      await sendCommand('PUBLISH', channel, message)
    },
    subscribe(channel, callback) {
      socket.data.subscribeCallbacks.set(channel, callback)
      sendCommand('SUBSCRIBE', channel)
    },
    unsubscribe(channel) {
      socket.data.subscribeCallbacks.delete(channel)
      sendCommand('UNSUBSCRIBE', channel)
    },
    async quit() {
      await sendCommand('QUIT')
      socket.end()
    },
  }
}

/**
 * Encode Redis command using RESP protocol
 */
function encodeRedisCommand(args: (string | number)[]): string {
  let command = `*${args.length}\r\n`
  for (const arg of args) {
    const str = String(arg)
    command += `$${str.length}\r\n${str}\r\n`
  }
  return command
}

/**
 * Parse Redis response
 */
function parseRedisResponse(response: string): unknown {
  const lines = response.split('\r\n')
  const type = lines[0][0]
  const value = lines[0].slice(1)

  switch (type) {
    case '+': // Simple string
      return value
    case '-': // Error
      throw new Error(value)
    case ':': // Integer
      return parseInt(value, 10)
    case '$': // Bulk string
      const len = parseInt(value, 10)
      if (len === -1) return null
      return lines[1]
    case '*': // Array
      const count = parseInt(value, 10)
      if (count === -1) return null
      const result: unknown[] = []
      let lineIndex = 1
      for (let i = 0; i < count; i++) {
        const itemType = lines[lineIndex][0]
        if (itemType === '$') {
          const itemLen = parseInt(lines[lineIndex].slice(1), 10)
          if (itemLen === -1) {
            result.push(null)
          } else {
            result.push(lines[lineIndex + 1])
            lineIndex++
          }
        } else if (itemType === ':') {
          result.push(parseInt(lines[lineIndex].slice(1), 10))
        }
        lineIndex++
      }
      return result
    default:
      return null
  }
}

/**
 * Cache entry point
 */
export const Cache = {
  /**
   * Create a new cache builder
   */
  create(name: string): CacheBuilder {
    return new CacheBuilder(name)
  },
}
