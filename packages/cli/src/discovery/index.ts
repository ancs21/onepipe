/**
 * Discovery Module
 *
 * Code-first auto-discovery for infrastructure needs
 */

export { detectEntrypoint, validateEntrypoint, type EntrypointResult } from './entrypoint'

export { analyzeEntrypoint, getInfrastructureTypes, type DiscoveryResult, type DiscoveredPrimitive, type InfrastructureRequirement } from './analyzer'

export {
  INFRASTRUCTURE_PATTERNS,
  PRIMITIVE_PATTERNS,
  INFRASTRUCTURE_CONFIG,
  type InfrastructureType,
  type PatternDefinition,
} from './patterns'
