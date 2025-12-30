/**
 * Terminal Utilities
 *
 * Centralized colors, symbols, and TTY detection for CLI output
 */

/**
 * Check if terminal supports colors
 */
export function supportsColor(): boolean {
  // Respect NO_COLOR standard
  if (process.env.NO_COLOR !== undefined) return false
  // Check for dumb terminal
  if (process.env.TERM === 'dumb') return false
  // Check for CI environments that support color
  if (process.env.CI && process.env.GITHUB_ACTIONS) return true
  // Check if stdout is a TTY
  if (!process.stdout.isTTY) return false
  return true
}

const colorEnabled = supportsColor()

/**
 * ANSI color codes (conditional based on TTY support)
 */
export const c = {
  // Reset
  reset: colorEnabled ? '\x1b[0m' : '',

  // Modifiers
  bold: colorEnabled ? '\x1b[1m' : '',
  dim: colorEnabled ? '\x1b[2m' : '',
  italic: colorEnabled ? '\x1b[3m' : '',
  underline: colorEnabled ? '\x1b[4m' : '',

  // Colors
  black: colorEnabled ? '\x1b[30m' : '',
  red: colorEnabled ? '\x1b[31m' : '',
  green: colorEnabled ? '\x1b[32m' : '',
  yellow: colorEnabled ? '\x1b[33m' : '',
  blue: colorEnabled ? '\x1b[34m' : '',
  magenta: colorEnabled ? '\x1b[35m' : '',
  cyan: colorEnabled ? '\x1b[36m' : '',
  white: colorEnabled ? '\x1b[37m' : '',
  gray: colorEnabled ? '\x1b[90m' : '',

  // Bright colors
  brightRed: colorEnabled ? '\x1b[91m' : '',
  brightGreen: colorEnabled ? '\x1b[92m' : '',
  brightYellow: colorEnabled ? '\x1b[93m' : '',
  brightBlue: colorEnabled ? '\x1b[94m' : '',
  brightMagenta: colorEnabled ? '\x1b[95m' : '',
  brightCyan: colorEnabled ? '\x1b[96m' : '',

  // Background colors
  bgRed: colorEnabled ? '\x1b[41m' : '',
  bgGreen: colorEnabled ? '\x1b[42m' : '',
  bgYellow: colorEnabled ? '\x1b[43m' : '',
  bgBlue: colorEnabled ? '\x1b[44m' : '',
}

/**
 * Unicode symbols for visual indicators
 */
export const s = {
  // Status indicators
  check: '\u2713',      // ✓
  cross: '\u2717',      // ✗
  warning: '\u26A0',    // ⚠
  info: '\u2139',       // ℹ

  // Bullets and arrows
  bullet: '\u2022',     // •
  arrow: '\u2192',      // →
  arrowRight: '\u25B6', // ▶
  dot: '\u00B7',        // ·

  // Box drawing
  topLeft: '\u250C',     // ┌
  topRight: '\u2510',    // ┐
  bottomLeft: '\u2514',  // └
  bottomRight: '\u2518', // ┘
  horizontal: '\u2500',  // ─
  vertical: '\u2502',    // │
  teeRight: '\u251C',    // ├
  teeLeft: '\u2524',     // ┤

  // Spinner frames (braille)
  spinner: ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'],
  // Alternative: dots spinner
  dotsSpinner: ['\u2804', '\u2806', '\u2807', '\u280B', '\u2819', '\u2838', '\u2830', '\u2820'],
}

/**
 * Get current timestamp in HH:MM:SS format
 */
export function timestamp(): string {
  const now = new Date()
  const hours = now.getHours().toString().padStart(2, '0')
  const minutes = now.getMinutes().toString().padStart(2, '0')
  const seconds = now.getSeconds().toString().padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

/**
 * Format a timestamped message
 */
export function ts(message: string): string {
  return `${c.dim}[${timestamp()}]${c.reset} ${message}`
}

/**
 * Pad string to fixed width
 */
export function pad(str: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (str.length >= width) return str
  const padding = ' '.repeat(width - str.length)
  return align === 'left' ? str + padding : padding + str
}

/**
 * Clear current line and move cursor to beginning
 */
export function clearLine(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\r\x1b[K')
  }
}

/**
 * Move cursor up N lines
 */
export function cursorUp(n: number = 1): void {
  if (process.stdout.isTTY) {
    process.stdout.write(`\x1b[${n}A`)
  }
}

/**
 * Hide cursor
 */
export function hideCursor(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?25l')
  }
}

/**
 * Show cursor
 */
export function showCursor(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?25h')
  }
}
