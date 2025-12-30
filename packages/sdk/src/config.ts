/**
 * Config - Type-safe Configuration
 *
 * Define and validate application configuration
 *
 * @example
 * ```typescript
 * // onepipe.config.ts
 * import { defineConfig } from '@onepipe/sdk'
 *
 * export default defineConfig({
 *   name: 'my-app',
 *
 *   environments: {
 *     local: {
 *       streams: 'embedded',
 *       database: 'sqlite:./local.db',
 *     },
 *     staging: {
 *       streams: 'https://streams.staging.example.com',
 *       database: process.env.STAGING_DATABASE_URL,
 *       redis: process.env.STAGING_REDIS_URL,
 *     },
 *     production: {
 *       streams: 'https://streams.example.com',
 *       database: process.env.DATABASE_URL,
 *       redis: process.env.REDIS_URL,
 *       replicas: 3,
 *     },
 *   },
 *
 *   hooks: {
 *     preDeploy: async (env) => {
 *       console.log(`Deploying to ${env}`)
 *     },
 *     postDeploy: async (env) => {
 *       console.log(`Deployed to ${env}`)
 *     },
 *   },
 * })
 * ```
 */

import type { OnePipeConfig, EnvironmentConfig, DeployHooks } from './types'

/**
 * Define OnePipe configuration with type safety
 */
export function defineConfig(config: OnePipeConfig): OnePipeConfig {
  validateConfig(config)
  return config
}

/**
 * Validate configuration
 */
function validateConfig(config: OnePipeConfig): void {
  if (!config.name) {
    throw new Error('Config requires a name')
  }

  if (!config.environments || Object.keys(config.environments).length === 0) {
    throw new Error('Config requires at least one environment')
  }

  // Validate services if defined
  if (config.services) {
    const serviceNames = new Set<string>()
    for (const service of config.services) {
      // Validate required fields
      if (!service.name) {
        throw new Error('Service requires a name')
      }
      if (!service.entrypoint) {
        throw new Error(`Service "${service.name}" requires an entrypoint`)
      }

      // Check for duplicate names
      if (serviceNames.has(service.name)) {
        throw new Error(`Duplicate service name: "${service.name}"`)
      }
      serviceNames.add(service.name)

      // Validate port range
      if (service.port !== undefined && (service.port < 1 || service.port > 65535)) {
        throw new Error(`Service "${service.name}" has invalid port: ${service.port}`)
      }

      // Validate depends references
      if (service.depends) {
        for (const dep of service.depends) {
          if (!config.services.some(s => s.name === dep)) {
            throw new Error(`Service "${service.name}" depends on unknown service: "${dep}"`)
          }
        }
      }
    }
  }

  for (const [envName, envConfig] of Object.entries(config.environments)) {
    if (!envConfig.streams) {
      throw new Error(`Environment "${envName}" requires streams configuration`)
    }

    // Validate streams URL format (if not embedded)
    if (envConfig.streams !== 'embedded') {
      try {
        new URL(envConfig.streams)
      } catch {
        throw new Error(`Invalid streams URL in environment "${envName}": ${envConfig.streams}`)
      }
    }

    // Validate database URL format (if provided)
    if (envConfig.database && !envConfig.database.startsWith('sqlite:')) {
      try {
        new URL(envConfig.database)
      } catch {
        throw new Error(`Invalid database URL in environment "${envName}": ${envConfig.database}`)
      }
    }

    // Validate redis URL format (if provided)
    if (envConfig.redis) {
      try {
        new URL(envConfig.redis)
      } catch {
        throw new Error(`Invalid redis URL in environment "${envName}": ${envConfig.redis}`)
      }
    }
  }
}

/**
 * Get configuration for current environment
 */
export function getEnvironmentConfig(
  config: OnePipeConfig,
  env?: string
): EnvironmentConfig & { name: string } {
  const envName = env || process.env.ONEPIPE_ENV || process.env.NODE_ENV || 'local'
  const envConfig = config.environments[envName]

  if (!envConfig) {
    const available = Object.keys(config.environments).join(', ')
    throw new Error(
      `Environment "${envName}" not found in config. Available: ${available}`
    )
  }

  return {
    name: envName,
    ...envConfig,
  }
}

/**
 * Load configuration from file
 */
export async function loadConfig(configPath?: string): Promise<OnePipeConfig> {
  const paths = configPath
    ? [configPath]
    : [
        './onepipe.config.ts',
        './onepipe.config.js',
        './config/onepipe.ts',
        './config/onepipe.js',
      ]

  for (const path of paths) {
    try {
      const file = Bun.file(path)
      if (await file.exists()) {
        const module = await import(path)
        return module.default || module
      }
    } catch {
      // Try next path
    }
  }

  throw new Error(
    `No configuration file found. Tried: ${paths.join(', ')}`
  )
}

/**
 * Configuration builder for programmatic configuration
 */
export class ConfigBuilder {
  private config: Partial<OnePipeConfig> = {
    environments: {},
  }

  /**
   * Set application name
   */
  name(name: string): this {
    this.config.name = name
    return this
  }

  /**
   * Add environment configuration
   */
  environment(name: string, config: EnvironmentConfig): this {
    if (!this.config.environments) {
      this.config.environments = {}
    }
    this.config.environments[name] = config
    return this
  }

  /**
   * Add local environment with embedded streams
   */
  local(overrides?: Partial<EnvironmentConfig>): this {
    return this.environment('local', {
      streams: 'embedded',
      ...overrides,
    })
  }

  /**
   * Set deploy hooks
   */
  hooks(hooks: DeployHooks): this {
    this.config.hooks = hooks
    return this
  }

  /**
   * Build the configuration
   */
  build(): OnePipeConfig {
    if (!this.config.name) {
      throw new Error('Config requires a name. Use .name()')
    }
    if (!this.config.environments || Object.keys(this.config.environments).length === 0) {
      throw new Error('Config requires at least one environment. Use .environment() or .local()')
    }
    return this.config as OnePipeConfig
  }
}

/**
 * Config entry point
 */
export const Config = {
  /**
   * Define configuration (for onepipe.config.ts)
   */
  define: defineConfig,

  /**
   * Create configuration builder
   */
  create(): ConfigBuilder {
    return new ConfigBuilder()
  },

  /**
   * Load configuration from file
   */
  load: loadConfig,

  /**
   * Get environment configuration
   */
  getEnv: getEnvironmentConfig,
}
