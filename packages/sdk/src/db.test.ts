/**
 * DB Builder Tests
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { DB } from './db'
import type { DBInstance, DBContext } from './types'
import { unlink } from 'node:fs/promises'

describe('DB', () => {
  describe('DB.create()', () => {
    test('creates a DB builder with name', () => {
      const builder = DB.create('test-db')
      expect(builder).toBeDefined()
    })
  })

  describe('DBBuilder', () => {
    test('configures SQLite connection', () => {
      const db = DB.create('sqlite-db')
        .sqlite(':memory:')
        .build()

      expect(db.name).toBe('sqlite-db')
      expect(db.type).toBe('sqlite')
    })

    test('configures PostgreSQL connection', () => {
      const db = DB.create('postgres-db')
        .postgres('postgres://localhost:5432/test')
        .build()

      expect(db.name).toBe('postgres-db')
      expect(db.type).toBe('postgres')
    })

    test('configures MySQL connection', () => {
      const db = DB.create('mysql-db')
        .mysql('mysql://localhost:3306/test')
        .build()

      expect(db.name).toBe('mysql-db')
      expect(db.type).toBe('mysql')
    })

    test('configures connection pool', () => {
      const db = DB.create('pooled')
        .sqlite(':memory:')
        .pool({ min: 2, max: 10 })
        .build()

      expect(db.name).toBe('pooled')
    })

    test('enables tracing', () => {
      const db = DB.create('traced')
        .sqlite(':memory:')
        .trace()
        .build()

      expect(db.name).toBe('traced')
    })

    test('throws error without connection type', () => {
      expect(() => {
        DB.create('incomplete').build()
      }).toThrow('requires a connection type and URL')
    })
  })

  describe('SQLite Integration', () => {
    const testDbPath = './.test-db-' + Date.now() + '.sqlite'
    let db: DBInstance

    beforeEach(async () => {
      db = DB.create('test')
        .sqlite(testDbPath)
        .build()

      // Create test table
      await db.query(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `)
    })

    afterEach(async () => {
      await db.close()
      try {
        await unlink(testDbPath)
      } catch {
        // Ignore if file doesn't exist
      }
    })

    test('executes query with parameters', async () => {
      await db.query(
        'INSERT INTO users (name, email) VALUES (?, ?)',
        ['Alice', 'alice@example.com']
      )

      const users = await db.query<{ id: number; name: string; email: string }>(
        'SELECT * FROM users WHERE email = ?',
        ['alice@example.com']
      )

      expect(users).toHaveLength(1)
      expect(users[0].name).toBe('Alice')
      expect(users[0].email).toBe('alice@example.com')
    })

    test('returns multiple rows', async () => {
      await db.query('INSERT INTO users (name, email) VALUES (?, ?)', ['Alice', 'alice@example.com'])
      await db.query('INSERT INTO users (name, email) VALUES (?, ?)', ['Bob', 'bob@example.com'])
      await db.query('INSERT INTO users (name, email) VALUES (?, ?)', ['Charlie', 'charlie@example.com'])

      const users = await db.query<{ name: string }>('SELECT name FROM users ORDER BY name')

      expect(users).toHaveLength(3)
      expect(users[0].name).toBe('Alice')
      expect(users[1].name).toBe('Bob')
      expect(users[2].name).toBe('Charlie')
    })

    test('returns empty array for no results', async () => {
      const users = await db.query('SELECT * FROM users WHERE id = ?', [999])
      expect(users).toHaveLength(0)
    })

    test('handles transactions', async () => {
      await db.transaction(async (tx: DBContext) => {
        await tx.query('INSERT INTO users (name, email) VALUES (?, ?)', ['Alice', 'alice@example.com'])
        await tx.query('INSERT INTO users (name, email) VALUES (?, ?)', ['Bob', 'bob@example.com'])
      })

      const users = await db.query('SELECT * FROM users')
      expect(users).toHaveLength(2)
    })

    test('rolls back failed transactions', async () => {
      try {
        await db.transaction(async (tx: DBContext) => {
          await tx.query('INSERT INTO users (name, email) VALUES (?, ?)', ['Alice', 'alice@example.com'])
          throw new Error('Simulated failure')
        })
      } catch {
        // Expected
      }

      const users = await db.query('SELECT * FROM users')
      expect(users).toHaveLength(0)
    })

    test('supports nested transactions', async () => {
      await db.transaction(async (tx: DBContext) => {
        await tx.query('INSERT INTO users (name, email) VALUES (?, ?)', ['Alice', 'alice@example.com'])

        await tx.transaction(async (innerTx: DBContext) => {
          await innerTx.query('INSERT INTO users (name, email) VALUES (?, ?)', ['Bob', 'bob@example.com'])
        })
      })

      const users = await db.query('SELECT * FROM users')
      expect(users).toHaveLength(2)
    })

    test('closes connection cleanly', async () => {
      const tempDb = DB.create('temp').sqlite(':memory:').build()
      await tempDb.query('SELECT 1')
      await tempDb.close()
      // Should not throw
    })
  })

  describe('In-memory SQLite', () => {
    test('creates in-memory database', async () => {
      const db = DB.create('memory')
        .sqlite(':memory:')
        .build()

      await db.query('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)')
      await db.query('INSERT INTO test (value) VALUES (?)', ['hello'])

      const rows = await db.query<{ value: string }>('SELECT value FROM test')
      expect(rows[0].value).toBe('hello')

      await db.close()
    })

    test('each connection gets separate database', async () => {
      const db1 = DB.create('memory1').sqlite(':memory:').build()
      const db2 = DB.create('memory2').sqlite(':memory:').build()

      await db1.query('CREATE TABLE test (id INTEGER)')
      await db1.query('INSERT INTO test (id) VALUES (1)')

      // db2 should not see db1's table
      await expect(db2.query('SELECT * FROM test')).rejects.toThrow()

      await db1.close()
      await db2.close()
    })
  })

  describe('Query patterns', () => {
    let db: DBInstance

    beforeEach(async () => {
      db = DB.create('patterns').sqlite(':memory:').build()
      await db.query(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY,
          name TEXT,
          price REAL,
          stock INTEGER
        )
      `)
      await db.query('INSERT INTO products (name, price, stock) VALUES (?, ?, ?)', ['Widget', 9.99, 100])
      await db.query('INSERT INTO products (name, price, stock) VALUES (?, ?, ?)', ['Gadget', 19.99, 50])
      await db.query('INSERT INTO products (name, price, stock) VALUES (?, ?, ?)', ['Gizmo', 29.99, 25])
    })

    afterEach(async () => {
      await db.close()
    })

    test('aggregate queries', async () => {
      const result = await db.query<{ total: number }>('SELECT SUM(price * stock) as total FROM products')
      expect(result[0].total).toBeGreaterThan(0)
    })

    test('filtered queries', async () => {
      const expensive = await db.query<{ name: string }>(
        'SELECT name FROM products WHERE price > ?',
        [15]
      )
      expect(expensive).toHaveLength(2)
    })

    test('ordered queries', async () => {
      const ordered = await db.query<{ name: string }>(
        'SELECT name FROM products ORDER BY price DESC'
      )
      expect(ordered[0].name).toBe('Gizmo')
    })

    test('limited queries', async () => {
      const limited = await db.query<{ name: string }>(
        'SELECT name FROM products LIMIT ?',
        [2]
      )
      expect(limited).toHaveLength(2)
    })

    test('update queries', async () => {
      await db.query('UPDATE products SET stock = stock - 1 WHERE name = ?', ['Widget'])
      const result = await db.query<{ stock: number }>(
        'SELECT stock FROM products WHERE name = ?',
        ['Widget']
      )
      expect(result[0].stock).toBe(99)
    })

    test('delete queries', async () => {
      await db.query('DELETE FROM products WHERE name = ?', ['Widget'])
      const result = await db.query('SELECT * FROM products')
      expect(result).toHaveLength(2)
    })
  })
})
