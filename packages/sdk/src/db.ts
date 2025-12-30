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
 *
 * @example Drizzle ORM integration
 * ```typescript
 * import * as schema from './schema'
 *
 * const db = DB
 *   .create('main')
 *   .drizzle(schema)   // Enable Drizzle ORM
 *   .postgres('postgres://user:pass@localhost:5432/mydb')
 *   .build()
 *
 * // Type-safe queries
 * const users = await db.drizzle.select().from(schema.users)
 * await db.drizzle.insert(schema.users).values({ id: '1', name: 'Alice' })
 *
 * // Raw SQL still available
 * await db.query('SELECT * FROM users WHERE id = $1', ['1'])
 * ```
 */

import { Database as SQLiteDB } from 'bun:sqlite'
import type { DBOptions, DBInstance, DrizzleDBInstance, PoolOptions, DBContext, TableInfo, ColumnInfo, QueryOptions } from './types'
import { withSpan, isInitialized as isTracingInitialized } from './otel'
import { registerPrimitive, type InfrastructureType } from './manifest'

// DB builder state
interface DBBuilderState {
  name: string
  type?: 'postgres' | 'mysql' | 'sqlite'
  url?: string
  pool?: PoolOptions
  trace: boolean
  drizzleSchema?: Record<string, unknown>
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
   * Enable Drizzle ORM integration
   * @param schema - Drizzle schema object containing table definitions
   * @returns Builder with Drizzle support
   */
  drizzle<TSchema extends Record<string, unknown>>(schema: TSchema): DrizzleDBBuilder<TSchema> {
    this.state.drizzleSchema = schema
    return new DrizzleDBBuilder(this.state) as DrizzleDBBuilder<TSchema>
  }

  /**
   * Build the DB instance
   */
  build(): DBInstance {
    if (!this.state.type || !this.state.url) {
      throw new Error(`DB "${this.state.name}" requires a connection type and URL`)
    }

    // Register with manifest for CLI auto-discovery
    const infraMap: Record<string, InfrastructureType | undefined> = {
      postgres: 'postgresql',
      mysql: 'mysql',
      sqlite: undefined, // No infrastructure needed
    }
    registerPrimitive({
      primitive: 'db',
      name: this.state.name,
      infrastructure: infraMap[this.state.type],
      config: { type: this.state.type },
    })

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
 * Drizzle DB Builder - Fluent API for database connections with Drizzle ORM
 */
class DrizzleDBBuilder<TSchema extends Record<string, unknown>> {
  private state: DBBuilderState

  constructor(state: DBBuilderState) {
    this.state = state
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
   * Build the DB instance with Drizzle ORM
   */
  build(): DrizzleDBInstance<TSchema> {
    if (!this.state.type || !this.state.url) {
      throw new Error(`DB "${this.state.name}" requires a connection type and URL`)
    }

    // Register with manifest for CLI auto-discovery
    const infraMap: Record<string, InfrastructureType | undefined> = {
      postgres: 'postgresql',
      mysql: 'mysql',
      sqlite: undefined, // No infrastructure needed
    }
    registerPrimitive({
      primitive: 'db',
      name: this.state.name,
      infrastructure: infraMap[this.state.type],
      config: { type: this.state.type, drizzle: true },
    })

    switch (this.state.type) {
      case 'postgres':
        return createPostgresDrizzleInstance(this.state) as DrizzleDBInstance<TSchema>
      case 'mysql':
        throw new Error('Drizzle ORM with MySQL is not yet supported')
      case 'sqlite':
        return createSQLiteDrizzleInstance(this.state) as DrizzleDBInstance<TSchema>
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

    // Build connection options with pooling
    const connectionOptions: Record<string, unknown> = {}
    if (state.pool) {
      if (state.pool.max !== undefined) {
        connectionOptions.max = state.pool.max
      }
      if (state.pool.idleTimeout !== undefined) {
        connectionOptions.idleTimeout = state.pool.idleTimeout
      }
      if (state.pool.connectionTimeout !== undefined) {
        connectionOptions.connectionTimeout = state.pool.connectionTimeout
      }
    }

    // Create SQL client with or without options
    if (Object.keys(connectionOptions).length > 0) {
      sqlClient = new SQL(state.url!, connectionOptions)
    } else {
      sqlClient = new SQL(state.url!)
    }
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
 * Create PostgreSQL instance with Drizzle ORM
 */
function createPostgresDrizzleInstance(state: DBBuilderState): DrizzleDBInstance {
  let sqlClient: unknown = null
  let drizzleInstance: unknown = null
  let initialized = false

  // Register with dashboard
  registerWithDashboard(state.name, 'postgres')

  const initConnection = async () => {
    if (initialized) return
    const { SQL } = await import('bun')

    // Build connection options with pooling
    const connectionOptions: Record<string, unknown> = {}
    if (state.pool) {
      if (state.pool.max !== undefined) {
        connectionOptions.max = state.pool.max
      }
      if (state.pool.idleTimeout !== undefined) {
        connectionOptions.idleTimeout = state.pool.idleTimeout
      }
      if (state.pool.connectionTimeout !== undefined) {
        connectionOptions.connectionTimeout = state.pool.connectionTimeout
      }
    }

    // Create SQL client with or without options
    if (Object.keys(connectionOptions).length > 0) {
      sqlClient = new SQL(state.url!, connectionOptions)
    } else {
      sqlClient = new SQL(state.url!)
    }

    // Initialize Drizzle ORM
    const { drizzle } = await import('drizzle-orm/bun-sql')
    drizzleInstance = drizzle(sqlClient as any, { schema: state.drizzleSchema })
    initialized = true
  }

  const logQuery = (sql: string, duration: number) => {
    if (state.trace) {
      console.debug(
        `[DB:${state.name}] ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''} ` +
          `duration=${duration.toFixed(2)}ms`
      )
    }
  }

  // Create a lazy getter for drizzle
  const getDrizzle = async () => {
    await initConnection()
    return drizzleInstance
  }

  const instance: DrizzleDBInstance = {
    name: state.name,
    type: 'postgres',

    // Drizzle instance (lazy initialized)
    get drizzle() {
      // Note: This is synchronous getter that returns the already-initialized drizzle instance
      // User should await their first operation to ensure initialization
      if (!drizzleInstance) {
        throw new Error('Drizzle not initialized. Make sure to await your first database operation.')
      }
      return drizzleInstance as any
    },

    async query<T>(sql: string, params: unknown[] = [], options?: QueryOptions): Promise<T[]> {
      await initConnection()

      const shouldTrace = options?.trace ?? state.trace

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

  // Initialize connection on first access to drizzle
  // This creates a proxy that triggers initialization on any property access
  return new Proxy(instance, {
    get(target, prop) {
      if (prop === 'drizzle') {
        // For drizzle property, trigger init and return
        // This is a bit tricky - we need to ensure init happens
        if (!initialized) {
          // Return a proxy that initializes on first use
          return new Proxy({} as any, {
            get: (_t, p) => {
              if (!initialized) {
                throw new Error('Database not initialized. Call any async method first (e.g., db.query) or use: await db.drizzle.select()...')
              }
              return (drizzleInstance as any)[p]
            },
            apply: (_t, _thisArg, args) => {
              if (!initialized) {
                throw new Error('Database not initialized. Call any async method first.')
              }
              return (drizzleInstance as any)(...args)
            }
          })
        }
        return drizzleInstance
      }
      return (target as any)[prop]
    }
  }) as DrizzleDBInstance
}

/**
 * Create SQLite instance with Drizzle ORM
 */
function createSQLiteDrizzleInstance(state: DBBuilderState): DrizzleDBInstance {
  const sqliteDb = new SQLiteDB(state.url!)
  let drizzleInstance: unknown = null

  // Register with dashboard
  registerWithDashboard(state.name, 'sqlite')

  // Initialize Drizzle synchronously for SQLite
  const initDrizzle = async () => {
    if (drizzleInstance) return
    const { drizzle } = await import('drizzle-orm/bun-sqlite')
    drizzleInstance = drizzle(sqliteDb, { schema: state.drizzleSchema })
  }

  const logQuery = (sql: string, duration: number) => {
    if (state.trace) {
      console.debug(
        `[DB:${state.name}] ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''} ` +
          `duration=${duration.toFixed(2)}ms`
      )
    }
  }

  const instance: DrizzleDBInstance = {
    name: state.name,
    type: 'sqlite',

    get drizzle() {
      if (!drizzleInstance) {
        throw new Error('Drizzle not initialized. Make sure to await your first database operation.')
      }
      return drizzleInstance as any
    },

    async query<T>(sql: string, params: unknown[] = [], options?: QueryOptions): Promise<T[]> {
      await initDrizzle()

      const shouldTrace = options?.trace ?? state.trace

      if (shouldTrace && isTracingInitialized()) {
        return withSpan('db.query', {
          'db.system': 'sqlite',
          'db.name': state.name,
          'db.statement': sql.substring(0, 200),
          'db.params.count': params.length,
        }, async () => {
          const stmt = sqliteDb.prepare(sql)
          // @ts-expect-error - SQLite params typing
          const result = stmt.all(...params) as T[]
          return result
        })
      }

      const startTime = shouldTrace ? performance.now() : 0
      try {
        const stmt = sqliteDb.prepare(sql)
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
      await initDrizzle()

      const txContext: DBContext = {
        async query<R>(sql: string, params?: unknown[]): Promise<R[]> {
          const stmt = sqliteDb.prepare(sql)
          // @ts-expect-error - SQLite params typing
          return stmt.all(...(params || [])) as R[]
        },
        async transaction<R>(innerFn: (innerTx: DBContext) => Promise<R>): Promise<R> {
          return innerFn(txContext)
        },
      }

      sqliteDb.run('BEGIN TRANSACTION')
      try {
        const result = await fn(txContext)
        sqliteDb.run('COMMIT')
        return result
      } catch (error) {
        sqliteDb.run('ROLLBACK')
        throw error
      }
    },

    async close(): Promise<void> {
      sqliteDb.close()
    },

    async getTables(): Promise<TableInfo[]> {
      const stmt = sqliteDb.prepare(`
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
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        throw new Error('Invalid table name')
      }
      const stmt = sqliteDb.prepare(`PRAGMA table_info("${tableName}")`)
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

  // Return proxy similar to postgres
  return new Proxy(instance, {
    get(target, prop) {
      if (prop === 'drizzle') {
        if (!drizzleInstance) {
          return new Proxy({} as any, {
            get: (_t, p) => {
              if (!drizzleInstance) {
                throw new Error('Database not initialized. Call any async method first.')
              }
              return (drizzleInstance as any)[p]
            }
          })
        }
        return drizzleInstance
      }
      return (target as any)[prop]
    }
  }) as DrizzleDBInstance
}

/**
 * Create a new DB connection
 */
export const DB = {
  create: DBBuilder.create,
}

export type { DBBuilder, DrizzleDBBuilder, DBInstance, DrizzleDBInstance }
