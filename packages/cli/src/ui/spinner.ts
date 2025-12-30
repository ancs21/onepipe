/**
 * Spinner Utility
 *
 * Animated spinner for async operations
 */

import { c, s, clearLine, hideCursor, showCursor, timestamp } from './terminal'

export interface Spinner {
  /** Update spinner text */
  text: (msg: string) => void
  /** Stop spinner with success message */
  succeed: (msg: string) => void
  /** Stop spinner with failure message */
  fail: (msg: string) => void
  /** Stop spinner without message */
  stop: () => void
}

/**
 * Create an animated spinner
 *
 * @example
 * const spinner = createSpinner('Loading...')
 * await someAsyncOperation()
 * spinner.succeed('Loaded successfully')
 */
export function createSpinner(text: string): Spinner {
  let frameIndex = 0
  let currentText = text
  let interval: ReturnType<typeof setInterval> | null = null
  const frames = s.spinner

  // Only animate if TTY
  if (process.stdout.isTTY) {
    hideCursor()
    interval = setInterval(() => {
      clearLine()
      const frame = frames[frameIndex++ % frames.length]
      process.stdout.write(`${c.cyan}${frame}${c.reset} ${currentText}`)
    }, 80)
  } else {
    // Non-TTY: just print the text once
    console.log(`  ${text}`)
  }

  const stop = () => {
    if (interval) {
      clearInterval(interval)
      interval = null
      clearLine()
      showCursor()
    }
  }

  return {
    text: (msg: string) => {
      currentText = msg
    },

    succeed: (msg: string) => {
      stop()
      console.log(`${c.green}${s.check}${c.reset} ${msg}`)
    },

    fail: (msg: string) => {
      stop()
      console.log(`${c.red}${s.cross}${c.reset} ${msg}`)
    },

    stop,
  }
}

/**
 * Create a spinner with timestamp prefix
 *
 * @example
 * const spinner = createTimestampedSpinner('Reloading...')
 * spinner.succeed('Reloaded in 42ms')
 * // Output: [09:45:32] ✓ Reloaded in 42ms
 */
export function createTimestampedSpinner(text: string): Spinner {
  let frameIndex = 0
  let currentText = text
  let interval: ReturnType<typeof setInterval> | null = null
  const frames = s.spinner

  const getTimestamp = () => `${c.dim}[${timestamp()}]${c.reset}`

  if (process.stdout.isTTY) {
    hideCursor()
    interval = setInterval(() => {
      clearLine()
      const frame = frames[frameIndex++ % frames.length]
      process.stdout.write(`${getTimestamp()} ${c.cyan}${frame}${c.reset} ${currentText}`)
    }, 80)
  } else {
    console.log(`[${timestamp()}] ${text}`)
  }

  const stop = () => {
    if (interval) {
      clearInterval(interval)
      interval = null
      clearLine()
      showCursor()
    }
  }

  return {
    text: (msg: string) => {
      currentText = msg
    },

    succeed: (msg: string) => {
      stop()
      console.log(`${getTimestamp()} ${c.green}${s.check}${c.reset} ${msg}`)
    },

    fail: (msg: string) => {
      stop()
      console.log(`${getTimestamp()} ${c.red}${s.cross}${c.reset} ${msg}`)
    },

    stop,
  }
}

/**
 * Run an async operation with a spinner
 *
 * @example
 * await withSpinner('Loading data...', async () => {
 *   await fetchData()
 * }, 'Data loaded')
 */
export async function withSpinner<T>(
  text: string,
  fn: () => Promise<T>,
  successMessage?: string
): Promise<T> {
  const spinner = createSpinner(text)
  try {
    const result = await fn()
    spinner.succeed(successMessage || text.replace(/\.{3}$/, ''))
    return result
  } catch (error) {
    spinner.fail(`${text} failed`)
    throw error
  }
}
