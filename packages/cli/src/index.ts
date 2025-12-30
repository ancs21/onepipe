#!/usr/bin/env bun
/**
 * OnePipe CLI
 *
 * Command-line interface for OnePipe development platform
 *
 * @example
 * ```bash
 * onepipe dev                    # Start development server
 * onepipe deploy staging         # Deploy to staging
 * onepipe migrate up             # Run migrations
 * onepipe logs production        # Stream production logs
 * ```
 */

// Import commands from commands module
import { runMigrate } from './commands/migrate'
import { runDB } from './commands/db'
import { deployKubernetes } from './commands/deploy-k8s'
import { deployCloudRun } from './commands/deploy-cloudrun'
import { deployCompose } from './commands/deploy-compose'

interface EnvironmentConfig {
  streams: string
  database?: string
  redis?: string
  replicas?: number
}

interface DeployConfig {
  entrypoint?: string   // Default: ./src/index.ts
  port?: number         // Default: 3000
  dockerfile?: string   // Custom Dockerfile path (skip generation)
}

interface OnePipeConfig {
  name: string
  environments: Record<string, EnvironmentConfig>
  deploy?: DeployConfig
  hooks?: {
    preDeploy?: (env: string) => Promise<void>
    postDeploy?: (env: string) => Promise<void>
  }
}

// =============================================================================
// Input Validation (prevent command injection)
// =============================================================================

const SAFE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const SAFE_TAG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const SAFE_REGISTRY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._\-/:]*$/

function validateImageTag(tag: string): string {
  if (!SAFE_TAG_PATTERN.test(tag)) {
    throw new Error(`Invalid image tag: ${tag}. Only alphanumeric, dots, hyphens, and underscores allowed.`)
  }
  return tag
}

function validateRegistry(registry: string): string {
  if (!SAFE_REGISTRY_PATTERN.test(registry)) {
    throw new Error(`Invalid registry: ${registry}. Contains invalid characters.`)
  }
  return registry
}

function validateAppName(name: string): string {
  if (!SAFE_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid app name: ${name}. Only alphanumeric, dots, hyphens, and underscores allowed.`)
  }
  return name
}

// =============================================================================
// Shell Helpers
// =============================================================================

async function exec(command: string, args: string[] = []): Promise<{ success: boolean; output: string }> {
  console.log(`$ ${command} ${args.join(' ')}`)
  const proc = Bun.spawn([command, ...args], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited
  return { success: exitCode === 0, output: '' }
}

async function checkCommand(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', command], { stdout: 'pipe', stderr: 'pipe' })
    return (await proc.exited) === 0
  } catch {
    return false
  }
}

// =============================================================================
// PostgreSQL Auto-Start (Apple Container or Docker)
// =============================================================================

type ContainerRuntime = 'apple' | 'docker' | null

async function detectContainerRuntime(): Promise<ContainerRuntime> {
  // Prefer Apple Container on macOS (faster, lighter, native)
  if (process.platform === 'darwin' && await checkCommand('container')) {
    // Check if Apple container system is running
    const check = Bun.spawn(['container', 'system', 'info'], { stdout: 'pipe', stderr: 'pipe' })
    if (await check.exited === 0) {
      return 'apple'
    }
    // Try to start Apple container system
    console.log('  Starting Apple Container system...')
    const start = Bun.spawn(['container', 'system', 'start'], { stdout: 'pipe', stderr: 'pipe' })
    if (await start.exited === 0) {
      return 'apple'
    }
  }

  // Fallback to Docker
  if (await checkCommand('docker')) {
    return 'docker'
  }

  return null
}

async function ensurePostgres(): Promise<string | null> {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL
  }

  const runtime = await detectContainerRuntime()
  if (!runtime) {
    console.log('  PostgreSQL: (no container runtime found)')
    return null
  }

  const containerName = 'onepipe-postgres'
  const image = 'postgres:18-alpine'

  if (runtime === 'apple') {
    return ensurePostgresApple(containerName, image)
  } else {
    return ensurePostgresDocker(containerName, image)
  }
}

async function ensurePostgresApple(name: string, image: string): Promise<string | null> {
  try {
    // Check if container exists
    const list = Bun.spawn(['container', 'ls', '-a'], { stdout: 'pipe' })
    const output = await new Response(list.stdout).text()

    if (output.includes(name)) {
      // Start if not running
      if (!output.includes('running')) {
        console.log('  PostgreSQL: Starting container...')
        await Bun.spawn(['container', 'start', name]).exited
      }

      // Always wait for PostgreSQL to be ready
      await waitForPostgresApple(name)

      // Get container IP from Apple Container inspect format
      const inspect = Bun.spawn(['container', 'inspect', name], { stdout: 'pipe' })
      const info = JSON.parse(await new Response(inspect.stdout).text())
      // Apple Container format: networks[0].address = "192.168.64.2/24"
      const address = info[0]?.networks?.[0]?.address || ''
      const ip = address.split('/')[0] || 'localhost'

      console.log(`  PostgreSQL: ${ip}:5432 (Apple Container)`)
      return `postgres://postgres:postgres@${ip}:5432/onepipe`
    }

    // Create new container
    console.log('  PostgreSQL: Creating Apple container...')
    await Bun.spawn([
      'container', 'run', '-d',
      '--name', name,
      '-e', 'POSTGRES_PASSWORD=postgres',
      '-e', 'POSTGRES_DB=onepipe',
      image
    ]).exited

    // Wait for PostgreSQL to be ready
    await waitForPostgresApple(name)

    // Get container IP from Apple Container inspect format
    const inspect = Bun.spawn(['container', 'inspect', name], { stdout: 'pipe' })
    const info = JSON.parse(await new Response(inspect.stdout).text())
    const address = info[0]?.networks?.[0]?.address || ''
    const ip = address.split('/')[0] || 'localhost'

    console.log(`  PostgreSQL: ${ip}:5432 (Apple Container)`)
    return `postgres://postgres:postgres@${ip}:5432/onepipe`
  } catch (error) {
    console.log('  PostgreSQL: (Apple Container failed, trying Docker...)')
    return ensurePostgresDocker('onepipe-postgres', 'postgres:18-alpine')
  }
}

async function ensurePostgresDocker(name: string, image: string): Promise<string | null> {
  const dbUrl = 'postgres://postgres:postgres@localhost:5432/onepipe'

  try {
    const running = Bun.spawn(['docker', 'ps', '-q', '-f', `name=${name}`], { stdout: 'pipe' })
    if ((await new Response(running.stdout).text()).trim()) {
      console.log('  PostgreSQL: localhost:5432 (Docker)')
      return dbUrl
    }

    const exists = Bun.spawn(['docker', 'ps', '-aq', '-f', `name=${name}`], { stdout: 'pipe' })
    if ((await new Response(exists.stdout).text()).trim()) {
      await Bun.spawn(['docker', 'start', name]).exited
    } else {
      console.log('  PostgreSQL: Creating Docker container...')
      await Bun.spawn([
        'docker', 'run', '-d',
        '--name', name,
        '-p', '5432:5432',
        '-e', 'POSTGRES_PASSWORD=postgres',
        '-e', 'POSTGRES_DB=onepipe',
        image
      ]).exited
      await waitForPostgresDocker(name)
    }

    console.log('  PostgreSQL: localhost:5432 (Docker)')
    return dbUrl
  } catch {
    console.log('  PostgreSQL: (failed to start)')
    return null
  }
}

async function waitForPostgresApple(name: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const check = Bun.spawn(['container', 'exec', name, 'pg_isready', '-U', 'postgres'], { stdout: 'pipe' })
    if (await check.exited === 0) return
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error('PostgreSQL failed to start')
}

async function waitForPostgresDocker(name: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const check = Bun.spawn(['docker', 'exec', name, 'pg_isready', '-U', 'postgres'], { stdout: 'pipe' })
    if (await check.exited === 0) return
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error('PostgreSQL failed to start')
}

const args = process.argv.slice(2)
const command = args[0]

async function main() {
  switch (command) {
    case 'dev':
      await runDev(args.slice(1))
      break

    case 'deploy':
      await runDeploy(args.slice(1))
      break

    case 'migrate':
      await runMigrate(args.slice(1))
      break

    case 'logs':
      await runLogs(args.slice(1))
      break

    case 'env':
      await runEnv(args.slice(1))
      break

    case 'flows':
      await runFlows(args.slice(1))
      break

    case 'db':
      await runDB(args.slice(1))
      break

    case '--help':
    case '-h':
    case undefined:
      printHelp()
      break

    case '--version':
    case '-v':
      console.log('onepipe v0.1.0')
      break

    default:
      console.error(`Unknown command: ${command}`)
      console.error('Run "onepipe --help" for usage')
      process.exit(1)
  }
}

function printHelp() {
  console.log(`
OnePipe CLI v0.2.0

Usage: onepipe <command> [options]

Commands:
  dev                Start development server with dashboard
  deploy <env>       Deploy to environment (staging, production)
  migrate <action>   Database migrations (generate, up, status)
  db <action>        Database utilities (seed, reset, studio)
  logs <env>         Stream logs from environment
  env <action>       Manage environments (list, status)
  flows <action>     Manage flows (list, read, write)

Options:
  -h, --help         Show this help message
  -v, --version      Show version number

Dev Options:
  -a, --app          App entry file (default: ./src/index.ts)
  --app-port         App server port (default: 3001)
  --dashboard-port   Dashboard port (default: 4000)
  --no-dashboard     Disable dashboard
  --no-watch         Disable hot reload (file watching)

Deploy Options:
  --target, -t       Target: docker (default), fly, standalone, kubernetes, cloudrun
  --registry, -r     Docker registry (e.g., ghcr.io/username)
  --tag              Image tag (default: latest)
  --push             Push image to registry after build
  --force            Overwrite existing Dockerfile/fly.toml

Kubernetes Options (--target kubernetes):
  --replicas         Number of replicas (default: 2)
  --cpu              CPU request (default: 250m)
  --memory           Memory request (default: 256Mi)
  --namespace, -n    Kubernetes namespace (default: default)
  --output, -o       Output directory (default: ./k8s)
  --dry-run          Print manifests to stdout

Cloud Run Options (--target cloudrun):
  --region           GCP region (default: us-central1)
  --project          GCP project ID
  --min-instances    Min instances (default: 0)
  --max-instances    Max instances (default: 100)
  --cpu              CPU limit (default: 1)
  --memory           Memory limit (default: 512Mi)
  --allow-unauthenticated  Allow public access
  --generate-only    Only generate service.yaml

Migrate Commands:
  migrate generate [--name <n>]  Generate migrations from schema changes
  migrate up                     Apply pending migrations to database
  migrate status                 Show migration status

DB Commands:
  db seed [--file <path>]        Run seed files from ./seeds/
  db reset --force               Drop all tables, re-run migrations
  db studio                      Launch Drizzle Studio (visual database UI)

Examples:
  onepipe dev --app ./src/server.ts       # Start dev with dashboard
  onepipe dev --no-dashboard              # Start without dashboard
  onepipe deploy production               # Docker build
  onepipe deploy production --target fly  # Deploy to Fly.io
  onepipe deploy production --target k8s --replicas 3  # Generate K8s manifests
  onepipe deploy production --target cloudrun --region us-central1  # Deploy to Cloud Run
  onepipe migrate generate                # Generate SQL from schema
  onepipe migrate up                      # Apply migrations
  onepipe db studio                       # Visual database browser
`)
}

/**
 * Development server command
 *
 * Two-phase startup with auto-discovery:
 * 1. Detect entrypoint (from flag or package.json)
 * 2. Static analysis to discover infrastructure needs
 * 3. Provision only required infrastructure (PostgreSQL, Redis, etc.)
 * 4. Start dashboard (if enabled)
 * 5. Load user's app
 */
async function runDev(args: string[]) {
  const cwd = process.cwd()

  // Import discovery and infrastructure modules
  const { detectEntrypoint, validateEntrypoint, analyzeEntrypoint, getInfrastructureTypes } = await import('./discovery')
  const { createInfrastructureManager } = await import('./infrastructure')
  const { printHeader, printEntrypoint, printDiscovery, printProvisioning, printProvisionResult, printReady, printError } = await import('./ui')

  const appPort = getFlag(args, '--app-port') || '3001'
  const dashboardPort = getFlag(args, '--dashboard-port') || '4000'
  const dashboardApiPort = '4001'
  const noDashboard = args.includes('--no-dashboard')
  const noWatch = args.includes('--no-watch')
  const appFlag = getFlag(args, '--app', '-a') || args.find(a => !a.startsWith('-'))

  // Print header
  printHeader()

  // Step 1: Detect entrypoint
  const entrypointResult = await detectEntrypoint(cwd, appFlag)
  printEntrypoint(entrypointResult.path, entrypointResult.source)

  // Validate entrypoint exists
  const validation = await validateEntrypoint(entrypointResult.path)
  if (!validation.valid) {
    printError('Entrypoint not found', `${entrypointResult.path}\nCreate a src/index.ts file or specify an entrypoint with --app`)
    process.exit(1)
  }

  // Step 2: Static analysis to discover infrastructure needs
  const discovery = await analyzeEntrypoint(entrypointResult.path)
  printDiscovery(discovery)

  // Step 3: Provision required infrastructure
  const infrastructureTypes = getInfrastructureTypes(discovery)
  if (infrastructureTypes.length > 0) {
    printProvisioning(infrastructureTypes)
    const manager = createInfrastructureManager()
    const provisionResult = await manager.provision(infrastructureTypes)
    printProvisionResult(provisionResult)

    // Set environment variables
    Object.assign(process.env, provisionResult.env)

    if (provisionResult.errors.length > 0) {
      for (const error of provisionResult.errors) {
        printError(error)
      }
    }
  }

  // Set development environment
  process.env.NODE_ENV = 'development'
  process.env.ONEPIPE_PORT = appPort
  process.env.APP_PORT = appPort

  // Find dashboard package path
  const dashboardPath = await findDashboardPath()

  // Enable trace reporting to dashboard via OTLP
  if (!noDashboard && dashboardPath) {
    process.env.ONEPIPE_DASHBOARD_URL = `http://localhost:${dashboardApiPort}`
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://localhost:${dashboardApiPort}/v1/traces`
  }

  const processes: Array<{ name: string; proc: ReturnType<typeof Bun.spawn> }> = []

  // Step 4: Start Dashboard (if not disabled and path exists)
  if (!noDashboard && dashboardPath) {
    const { join } = await import('path')
    const { existsSync } = await import('fs')

    // Start Dashboard API server (silent)
    const dashboardApiProc = Bun.spawn(['bun', 'run', 'server/standalone.ts'], {
      cwd: dashboardPath,
      env: { ...process.env, PORT: dashboardApiPort, APP_PORT: appPort },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    processes.push({ name: 'dashboard-api', proc: dashboardApiProc })

    // Check if dashboard is built
    const distPath = join(dashboardPath, 'dist')
    const isBuilt = existsSync(distPath)

    if (!isBuilt) {
      // Build dashboard first
      console.log('  Building dashboard...')
      const buildProc = Bun.spawn(['bun', 'run', 'build'], {
        cwd: dashboardPath,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      await buildProc.exited
    }

    // Serve built dashboard with vite preview (silent)
    const dashboardFrontendProc = Bun.spawn(['bun', 'run', 'preview', '--port', dashboardPort], {
      cwd: dashboardPath,
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    processes.push({ name: 'dashboard-frontend', proc: dashboardFrontendProc })
  }

  // Step 5: Run the application with hot reload (bun --watch)
  const bunArgs = noWatch
    ? ['bun', 'run', entrypointResult.path]
    : ['bun', '--watch', 'run', entrypointResult.path]

  const appProc = Bun.spawn(bunArgs, {
    cwd: process.cwd(),
    env: { ...process.env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  processes.push({ name: 'app', proc: appProc })

  // Filter stderr (show errors, hide framework noise)
  if (appProc.stderr) {
    const stderrReader = appProc.stderr.getReader()
    const stderrDecoder = new TextDecoder()
    const { c, s } = await import('./ui')

    ;(async () => {
      while (true) {
        const { done, value } = await stderrReader.read()
        if (done) break
        const text = stderrDecoder.decode(value)

        for (const line of text.split('\n')) {
          if (!line.trim()) continue

          // Skip framework noise
          if (
            line.includes('[FileBackedStreamStore]') ||
            line.includes('[OTEL]') ||
            line.includes('Embedded streams server')
          ) {
            // Skip
          }
          // Show actual errors
          else {
            console.error(`${c.red}${s.cross}${c.reset} ${line}`)
          }
        }
      }
    })()
  }

  // Stream and filter app output (show hot reload and errors only)
  if (appProc.stdout) {
    const reader = appProc.stdout.getReader()
    const decoder = new TextDecoder()
    const { ts, c, s } = await import('./ui')

    ;(async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)

        // Filter output - only show important messages
        for (const line of text.split('\n')) {
          if (!line.trim()) continue

          // Skip noisy framework output
          if (
            line.includes('[OTEL]') ||
            line.includes('[FileBackedStreamStore]') ||
            line.includes('OnePipe Server') ||
            line.includes('REST APIs:') ||
            line.includes('Channels:') ||
            line.includes('Flows:') ||
            line.includes('Projections:') ||
            line.includes('Signals:') ||
            line.includes('Workflows:') ||
            line.includes('Cron Jobs:') ||
            line.includes('Databases:') ||
            line.includes('registered') ||
            line.includes('Embedded streams server') ||
            line.includes('┌') ||
            line.includes('│') ||
            line.includes('└') ||
            line.includes('─') ||
            line.includes('http://0.0.0.0') ||
            line.match(/^\s*(GET|POST|PUT|DELETE|PATCH)\s+/)
          ) {
            // Skip
          }
          // Show hot reload events with timestamp
          else if (line.includes('[watch]') || line.includes('reloading')) {
            console.log(ts(`${c.cyan}${s.arrow}${c.reset} ${line.replace('[watch]', '').trim()}`))
          }
          // Show actual errors (not framework noise)
          else if (line.includes('error:') || line.includes('Error:') || line.includes('EADDRINUSE')) {
            console.log(`${c.red}${s.cross}${c.reset} ${line}`)
          }
        }
      }
    })()
  }

  // Print ready message
  printReady({
    appPort: parseInt(appPort, 10),
    dashboardPort: !noDashboard && dashboardPath ? parseInt(dashboardPort, 10) : undefined,
    dashboardApiPort: !noDashboard && dashboardPath ? parseInt(dashboardApiPort, 10) : undefined,
    streamsPort: 9999, // Embedded streams server
  })

  // Handle cleanup on exit
  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    for (const { proc } of processes) {
      proc.kill()
    }
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    for (const { proc } of processes) {
      proc.kill()
    }
    process.exit(0)
  })
}

/**
 * Find the dashboard package path
 */
async function findDashboardPath(): Promise<string | null> {
  const { resolve, join } = await import('path')
  const cwd = process.cwd()

  // Check common locations (relative to cwd)
  const paths = [
    './node_modules/@onepipe/dashboard',
    './packages/dashboard', // Monorepo root
    '../dashboard', // In monorepo packages/cli
    '../../packages/dashboard', // From examples
  ]

  for (const p of paths) {
    const fullPath = resolve(cwd, p)
    const packageJson = Bun.file(join(fullPath, 'package.json'))
    if (await packageJson.exists()) {
      const content = await packageJson.json()
      if (content.name === '@onepipe/dashboard') {
        return fullPath
      }
    }
  }

  return null
}

/**
 * Deploy command
 */
async function runDeploy(args: string[]) {
  const environment = args[0]
  const target = getFlag(args, '--target', '-t') || 'docker'
  const registry = getFlag(args, '--registry', '-r')
  const tag = getFlag(args, '--tag') || 'latest'
  const push = args.includes('--push')
  const force = args.includes('--force')

  if (!environment) {
    console.error('Error: Environment required')
    console.error('Usage: onepipe deploy <environment> [--target docker|fly|standalone]')
    process.exit(1)
  }

  const config = await loadConfig()
  const envConfig = config.environments[environment]

  if (!envConfig) {
    console.error(`Error: Unknown environment: ${environment}`)
    console.error(`Available: ${Object.keys(config.environments).join(', ')}`)
    process.exit(1)
  }

  console.log(`
┌─────────────────────────────────────────────────┐
│                                                 │
│   🚀 OnePipe Deploy                             │
│                                                 │
│   Environment: ${environment.padEnd(32)}│
│   Target:      ${target.padEnd(32)}│
│                                                 │
└─────────────────────────────────────────────────┘
`)

  // Run pre-deploy hooks
  if (config.hooks?.preDeploy) {
    console.log('Running pre-deploy hooks...')
    await config.hooks.preDeploy(environment)
  }

  // Route to target
  switch (target) {
    case 'docker':
      await deployDocker(config, environment, { registry, tag, push, force })
      break
    case 'fly':
      await deployFly(config, environment, { force })
      break
    case 'standalone':
      await deployStandalone(config)
      break
    case 'kubernetes':
    case 'k8s':
      await deployKubernetes(
        {
          name: config.name,
          port: config.deploy?.port,
          entrypoint: config.deploy?.entrypoint,
        },
        args.slice(1) // Pass remaining args for K8s options
      )
      break
    case 'cloudrun':
    case 'cloud-run':
      await deployCloudRun(
        {
          name: config.name,
          port: config.deploy?.port,
          entrypoint: config.deploy?.entrypoint,
        },
        args.slice(1) // Pass remaining args for Cloud Run options
      )
      break
    case 'compose':
    case 'docker-compose':
      await deployCompose(
        {
          name: config.name,
          entrypoint: config.deploy?.entrypoint,
        },
        args.slice(1) // Pass remaining args for compose options
      )
      break
    default:
      console.error(`Unknown target: ${target}`)
      console.error('Available: docker, fly, standalone, kubernetes, cloudrun, compose')
      process.exit(1)
  }

  // Run post-deploy hooks
  if (config.hooks?.postDeploy) {
    console.log('Running post-deploy hooks...')
    await config.hooks.postDeploy(environment)
  }
}

// =============================================================================
// Docker Deployment
// =============================================================================

async function deployDocker(
  config: OnePipeConfig,
  env: string,
  options: { registry?: string; tag: string; push: boolean; force: boolean }
) {
  // Check Docker is installed
  if (!await checkCommand('docker')) {
    console.error('Error: Docker is not installed or not in PATH')
    process.exit(1)
  }

  // Validate inputs to prevent command injection
  const appName = validateAppName(config.name)
  const tag = validateImageTag(options.tag)
  const registry = options.registry ? validateRegistry(options.registry) : undefined

  const entrypoint = config.deploy?.entrypoint || './src/index.ts'
  const port = config.deploy?.port || 3000

  // Generate Dockerfile if not exists (or --force)
  const dockerfileExists = await Bun.file('./Dockerfile').exists()
  if (!dockerfileExists || options.force) {
    await generateDockerfile(config, entrypoint, port)
    await generateDockerignore()
    console.log('✓ Generated Dockerfile and .dockerignore')
  }

  // Build image
  console.log('Building Docker image...')
  const imageName = `${appName}:${tag}`
  const buildResult = await exec('docker', ['build', '-t', imageName, '.'])
  if (!buildResult.success) {
    console.error('Docker build failed')
    process.exit(1)
  }
  console.log(`✓ Built image: ${imageName}`)

  // Tag and push if registry specified
  if (registry) {
    const fullTag = `${registry}/${imageName}`
    await exec('docker', ['tag', imageName, fullTag])
    console.log(`✓ Tagged: ${fullTag}`)

    if (options.push) {
      console.log('Pushing to registry...')
      const pushResult = await exec('docker', ['push', fullTag])
      if (!pushResult.success) {
        console.error('Docker push failed. Check your registry authentication.')
        process.exit(1)
      }
      console.log(`✓ Pushed: ${fullTag}`)
    }
  }

  console.log(`
✓ Docker deployment complete
  Run locally: docker run -p ${port}:${port} ${imageName}
`)
}

async function generateDockerfile(config: OnePipeConfig, entrypoint: string, port: number) {
  const dockerfile = `# Generated by OnePipe CLI
FROM oven/bun:1 AS builder
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY . .

# Build
RUN bun build ${entrypoint} --outdir ./dist --target bun --minify

# Production image
FROM oven/bun:1-slim
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
EXPOSE ${port}

CMD ["bun", "run", "./dist/index.js"]
`
  await Bun.write('./Dockerfile', dockerfile)
}

async function generateDockerignore() {
  const dockerignore = `node_modules
.git
.gitignore
*.md
.env*
.DS_Store
dist
coverage
.nyc_output
*.log
`
  await Bun.write('./.dockerignore', dockerignore)
}

// =============================================================================
// Fly.io Deployment
// =============================================================================

async function deployFly(
  config: OnePipeConfig,
  env: string,
  options: { force: boolean }
) {
  // Check flyctl is installed
  if (!await checkCommand('flyctl')) {
    console.error('Error: flyctl is not installed')
    console.error('Install: curl -L https://fly.io/install.sh | sh')
    process.exit(1)
  }

  const envConfig = config.environments[env]
  const port = config.deploy?.port || 3000

  // Generate fly.toml if not exists
  const flyTomlExists = await Bun.file('./fly.toml').exists()
  if (!flyTomlExists || options.force) {
    await generateFlyConfig(config, envConfig, port)
    console.log('✓ Generated fly.toml')
  }

  // Also need Dockerfile for Fly
  const dockerfileExists = await Bun.file('./Dockerfile').exists()
  if (!dockerfileExists || options.force) {
    await generateDockerfile(config, config.deploy?.entrypoint || './src/index.ts', port)
    await generateDockerignore()
    console.log('✓ Generated Dockerfile')
  }

  // Deploy
  console.log('Deploying to Fly.io...')
  const result = await exec('flyctl', ['deploy'])
  if (!result.success) {
    console.error('Fly deployment failed')
    process.exit(1)
  }

  console.log(`
✓ Deployed to Fly.io
`)
}

async function generateFlyConfig(config: OnePipeConfig, envConfig: EnvironmentConfig, port: number) {
  const flyToml = `# Generated by OnePipe CLI
app = "${config.name}"
primary_region = "iad"

[build]

[env]
  NODE_ENV = "production"
  PORT = "${port}"

[http_service]
  internal_port = ${port}
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = ${envConfig.replicas || 0}

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
`
  await Bun.write('./fly.toml', flyToml)
}

// =============================================================================
// Bun Standalone Deployment
// =============================================================================

async function deployStandalone(config: OnePipeConfig) {
  const entrypoint = config.deploy?.entrypoint || './src/index.ts'
  const outfile = `./dist/${config.name}`

  console.log('Building standalone executable...')

  // Bun standalone requires CLI, not Bun.build API
  const result = await exec('bun', [
    'build',
    entrypoint,
    '--compile',
    '--minify',
    '--outfile', outfile
  ])

  if (!result.success) {
    console.error('Standalone build failed')
    process.exit(1)
  }

  console.log(`
✓ Built standalone executable: ${outfile}
  Run: ${outfile}
`)
}


/**
 * Logs command
 */
async function runLogs(args: string[]) {
  const environment = args[0] || 'development'
  const service = getFlag(args, '--service', '-s')

  console.log(`Streaming logs from ${environment}${service ? ` (${service})` : ''}...`)

  // Connect to logs stream
  const config = await loadConfig()
  const envConfig = config.environments[environment]

  if (!envConfig) {
    console.error(`Error: Unknown environment: ${environment}`)
    process.exit(1)
  }

  const streamsUrl = envConfig.streams === 'embedded'
    ? 'http://localhost:9999'
    : envConfig.streams

  const url = `${streamsUrl}/v1/stream/system/logs?live=sse`

  try {
    const eventSource = new EventSource(url)

    eventSource.onmessage = (event) => {
      try {
        const logs = JSON.parse(event.data)
        for (const log of Array.isArray(logs) ? logs : [logs]) {
          const timestamp = new Date(log.timestamp).toISOString()
          const level = log.level?.toUpperCase().padEnd(5) || 'INFO '
          const serviceName = log.service?.padEnd(15) || ''
          console.log(`${timestamp} ${level} [${serviceName}] ${log.message}`)
        }
      } catch {
        console.log(event.data)
      }
    }

    eventSource.onerror = (error) => {
      console.error('Log stream error:', error)
    }

    // Keep running
    await new Promise(() => {})
  } catch (error) {
    console.error('Failed to connect to logs:', error)
    process.exit(1)
  }
}

/**
 * Environment command
 */
async function runEnv(args: string[]) {
  const action = args[0]

  switch (action) {
    case 'list':
      const config = await loadConfig()
      console.log('Environments:')
      for (const [name, env] of Object.entries(config.environments)) {
        console.log(`  ${name}:`)
        console.log(`    streams: ${env.streams}`)
        if (env.database) console.log(`    database: ${env.database}`)
        if (env.replicas) console.log(`    replicas: ${env.replicas}`)
      }
      break

    case 'status':
      console.log('Environment status:')
      // TODO: Implement status check
      break

    default:
      console.error('Usage: onepipe env <list|status>')
      process.exit(1)
  }
}

/**
 * Flows command
 */
async function runFlows(args: string[]) {
  const action = args[0]
  const flowName = args[1]

  const streamsUrl = process.env.ONEPIPE_STREAMS_URL || 'http://localhost:9999'

  switch (action) {
    case 'list':
      const response = await fetch(`${streamsUrl}/v1/streams`)
      const streams = await response.json()
      console.log('Flows:')
      for (const stream of streams) {
        console.log(`  ${stream.name}`)
      }
      break

    case 'read':
      if (!flowName) {
        console.error('Usage: onepipe flows read <flow-name>')
        process.exit(1)
      }
      const readResponse = await fetch(`${streamsUrl}/v1/stream/flows/${flowName}?tail=10`)
      const messages = await readResponse.json()
      console.log(`Last 10 messages from ${flowName}:`)
      console.log(JSON.stringify(messages, null, 2))
      break

    case 'write':
      if (!flowName) {
        console.error('Usage: onepipe flows write <flow-name> <json-data>')
        process.exit(1)
      }
      const data = args[2]
      if (!data) {
        console.error('Usage: onepipe flows write <flow-name> <json-data>')
        process.exit(1)
      }
      await fetch(`${streamsUrl}/v1/stream/flows/${flowName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: data,
      })
      console.log(`Written to ${flowName}`)
      break

    default:
      console.error('Usage: onepipe flows <list|read|write>')
      process.exit(1)
  }
}


/**
 * Helper: Get flag value from args
 */
function getFlag(args: string[], long: string, short?: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === long || args[i] === short) {
      return args[i + 1]
    }
    if (args[i].startsWith(`${long}=`)) {
      return args[i].split('=')[1]
    }
  }
  return undefined
}

/**
 * Load onepipe.config.ts
 */
async function loadConfig(): Promise<OnePipeConfig> {
  const configPath = './onepipe.config.ts'
  const file = Bun.file(configPath)

  if (await file.exists()) {
    const module = await import(Bun.pathToFileURL(configPath).href)
    return module.default as OnePipeConfig
  }

  // Return default config
  return {
    name: 'onepipe-app',
    environments: {
      development: {
        streams: 'embedded',
        database: './dev.db',
      },
      production: {
        streams: 'https://streams.example.com',
      },
    },
  }
}

// Run CLI
main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
