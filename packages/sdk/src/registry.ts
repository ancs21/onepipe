/**
 * Service Registry - Central Configuration for Microservices
 *
 * Provides a centralized way to configure and access service clients.
 * Supports environment variable configuration and health checks.
 *
 * @example
 * ```typescript
 * import { ServiceRegistry } from '@onepipe/sdk'
 *
 * // Define all services in one place
 * export const services = ServiceRegistry.create()
 *   .service('users', process.env.USERS_URL || 'http://localhost:3001')
 *   .service('orders', process.env.ORDERS_URL || 'http://localhost:3002')
 *   .service('payments', process.env.PAYMENTS_URL || 'http://localhost:3003')
 *   .timeout(5000)  // Default timeout for all services
 *   .retry(3)       // Default retries for all services
 *   .build()
 *
 * // Use in handlers
 * const user = await services.users.get<User>('/api/users/123')
 * const order = await services.orders.post<Order>('/api/orders', { userId: user.id })
 * ```
 */

import { ServiceClient, type ServiceClientInstance } from './service-client'

// ============================================================================
// Types
// ============================================================================

export interface ServiceRegistryOptions {
  /** Default timeout for all services (ms) */
  timeout: number
  /** Default retries for all services */
  retries: number
  /** Default retry delay (ms) */
  retryDelay: number
  /** Default headers for all services */
  headers: Record<string, string>
}

export interface ServiceConfig {
  name: string
  url: string
  timeout?: number
  retries?: number
  retryDelay?: number
  headers?: Record<string, string>
}

export type ServiceRegistryInstance<T extends Record<string, ServiceClientInstance>> = T & {
  /** Get all registered service names */
  readonly serviceNames: string[]
  /** Check health of all services */
  healthCheck(): Promise<Record<string, { healthy: boolean; latency?: number; error?: string }>>
}

// ============================================================================
// Builder
// ============================================================================

class ServiceRegistryBuilder {
  private services: ServiceConfig[] = []
  private options: ServiceRegistryOptions = {
    timeout: 30000,
    retries: 0,
    retryDelay: 1000,
    headers: {},
  }

  /**
   * Register a service with its URL
   */
  service(name: string, url: string): this {
    this.services.push({ name, url })
    return this
  }

  /**
   * Set default timeout for all services
   */
  timeout(ms: number): this {
    this.options.timeout = ms
    return this
  }

  /**
   * Set default retries for all services
   */
  retry(count: number, delayMs = 1000): this {
    this.options.retries = count
    this.options.retryDelay = delayMs
    return this
  }

  /**
   * Add default headers for all services
   */
  headers(headers: Record<string, string>): this {
    Object.assign(this.options.headers, headers)
    return this
  }

  /**
   * Build the service registry
   */
  build<T extends Record<string, ServiceClientInstance> = Record<string, ServiceClientInstance>>(): ServiceRegistryInstance<T> {
    const clients: Record<string, ServiceClientInstance> = {}

    for (const config of this.services) {
      const client = ServiceClient.create(config.name)
        .baseUrl(config.url)
        .timeout(config.timeout ?? this.options.timeout)
        .retry(config.retries ?? this.options.retries, config.retryDelay ?? this.options.retryDelay)
        .headers(this.options.headers)

      // Add service-specific headers
      if (config.headers) {
        client.headers(config.headers)
      }

      clients[config.name] = client.build()
    }

    // Add metadata and helper methods
    const serviceNames = this.services.map(s => s.name)

    const healthCheck = async (): Promise<Record<string, { healthy: boolean; latency?: number; error?: string }>> => {
      const results: Record<string, { healthy: boolean; latency?: number; error?: string }> = {}

      await Promise.all(
        this.services.map(async (config) => {
          const startTime = performance.now()
          try {
            // Try to call health endpoint
            const response = await fetch(`${config.url}/health`, {
              signal: AbortSignal.timeout(5000),
            })
            const latency = Math.round(performance.now() - startTime)

            if (response.ok) {
              results[config.name] = { healthy: true, latency }
            } else {
              results[config.name] = {
                healthy: false,
                latency,
                error: `HTTP ${response.status}`,
              }
            }
          } catch (error) {
            const latency = Math.round(performance.now() - startTime)
            results[config.name] = {
              healthy: false,
              latency,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          }
        })
      )

      return results
    }

    return Object.assign(clients, { serviceNames, healthCheck }) as ServiceRegistryInstance<T>
  }
}

// ============================================================================
// Environment Helper
// ============================================================================

/**
 * Get service URL from environment variable
 * Converts service name to uppercase with _URL suffix
 *
 * @example
 * ```typescript
 * // If USERS_SERVICE_URL=http://users:3000 is set
 * const url = getServiceUrl('users', 'http://localhost:3001')
 * // Returns: http://users:3000
 *
 * // If not set, returns fallback
 * const url = getServiceUrl('payments', 'http://localhost:3003')
 * // Returns: http://localhost:3003
 * ```
 */
export function getServiceUrl(name: string, fallback: string): string {
  const envName = `${name.toUpperCase().replace(/-/g, '_')}_SERVICE_URL`
  return process.env[envName] || fallback
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a new service registry for managing service clients.
 *
 * @example
 * ```typescript
 * export const services = ServiceRegistry.create()
 *   .service('users', getServiceUrl('users', 'http://localhost:3001'))
 *   .service('orders', getServiceUrl('orders', 'http://localhost:3002'))
 *   .timeout(5000)
 *   .retry(3)
 *   .build()
 * ```
 */
export const ServiceRegistry = {
  create(): ServiceRegistryBuilder {
    return new ServiceRegistryBuilder()
  },
}
