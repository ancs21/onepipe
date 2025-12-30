/**
 * PostgreSQL Infrastructure
 *
 * Auto-provision PostgreSQL using Apple Container or Docker
 */

import { detectContainerRuntime, runContainerApple, runContainerDocker, waitForContainer, type ContainerRuntime } from './containers'
import { INFRASTRUCTURE_CONFIG } from '../discovery/patterns'

const CONFIG = INFRASTRUCTURE_CONFIG.postgresql

export interface PostgresResult {
  url: string
  host: string
  port: number
  runtime: ContainerRuntime
}

/**
 * Ensure PostgreSQL is running
 * Returns connection URL or null if failed
 */
export async function ensurePostgres(): Promise<PostgresResult | null> {
  // Respect user-provided DATABASE_URL
  if (process.env.DATABASE_URL) {
    return {
      url: process.env.DATABASE_URL,
      host: 'user-provided',
      port: 5432,
      runtime: null,
    }
  }

  const runtime = await detectContainerRuntime()
  if (!runtime) {
    return null
  }

  try {
    if (runtime === 'apple') {
      return await ensurePostgresApple()
    } else {
      return await ensurePostgresDocker()
    }
  } catch (error) {
    // If Apple Container fails, try Docker as fallback
    if (runtime === 'apple') {
      try {
        return await ensurePostgresDocker()
      } catch {
        return null
      }
    }
    return null
  }
}

async function ensurePostgresApple(): Promise<PostgresResult> {
  const { ip } = await runContainerApple({
    name: CONFIG.containerName,
    image: CONFIG.image,
    env: {
      POSTGRES_PASSWORD: CONFIG.credentials.password,
      POSTGRES_DB: CONFIG.credentials.database,
    },
  })

  await waitForContainer('apple', CONFIG.containerName, CONFIG.healthCheck)

  return {
    url: `postgres://${CONFIG.credentials.user}:${CONFIG.credentials.password}@${ip}:${CONFIG.port}/${CONFIG.credentials.database}`,
    host: ip,
    port: CONFIG.port,
    runtime: 'apple',
  }
}

async function ensurePostgresDocker(): Promise<PostgresResult> {
  const { ip } = await runContainerDocker({
    name: CONFIG.containerName,
    image: CONFIG.image,
    ports: [{ host: CONFIG.port, container: CONFIG.port }],
    env: {
      POSTGRES_PASSWORD: CONFIG.credentials.password,
      POSTGRES_DB: CONFIG.credentials.database,
    },
  })

  await waitForContainer('docker', CONFIG.containerName, CONFIG.healthCheck)

  return {
    url: `postgres://${CONFIG.credentials.user}:${CONFIG.credentials.password}@${ip}:${CONFIG.port}/${CONFIG.credentials.database}`,
    host: ip,
    port: CONFIG.port,
    runtime: 'docker',
  }
}
