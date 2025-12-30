/**
 * PostgreSQL Cache
 *
 * Redis-compatible cache using PostgreSQL UNLOGGED tables.
 * 2x faster writes than logged tables, acceptable for cache use cases.
 *
 * @example
 * ```typescript
 * import { PGCache, DB } from '@onepipe/sdk'
 *
 * const db = DB.create('main').postgres(process.env.DATABASE_URL).build()
 * const cache = await PGCache.create('cache').db(db).build()
 *
 * await cache.set('user:123', { name: 'Alice' }, { ttl: 300 })
 * const user = await cache.get('user:123')
 * ```
 */

import type { DBInstance, CacheContext } from './types'
import { registerPrimitive } from './manifest'

export interface PGCacheOptions {
  name: string
  db?: DBInstance
  prefix?: string
  defaultTtl?: number
  cleanupInterval?: number // seconds, 0 = disabled
}

export interface PGCacheInstance {
  readonly name: string
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, options?: { ttl?: number }): Promise<void>
  del(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  ttl(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<void>
  incr(key: string, by?: number): Promise<number>
  decr(key: string, by?: number): Promise<number>
  // Hash operations
  hset(key: string, field: string, value: unknown): Promise<void>
  hget<T>(key: string, field: string): Promise<T | null>
  hgetall<T>(key: string): Promise<T | null>
  hdel(key: string, field: string): Promise<void>
  // List operations
  lpush<T>(key: string, value: T): Promise<number>
  rpush<T>(key: string, value: T): Promise<number>
  lpop<T>(key: string): Promise<T | null>
  rpop<T>(key: string): Promise<T | null>
  lrange<T>(key: string, start: number, stop: number): Promise<T[]>
  // Set operations
  sadd(key: string, ...members: string[]): Promise<number>
  srem(key: string, ...members: string[]): Promise<number>
  smembers(key: string): Promise<string[]>
  sismember(key: string, member: string): Promise<boolean>
  // Cleanup
  cleanup(): Promise<number>
  // Context for REST handlers
  context(): CacheContext
  close(): Promise<void>
}

/**
 * PGCache Builder
 */
class PGCacheBuilder {
  private options: PGCacheOptions

  constructor(name: string) {
    this.options = {
      name,
      prefix: '',
      defaultTtl: 0,
      cleanupInterval: 60, // cleanup every 60 seconds by default
    }
  }

  /**
   * Set the database connection
   */
  db(database: DBInstance): this {
    if (database.type !== 'postgres') {
      throw new Error('PGCache requires PostgreSQL database')
    }
    this.options.db = database
    return this
  }

  /**
   * Set key prefix for namespacing
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
   * Set cleanup interval in seconds (0 = disabled)
   */
  cleanupInterval(seconds: number): this {
    this.options.cleanupInterval = seconds
    return this
  }

  /**
   * Build the cache instance
   */
  async build(): Promise<PGCacheInstance> {
    if (!this.options.db) {
      throw new Error('PGCache requires a database connection. Use .db(database)')
    }

    const instance = new PGCacheInstanceImpl(this.options)
    await instance.initialize()

    registerPrimitive({
      primitive: 'cache',
      name: this.options.name,
      config: { backend: 'postgres' },
    })

    return instance
  }
}

/**
 * PGCache Instance Implementation
 */
class PGCacheInstanceImpl implements PGCacheInstance {
  readonly name: string
  private db: DBInstance
  private prefix: string
  private defaultTtl: number
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: PGCacheOptions) {
    this.name = options.name
    this.db = options.db!
    this.prefix = options.prefix || ''
    this.defaultTtl = options.defaultTtl || 0

    // Start cleanup timer if enabled
    if (options.cleanupInterval && options.cleanupInterval > 0) {
      this.cleanupTimer = setInterval(
        () => this.cleanup().catch(console.error),
        options.cleanupInterval * 1000
      )
    }
  }

  /**
   * Initialize the cache tables
   */
  async initialize(): Promise<void> {
    // Create UNLOGGED table for cache (2x faster writes, data lost on crash - acceptable for cache)
    await this.db.query(`
      CREATE UNLOGGED TABLE IF NOT EXISTS _onepipe_cache (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // Index for TTL cleanup
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_onepipe_cache_expires
      ON _onepipe_cache(expires_at)
      WHERE expires_at IS NOT NULL
    `)

    // Table for hash operations
    await this.db.query(`
      CREATE UNLOGGED TABLE IF NOT EXISTS _onepipe_cache_hash (
        key TEXT NOT NULL,
        field TEXT NOT NULL,
        value JSONB NOT NULL,
        PRIMARY KEY (key, field)
      )
    `)

    // Table for list operations
    await this.db.query(`
      CREATE UNLOGGED TABLE IF NOT EXISTS _onepipe_cache_list (
        key TEXT NOT NULL,
        idx SERIAL,
        value JSONB NOT NULL,
        PRIMARY KEY (key, idx)
      )
    `)

    // Table for set operations
    await this.db.query(`
      CREATE UNLOGGED TABLE IF NOT EXISTS _onepipe_cache_set (
        key TEXT NOT NULL,
        member TEXT NOT NULL,
        PRIMARY KEY (key, member)
      )
    `)
  }

  private prefixKey(key: string): string {
    return this.prefix ? `${this.prefix}${key}` : key
  }

  // ============================================================================
  // Basic Operations
  // ============================================================================

  async get<T>(key: string): Promise<T | null> {
    const prefixedKey = this.prefixKey(key)
    const rows = await this.db.query<{ value: T }>(
      `SELECT value FROM _onepipe_cache
       WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [prefixedKey]
    )
    return rows[0]?.value ?? null
  }

  async set<T>(key: string, value: T, options?: { ttl?: number }): Promise<void> {
    const prefixedKey = this.prefixKey(key)
    const ttl = options?.ttl ?? this.defaultTtl
    const expiresAt = ttl > 0 ? new Date(Date.now() + ttl * 1000) : null

    await this.db.query(
      `INSERT INTO _onepipe_cache (key, value, expires_at, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = $2,
         expires_at = $3,
         updated_at = NOW()`,
      [prefixedKey, JSON.stringify(value), expiresAt]
    )
  }

  async del(key: string): Promise<void> {
    const prefixedKey = this.prefixKey(key)
    await this.db.query('DELETE FROM _onepipe_cache WHERE key = $1', [prefixedKey])
  }

  async exists(key: string): Promise<boolean> {
    const prefixedKey = this.prefixKey(key)
    const rows = await this.db.query<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM _onepipe_cache
        WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())
      ) as exists`,
      [prefixedKey]
    )
    return rows[0]?.exists ?? false
  }

  async ttl(key: string): Promise<number> {
    const prefixedKey = this.prefixKey(key)
    const rows = await this.db.query<{ ttl: number }>(
      `SELECT EXTRACT(EPOCH FROM (expires_at - NOW()))::int as ttl
       FROM _onepipe_cache
       WHERE key = $1`,
      [prefixedKey]
    )
    if (!rows[0]) return -2 // Key doesn't exist
    if (rows[0].ttl === null) return -1 // No expiry
    return Math.max(0, rows[0].ttl)
  }

  async expire(key: string, seconds: number): Promise<void> {
    const prefixedKey = this.prefixKey(key)
    const expiresAt = new Date(Date.now() + seconds * 1000)
    await this.db.query(
      'UPDATE _onepipe_cache SET expires_at = $2 WHERE key = $1',
      [prefixedKey, expiresAt]
    )
  }

  async incr(key: string, by = 1): Promise<number> {
    const prefixedKey = this.prefixKey(key)
    const rows = await this.db.query<{ value: number }>(
      `INSERT INTO _onepipe_cache (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = (COALESCE(_onepipe_cache.value::text::int, 0) + $3)::text::jsonb,
         updated_at = NOW()
       RETURNING value::text::int as value`,
      [prefixedKey, by, by]
    )
    return rows[0]?.value ?? by
  }

  async decr(key: string, by = 1): Promise<number> {
    return this.incr(key, -by)
  }

  // ============================================================================
  // Hash Operations
  // ============================================================================

  async hset(key: string, field: string, value: unknown): Promise<void> {
    const prefixedKey = this.prefixKey(key)
    await this.db.query(
      `INSERT INTO _onepipe_cache_hash (key, field, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (key, field) DO UPDATE SET value = $3`,
      [prefixedKey, field, JSON.stringify(value)]
    )
  }

  async hget<T>(key: string, field: string): Promise<T | null> {
    const prefixedKey = this.prefixKey(key)
    const rows = await this.db.query<{ value: T }>(
      'SELECT value FROM _onepipe_cache_hash WHERE key = $1 AND field = $2',
      [prefixedKey, field]
    )
    return rows[0]?.value ?? null
  }

  async hgetall<T>(key: string): Promise<T | null> {
    const prefixedKey = this.prefixKey(key)
    const rows = await this.db.query<{ field: string; value: unknown }>(
      'SELECT field, value FROM _onepipe_cache_hash WHERE key = $1',
      [prefixedKey]
    )
    if (rows.length === 0) return null
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      result[row.field] = row.value
    }
    return result as T
  }

  async hdel(key: string, field: string): Promise<void> {
    const prefixedKey = this.prefixKey(key)
    await this.db.query(
      'DELETE FROM _onepipe_cache_hash WHERE key = $1 AND field = $2',
      [prefixedKey, field]
    )
  }

  // ============================================================================
  // List Operations
  // ============================================================================

  async lpush<T>(key: string, value: T): Promise<number> {
    const prefixedKey = this.prefixKey(key)
    await this.db.query(
      `INSERT INTO _onepipe_cache_list (key, idx, value)
       VALUES ($1, (SELECT COALESCE(MIN(idx), 0) - 1 FROM _onepipe_cache_list WHERE key = $1), $2)`,
      [prefixedKey, JSON.stringify(value)]
    )
    const rows = await this.db.query<{ count: number }>(
      'SELECT COUNT(*)::int as count FROM _onepipe_cache_list WHERE key = $1',
      [prefixedKey]
    )
    return rows[0]?.count ?? 0
  }

  async rpush<T>(key: string, value: T): Promise<number> {
    const prefixedKey = this.prefixKey(key)
    await this.db.query(
      `INSERT INTO _onepipe_cache_list (key, idx, value)
       VALUES ($1, (SELECT COALESCE(MAX(idx), 0) + 1 FROM _onepipe_cache_list WHERE key = $1), $2)`,
      [prefixedKey, JSON.stringify(value)]
    )
    const rows = await this.db.query<{ count: number }>(
      'SELECT COUNT(*)::int as count FROM _onepipe_cache_list WHERE key = $1',
      [prefixedKey]
    )
    return rows[0]?.count ?? 0
  }

  async lpop<T>(key: string): Promise<T | null> {
    const prefixedKey = this.prefixKey(key)
    const rows = await this.db.query<{ value: T }>(
      `DELETE FROM _onepipe_cache_list
       WHERE key = $1 AND idx = (SELECT MIN(idx) FROM _onepipe_cache_list WHERE key = $1)
       RETURNING value`,
      [prefixedKey]
    )
    return rows[0]?.value ?? null
  }

  async rpop<T>(key: string): Promise<T | null> {
    const prefixedKey = this.prefixKey(key)
    const rows = await this.db.query<{ value: T }>(
      `DELETE FROM _onepipe_cache_list
       WHERE key = $1 AND idx = (SELECT MAX(idx) FROM _onepipe_cache_list WHERE key = $1)
       RETURNING value`,
      [prefixedKey]
    )
    return rows[0]?.value ?? null
  }

  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    const prefixedKey = this.prefixKey(key)
    // Handle negative indices like Redis
    const rows = await this.db.query<{ value: T }>(
      `WITH indexed AS (
        SELECT value, ROW_NUMBER() OVER (ORDER BY idx) - 1 as pos
        FROM _onepipe_cache_list WHERE key = $1
      )
      SELECT value FROM indexed
      WHERE pos >= $2 AND pos <= CASE WHEN $3 < 0 THEN (SELECT MAX(pos) FROM indexed) + $3 + 1 ELSE $3 END
      ORDER BY pos`,
      [prefixedKey, start, stop]
    )
    return rows.map(r => r.value)
  }

  // ============================================================================
  // Set Operations
  // ============================================================================

  async sadd(key: string, ...members: string[]): Promise<number> {
    const prefixedKey = this.prefixKey(key)
    let added = 0
    for (const member of members) {
      const result = await this.db.query<{ inserted: boolean }>(
        `INSERT INTO _onepipe_cache_set (key, member)
         VALUES ($1, $2)
         ON CONFLICT (key, member) DO NOTHING
         RETURNING true as inserted`,
        [prefixedKey, member]
      )
      if (result.length > 0) added++
    }
    return added
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const prefixedKey = this.prefixKey(key)
    let removed = 0
    for (const member of members) {
      const result = await this.db.query(
        'DELETE FROM _onepipe_cache_set WHERE key = $1 AND member = $2 RETURNING member',
        [prefixedKey, member]
      )
      if (result.length > 0) removed++
    }
    return removed
  }

  async smembers(key: string): Promise<string[]> {
    const prefixedKey = this.prefixKey(key)
    const rows = await this.db.query<{ member: string }>(
      'SELECT member FROM _onepipe_cache_set WHERE key = $1',
      [prefixedKey]
    )
    return rows.map(r => r.member)
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const prefixedKey = this.prefixKey(key)
    const rows = await this.db.query<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM _onepipe_cache_set WHERE key = $1 AND member = $2
      ) as exists`,
      [prefixedKey, member]
    )
    return rows[0]?.exists ?? false
  }

  // ============================================================================
  // Cleanup & Utilities
  // ============================================================================

  /**
   * Remove expired cache entries
   * @returns Number of entries removed
   */
  async cleanup(): Promise<number> {
    const result = await this.db.query<{ count: number }>(
      `WITH deleted AS (
        DELETE FROM _onepipe_cache
        WHERE expires_at IS NOT NULL AND expires_at <= NOW()
        RETURNING 1
      )
      SELECT COUNT(*)::int as count FROM deleted`
    )
    return result[0]?.count ?? 0
  }

  /**
   * Get cache context for REST handlers
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
   * Close the cache (stop cleanup timer)
   */
  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }
}

/**
 * PGCache factory
 */
export const PGCache = {
  create(name: string): PGCacheBuilder {
    return new PGCacheBuilder(name)
  },
}
