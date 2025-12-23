/**
 * Log - Structured Logging Builder
 *
 * JSON-based structured logging with context propagation
 *
 * @example
 * ```typescript
 * import { Log } from '@onepipe/sdk'
 *
 * const logger = Log
 *   .create('my-service')
 *   .level('info')
 *   .build()
 *
 * logger.info('User logged in', { userId: '123', email: 'user@example.com' })
 * logger.error('Failed to process payment', { orderId: '456', error: err.message })
 *
 * // Child logger with additional context
 * const requestLogger = logger.child({ requestId: 'abc-123' })
 * requestLogger.info('Processing request')
 * ```
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
}

export interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  service: string
  [key: string]: unknown
}

export interface LogTransport {
  write(entry: LogEntry): void
}

export interface LoggerInstance {
  readonly name: string
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
  fatal(message: string, context?: Record<string, unknown>): void
  child(context: Record<string, unknown>): LoggerInstance
  withTraceId(traceId: string): LoggerInstance
}

/**
 * Console transport - writes to stdout/stderr
 */
class ConsoleTransport implements LogTransport {
  private pretty: boolean

  constructor(pretty: boolean = false) {
    this.pretty = pretty
  }

  write(entry: LogEntry): void {
    const output = this.pretty ? this.formatPretty(entry) : JSON.stringify(entry)
    if (entry.level === 'error' || entry.level === 'fatal') {
      console.error(output)
    } else {
      console.log(output)
    }
  }

  private formatPretty(entry: LogEntry): string {
    const { level, message, timestamp, service, ...rest } = entry
    const levelColors: Record<LogLevel, string> = {
      debug: '\x1b[36m', // cyan
      info: '\x1b[32m', // green
      warn: '\x1b[33m', // yellow
      error: '\x1b[31m', // red
      fatal: '\x1b[35m', // magenta
    }
    const reset = '\x1b[0m'
    const color = levelColors[level] || reset

    const time = timestamp.split('T')[1]?.replace('Z', '') || timestamp
    let output = `${color}${level.toUpperCase().padEnd(5)}${reset} [${time}] ${message}`

    if (Object.keys(rest).length > 0) {
      output += ` ${JSON.stringify(rest)}`
    }

    return output
  }
}

/**
 * File transport - writes to file
 */
class FileTransport implements LogTransport {
  private filePath: string
  private buffer: string[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null

  constructor(filePath: string, flushIntervalMs: number = 1000) {
    this.filePath = filePath
    this.flushTimer = setInterval(() => this.flush(), flushIntervalMs)
  }

  write(entry: LogEntry): void {
    this.buffer.push(JSON.stringify(entry))
    if (this.buffer.length >= 100) {
      this.flush()
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const lines = this.buffer.join('\n') + '\n'
    this.buffer = []

    try {
      const file = Bun.file(this.filePath)
      const existing = await file.exists() ? await file.text() : ''
      await Bun.write(this.filePath, existing + lines)
    } catch (error) {
      console.error('[LOG] Failed to write to file:', error)
    }
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    await this.flush()
  }
}

/**
 * Stream transport - sends logs to HTTP endpoint
 */
class StreamTransport implements LogTransport {
  private endpoint: string
  private buffer: LogEntry[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null

  constructor(endpoint: string, flushIntervalMs: number = 5000) {
    this.endpoint = endpoint
    this.flushTimer = setInterval(() => this.flush(), flushIntervalMs)
  }

  write(entry: LogEntry): void {
    this.buffer.push(entry)
    if (this.buffer.length >= 100) {
      this.flush()
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const entries = this.buffer
    this.buffer = []

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entries),
      })
    } catch (error) {
      console.error('[LOG] Failed to send logs:', error)
      // Re-add failed entries (with limit)
      if (this.buffer.length < 1000) {
        this.buffer.unshift(...entries)
      }
    }
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    await this.flush()
  }
}

/**
 * Log builder with fluent API
 */
class LogBuilder {
  private serviceName: string
  private minLevel: LogLevel = 'info'
  private transports: LogTransport[] = []
  private defaultContext: Record<string, unknown> = {}
  private pretty: boolean = false

  constructor(name: string) {
    this.serviceName = name
  }

  /**
   * Set minimum log level
   */
  level(level: LogLevel): this {
    this.minLevel = level
    return this
  }

  /**
   * Enable pretty console output
   */
  prettyPrint(): this {
    this.pretty = true
    return this
  }

  /**
   * Add console transport
   */
  console(): this {
    this.transports.push(new ConsoleTransport(this.pretty))
    return this
  }

  /**
   * Add file transport
   */
  file(path: string): this {
    this.transports.push(new FileTransport(path))
    return this
  }

  /**
   * Add stream transport
   */
  stream(endpoint: string): this {
    this.transports.push(new StreamTransport(endpoint))
    return this
  }

  /**
   * Add custom transport
   */
  transport(transport: LogTransport): this {
    this.transports.push(transport)
    return this
  }

  /**
   * Set default context for all log entries
   */
  context(ctx: Record<string, unknown>): this {
    this.defaultContext = { ...this.defaultContext, ...ctx }
    return this
  }

  /**
   * Build the logger instance
   */
  build(): LoggerInstance {
    // Add console transport if none specified
    if (this.transports.length === 0) {
      this.transports.push(new ConsoleTransport(this.pretty))
    }

    return new LoggerImpl(
      this.serviceName,
      this.minLevel,
      this.transports,
      this.defaultContext
    )
  }
}

/**
 * Logger implementation
 */
class LoggerImpl implements LoggerInstance {
  readonly name: string
  private minLevel: LogLevel
  private transports: LogTransport[]
  private context: Record<string, unknown>

  constructor(
    name: string,
    minLevel: LogLevel,
    transports: LogTransport[],
    context: Record<string, unknown>
  ) {
    this.name = name
    this.minLevel = minLevel
    this.transports = transports
    this.context = context
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel]
  }

  private log(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      service: this.name,
      ...this.context,
      ...extra,
    }

    for (const transport of this.transports) {
      try {
        transport.write(entry)
      } catch (error) {
        console.error('[LOG] Transport error:', error)
      }
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context)
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context)
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context)
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context)
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.log('fatal', message, context)
  }

  child(additionalContext: Record<string, unknown>): LoggerInstance {
    return new LoggerImpl(
      this.name,
      this.minLevel,
      this.transports,
      { ...this.context, ...additionalContext }
    )
  }

  withTraceId(traceId: string): LoggerInstance {
    return this.child({ traceId })
  }
}

/**
 * Global logger instance
 */
let globalLogger: LoggerInstance | null = null

/**
 * Log entry point
 */
export const Log = {
  /**
   * Create a new log builder
   */
  create(name: string): LogBuilder {
    return new LogBuilder(name)
  },

  /**
   * Set global logger
   */
  setGlobal(logger: LoggerInstance): void {
    globalLogger = logger
  },

  /**
   * Get global logger
   */
  getGlobal(): LoggerInstance | null {
    return globalLogger
  },

  /**
   * Log debug message using global logger
   */
  debug(message: string, context?: Record<string, unknown>): void {
    globalLogger?.debug(message, context)
  },

  /**
   * Log info message using global logger
   */
  info(message: string, context?: Record<string, unknown>): void {
    globalLogger?.info(message, context)
  },

  /**
   * Log warn message using global logger
   */
  warn(message: string, context?: Record<string, unknown>): void {
    globalLogger?.warn(message, context)
  },

  /**
   * Log error message using global logger
   */
  error(message: string, context?: Record<string, unknown>): void {
    globalLogger?.error(message, context)
  },

  /**
   * Log fatal message using global logger
   */
  fatal(message: string, context?: Record<string, unknown>): void {
    globalLogger?.fatal(message, context)
  },
}

export type { LogBuilder }
