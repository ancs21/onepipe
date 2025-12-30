/**
 * Runtime Manifest System
 *
 * SDK primitives register their infrastructure needs when built.
 * The CLI reads this manifest to auto-provision required services.
 */

export type PrimitiveType =
  | 'db'
  | 'cache'
  | 'workflow'
  | 'cron'
  | 'flow'
  | 'signal'
  | 'rest'
  | 'auth'
  | 'storage'
  | 'channel'
  | 'projection'

export type InfrastructureType = 'postgresql' | 'redis' | 'mysql'

export interface ManifestEntry {
  primitive: PrimitiveType
  name: string
  infrastructure?: InfrastructureType
  config?: Record<string, unknown>
}

declare global {
  var __ONEPIPE_MANIFEST__: ManifestEntry[] | undefined
}

/**
 * Register a primitive with the manifest.
 * Called automatically by primitives during .build()
 */
export function registerPrimitive(entry: ManifestEntry): void {
  globalThis.__ONEPIPE_MANIFEST__ ??= []
  globalThis.__ONEPIPE_MANIFEST__.push(entry)
}

/**
 * Get all registered primitives.
 * Called by CLI to determine infrastructure needs.
 */
export function getManifest(): ManifestEntry[] {
  return globalThis.__ONEPIPE_MANIFEST__ ?? []
}

/**
 * Clear the manifest (useful for testing)
 */
export function clearManifest(): void {
  globalThis.__ONEPIPE_MANIFEST__ = []
}

/**
 * Get unique infrastructure requirements from manifest
 */
export function getInfrastructureNeeds(): InfrastructureType[] {
  const manifest = getManifest()
  const needs = new Set<InfrastructureType>()

  for (const entry of manifest) {
    if (entry.infrastructure) {
      needs.add(entry.infrastructure)
    }
  }

  return Array.from(needs)
}
