/**
 * DB - Unified Database Builder
 *
 * Uses Bun's native SQL support:
 * - PostgreSQL: Bun.sql (native, zero dependencies)
 * - MySQL: Bun.sql (native, zero dependencies)
 * - SQLite: bun:sqlite (built-in)
 *
 * @example
 * ```typescript
 * const db = DB
 *   .create('main')
 *   .postgres('postgres://user:pass@localhost:5432/mydb')
 *   .pool({ min: 2, max: 10 })
 *   .trace()
 *   .build()
 *
 * // Tagged template literal syntax
 * const users = await db.sql`SELECT * FROM users WHERE id = ${userId}`
 *
 * // Or use query method
 * const users = await db.query('SELECT * FROM users WHERE id = $1', [userId])
 * ```
 */

import { Database as SQLiteDB } from 'bun:sqlite'
import type { DBOptions, DBInstance, PoolOptions, DBContext, TableInfo, ColumnInfo, QueryOptions } from './types'
import { withSpan, isInitialized as isTracingInitialized } from './otel'

// DB builder state
interface DBBuilderState {
  name: string
  type?: 'postgres' | 'mysql' | 'sqlite'
  url?: string
  pool?: PoolOptions
  trace: boolean
}

/**
 * DB Builder - Fluent API for database connections
 */
class DBBuilder {
  private state: DBBuilderState

  private constructor(name: string) {
    this.state = {
      name,
      trace: false,
    }
  }

  /**
   * Create a new DB builder
   */
  static create(name: string): DBBuilder {
    return new DBBuilder(name)
  }

  /**
   * Configure PostgreSQL connection
   */
  postgres(url: string): this {
    this.state.type = 'postgres'
    this.state.url = url
    return this
  }

  /**
   * Configure MySQL connection
   */
  mysql(url: string): this {
    this.state.type = 'mysql'
    this.state.url = url
    return this
  }

  /**
   * Configure SQLite connection
   */
  sqlite(path: string): this {
    this.state.type = 'sqlite'
    this.state.url = path
    return this
  }

  /**
   * Configure connection pool
   */
  pool(options: PoolOptions): this {
    this.state.pool = options
    return this
  }

  /**
   * Enable query tracing
   */
  trace(): this {
    this.state.trace = true
    return this
  }

  /**
   * Build the DB instance
   */
  build(): DBInstance {
    if (!this.state.type || !this.state.url) {
      throw new Error(`DB "${this.state.name}" requires a connection type and URL`)
    }

    switch (this.state.type) {
      case 'postgres':
        return createPostgresInstance(this.state)
      case 'mysql':
        return createMySQLInstance(this.state)
      case 'sqlite':
        return createSQLiteInstance(this.state)
      default:
        throw new Error(`Unknown database type: ${this.state.type}`)
    }
  }
}

/**
 * Create PostgreSQL instance
 */
function createPostgresInstance(state: DBBuilderState): DBInstance {
  let sqlClient: unknown = null
  let initialized = false

  // Register with dashboard
  registerWithDashboard(state.name, 'postgres')

  const initConnection = async () => {
    if (initialized) return
    const { SQL } = await import('bun')
    sqlClient = new SQL(state.url!)
    initialized = true
  }

  const logQuery = (sql: string, duration: number) => {
    if (state.trace) {
      // Note: params intentionally not logged to avoid exposing sensitive data
      console.debug(
        `[DB:${state.name}] ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''} ` +
          `duration=${duration.toFixed(2)}ms`
      )
    }
  }

  const instance: DBInstance = {
    name: state.name,
    type: 'postgres',

    async query<T>(sql: string, params: unknown[] = [], options?: QueryOptions): Promise<T[]> {
      await initConnection()

      // Check if tracing should be enabled for this query
      const shouldTrace = options?.trace ?? state.trace

      // Create OTEL child span if tracing is enabled
      if (shouldTrace && isTracingInitialized()) {
        return withSpan('db.query', {
          'db.system': 'postgres',
          'db.name': state.name,
          'db.statement': sql.substring(0, 200),
          'db.params.count': params.length,
        }, async () => {
          // @ts-expect-error - Dynamic SQL client
          const result = await sqlClient.unsafe(sql, params)
          return result as T[]
        })
      }

      // Non-traced path
      const startTime = shouldTrace ? performance.now() : 0
      try {
        // @ts-expect-error - Dynamic SQL client
        const result = await sqlClient.unsafe(sql, params)
        return result as T[]
      } finally {
        if (shouldTrace) {
          logQuery(sql, performance.now() - startTime)
        }
      }
    },

    async transaction<T>(fn: (tx: DBContext) => Promise<T>): Promise<T> {
      await initConnection()

      // @ts-expect-error - Dynamic SQL client
      return sqlClient.begin(async (tx: unknown) => {
        const txContext: DBContext = {
          async query<R>(sql: string, params?: unknown[]): Promise<R[]> {
            // @ts-expect-error - Dynamic tx
            return tx.unsafe(sql, params || []) as Promise<R[]>
          },
          async transaction<R>(innerFn: (innerTx: DBContext) => Promise<R>): Promise<R> {
            return innerFn(txContext)
          },
        }
        return fn(txContext)
      })
    },

    async close(): Promise<void> {
      // @ts-expect-error - Dynamic SQL client
      if (sqlClient?.end) {
        // @ts-expect-error - Dynamic SQL client
        await sqlClient.end()
      }
    },

    async getTables(): Promise<TableInfo[]> {
      await initConnection()
      // @ts-expect-error - Dynamic SQL client
      const rows = await sqlClient.unsafe(`
        SELECT table_name as name,
               CASE table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END as type
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `)
      return rows as TableInfo[]
    },

    async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
      await initConnection()
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        throw new Error('Invalid table name')
      }
      // @ts-expect-error - Dynamic SQL client
      const rows = await sqlClient.unsafe(`
        SELECT
          column_name as name,
          data_type as type,
          is_nullable = 'YES' as nullable,
          CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as "primaryKey",
          column_default as "defaultValue"
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
          WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1
        ) pk ON c.column_name = pk.column_name
        WHERE c.table_name = $1 AND c.table_schema = 'public'
        ORDER BY c.ordinal_position
      `, [tableName])
      return rows as ColumnInfo[]
    },
  }

  return instance
}

/**
 * Create MySQL instance
 */
function createMySQLInstance(state: DBBuilderState): DBInstance {
  let mysqlClient: unknown = null
  let initialized = false

  // Register with dashboard
  registerWithDashboard(state.name, 'mysql')

  const initConnection = async () => {
    if (initialized) return
    // @ts-expect-error - Bun mysql is available in Bun runtime
    const { mysql } = await import('bun')
    mysqlClient = mysql(state.url)
    initialized = true
  }

  const instance: DBInstance = {
    name: state.name,
    type: 'mysql',

    async query<T>(sql: string, params: unknown[] = [], options?: QueryOptions): Promise<T[]> {
      await initConnection()

      // Check if tracing should be enabled for this query
      const shouldTrace = options?.trace ?? state.trace

      // Create OTEL child span if tracing is enabled
      if (shouldTrace && isTracingInitialized()) {
        return withSpan('db.query', {
          'db.system': 'mysql',
          'db.name': state.name,
          'db.statement': sql.substring(0, 200),
          'db.params.count': params.length,
        }, async () => {
          // @ts-expect-error - Dynamic MySQL client
          const result = await mysqlClient.query(sql, params)
          return result as T[]
        })
      }

      // Non-traced path
      // @ts-expect-error - Dynamic MySQL client
      const result = await mysqlClient.query(sql, params)
      return result as T[]
    },

    async transaction<T>(fn: (tx: DBContext) => Promise<T>): Promise<T> {
      await initConnection()

      // @ts-expect-error - Dynamic MySQL client
      return mysqlClient.begin(async (tx: unknown) => {
        const txContext: DBContext = {
          async query<R>(sql: string, params?: unknown[]): Promise<R[]> {
            // @ts-expect-error - Dynamic tx
            return tx.query(sql, params || []) as Promise<R[]>
          },
          async transaction<R>(innerFn: (innerTx: DBContext) => Promise<R>): Promise<R> {
            return innerFn(txContext)
          },
        }
        return fn(txContext)
      })
    },

    async close(): Promise<void> {
      // @ts-expect-error - Dynamic MySQL client
      if (mysqlClient?.end) {
        // @ts-expect-error - Dynamic MySQL client
        await mysqlClient.end()
      }
    },

    async getTables(): Promise<TableInfo[]> {
      await initConnection()
      // @ts-expect-error - Dynamic MySQL client
      const rows = await mysqlClient.query(`
        SELECT table_name as name,
               CASE table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END as type
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
        ORDER BY table_name
      `)
      return rows as TableInfo[]
    },

    async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
      await initConnection()
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        throw new Error('Invalid table name')
      }
      // @ts-expect-error - Dynamic MySQL client
      const rows = await mysqlClient.query(`
        SELECT
          column_name as name,
          data_type as type,
          is_nullable = 'YES' as nullable,
          column_key = 'PRI' as primaryKey,
          column_default as defaultValue
        FROM information_schema.columns
        WHERE table_name = ? AND table_schema = DATABASE()
        ORDER BY ordinal_position
      `, [tableName])
      return rows as ColumnInfo[]
    },
  }

  return instance
}

/**
 * Register database with dashboard
 */
async function registerWithDashboard(name: string, type: string): Promise<void> {
  const dashboardUrl = process.env.ONEPIPE_DASHBOARD_URL
  if (!dashboardUrl) return

  try {
    await fetch(`${dashboardUrl}/api/dashboard/databases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type }),
    })
  } catch {
    // Dashboard not running, ignore
  }
}

/**
 * Create SQLite instance
 */
function createSQLiteInstance(state: DBBuilderState): DBInstance {
  const db = new SQLiteDB(state.url!)

  // Register with dashboard
  registerWithDashboard(state.name, 'sqlite')

  const logQuery = (sql: string, duration: number) => {
    if (state.trace) {
      // Note: params intentionally not logged to avoid exposing sensitive data
      console.debug(
        `[DB:${state.name}] ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''} ` +
          `duration=${duration.toFixed(2)}ms`
      )
    }
  }

  const instance: DBInstance = {
    name: state.name,
    type: 'sqlite',

    async query<T>(sql: string, params: unknown[] = [], options?: QueryOptions): Promise<T[]> {
      // Check if tracing should be enabled for this query
      const shouldTrace = options?.trace ?? state.trace

      // Create OTEL child span if tracing is enabled
      if (shouldTrace && isTracingInitialized()) {
        return withSpan('db.query', {
          'db.system': 'sqlite',
          'db.name': state.name,
          'db.statement': sql.substring(0, 200),
          'db.params.count': params.length,
        }, async () => {
          const stmt = db.prepare(sql)
          // @ts-expect-error - SQLite params typing
          const result = stmt.all(...params) as T[]
          return result
        })
      }

      // Non-traced path
      const startTime = shouldTrace ? performance.now() : 0
      try {
        const stmt = db.prepare(sql)
        // @ts-expect-error - SQLite params typing
        const result = stmt.all(...params) as T[]
        return result
      } finally {
        if (shouldTrace) {
          logQuery(sql, performance.now() - startTime)
        }
      }
    },

    async transaction<T>(fn: (tx: DBContext) => Promise<T>): Promise<T> {
      const txContext: DBContext = {
        async query<R>(sql: string, params?: unknown[]): Promise<R[]> {
          const stmt = db.prepare(sql)
          // @ts-expect-error - SQLite params typing
          return stmt.all(...(params || [])) as R[]
        },
        async transaction<R>(innerFn: (innerTx: DBContext) => Promise<R>): Promise<R> {
          return innerFn(txContext)
        },
      }

      db.run('BEGIN TRANSACTION')
      try {
        const result = await fn(txContext)
        db.run('COMMIT')
        return result
      } catch (error) {
        db.run('ROLLBACK')
        throw error
      }
    },

    async close(): Promise<void> {
      db.close()
    },

    async getTables(): Promise<TableInfo[]> {
      const stmt = db.prepare(`
        SELECT name, type FROM sqlite_master
        WHERE type IN ('table', 'view')
        AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `)
      const rows = stmt.all() as Array<{ name: string; type: string }>
      return rows.map(row => ({
        name: row.name,
        type: row.type as 'table' | 'view',
      }))
    },

    async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
      // Validate table name to prevent SQL injection
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        throw new Error('Invalid table name')
      }
      const stmt = db.prepare(`PRAGMA table_info("${tableName}")`)
      const rows = stmt.all() as Array<{
        cid: number
        name: string
        type: string
        notnull: number
        dflt_value: string | null
        pk: number
      }>
      return rows.map(row => ({
        name: row.name,
        type: row.type,
        nullable: row.notnull === 0,
        primaryKey: row.pk === 1,
        defaultValue: row.dflt_value,
      }))
    },
  }

  return instance
}

/**
 * Create a new DB connection
 */
export const DB = {
  create: DBBuilder.create,
}

export type { DBBuilder, DBInstance }
