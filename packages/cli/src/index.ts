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
OnePipe CLI v0.1.0

Usage: onepipe <command> [options]

Commands:
  dev                Start development server with hot reload
  deploy <env>       Deploy to environment (staging, production)
  migrate <action>   Run database migrations (up, down, status)
  logs <env>         Stream logs from environment
  env <action>       Manage environments (list, status)
  flows <action>     Manage flows (list, read, write)
  db <action>        Database utilities (seed, reset, console)

Options:
  -h, --help         Show this help message
  -v, --version      Show version number

Deploy Options:
  --target, -t       Target: docker (default), fly, standalone
  --registry, -r     Docker registry (e.g., ghcr.io/username)
  --tag              Image tag (default: latest)
  --push             Push image to registry after build
  --force            Overwrite existing Dockerfile/fly.toml

Examples:
  onepipe dev                                    # Start dev server
  onepipe deploy production                      # Docker build
  onepipe deploy production --push -r ghcr.io/x # Build and push
  onepipe deploy production --target fly        # Deploy to Fly.io
  onepipe deploy production --target standalone # Build executable
  onepipe migrate up                            # Run migrations
  onepipe logs production                       # Stream logs
`)
}

/**
 * Development server command
 */
async function runDev(args: string[]) {
  const port = getFlag(args, '--port', '-p') || '3000'
  const entrypoint = args.find(a => !a.startsWith('-')) || './src/index.ts'

  console.log(`
┌─────────────────────────────────────────────────┐
│                                                 │
│   ⚡ OnePipe Development Server                 │
│                                                 │
│   Starting...                                   │
│                                                 │
└─────────────────────────────────────────────────┘
`)

  // Set development environment
  process.env.NODE_ENV = 'development'
  process.env.ONEPIPE_PORT = port

  // Check if entrypoint exists
  const file = Bun.file(entrypoint)
  if (!await file.exists()) {
    console.error(`Error: Entrypoint not found: ${entrypoint}`)
    console.error('Create a src/index.ts file or specify an entrypoint')
    process.exit(1)
  }

  // Import and run the application
  try {
    await import(Bun.pathToFileURL(entrypoint).href)
  } catch (error) {
    console.error('Failed to start development server:')
    console.error(error)
    process.exit(1)
  }
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
    default:
      console.error(`Unknown target: ${target}`)
      console.error('Available: docker, fly, standalone')
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
  const imageName = `${config.name}:${options.tag}`
  const buildResult = await exec('docker', ['build', '-t', imageName, '.'])
  if (!buildResult.success) {
    console.error('Docker build failed')
    process.exit(1)
  }
  console.log(`✓ Built image: ${imageName}`)

  // Tag and push if registry specified
  if (options.registry) {
    const fullTag = `${options.registry}/${imageName}`
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
 * Migrate command
 */
async function runMigrate(args: string[]) {
  const action = args[0]

  switch (action) {
    case 'up':
      console.log('Running pending migrations...')
      // TODO: Implement migration up
      break

    case 'down':
      console.log('Rolling back last migration...')
      // TODO: Implement migration down
      break

    case 'status':
      console.log('Migration status:')
      // TODO: Implement migration status
      break

    default:
      console.error('Usage: onepipe migrate <up|down|status>')
      process.exit(1)
  }
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
 * Database command
 */
async function runDB(args: string[]) {
  const action = args[0]

  switch (action) {
    case 'seed':
      console.log('Running database seeds...')
      // TODO: Implement seeding
      break

    case 'reset':
      console.log('Resetting database...')
      // TODO: Implement reset
      break

    case 'console':
      console.log('Starting database console...')
      // TODO: Implement console
      break

    default:
      console.error('Usage: onepipe db <seed|reset|console>')
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
