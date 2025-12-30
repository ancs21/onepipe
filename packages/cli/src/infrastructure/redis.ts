/**
 * Redis Infrastructure
 *
 * Auto-provision Redis using Apple Container or Docker
 */

import { detectContainerRuntime, runContainerApple, runContainerDocker, waitForContainer, type ContainerRuntime } from './containers'
import { INFRASTRUCTURE_CONFIG } from '../discovery/patterns'

const CONFIG = INFRASTRUCTURE_CONFIG.redis

export interface RedisResult {
  url: string
  host: string
  port: number
  runtime: ContainerRuntime
}

/**
 * Ensure Redis is running
 * Returns connection URL or null if failed
 */
export async function ensureRedis(): Promise<RedisResult | null> {
  // Respect user-provided REDIS_URL
  if (process.env.REDIS_URL) {
    return {
      url: process.env.REDIS_URL,
      host: 'user-provided',
      port: 6379,
      runtime: null,
    }
  }

  const runtime = await detectContainerRuntime()
  if (!runtime) {
    return null
  }

  try {
    if (runtime === 'apple') {
      return await ensureRedisApple()
    } else {
      return await ensureRedisDocker()
    }
  } catch (error) {
    // If Apple Container fails, try Docker as fallback
    if (runtime === 'apple') {
      try {
        return await ensureRedisDocker()
      } catch {
        return null
      }
    }
    return null
  }
}

async function ensureRedisApple(): Promise<RedisResult> {
  const { ip } = await runContainerApple({
    name: CONFIG.containerName,
    image: CONFIG.image,
  })

  await waitForContainer('apple', CONFIG.containerName, CONFIG.healthCheck)

  return {
    url: `redis://${ip}:${CONFIG.port}`,
    host: ip,
    port: CONFIG.port,
    runtime: 'apple',
  }
}

async function ensureRedisDocker(): Promise<RedisResult> {
  const { ip } = await runContainerDocker({
    name: CONFIG.containerName,
    image: CONFIG.image,
    ports: [{ host: CONFIG.port, container: CONFIG.port }],
  })

  await waitForContainer('docker', CONFIG.containerName, CONFIG.healthCheck)

  return {
    url: `redis://${ip}:${CONFIG.port}`,
    host: ip,
    port: CONFIG.port,
    runtime: 'docker',
  }
}
