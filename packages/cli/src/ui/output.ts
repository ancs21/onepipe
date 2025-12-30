/**
 * CLI Output Functions
 *
 * High-level output functions for the OnePipe CLI
 */

import type { DiscoveryResult } from '../discovery'
import type { ProvisionResult } from '../infrastructure'
import { c, s, pad } from './terminal'
import { box, keyValueBox, errorBox, headerBox, section } from './box'

/**
 * Print styled header
 */
export function printHeader(): void {
  console.log('')
  console.log(headerBox())
  console.log('')
}

/**
 * Print entrypoint detection result
 */
export function printEntrypoint(path: string, source: string): void {
  console.log(`${c.green}${s.check}${c.reset} ${pad('Entrypoint', 14)}${c.cyan}${path}${c.reset}`)
  console.log(`  ${c.dim}(from ${source})${c.reset}`)
  console.log('')
}

/**
 * Print discovery results
 */
export function printDiscovery(result: DiscoveryResult): void {
  console.log(`${c.green}${s.check}${c.reset} ${pad('Analyzed', 14)}${result.analyzedFiles.length} files ${c.dim}(${result.duration.toFixed(0)}ms)${c.reset}`)
  console.log('')

  // Group primitives by type
  const byType = new Map<string, number>()
  for (const p of result.primitives) {
    byType.set(p.type, (byType.get(p.type) || 0) + 1)
  }

  if (byType.size > 0) {
    const items: string[] = []
    for (const [type, count] of byType) {
      const label = formatPrimitiveType(type)
      const countStr = count > 1 ? `${c.dim}(${count})${c.reset}` : ''
      items.push(`${pad(label, 18)}${countStr}`)
    }
    console.log(section('Discovered', items))
    console.log('')
  }

  // Infrastructure requirements
  if (result.infrastructure.length > 0) {
    const items: string[] = []
    for (const infra of result.infrastructure) {
      const reasons = infra.requestedBy.join(', ')
      items.push(`${pad(formatInfraType(infra.type), 14)}${c.dim}(${reasons})${c.reset}`)
    }
    console.log(section('Infrastructure', items))
    console.log('')
  } else {
    console.log(`  ${c.dim}No infrastructure needed${c.reset}`)
    console.log('')
  }
}

/**
 * Print infrastructure provisioning status
 */
export function printProvisioning(types: string[]): void {
  if (types.length === 0) return
  // Note: This is called before spinner starts, so just a simple message
}

/**
 * Print provisioned service
 */
export function printProvisionedService(type: string, host: string, port: number, runtime: string | null): void {
  const runtimeLabel = runtime ? ` ${c.dim}(${runtime})${c.reset}` : ''
  console.log(`${c.green}${s.check}${c.reset} ${pad(formatInfraType(type), 14)}${c.cyan}${host}:${port}${c.reset}${runtimeLabel}`)
}

/**
 * Print provision result
 */
export function printProvisionResult(result: ProvisionResult): void {
  for (const service of result.services) {
    printProvisionedService(service.type, service.host, service.port, service.runtime)
  }

  for (const error of result.errors) {
    console.log(`${c.red}${s.cross}${c.reset} ${error}`)
  }

  if (result.services.length > 0 || result.errors.length > 0) {
    console.log('')
  }
}

/**
 * Print ready message with URLs
 */
export function printReady(config: {
  appPort: number
  dashboardPort?: number
  dashboardApiPort?: number
  streamsPort?: number
}): void {
  const data: Record<string, string> = {
    'App': `http://localhost:${config.appPort}`,
  }

  if (config.dashboardPort) {
    data['Dashboard'] = `http://localhost:${config.dashboardPort}`
  }

  if (config.dashboardApiPort) {
    data['Dashboard API'] = `http://localhost:${config.dashboardApiPort}`
  }

  if (config.streamsPort) {
    data['Streams'] = `http://localhost:${config.streamsPort}`
  }

  console.log(keyValueBox('Ready', data))
  console.log('')
}

/**
 * Print error message
 */
export function printError(message: string, details?: string): void {
  console.log('')
  console.log(errorBox('Error', message, details))
  console.log('')
}

/**
 * Print warning message
 */
export function printWarning(message: string): void {
  console.log(`${c.yellow}${s.warning}${c.reset} ${message}`)
}

/**
 * Print info message
 */
export function printInfo(message: string): void {
  console.log(`${c.blue}${s.info}${c.reset} ${message}`)
}

/**
 * Format primitive type for display
 */
function formatPrimitiveType(type: string): string {
  const labels: Record<string, string> = {
    postgres: 'PostgreSQL',
    mysql: 'MySQL',
    sqlite: 'SQLite',
    redis: 'Redis',
    'redis-direct': 'Redis',
    workflow: 'Workflow',
    cron: 'Cron Job',
    flow: 'Flow',
    signal: 'Signal',
    rest: 'REST API',
    channel: 'Channel',
    projection: 'Projection',
    auth: 'Auth',
    storage: 'Storage',
  }
  return labels[type] || type
}

/**
 * Format infrastructure type for display
 */
function formatInfraType(type: string): string {
  const labels: Record<string, string> = {
    postgresql: 'PostgreSQL',
    redis: 'Redis',
    mysql: 'MySQL',
  }
  return labels[type] || type
}
