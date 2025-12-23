#!/usr/bin/env bun
import { parseArgs } from 'util'
import { spawn, type Subprocess } from 'bun'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const VERSION = '0.1.0'

const HELP = `
  ╭─────────────────────────────────────╮
  │                                     │
  │   ▒█████   ███▄    █ ▓█████         │
  │  ▒██▒  ██▒ ██ ▀█   █ ▓█   ▀         │
  │  ▒██░  ██▒▓██  ▀█ ██▒▒███           │
  │  ▒██   ██░▓██▒  ▐▌██▒▒▓█  ▄         │
  │  ░ ████▓▒░▒██░   ▓██░░▒████▒        │
  │  ░ ▒░▒░▒░ ░ ▒░   ▒ ▒ ░░ ▒░ ░        │
  │    ░ ▒ ▒░ ░ ░░   ░ ▒░ ░ ░  ░        │
  │         PIPE                        │
  │         OnePipe SDK v${VERSION}          │
  ╰─────────────────────────────────────╯

  Usage: onepipe <command> [options]

  Commands:
    dev         Start development server with dashboard
    dashboard   Start dashboard only (standalone)
    version     Show version

  Options:
    -h, --help      Show this help message
    -p, --port      Dashboard port (default: 4000)
    -a, --app       App entry file (default: auto-detect)
    --app-port      App server port (default: 3001)
    --dev           Run dashboard with Vite dev server (hot-reload)

  Examples:
    $ onepipe dev --app ./src/server.ts
    $ onepipe dev --dev                    # with Vite hot-reload
    $ onepipe dashboard --port 4000
`

interface CLIOptions {
  port: number
  appPort: number
  app?: string
  help: boolean
  dev: boolean
}

function parseOptions(): { command: string; options: CLIOptions } {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      port: { type: 'string', short: 'p', default: '4000' },
      app: { type: 'string', short: 'a' },
      'app-port': { type: 'string', default: '3001' },
      dev: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })

  return {
    command: positionals[0] || 'help',
    options: {
      port: parseInt(values.port as string, 10),
      appPort: parseInt(values['app-port'] as string, 10),
      app: values.app as string | undefined,
      help: values.help as boolean,
      dev: values.dev as boolean,
    },
  }
}

function findAppEntry(): string | null {
  const cwd = process.cwd()

  // Standard entry points
  const candidates = [
    'src/index.ts',
    'src/server.ts',
    'src/app.ts',
    'src/main.ts',
    'index.ts',
    'server.ts',
    'app.ts',
    'main.ts',
  ]

  for (const candidate of candidates) {
    if (existsSync(resolve(cwd, candidate))) {
      return candidate
    }
  }

  // Auto-discover: find any .ts file that imports @onepipe/sdk
  try {
    const files = require('fs').readdirSync(cwd)
    const tsFiles = files
      .filter((f: string) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .sort() // Sort for predictable order (01-xxx before 02-xxx)

    for (const file of tsFiles) {
      const content = require('fs').readFileSync(resolve(cwd, file), 'utf-8')
      // Look for OnePipe SDK usage patterns
      const hasSDK = content.includes('@onepipe/sdk')
      const hasServer = content.includes('Bun.serve') || content.includes('.start(') || content.includes('.listen(')
      if (hasSDK && hasServer) {
        return file
      }
    }
  } catch {
    // Ignore errors
  }

  return null
}

function findDashboardPath(): string {
  const cwd = process.cwd()

  // Try relative to this CLI (in node_modules)
  const candidates = [
    join(__dirname, '../../dashboard'),
    join(__dirname, '../../../dashboard'),
    join(cwd, 'node_modules/@onepipe/dashboard'),
    join(cwd, 'packages/dashboard'),
    // From subdirectories like examples/
    join(cwd, '../packages/dashboard'),
    join(cwd, '../../packages/dashboard'),
    // Monorepo root
    join(cwd, '../node_modules/@onepipe/dashboard'),
  ]

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json'))) {
      return candidate
    }
  }

  throw new Error('Could not find @onepipe/dashboard package. Run from project root or install @onepipe/dashboard.')
}

async function startDashboardAPI(port: number, dashboardPath: string, appPort: number): Promise<Subprocess> {
  console.log(`\x1b[35m◆\x1b[0m Starting dashboard API on \x1b[1mhttp://localhost:${port}\x1b[0m`)

  const proc = spawn({
    cmd: ['bun', 'run', 'server/standalone.ts'],
    cwd: dashboardPath,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      PORT: port.toString(),
      APP_PORT: appPort.toString(),
      FORCE_COLOR: '1',
    },
  })

  const streamOutput = async (stream: ReadableStream<Uint8Array>, prefix: string) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value)
      for (const line of text.split('\n').filter(Boolean)) {
        console.log(`\x1b[90m${prefix}\x1b[0m ${line}`)
      }
    }
  }

  streamOutput(proc.stdout, '[api]')
  streamOutput(proc.stderr, '[api]')

  return proc
}

async function startDashboard(port: number, appPort: number, devMode: boolean = true): Promise<Subprocess[]> {
  const dashboardPath = findDashboardPath()
  const processes: Subprocess[] = []
  const distPath = join(dashboardPath, 'dist', 'index.html')

  // In dev mode, or if dist doesn't exist, run Vite
  const useVite = devMode || !existsSync(distPath)

  if (useVite) {
    // Start dashboard API server on port+1 (e.g., 4001)
    const apiPort = port + 1
    const apiProc = await startDashboardAPI(apiPort, dashboardPath, appPort)
    processes.push(apiProc)

    // Small delay to let API start
    await new Promise((resolve) => setTimeout(resolve, 300))

    console.log(`\x1b[36m◆\x1b[0m Starting dashboard UI on \x1b[1mhttp://localhost:${port}\x1b[0m`)

    const proc = spawn({
      cmd: ['bun', 'run', 'dev', '--port', port.toString()],
      cwd: dashboardPath,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        FORCE_COLOR: '1',
      },
    })

    // Stream output with prefix
    const streamOutput = async (stream: ReadableStream<Uint8Array>, prefix: string) => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        for (const line of text.split('\n').filter(Boolean)) {
          console.log(`\x1b[90m${prefix}\x1b[0m ${line}`)
        }
      }
    }

    streamOutput(proc.stdout, '[dashboard]')
    streamOutput(proc.stderr, '[dashboard]')
    processes.push(proc)
  } else {
    // Production mode: serve built files via dashboard server
    console.log(`\x1b[36m◆\x1b[0m Starting dashboard on \x1b[1mhttp://localhost:${port}\x1b[0m`)

    const proc = spawn({
      cmd: ['bun', 'run', 'server/standalone.ts'],
      cwd: dashboardPath,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PORT: port.toString(),
        APP_PORT: appPort.toString(),
        FORCE_COLOR: '1',
      },
    })

    const streamOutput = async (stream: ReadableStream<Uint8Array>, prefix: string) => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        for (const line of text.split('\n').filter(Boolean)) {
          console.log(`\x1b[90m${prefix}\x1b[0m ${line}`)
        }
      }
    }

    streamOutput(proc.stdout, '[dashboard]')
    streamOutput(proc.stderr, '[dashboard]')
    processes.push(proc)
  }

  return processes
}

async function startApp(entry: string, port: number, dashboardApiPort: number): Promise<Subprocess> {
  console.log(`\x1b[32m◆\x1b[0m Starting app \x1b[1m${entry}\x1b[0m on port \x1b[1m${port}\x1b[0m`)

  const proc = spawn({
    cmd: ['bun', '--watch', entry],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      PORT: port.toString(),
      ONEPIPE_DASHBOARD: 'true',
      ONEPIPE_DASHBOARD_URL: `http://localhost:${dashboardApiPort}`,
      FORCE_COLOR: '1',
    },
  })

  const streamOutput = async (stream: ReadableStream<Uint8Array>, prefix: string) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value)
      for (const line of text.split('\n').filter(Boolean)) {
        console.log(`\x1b[90m${prefix}\x1b[0m ${line}`)
      }
    }
  }

  streamOutput(proc.stdout, '[app]')
  streamOutput(proc.stderr, '[app]')

  return proc
}

async function devCommand(options: CLIOptions): Promise<void> {
  const entry = options.app || findAppEntry()

  console.log()
  console.log('\x1b[1m  OnePipe Development Server\x1b[0m')
  console.log()

  const processes: Subprocess[] = []

  // Start dashboard (returns array of processes: API + UI or just built server)
  const dashboardProcs = await startDashboard(options.port, options.appPort, options.dev)
  processes.push(...dashboardProcs)

  // Start app if found
  if (entry) {
    // Small delay to let dashboard start first
    await new Promise((resolve) => setTimeout(resolve, 500))
    // In dev mode, API is on port+1. In prod mode, API is on same port as UI
    const dashboardApiPort = options.dev ? options.port + 1 : options.port
    const appProc = await startApp(entry, options.appPort, dashboardApiPort)
    processes.push(appProc)
  } else {
    console.log('\x1b[33m◆\x1b[0m No app entry found. Use --app to specify.')
    console.log('  Dashboard running in standalone mode.')
  }

  console.log()
  console.log('\x1b[90m  Press Ctrl+C to stop\x1b[0m')
  console.log()

  // Handle graceful shutdown
  const shutdown = () => {
    console.log('\n\x1b[90m  Shutting down...\x1b[0m')
    for (const proc of processes) {
      proc.kill()
    }
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // Wait for processes
  await Promise.all(processes.map((p) => p.exited))
}

async function dashboardCommand(options: CLIOptions): Promise<void> {
  console.log()
  console.log('\x1b[1m  OnePipe Dashboard\x1b[0m')
  console.log()

  const processes = await startDashboard(options.port, options.appPort)

  console.log()
  console.log('\x1b[90m  Press Ctrl+C to stop\x1b[0m')
  console.log()

  process.on('SIGINT', () => {
    for (const proc of processes) {
      proc.kill()
    }
    process.exit(0)
  })

  await Promise.all(processes.map((p) => p.exited))
}

async function main(): Promise<void> {
  const { command, options } = parseOptions()

  if (options.help || command === 'help') {
    console.log(HELP)
    process.exit(0)
  }

  switch (command) {
    case 'dev':
      await devCommand(options)
      break

    case 'dashboard':
      await dashboardCommand(options)
      break

    case 'version':
      console.log(`onepipe v${VERSION}`)
      break

    default:
      console.error(`Unknown command: ${command}`)
      console.log(HELP)
      process.exit(1)
  }
}

main().catch((error) => {
  console.error('\x1b[31mError:\x1b[0m', error.message)
  process.exit(1)
})
