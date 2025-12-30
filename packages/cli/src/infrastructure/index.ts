/**
 * Infrastructure Module
 *
 * Auto-provisioning of development infrastructure
 */

export { detectContainerRuntime, runContainerApple, runContainerDocker, waitForContainer, execInContainer, type ContainerRuntime } from './containers'

export { ensurePostgres, type PostgresResult } from './postgres'

export { ensureRedis, type RedisResult } from './redis'

export { InfrastructureManager, createInfrastructureManager, type ProvisionResult } from './manager'
