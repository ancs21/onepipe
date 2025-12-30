/**
 * DB Commands
 *
 * Database utilities: seed, reset, and studio
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { c, s, createSpinner, box, section } from '../ui'

/**
 * Run seed files
 *
 * Looks for seed files in ./seeds/ or ./src/seeds/
 *
 * @example
 * onepipe db seed
 * onepipe db seed --file seeds/users.ts
 */
export async function dbSeed(args: string[]): Promise<void> {
  const cwd = process.cwd()

  // Check for DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.log('')
    console.log(`${c.red}${s.cross}${c.reset} DATABASE_URL environment variable is not set`)
    console.log(`  ${c.dim}Set DATABASE_URL to your database connection string${c.reset}`)
    console.log('')
    process.exit(1)
  }

  // Parse optional file flag
  const fileIndex = args.indexOf('--file')
  let specificFile: string | undefined
  if (fileIndex !== -1 && args[fileIndex + 1]) {
    specificFile = args[fileIndex + 1]
  }

  // Find seed files
  const seedDirs = ['./seeds', './src/seeds']
  let seedFiles: string[] = []

  if (specificFile) {
    // Run specific file
    const filePath = resolve(cwd, specificFile)
    if (!existsSync(filePath)) {
      console.log('')
      console.log(`${c.red}${s.cross}${c.reset} Seed file not found: ${specificFile}`)
      console.log('')
      process.exit(1)
    }
    seedFiles = [filePath]
  } else {
    // Find all seed files
    for (const dir of seedDirs) {
      const seedDir = resolve(cwd, dir)
      if (existsSync(seedDir)) {
        const glob = new Bun.Glob('**/*.ts')
        for await (const file of glob.scan(seedDir)) {
          seedFiles.push(resolve(seedDir, file))
        }
      }
    }
    seedFiles.sort()
  }

  if (seedFiles.length === 0) {
    console.log('')
    console.log(`${c.yellow}${s.warning}${c.reset} No seed files found`)
    console.log(`  ${c.dim}Create seed files in ./seeds/ or ./src/seeds/${c.reset}`)
    console.log('')
    console.log(box([
      `${c.dim}// seeds/001_users.ts${c.reset}`,
      `import { db } from '../src/db'`,
      `import { users } from '../src/db/schema'`,
      ``,
      `await db.drizzle.insert(users).values([`,
      `  { id: '1', name: 'Alice' },`,
      `])`,
    ], { title: 'Example', width: 45 }))
    console.log('')
    return
  }

  console.log('')

  for (const file of seedFiles) {
    const relativePath = file.replace(cwd + '/', '')
    const spinner = createSpinner(`Running ${relativePath}...`)

    try {
      await import(Bun.pathToFileURL(file).href)
      spinner.succeed(`${relativePath}`)
    } catch (error) {
      spinner.fail(`${relativePath}`)
      console.log(`  ${c.red}${error}${c.reset}`)
      process.exit(1)
    }
  }

  console.log('')
  console.log(`${c.green}${s.check}${c.reset} Seeding complete`)
  console.log('')
}

/**
 * Reset database - drop all tables and re-run migrations
 *
 * @example
 * onepipe db reset --force
 */
export async function dbReset(args: string[]): Promise<void> {
  const cwd = process.cwd()

  // Check for --force flag
  if (!args.includes('--force')) {
    console.log('')
    console.log(`${c.red}${s.cross}${c.reset} This will ${c.bold}DROP ALL TABLES${c.reset} in the database.`)
    console.log('')
    console.log(`  ${c.dim}Use --force to confirm: onepipe db reset --force${c.reset}`)
    console.log('')
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
  console.log(`${c.yellow}${s.warning}${c.reset} ${c.bold}Resetting database...${c.reset}`)
  console.log('')

  const spinner = createSpinner('Dropping and recreating schema...')

  const proc = Bun.spawn(['bunx', 'drizzle-kit', 'push', '--force'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  })

  const exitCode = await proc.exited

  if (exitCode === 0) {
    spinner.succeed('Database reset complete')
    console.log('')
  } else {
    spinner.fail('Database reset failed')
    const stderr = await new Response(proc.stderr).text()
    if (stderr) {
      console.log(`  ${c.dim}${stderr}${c.reset}`)
    }
    console.log('')
    process.exit(exitCode)
  }
}

/**
 * Launch Drizzle Studio (visual database UI)
 *
 * @example
 * onepipe db studio
 */
export async function dbStudio(args: string[]): Promise<void> {
  const cwd = process.cwd()

  // Check for drizzle.config.ts
  const configPath = resolve(cwd, 'drizzle.config.ts')
  if (!existsSync(configPath)) {
    console.log('')
    console.log(`${c.red}${s.cross}${c.reset} No drizzle.config.ts found`)
    console.log(`  ${c.dim}Create a drizzle.config.ts file first${c.reset}`)
    console.log('')
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
  console.log(`${c.cyan}${s.arrow}${c.reset} Launching Drizzle Studio...`)
  console.log('')

  const proc = Bun.spawn(['bunx', 'drizzle-kit', 'studio'], {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env },
  })

  await proc.exited
}

/**
 * Run db command
 */
export async function runDB(args: string[]): Promise<void> {
  const action = args[0]

  switch (action) {
    case 'seed':
      return dbSeed(args.slice(1))
    case 'reset':
      return dbReset(args.slice(1))
    case 'studio':
      return dbStudio(args.slice(1))
    default:
      printDBHelp()
  }
}

function printDBHelp(): void {
  console.log('')
  console.log(`${c.bold}Usage:${c.reset} onepipe db <command>`)
  console.log('')
  console.log(section('Commands', [
    `seed [--file <path>]  ${c.dim}Run seed files from ./seeds/${c.reset}`,
    `reset --force         ${c.dim}Drop all tables, re-run migrations${c.reset}`,
    `studio                ${c.dim}Launch Drizzle Studio${c.reset}`,
  ], { width: 50 }))
  console.log('')
  console.log(`${c.bold}Examples:${c.reset}`)
  console.log(`  ${c.dim}onepipe db seed${c.reset}`)
  console.log(`  ${c.dim}onepipe db seed --file seeds/users.ts${c.reset}`)
  console.log(`  ${c.dim}onepipe db reset --force${c.reset}`)
  console.log(`  ${c.dim}onepipe db studio${c.reset}`)
  console.log('')
}
