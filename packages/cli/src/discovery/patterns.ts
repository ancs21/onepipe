/**
 * Primitive Detection Patterns
 *
 * Regex patterns for detecting SDK primitives in code
 */

export type InfrastructureType = 'postgresql' | 'redis' | 'mysql'

export interface PatternDefinition {
  name: string
  regex: RegExp
  infrastructure: InfrastructureType | null
  reason?: string
}

/**
 * Patterns for detecting infrastructure needs
 */
export const INFRASTRUCTURE_PATTERNS: PatternDefinition[] = [
  // Database backends
  {
    name: 'postgres',
    regex: /\.postgres\s*\(/,
    infrastructure: 'postgresql',
  },
  {
    name: 'mysql',
    regex: /\.mysql\s*\(/,
    infrastructure: 'mysql',
  },
  {
    name: 'sqlite',
    regex: /\.sqlite\s*\(/,
    infrastructure: null, // No container needed
  },

  // Cache (Redis)
  {
    name: 'redis',
    regex: /Cache\.create\s*\([^)]*\)[\s\S]*?\.redis\s*\(/,
    infrastructure: 'redis',
  },
  // Also catch direct .redis() calls
  {
    name: 'redis-direct',
    regex: /\.redis\s*\(\s*['"`]/,
    infrastructure: 'redis',
  },

  // PostgreSQL-required primitives
  {
    name: 'workflow',
    regex: /Workflow\.create\s*\(/,
    infrastructure: 'postgresql',
    reason: 'Workflows require PostgreSQL for durable execution',
  },
  {
    name: 'cron',
    regex: /Cron\.create\s*\(/,
    infrastructure: 'postgresql',
    reason: 'Cron jobs require PostgreSQL for persistence',
  },
]

/**
 * Patterns for detecting primitives (not necessarily infrastructure)
 */
export const PRIMITIVE_PATTERNS: PatternDefinition[] = [
  ...INFRASTRUCTURE_PATTERNS,
  // No infrastructure needed, but useful for discovery output
  {
    name: 'flow',
    regex: /Flow\.create\s*\(/,
    infrastructure: null,
  },
  {
    name: 'signal',
    regex: /Signal\.create\s*\(/,
    infrastructure: null,
  },
  {
    name: 'rest',
    regex: /REST\.create\s*\(/,
    infrastructure: null,
  },
  {
    name: 'channel',
    regex: /Channel\.create\s*\(/,
    infrastructure: null,
  },
  {
    name: 'projection',
    regex: /Projection\.create\s*\(/,
    infrastructure: null,
  },
  {
    name: 'auth',
    regex: /Auth\.create\s*\(/,
    infrastructure: null,
  },
  {
    name: 'storage',
    regex: /Storage\.create\s*\(/,
    infrastructure: null,
  },
  // Service-to-service communication
  {
    name: 'service-client',
    regex: /ServiceClient\.create\s*\(/,
    infrastructure: null,
  },
  {
    name: 'service-registry',
    regex: /ServiceRegistry\.create\s*\(/,
    infrastructure: null,
  },
]

/**
 * Infrastructure configuration for auto-provisioning
 */
export const INFRASTRUCTURE_CONFIG: Record<
  InfrastructureType,
  {
    image: string
    containerName: string
    port: number
    envVar: string
    healthCheck: string[]
    credentials: Record<string, string>
  }
> = {
  postgresql: {
    image: 'postgres:18-alpine',
    containerName: 'onepipe-postgres',
    port: 5432,
    envVar: 'DATABASE_URL',
    healthCheck: ['pg_isready', '-U', 'postgres'],
    credentials: { user: 'postgres', password: 'postgres', database: 'onepipe' },
  },
  redis: {
    image: 'redis:7-alpine',
    containerName: 'onepipe-redis',
    port: 6379,
    envVar: 'REDIS_URL',
    healthCheck: ['redis-cli', 'ping'],
    credentials: {},
  },
  mysql: {
    image: 'mysql:8',
    containerName: 'onepipe-mysql',
    port: 3306,
    envVar: 'MYSQL_URL',
    healthCheck: ['mysqladmin', 'ping', '-h', 'localhost'],
    credentials: { user: 'root', password: 'mysql', database: 'onepipe' },
  },
}
