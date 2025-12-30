/**
 * Box Drawing Utilities
 *
 * Create bordered boxes for terminal output
 */

import { c, s } from './terminal'

export interface BoxOptions {
  /** Box title (appears in top border) */
  title?: string
  /** Box width (default: 40) */
  width?: number
  /** Title color */
  titleColor?: string
  /** Border color */
  borderColor?: string
  /** Padding inside the box */
  padding?: number
}

/**
 * Create a bordered box with content
 *
 * @example
 * console.log(box(['Line 1', 'Line 2'], { title: 'Info', width: 30 }))
 * // ┌ Info ─────────────────────┐
 * // │  Line 1                   │
 * // │  Line 2                   │
 * // └───────────────────────────┘
 */
export function box(lines: string[], options: BoxOptions = {}): string {
  const {
    title,
    width = 40,
    titleColor = c.bold,
    borderColor = c.dim,
    padding = 1,
  } = options

  const innerWidth = width - 2 // Account for │ on each side
  const paddingStr = ' '.repeat(padding)

  // Top border with optional title
  let topBorder: string
  if (title) {
    const titleWithSpaces = ` ${title} `
    const remainingWidth = width - 2 - titleWithSpaces.length // -2 for corners
    topBorder = `${borderColor}${s.topLeft}${c.reset}${titleColor}${titleWithSpaces}${c.reset}${borderColor}${s.horizontal.repeat(remainingWidth)}${s.topRight}${c.reset}`
  } else {
    topBorder = `${borderColor}${s.topLeft}${s.horizontal.repeat(width - 2)}${s.topRight}${c.reset}`
  }

  // Content lines
  const contentLines = lines.map(line => {
    // Strip ANSI codes for length calculation
    const visibleLength = stripAnsi(line).length
    const paddedLine = paddingStr + line
    const spaces = Math.max(0, innerWidth - padding - visibleLength - padding)
    return `${borderColor}${s.vertical}${c.reset}${paddedLine}${' '.repeat(spaces)}${paddingStr}${borderColor}${s.vertical}${c.reset}`
  })

  // Bottom border
  const bottomBorder = `${borderColor}${s.bottomLeft}${s.horizontal.repeat(width - 2)}${s.bottomRight}${c.reset}`

  return [topBorder, ...contentLines, bottomBorder].join('\n')
}

/**
 * Create a simple titled section (no side borders)
 *
 * @example
 * console.log(section('Discovered', ['REST API', 'Database']))
 * // ┌ Discovered ───────────────┐
 * // │  REST API                 │
 * // │  Database                 │
 * // └───────────────────────────┘
 */
export function section(title: string, items: string[], options: Omit<BoxOptions, 'title'> = {}): string {
  return box(items, { ...options, title })
}

/**
 * Create a key-value box
 *
 * @example
 * console.log(keyValueBox('Ready', { App: 'http://localhost:3001', Dashboard: 'http://localhost:4000' }))
 */
export function keyValueBox(
  title: string,
  data: Record<string, string>,
  options: Omit<BoxOptions, 'title'> = {}
): string {
  const keys = Object.keys(data)
  const maxKeyLength = Math.max(...keys.map(k => k.length))

  const lines = keys.map(key => {
    const paddedKey = key.padEnd(maxKeyLength)
    const value = data[key]
    return `${c.dim}${paddedKey}${c.reset}  ${c.cyan}${value}${c.reset}`
  })

  return box(lines, { ...options, title })
}

/**
 * Create an error box
 */
export function errorBox(title: string, message: string, details?: string): string {
  const lines = [message]
  if (details) {
    lines.push('')
    lines.push(`${c.dim}${details}${c.reset}`)
  }
  return box(lines, { title: `${c.red}${title}${c.reset}`, borderColor: c.red, width: 45 })
}

/**
 * Create a success box
 */
export function successBox(title: string, message: string): string {
  return box([message], { title: `${c.green}${title}${c.reset}`, borderColor: c.green, width: 45 })
}

/**
 * Create the OnePipe header box
 */
export function headerBox(version: string = '0.3.0'): string {
  const title = `${c.cyan}${c.bold}OnePipe Dev${c.reset}`
  const ver = `${c.dim}v${version}${c.reset}`

  // Calculate spacing for right-aligned version
  const width = 40
  const innerWidth = width - 4 // borders + padding
  const titleLen = 11 // "OnePipe Dev" without ANSI
  const verLen = version.length + 1 // "v0.3.0"
  const spacing = innerWidth - titleLen - verLen

  const line = `${title}${' '.repeat(spacing)}${ver}`

  return box([line], { width })
}

/**
 * Strip ANSI escape codes from string (for length calculation)
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * Print a horizontal rule
 */
export function hr(width: number = 40): string {
  return `${c.dim}${s.horizontal.repeat(width)}${c.reset}`
}
