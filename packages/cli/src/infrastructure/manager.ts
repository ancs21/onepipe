/**
 * Infrastructure Manager
 *
 * Orchestrates provisioning of all required infrastructure
 */

import { type InfrastructureType, INFRASTRUCTURE_CONFIG } from '../discovery/patterns'
import { ensurePostgres, type PostgresResult } from './postgres'
import { ensureRedis, type RedisResult } from './redis'
import { detectContainerRuntime } from './containers'

export interface ProvisionResult {
  env: Record<string, string>
  services: Array<{
    type: InfrastructureType
    url: string
    host: string
    port: number
    runtime: string | null
  }>
  errors: string[]
}

/**
 * Infrastructure Manager
 * Provisions required services based on discovery results
 */
export class InfrastructureManager {
  private services: Map<InfrastructureType, { url: string; host: string; port: number; runtime: string | null }> = new Map()
  private errors: string[] = []

  /**
   * Provision all required infrastructure
   * @param requirements List of infrastructure types needed
   * @returns Environment variables and service details
   */
  async provision(requirements: InfrastructureType[]): Promise<ProvisionResult> {
    // Deduplicate requirements
    const uniqueRequirements = [...new Set(requirements)]

    if (uniqueRequirements.length === 0) {
      return { env: {}, services: [], errors: [] }
    }

    // Check for container runtime
    const runtime = await detectContainerRuntime()
    if (!runtime && uniqueRequirements.length > 0) {
      // Check if all requirements are satisfied by environment variables
      const unsatisfied = uniqueRequirements.filter((type) => {
        const envVar = INFRASTRUCTURE_CONFIG[type].envVar
        return !process.env[envVar]
      })

      if (unsatisfied.length > 0) {
        this.errors.push(`No container runtime found (Docker or Apple Container). Cannot provision: ${unsatisfied.join(', ')}`)
        return {
          env: {},
          services: [],
          errors: this.errors,
        }
      }
    }

    // Provision services in parallel
    const provisions = uniqueRequirements.map(async (type) => {
      try {
        switch (type) {
          case 'postgresql':
            return { type, result: await ensurePostgres() }
          case 'redis':
            return { type, result: await ensureRedis() }
          case 'mysql':
            // TODO: Implement MySQL support
            this.errors.push('MySQL provisioning not yet implemented')
            return { type, result: null }
          default:
            return { type, result: null }
        }
      } catch (error) {
        this.errors.push(`Failed to provision ${type}: ${error}`)
        return { type, result: null }
      }
    })

    const results = await Promise.all(provisions)

    // Build environment variables
    const env: Record<string, string> = {}

    for (const { type, result } of results) {
      if (result) {
        const config = INFRASTRUCTURE_CONFIG[type]
        env[config.envVar] = result.url
        this.services.set(type, {
          url: result.url,
          host: result.host,
          port: result.port,
          runtime: result.runtime,
        })
      }
    }

    return {
      env,
      services: Array.from(this.services.entries()).map(([type, data]) => ({
        type,
        ...data,
      })),
      errors: this.errors,
    }
  }

  /**
   * Get a provisioned service
   */
  getService(type: InfrastructureType): { url: string; host: string; port: number; runtime: string | null } | undefined {
    return this.services.get(type)
  }

  /**
   * Check if a service was provisioned
   */
  hasService(type: InfrastructureType): boolean {
    return this.services.has(type)
  }

  /**
   * Get all errors that occurred during provisioning
   */
  getErrors(): string[] {
    return this.errors
  }
}

/**
 * Create a new infrastructure manager
 */
export function createInfrastructureManager(): InfrastructureManager {
  return new InfrastructureManager()
}
