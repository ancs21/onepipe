/**
 * Entrypoint Detection
 *
 * Auto-detects the application entrypoint from package.json
 */

import { join, resolve } from 'path'

export interface EntrypointResult {
  path: string
  source: 'package.json' | 'flag' | 'default'
}

/**
 * Detect the entrypoint for the application
 * Priority: flag > package.json (main/module) > ./src/index.ts
 */
export async function detectEntrypoint(cwd: string, flagValue?: string): Promise<EntrypointResult> {
  // If user provided --app flag, use it
  if (flagValue) {
    return {
      path: resolve(cwd, flagValue),
      source: 'flag',
    }
  }

  // Try to read package.json
  const pkgPath = join(cwd, 'package.json')
  const pkgFile = Bun.file(pkgPath)

  if (await pkgFile.exists()) {
    try {
      const pkg = await pkgFile.json()

      // Priority: main > module
      const entry = pkg.main || pkg.module
      if (entry) {
        return {
          path: resolve(cwd, entry),
          source: 'package.json',
        }
      }
    } catch {
      // Invalid package.json, fall through to default
    }
  }

  // Default to ./src/index.ts
  return {
    path: resolve(cwd, './src/index.ts'),
    source: 'default',
  }
}

/**
 * Validate that the entrypoint file exists
 */
export async function validateEntrypoint(path: string): Promise<{ valid: boolean; error?: string }> {
  const file = Bun.file(path)

  if (!(await file.exists())) {
    return {
      valid: false,
      error: `Entrypoint not found: ${path}`,
    }
  }

  return { valid: true }
}
