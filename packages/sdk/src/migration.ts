/**
 * Migration - Database Migration Builder
 *
 * @example
 * ```typescript
 * import { Migration } from '@onepipe/sdk'
 *
 * const createUsersTable = Migration
 *   .create('001_create_users')
 *   .up(async (db) => {
 *     await db.query(`
 *       CREATE TABLE users (
 *         id TEXT PRIMARY KEY,
 *         email TEXT UNIQUE NOT NULL,
 *         name TEXT,
 *         created_at INTEGER NOT NULL DEFAULT (unixepoch())
 *       )
 *     `)
 *   })
 *   .down(async (db) => {
 *     await db.query(`DROP TABLE users`)
 *   })
 *   .build()
 *
 * // Run migrations programmatically
 * await Migration.run([createUsersTable], db)
 * ```
 */

import { Database } from 'bun:sqlite'
import { resolve, relative } from 'node:path'
import type { DBInstance, DBContext } from './types'

export interface MigrationInstance {
  readonly name: string
  readonly version: string
  up(db: DBContext): Promise<void>
  down(db: DBContext): Promise<void>
}

interface MigrationRecord {
  name: string
  applied_at: number
}

/**
 * Migration builder with fluent API
 */
class MigrationBuilder {
  private migrationName: string
  private upFn: ((db: DBContext) => Promise<void>) | null = null
  private downFn: ((db: DBContext) => Promise<void>) | null = null

  constructor(name: string) {
    this.migrationName = name
  }

  /**
   * Define the up migration
   */
  up(fn: (db: DBContext) => Promise<void>): this {
    this.upFn = fn
    return this
  }

  /**
   * Define the down migration (rollback)
   */
  down(fn: (db: DBContext) => Promise<void>): this {
    this.downFn = fn
    return this
  }

  /**
   * Build the migration instance
   */
  build(): MigrationInstance {
    if (!this.upFn) {
      throw new Error('Migration requires an up() function')
    }
    if (!this.downFn) {
      throw new Error('Migration requires a down() function')
    }

    const name = this.migrationName
    const upFn = this.upFn
    const downFn = this.downFn

    // Extract version from name (e.g., "001_create_users" -> "001")
    const version = name.split('_')[0] || name

    return {
      name,
      version,
      up: upFn,
      down: downFn,
    }
  }
}

/**
 * Migration runner for managing database migrations
 */
class MigrationRunner {
  private db: Database
  private migrations: MigrationInstance[]
  private tableName = '_migrations'

  constructor(dbPath: string, migrations: MigrationInstance[]) {
    this.db = new Database(dbPath)
    this.migrations = migrations.sort((a, b) => a.version.localeCompare(b.version))
    this.ensureMigrationTable()
  }

  private ensureMigrationTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `)
  }

  private getAppliedMigrations(): string[] {
    const rows = this.db
      .query<MigrationRecord, []>(`SELECT name FROM ${this.tableName} ORDER BY name`)
      .all()
    return rows.map((r) => r.name)
  }

  private createDbContext(): DBContext {
    const db = this.db
    const self = this
    return {
      async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
        if (params && params.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return db.query<T, any>(sql).all(...params)
        }
        return db.query<T, []>(sql).all()
      },
      async transaction<T>(fn: (tx: DBContext) => Promise<T>): Promise<T> {
        return db.transaction(() => fn(self.createDbContext()))() as T
      },
    }
  }

  /**
   * Run all pending migrations
   */
  async up(): Promise<string[]> {
    const applied = this.getAppliedMigrations()
    const pending = this.migrations.filter((m) => !applied.includes(m.name))
    const executed: string[] = []

    for (const migration of pending) {
      console.log(`Running migration: ${migration.name}`)
      try {
        await migration.up(this.createDbContext())
        this.db.run(
          `INSERT INTO ${this.tableName} (name, applied_at) VALUES (?, ?)`,
          [migration.name, Date.now()]
        )
        executed.push(migration.name)
        console.log(`  ✓ ${migration.name}`)
      } catch (error) {
        console.error(`  ✗ ${migration.name}: ${error}`)
        throw error
      }
    }

    return executed
  }

  /**
   * Rollback the last migration
   */
  async down(): Promise<string | null> {
    const applied = this.getAppliedMigrations()
    if (applied.length === 0) {
      console.log('No migrations to rollback')
      return null
    }

    const lastApplied = applied[applied.length - 1]
    const migration = this.migrations.find((m) => m.name === lastApplied)

    if (!migration) {
      throw new Error(`Migration not found: ${lastApplied}`)
    }

    console.log(`Rolling back: ${migration.name}`)
    try {
      await migration.down(this.createDbContext())
      this.db.run(`DELETE FROM ${this.tableName} WHERE name = ?`, [migration.name])
      console.log(`  ✓ Rolled back ${migration.name}`)
      return migration.name
    } catch (error) {
      console.error(`  ✗ ${migration.name}: ${error}`)
      throw error
    }
  }

  /**
   * Rollback all migrations
   */
  async reset(): Promise<string[]> {
    const rolledBack: string[] = []
    let last = await this.down()
    while (last) {
      rolledBack.push(last)
      last = await this.down()
    }
    return rolledBack
  }

  /**
   * Get migration status
   */
  status(): { applied: string[]; pending: string[] } {
    const applied = this.getAppliedMigrations()
    const pending = this.migrations
      .filter((m) => !applied.includes(m.name))
      .map((m) => m.name)
    return { applied, pending }
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close()
  }
}

/**
 * Load migrations from a directory
 */
async function loadMigrationsFromDir(dir: string): Promise<MigrationInstance[]> {
  // Validate directory path to prevent directory traversal
  const cwd = process.cwd()
  const absoluteDir = resolve(cwd, dir)
  const relativePath = relative(cwd, absoluteDir)

  // Ensure directory is within project (doesn't escape with ..)
  if (relativePath.startsWith('..') || resolve(cwd, relativePath) !== absoluteDir) {
    throw new Error('Migration directory must be within project root')
  }

  const glob = new Bun.Glob('*.ts')
  const migrations: MigrationInstance[] = []

  for await (const file of glob.scan({ cwd: absoluteDir })) {
    if (file.endsWith('.test.ts')) continue
    const fullPath = resolve(absoluteDir, file)
    try {
      const module = await import(fullPath)
      if (module.default && typeof module.default === 'object' && 'up' in module.default) {
        migrations.push(module.default as MigrationInstance)
      }
    } catch (error) {
      console.warn(`Failed to load migration ${file}:`, error)
    }
  }

  return migrations.sort((a, b) => a.version.localeCompare(b.version))
}

/**
 * Migration entry point
 */
export const Migration = {
  /**
   * Create a new migration builder
   */
  create(name: string): MigrationBuilder {
    return new MigrationBuilder(name)
  },

  /**
   * Create a migration runner
   */
  runner(dbPath: string, migrations: MigrationInstance[]): MigrationRunner {
    return new MigrationRunner(dbPath, migrations)
  },

  /**
   * Load migrations from directory
   */
  load: loadMigrationsFromDir,

  /**
   * Run migrations on a database
   */
  async run(migrations: MigrationInstance[], dbPath: string): Promise<string[]> {
    const runner = new MigrationRunner(dbPath, migrations)
    try {
      return await runner.up()
    } finally {
      runner.close()
    }
  },

  /**
   * Rollback last migration
   */
  async rollback(migrations: MigrationInstance[], dbPath: string): Promise<string | null> {
    const runner = new MigrationRunner(dbPath, migrations)
    try {
      return await runner.down()
    } finally {
      runner.close()
    }
  },

  /**
   * Get migration status
   */
  status(migrations: MigrationInstance[], dbPath: string): { applied: string[]; pending: string[] } {
    const runner = new MigrationRunner(dbPath, migrations)
    try {
      return runner.status()
    } finally {
      runner.close()
    }
  },
}

export type { MigrationBuilder, MigrationRunner }
