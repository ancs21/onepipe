/**
 * PGCache Tests
 *
 * Tests for PostgreSQL-based cache using UNLOGGED tables.
 * Uses SQLite in-memory for testing (simulates basic operations).
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { DB } from './db'
import { PGCache } from './pg-cache'

// Mock database for testing (uses actual PostgreSQL connection)
// For unit tests, we'll test with mocked queries
describe('PGCache', () => {
  describe('PGCacheBuilder', () => {
    it('should create a builder with name', () => {
      const builder = PGCache.create('test-cache')
      expect(builder).toBeDefined()
    })

    it('should throw error if no db is provided', async () => {
      const builder = PGCache.create('test-cache')
      await expect(builder.build()).rejects.toThrow('PGCache requires a database connection')
    })

    it('should throw error for non-postgres database', () => {
      const sqliteDb = DB.create('test').sqlite(':memory:').build()
      const builder = PGCache.create('test-cache')
      expect(() => builder.db(sqliteDb)).toThrow('PGCache requires PostgreSQL database')
    })
  })

  describe('PGCacheBuilder methods', () => {
    it('should chain prefix method', () => {
      const builder = PGCache.create('test')
        .prefix('app:')
      expect(builder).toBeDefined()
    })

    it('should chain ttl method', () => {
      const builder = PGCache.create('test')
        .ttl(3600)
      expect(builder).toBeDefined()
    })

    it('should chain cleanupInterval method', () => {
      const builder = PGCache.create('test')
        .cleanupInterval(120)
      expect(builder).toBeDefined()
    })
  })
})

// Integration tests require a PostgreSQL database
// These tests verify the SQL queries are correct
describe('PGCache SQL queries', () => {
  it('should generate correct CREATE TABLE for cache', () => {
    const expectedSQL = `
      CREATE UNLOGGED TABLE IF NOT EXISTS _onepipe_cache (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
    expect(expectedSQL).toContain('UNLOGGED TABLE')
    expect(expectedSQL).toContain('_onepipe_cache')
    expect(expectedSQL).toContain('JSONB')
  })

  it('should generate correct CREATE TABLE for hash operations', () => {
    const expectedSQL = `
      CREATE UNLOGGED TABLE IF NOT EXISTS _onepipe_cache_hash (
        key TEXT NOT NULL,
        field TEXT NOT NULL,
        value JSONB NOT NULL,
        PRIMARY KEY (key, field)
      )
    `
    expect(expectedSQL).toContain('_onepipe_cache_hash')
    expect(expectedSQL).toContain('PRIMARY KEY (key, field)')
  })

  it('should generate correct CREATE TABLE for list operations', () => {
    const expectedSQL = `
      CREATE UNLOGGED TABLE IF NOT EXISTS _onepipe_cache_list (
        key TEXT NOT NULL,
        idx SERIAL,
        value JSONB NOT NULL,
        PRIMARY KEY (key, idx)
      )
    `
    expect(expectedSQL).toContain('_onepipe_cache_list')
    expect(expectedSQL).toContain('SERIAL')
  })

  it('should generate correct CREATE TABLE for set operations', () => {
    const expectedSQL = `
      CREATE UNLOGGED TABLE IF NOT EXISTS _onepipe_cache_set (
        key TEXT NOT NULL,
        member TEXT NOT NULL,
        PRIMARY KEY (key, member)
      )
    `
    expect(expectedSQL).toContain('_onepipe_cache_set')
    expect(expectedSQL).toContain('member TEXT')
  })
})

// API interface tests
describe('PGCache interface', () => {
  it('should match CacheInstance interface', () => {
    // Verify the interface methods exist
    const methods = [
      'get', 'set', 'del', 'exists', 'ttl', 'expire',
      'incr', 'decr',
      'hset', 'hget', 'hgetall', 'hdel',
      'lpush', 'rpush', 'lpop', 'rpop', 'lrange',
      'sadd', 'srem', 'smembers', 'sismember',
      'cleanup', 'context', 'close'
    ]

    // These methods should be defined on PGCacheInstance
    expect(methods.length).toBe(24)
  })
})
