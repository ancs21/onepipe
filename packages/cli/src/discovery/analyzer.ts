/**
 * Static Code Analyzer
 *
 * Scans code to detect SDK primitives and infrastructure needs
 */

import { dirname, join, resolve } from 'path'
import { INFRASTRUCTURE_PATTERNS, PRIMITIVE_PATTERNS, type InfrastructureType } from './patterns'

export interface DiscoveredPrimitive {
  type: string
  file: string
  line: number
  infrastructure?: InfrastructureType
  reason?: string
}

export interface InfrastructureRequirement {
  type: InfrastructureType
  requestedBy: string[]
  reasons: string[]
}

export interface DiscoveryResult {
  entrypoint: string
  analyzedFiles: string[]
  primitives: DiscoveredPrimitive[]
  infrastructure: InfrastructureRequirement[]
  duration: number
}

const MAX_DEPTH = 10
const IMPORT_REGEX = /(?:import|from)\s+['"]([^'"]+)['"]/g
const RELATIVE_IMPORT_REGEX = /^\.\.?[/\\]/

/**
 * Analyze entrypoint and its imports to discover infrastructure needs
 */
export async function analyzeEntrypoint(entrypoint: string): Promise<DiscoveryResult> {
  const startTime = performance.now()
  const analyzedFiles = new Set<string>()
  const primitives: DiscoveredPrimitive[] = []
  const infrastructureMap = new Map<InfrastructureType, { requestedBy: Set<string>; reasons: Set<string> }>()

  await analyzeFile(entrypoint, analyzedFiles, primitives, infrastructureMap, 0)

  const infrastructure: InfrastructureRequirement[] = []
  for (const [type, data] of infrastructureMap) {
    infrastructure.push({
      type,
      requestedBy: Array.from(data.requestedBy),
      reasons: Array.from(data.reasons),
    })
  }

  return {
    entrypoint,
    analyzedFiles: Array.from(analyzedFiles),
    primitives,
    infrastructure,
    duration: performance.now() - startTime,
  }
}

async function analyzeFile(
  filePath: string,
  analyzedFiles: Set<string>,
  primitives: DiscoveredPrimitive[],
  infrastructureMap: Map<InfrastructureType, { requestedBy: Set<string>; reasons: Set<string> }>,
  depth: number
): Promise<void> {
  // Prevent infinite loops
  if (depth > MAX_DEPTH) return

  // Normalize path
  const normalizedPath = await resolveFilePath(filePath)
  if (!normalizedPath || analyzedFiles.has(normalizedPath)) return

  analyzedFiles.add(normalizedPath)

  // Read file content
  const file = Bun.file(normalizedPath)
  if (!(await file.exists())) return

  let content: string
  try {
    content = await file.text()
  } catch {
    return
  }

  // Analyze for primitives
  const lines = content.split('\n')
  for (const pattern of PRIMITIVE_PATTERNS) {
    // Reset regex state
    pattern.regex.lastIndex = 0

    // Find all matches
    let lineNum = 1
    for (const line of lines) {
      if (pattern.regex.test(line)) {
        primitives.push({
          type: pattern.name,
          file: normalizedPath,
          line: lineNum,
          infrastructure: pattern.infrastructure ?? undefined,
          reason: pattern.reason,
        })

        // Track infrastructure requirement
        if (pattern.infrastructure) {
          if (!infrastructureMap.has(pattern.infrastructure)) {
            infrastructureMap.set(pattern.infrastructure, {
              requestedBy: new Set(),
              reasons: new Set(),
            })
          }
          const entry = infrastructureMap.get(pattern.infrastructure)!
          entry.requestedBy.add(pattern.name)
          if (pattern.reason) {
            entry.reasons.add(pattern.reason)
          }
        }

        // Reset regex for next iteration
        pattern.regex.lastIndex = 0
      }
      lineNum++
    }
  }

  // Find and analyze imports
  const imports = findImports(content)
  const baseDir = dirname(normalizedPath)

  for (const importPath of imports) {
    // Only follow relative imports (not node_modules)
    if (RELATIVE_IMPORT_REGEX.test(importPath)) {
      const resolvedImport = resolve(baseDir, importPath)
      await analyzeFile(resolvedImport, analyzedFiles, primitives, infrastructureMap, depth + 1)
    }
  }
}

function findImports(content: string): string[] {
  const imports: string[] = []
  let match: RegExpExecArray | null

  // Reset regex state
  IMPORT_REGEX.lastIndex = 0

  while ((match = IMPORT_REGEX.exec(content)) !== null) {
    const importPath = match[1]
    // Skip package imports (node_modules)
    if (!importPath.startsWith('@') && !importPath.includes('/node_modules/')) {
      imports.push(importPath)
    }
  }

  return imports
}

async function resolveFilePath(filePath: string): Promise<string | null> {
  // Try exact path first
  if (await Bun.file(filePath).exists()) {
    return filePath
  }

  // Try with extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs']
  for (const ext of extensions) {
    const withExt = filePath + ext
    if (await Bun.file(withExt).exists()) {
      return withExt
    }
  }

  // Try as directory with index file
  for (const ext of extensions) {
    const indexPath = join(filePath, `index${ext}`)
    if (await Bun.file(indexPath).exists()) {
      return indexPath
    }
  }

  return null
}

/**
 * Get unique infrastructure types from discovery result
 */
export function getInfrastructureTypes(result: DiscoveryResult): InfrastructureType[] {
  return result.infrastructure.map((i) => i.type)
}
