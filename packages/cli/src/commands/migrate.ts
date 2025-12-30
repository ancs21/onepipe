/**
 * Migrate Commands
 *
 * Database migration management using Drizzle Kit
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { c, s, createSpinner, box, section } from '../ui'

/**
 * Common schema file locations to search
 */
const SCHEMA_PATTERNS = [
  './src/db/schema.ts',
  './src/schema.ts',
  './db/schema.ts',
  './schema.ts',
  './src/db/schema/index.ts',
  './src/database/schema.ts',
]

/**
 * Detect database dialect from code or environment
 */
async function detectDialect(cwd: string): Promise<'postgresql' | 'sqlite'> {
  // Check DATABASE_URL format
  const dbUrl = process.env.DATABASE_URL || ''
  if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
    return 'postgresql'
  }
  if (dbUrl.endsWith('.db') || dbUrl.endsWith('.sqlite') || dbUrl === ':memory:') {
    return 'sqlite'
  }

  // Try to detect from code using static analysis
  const entrypoints = ['./src/index.ts', './src/server.ts', './index.ts']
  for (const entry of entrypoints) {
    const fullPath = resolve(cwd, entry)
    if (existsSync(fullPath)) {
      try {
        const content = await Bun.file(fullPath).text()
        if (content.includes('.postgres(') || content.includes('postgres://')) {
          return 'postgresql'
        }
        if (content.includes('.sqlite(') || content.includes('bun:sqlite')) {
          return 'sqlite'
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  // Default to postgresql
  return 'postgresql'
}

/**
 * Find schema file by searching common locations
 */
async function findSchemaFile(cwd: string): Promise<string | null> {
  for (const pattern of SCHEMA_PATTERNS) {
    const fullPath = resolve(cwd, pattern)
    if (existsSync(fullPath)) {
      return pattern
    }
  }

  // Search for any schema.ts file
  const glob = new Bun.Glob('**/schema.ts')
  for await (const file of glob.scan({ cwd, onlyFiles: true })) {
    // Skip node_modules
    if (!file.includes('node_modules')) {
      return './' + file
    }
  }

  return null
}

/**
 * Generate drizzle.config.ts content
 */
function generateDrizzleConfigContent(options: {
  dialect: 'postgresql' | 'sqlite'
  schemaPath: string
  migrationsPath: string
}): string {
  if (options.dialect === 'sqlite') {
    return `import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: '${options.schemaPath}',
  out: '${options.migrationsPath}',
  dbCredentials: {
    url: process.env.DATABASE_URL || './data.db',
  },
})
`
  }

  return `import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: '${options.schemaPath}',
  out: '${options.migrationsPath}',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
`
}

/**
 * Check for drizzle.config.ts and auto-generate if missing
 */
async function ensureDrizzleConfig(cwd: string): Promise<boolean> {
  const configPath = resolve(cwd, 'drizzle.config.ts')

  if (existsSync(configPath)) {
    return true
  }

  console.log('')
  console.log(`${c.yellow}${s.warning}${c.reset} No drizzle.config.ts found. Auto-generating...`)

  // Find schema file
  const schemaPath = await findSchemaFile(cwd)
  if (!schemaPath) {
    console.log('')
    console.log(`${c.red}${s.cross}${c.reset} Could not find schema file.`)
    console.log('')
    console.log(`  ${c.dim}Create a schema file at one of these locations:${c.reset}`)
    for (const pattern of SCHEMA_PATTERNS.slice(0, 4)) {
      console.log(`    ${c.dim}${pattern}${c.reset}`)
    }
    console.log('')
    console.log(box([
      `import { pgTable, text } from 'drizzle-orm/pg-core'`,
      ``,
      `export const users = pgTable('users', {`,
      `  id: text('id').primaryKey(),`,
      `  name: text('name').notNull(),`,
      `})`,
    ], { title: 'Example Schema', width: 50 }))
    console.log('')
    return false
  }

  // Detect dialect
  const dialect = await detectDialect(cwd)

  // Generate config
  const configContent = generateDrizzleConfigContent({
    dialect,
    schemaPath,
    migrationsPath: './drizzle',
  })

  // Write config file
  await Bun.write(configPath, configContent)

  console.log('')
  console.log(`${c.green}${s.check}${c.reset} Generated drizzle.config.ts`)
  console.log(`  ${c.dim}Schema:  ${schemaPath}${c.reset}`)
  console.log(`  ${c.dim}Dialect: ${dialect}${c.reset}`)
  console.log(`  ${c.dim}Output:  ./drizzle/${c.reset}`)
  console.log('')

  return true
}

/**
 * Generate migrations from schema changes
 *
 * @example
 * onepipe migrate generate
 * onepipe migrate generate --name add_users
 */
export async function migrateGenerate(args: string[]): Promise<void> {
  const cwd = process.cwd()

  if (!await ensureDrizzleConfig(cwd)) {
    process.exit(1)
  }

  // Parse optional name flag
  let name: string | undefined
  const nameIndex = args.indexOf('--name')
  if (nameIndex !== -1 && args[nameIndex + 1]) {
    name = args[nameIndex + 1]
  }

  const spinner = createSpinner('Generating migrations from schema...')

  const drizzleArgs = ['drizzle-kit', 'generate']
  if (name) {
    drizzleArgs.push('--name', name)
  }

  const proc = Bun.spawn(['bunx', ...drizzleArgs], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  })

  const exitCode = await proc.exited

  if (exitCode === 0) {
    spinner.succeed('Migrations generated')
    console.log(`  ${c.dim}Check ./drizzle/ for new migration files${c.reset}`)
    console.log('')
  } else {
    spinner.fail('Migration generation failed')
    const stderr = await new Response(proc.stderr).text()
    if (stderr) {
      console.log(`  ${c.dim}${stderr}${c.reset}`)
    }
    console.log('')
    process.exit(exitCode)
  }
}

/**
 * Apply pending migrations
 *
 * @example
 * onepipe migrate up
 */
export async function migrateUp(args: string[]): Promise<void> {
  const cwd = process.cwd()

  if (!await ensureDrizzleConfig(cwd)) {
    process.exit(1)
  }

  // Check for DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.log('')
    console.log(`${c.red}${s.cross}${c.reset} DATABASE_URL environment variable is not set`)
    console.log(`  ${c.dim}Set DATABASE_URL to your database connection string${c.reset}`)
    console.log('')
    process.exit(1)
  }

  const spinner = createSpinner('Applying pending migrations...')

  const proc = Bun.spawn(['bunx', 'drizzle-kit', 'migrate'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  })

  const exitCode = await proc.exited

  if (exitCode === 0) {
    spinner.succeed('Migrations applied')
    console.log('')
  } else {
    spinner.fail('Migration failed')
    const stderr = await new Response(proc.stderr).text()
    if (stderr) {
      console.log(`  ${c.dim}${stderr}${c.reset}`)
    }
    console.log('')
    process.exit(exitCode)
  }
}

/**
 * Show migration status
 *
 * @example
 * onepipe migrate status
 */
export async function migrateStatus(args: string[]): Promise<void> {
  const cwd = process.cwd()

  if (!await ensureDrizzleConfig(cwd)) {
    process.exit(1)
  }

  // Check for DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.log('')
    console.log(`${c.red}${s.cross}${c.reset} DATABASE_URL environment variable is not set`)
    console.log(`  ${c.dim}Set DATABASE_URL to your database connection string${c.reset}`)
    console.log('')
    process.exit(1)
  }

  console.log('')

  // Check migrations folder
  const migrationsDir = resolve(cwd, 'drizzle')
  if (!existsSync(migrationsDir)) {
    console.log(`${c.yellow}${s.warning}${c.reset} No migrations folder found`)
    console.log(`  ${c.dim}Run 'onepipe migrate generate' to create migrations${c.reset}`)
    console.log('')
    return
  }

  // List migration files
  const glob = new Bun.Glob('*.sql')
  const migrationFiles: string[] = []
  for await (const file of glob.scan(migrationsDir)) {
    migrationFiles.push(file)
  }
  migrationFiles.sort()

  if (migrationFiles.length === 0) {
    console.log(`${c.yellow}${s.warning}${c.reset} No migrations found`)
    console.log(`  ${c.dim}Run 'onepipe migrate generate' to create migrations${c.reset}`)
    console.log('')
    return
  }

  const items = migrationFiles.map(file => {
    const name = file.replace('.sql', '')
    return `${c.green}${s.check}${c.reset} ${name}`
  })

  console.log(section('Migrations', items, { width: 50 }))
  console.log('')
  console.log(`  ${c.dim}Total: ${migrationFiles.length} migration(s)${c.reset}`)
  console.log('')
}

/**
 * Run migrate command
 */
export async function runMigrate(args: string[]): Promise<void> {
  const action = args[0]

  switch (action) {
    case 'generate':
      return migrateGenerate(args.slice(1))
    case 'up':
      return migrateUp(args.slice(1))
    case 'status':
      return migrateStatus(args.slice(1))
    default:
      printMigrateHelp()
  }
}

function printMigrateHelp(): void {
  console.log('')
  console.log(`${c.bold}Usage:${c.reset} onepipe migrate <command>`)
  console.log('')
  console.log(section('Commands', [
    `generate [--name <n>]  ${c.dim}Generate migrations from schema${c.reset}`,
    `up                     ${c.dim}Apply pending migrations${c.reset}`,
    `status                 ${c.dim}Show migration status${c.reset}`,
  ], { width: 50 }))
  console.log('')
  console.log(`${c.bold}Examples:${c.reset}`)
  console.log(`  ${c.dim}onepipe migrate generate${c.reset}`)
  console.log(`  ${c.dim}onepipe migrate generate --name add_users${c.reset}`)
  console.log(`  ${c.dim}onepipe migrate up${c.reset}`)
  console.log(`  ${c.dim}onepipe migrate status${c.reset}`)
  console.log('')
}
