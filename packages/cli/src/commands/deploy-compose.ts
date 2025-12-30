/**
 * Docker Compose Deployment Command
 *
 * Generates Docker Compose with Traefik gateway for OnePipe applications
 *
 * @example
 * ```bash
 * onepipe deploy compose --gateway traefik --domain example.com
 * ```
 */

import type { OnePipeConfig, ServiceDefinition } from '@onepipe/sdk'
import { mkdir } from 'fs/promises'

interface ComposeDeployOptions {
  gateway: 'traefik' | 'none'
  domain: string
  outputDir: string
  dryRun: boolean
  config?: OnePipeConfig
  entrypoint?: string
}

interface InfrastructureNeeds {
  postgres: boolean
  redis: boolean
}

interface ComposeService {
  build?: { context: string; dockerfile?: string }
  image?: string
  command?: string[]
  environment?: Record<string, string>
  ports?: string[]
  labels?: string[]
  depends_on?: Record<string, { condition: string }> | string[]
  healthcheck?: {
    test: string[]
    interval: string
    timeout: string
    retries: number
  }
  volumes?: string[]
  networks?: string[]
  restart?: string
}

interface ComposeFile {
  services: Record<string, ComposeService>
  networks?: Record<string, { driver: string }>
  volumes?: Record<string, object>
}

/**
 * Run Docker Compose deployment
 */
export async function deployCompose(
  config: { name: string; entrypoint?: string },
  args: string[]
): Promise<void> {
  const options = parseComposeOptions(config, args)

  console.log(`
Generating Docker Compose configuration...
  Gateway: ${options.gateway}
  Domain:  ${options.domain}
  Output:  ${options.outputDir}
`)

  // Try to load OnePipe config
  let appConfig: OnePipeConfig | undefined
  try {
    const { loadConfig } = await import('@onepipe/sdk')
    appConfig = await loadConfig()
    options.config = appConfig
  } catch {
    // No config file, will use single service mode
  }

  // Discover infrastructure needs
  const infraNeeds = await discoverInfrastructure(options.entrypoint)

  // Generate compose file
  const compose = generateComposeFile(options, infraNeeds)

  if (options.dryRun) {
    console.log('--- docker-compose.yml ---')
    console.log(serializeYaml(compose))
    console.log('\n--- .env.example ---')
    console.log(generateEnvExample(options))
    return
  }

  // Write files
  await mkdir(options.outputDir, { recursive: true })
  await Bun.write(`${options.outputDir}/docker-compose.yml`, serializeYaml(compose))
  await Bun.write(`${options.outputDir}/.env.example`, generateEnvExample(options))
  await Bun.write(`${options.outputDir}/Dockerfile`, generateDockerfile())

  console.log(`
Generated Docker Compose files in ${options.outputDir}/:
  docker-compose.yml  - Main compose file
  .env.example        - Environment variables template
  Dockerfile          - Container build file

To deploy:
  1. Copy .env.example to .env and fill in values
  2. Run: docker compose -f ${options.outputDir}/docker-compose.yml up -d

For production with HTTPS:
  - Set DOMAIN and ACME_EMAIL in .env
  - Traefik will auto-provision Let's Encrypt certificates
`)
}

/**
 * Parse command line options
 */
function parseComposeOptions(
  config: { name: string; entrypoint?: string },
  args: string[]
): ComposeDeployOptions {
  return {
    gateway: (getFlag(args, '--gateway') || 'traefik') as 'traefik' | 'none',
    domain: getFlag(args, '--domain') || '${DOMAIN}',
    outputDir: getFlag(args, '--output', '-o') || './deploy',
    dryRun: args.includes('--dry-run'),
    entrypoint: config.entrypoint,
  }
}

/**
 * Discover infrastructure needs from entrypoint
 */
async function discoverInfrastructure(entrypoint?: string): Promise<InfrastructureNeeds> {
  try {
    const { analyzeEntrypoint, getInfrastructureTypes } = await import('../discovery')
    const discovery = await analyzeEntrypoint(entrypoint || './src/index.ts')
    const infraTypes = getInfrastructureTypes(discovery)
    return {
      postgres: infraTypes.includes('postgresql'),
      redis: infraTypes.includes('redis'),
    }
  } catch {
    // Default to postgres only (PostgreSQL-first approach)
    return { postgres: true, redis: false }
  }
}

/**
 * Generate the complete Docker Compose file
 */
function generateComposeFile(
  options: ComposeDeployOptions,
  infra: InfrastructureNeeds
): ComposeFile {
  const services: Record<string, ComposeService> = {}

  // Add Traefik gateway
  if (options.gateway === 'traefik') {
    services.traefik = generateTraefikService()
  }

  // Add infrastructure services
  if (infra.postgres) {
    services.postgres = generatePostgresService()
  }
  if (infra.redis) {
    services.redis = generateRedisService()
  }

  // Add application services
  const appServices = options.config?.services
  if (appServices && appServices.length > 0) {
    // Microservices mode
    for (const svc of appServices) {
      services[svc.name] = generateAppService(svc, options, appServices, infra)
    }
  } else {
    // Single service mode
    services.app = generateAppService(
      { name: 'app', entrypoint: options.entrypoint || './src/index.ts', port: 3000, gateway: true },
      options,
      [],
      infra
    )
  }

  return {
    services,
    networks: {
      onepipe: { driver: 'bridge' },
    },
    volumes: {
      ...(infra.postgres ? { postgres_data: {} } : {}),
      ...(options.gateway === 'traefik' ? { letsencrypt: {} } : {}),
    },
  }
}

/**
 * Generate Traefik reverse proxy service
 */
function generateTraefikService(): ComposeService {
  return {
    image: 'traefik:v3.0',
    command: [
      '--api.dashboard=true',
      '--api.insecure=true',
      '--providers.docker=true',
      '--providers.docker.exposedbydefault=false',
      '--entrypoints.web.address=:80',
      '--entrypoints.websecure.address=:443',
      '--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}',
      '--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json',
      '--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web',
      // Redirect HTTP to HTTPS
      '--entrypoints.web.http.redirections.entrypoint.to=websecure',
      '--entrypoints.web.http.redirections.entrypoint.scheme=https',
    ],
    ports: [
      '80:80',
      '443:443',
      '8080:8080', // Dashboard
    ],
    volumes: [
      '/var/run/docker.sock:/var/run/docker.sock:ro',
      'letsencrypt:/letsencrypt',
    ],
    networks: ['onepipe'],
    restart: 'unless-stopped',
  }
}

/**
 * Generate PostgreSQL service
 */
function generatePostgresService(): ComposeService {
  return {
    image: 'postgres:17-alpine',
    environment: {
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: '${DB_PASSWORD}',
      POSTGRES_DB: 'onepipe',
    },
    volumes: ['postgres_data:/var/lib/postgresql/data'],
    healthcheck: {
      test: ['CMD', 'pg_isready', '-U', 'postgres'],
      interval: '5s',
      timeout: '3s',
      retries: 5,
    },
    networks: ['onepipe'],
    restart: 'unless-stopped',
  }
}

/**
 * Generate Redis service
 */
function generateRedisService(): ComposeService {
  return {
    image: 'redis:7-alpine',
    command: ['redis-server', '--appendonly', 'yes'],
    healthcheck: {
      test: ['CMD', 'redis-cli', 'ping'],
      interval: '5s',
      timeout: '3s',
      retries: 5,
    },
    networks: ['onepipe'],
    restart: 'unless-stopped',
  }
}

/**
 * Generate application service
 */
function generateAppService(
  service: ServiceDefinition,
  options: ComposeDeployOptions,
  allServices: ServiceDefinition[],
  infra: InfrastructureNeeds
): ComposeService {
  const port = service.port || 3000
  const isGateway = service.gateway || service.name === 'gateway' || allServices.length === 0

  // Build environment variables
  const environment: Record<string, string> = {
    NODE_ENV: 'production',
    PORT: String(port),
  }

  // Add database URL if postgres is needed
  if (infra.postgres) {
    environment.DATABASE_URL = 'postgres://postgres:${DB_PASSWORD}@postgres:5432/onepipe'
  }

  // Add redis URL if redis is needed
  if (infra.redis) {
    environment.REDIS_URL = 'redis://redis:6379'
  }

  // Add service-to-service URLs
  for (const svc of allServices) {
    if (svc.name !== service.name) {
      const envName = `${svc.name.toUpperCase()}_URL`
      environment[envName] = `http://${svc.name}:${svc.port || 3000}`
    }
  }

  // Build depends_on
  const dependsOn: Record<string, { condition: string }> = {}
  if (infra.postgres) {
    dependsOn.postgres = { condition: 'service_healthy' }
  }
  if (infra.redis) {
    dependsOn.redis = { condition: 'service_healthy' }
  }
  if (service.depends) {
    for (const dep of service.depends) {
      dependsOn[dep] = { condition: 'service_started' }
    }
  }

  // Build labels for Traefik routing
  const labels: string[] = []
  if (options.gateway === 'traefik' && isGateway) {
    const routerName = service.name.replace(/-/g, '')
    labels.push(
      'traefik.enable=true',
      `traefik.http.routers.${routerName}.rule=Host(\`${options.domain}\`)`,
      `traefik.http.routers.${routerName}.entrypoints=websecure`,
      `traefik.http.routers.${routerName}.tls.certresolver=letsencrypt`,
      `traefik.http.services.${routerName}.loadbalancer.server.port=${port}`,
      `traefik.http.services.${routerName}.loadbalancer.healthcheck.path=/health`,
      `traefik.http.services.${routerName}.loadbalancer.healthcheck.interval=10s`,
    )
  }

  return {
    build: { context: '.' },
    command: ['bun', 'run', service.entrypoint],
    environment,
    labels: labels.length > 0 ? labels : undefined,
    depends_on: Object.keys(dependsOn).length > 0 ? dependsOn : undefined,
    healthcheck: {
      test: ['CMD', 'curl', '-f', `http://localhost:${port}/health`],
      interval: '10s',
      timeout: '5s',
      retries: 3,
    },
    networks: ['onepipe'],
    restart: 'unless-stopped',
  }
}

/**
 * Generate .env.example file
 */
function generateEnvExample(options: ComposeDeployOptions): string {
  return `# OnePipe Docker Compose Environment Variables

# Domain for Traefik routing (required for HTTPS)
DOMAIN=example.com

# Email for Let's Encrypt certificates
ACME_EMAIL=admin@example.com

# Database password
DB_PASSWORD=changeme

# Optional: Redis password (if using Redis)
# REDIS_PASSWORD=changeme

# Optional: Application secrets
# JWT_SECRET=your-jwt-secret
# API_KEY=your-api-key
`
}

/**
 * Generate Dockerfile
 */
function generateDockerfile(): string {
  return `# OnePipe Dockerfile
FROM oven/bun:1.1-alpine

WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy application code
COPY . .

# Build if needed (uncomment if you have a build step)
# RUN bun run build

# Expose port (will be overridden by docker-compose)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["bun", "run", "src/index.ts"]
`
}

/**
 * Serialize object to YAML format
 */
function serializeYaml(obj: ComposeFile): string {
  const lines: string[] = ['# Generated by OnePipe CLI', '']

  // Services
  lines.push('services:')
  for (const [name, service] of Object.entries(obj.services)) {
    lines.push(`  ${name}:`)
    lines.push(...serializeService(service, 4))
  }

  // Networks
  if (obj.networks) {
    lines.push('')
    lines.push('networks:')
    for (const [name, config] of Object.entries(obj.networks)) {
      lines.push(`  ${name}:`)
      lines.push(`    driver: ${config.driver}`)
    }
  }

  // Volumes
  if (obj.volumes && Object.keys(obj.volumes).length > 0) {
    lines.push('')
    lines.push('volumes:')
    for (const name of Object.keys(obj.volumes)) {
      lines.push(`  ${name}:`)
    }
  }

  return lines.join('\n')
}

/**
 * Serialize a service to YAML lines
 */
function serializeService(service: ComposeService, indent: number): string[] {
  const lines: string[] = []
  const pad = ' '.repeat(indent)

  if (service.image) {
    lines.push(`${pad}image: ${service.image}`)
  }

  if (service.build) {
    lines.push(`${pad}build:`)
    lines.push(`${pad}  context: ${service.build.context}`)
    if (service.build.dockerfile) {
      lines.push(`${pad}  dockerfile: ${service.build.dockerfile}`)
    }
  }

  if (service.command) {
    lines.push(`${pad}command:`)
    for (const cmd of service.command) {
      lines.push(`${pad}  - "${cmd}"`)
    }
  }

  if (service.environment) {
    lines.push(`${pad}environment:`)
    for (const [key, value] of Object.entries(service.environment)) {
      lines.push(`${pad}  ${key}: "${value}"`)
    }
  }

  if (service.ports) {
    lines.push(`${pad}ports:`)
    for (const port of service.ports) {
      lines.push(`${pad}  - "${port}"`)
    }
  }

  if (service.volumes) {
    lines.push(`${pad}volumes:`)
    for (const vol of service.volumes) {
      lines.push(`${pad}  - ${vol}`)
    }
  }

  if (service.labels) {
    lines.push(`${pad}labels:`)
    for (const label of service.labels) {
      lines.push(`${pad}  - "${label}"`)
    }
  }

  if (service.depends_on) {
    lines.push(`${pad}depends_on:`)
    if (typeof service.depends_on === 'object' && !Array.isArray(service.depends_on)) {
      for (const [dep, config] of Object.entries(service.depends_on)) {
        lines.push(`${pad}  ${dep}:`)
        lines.push(`${pad}    condition: ${config.condition}`)
      }
    }
  }

  if (service.healthcheck) {
    lines.push(`${pad}healthcheck:`)
    lines.push(`${pad}  test: [${service.healthcheck.test.map(t => `"${t}"`).join(', ')}]`)
    lines.push(`${pad}  interval: ${service.healthcheck.interval}`)
    lines.push(`${pad}  timeout: ${service.healthcheck.timeout}`)
    lines.push(`${pad}  retries: ${service.healthcheck.retries}`)
  }

  if (service.networks) {
    lines.push(`${pad}networks:`)
    for (const net of service.networks) {
      lines.push(`${pad}  - ${net}`)
    }
  }

  if (service.restart) {
    lines.push(`${pad}restart: ${service.restart}`)
  }

  return lines
}

/**
 * Get flag value from args
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
