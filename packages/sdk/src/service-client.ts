/**
 * Service Client - Traced HTTP Client for Microservices
 *
 * Type-safe HTTP client with automatic OTEL tracing for service-to-service calls.
 * Adds `target.service` attribute to spans for dependency graph visualization.
 *
 * @example
 * ```typescript
 * import { ServiceClient } from '@onepipe/sdk'
 *
 * // Create a client for the users service
 * const users = ServiceClient.create('users')
 *   .baseUrl(process.env.USERS_URL || 'http://localhost:3001')
 *   .timeout(5000)
 *   .retry(3)
 *   .build()
 *
 * // In a handler - automatically traced
 * const user = await users.get<User>('/api/users/123')
 * await users.post<User>('/api/users', { name: 'Alice' })
 * ```
 */

import { withSpan, isInitialized } from './otel'
import { APIError } from './types'

// ============================================================================
// Types
// ============================================================================

export interface ServiceClientOptions {
  /** Service name (used for tracing and dependency graph) */
  name: string
  /** Base URL for the service */
  baseUrl: string
  /** Request timeout in milliseconds (default: 30000) */
  timeout: number
  /** Number of retries for failed requests (default: 0) */
  retries: number
  /** Retry delay in milliseconds (default: 1000) */
  retryDelay: number
  /** Default headers to include in all requests */
  headers: Record<string, string>
}

export interface ServiceClientInstance {
  /** Service name */
  readonly name: string
  /** Base URL */
  readonly baseUrl: string

  /** GET request with typed response */
  get<T>(path: string, options?: RequestOptions): Promise<T>

  /** POST request with typed body and response */
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>

  /** PUT request with typed body and response */
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>

  /** PATCH request with typed body and response */
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>

  /** DELETE request with typed response */
  delete<T>(path: string, options?: RequestOptions): Promise<T>

  /** Raw request with full control */
  request<T>(method: string, path: string, options?: RequestOptions): Promise<T>
}

export interface RequestOptions {
  /** Request body (for POST/PUT/PATCH) */
  body?: unknown
  /** Additional headers */
  headers?: Record<string, string>
  /** Override timeout for this request */
  timeout?: number
  /** Query parameters */
  query?: Record<string, string | number | boolean>
}

// ============================================================================
// Builder
// ============================================================================

class ServiceClientBuilder {
  private options: ServiceClientOptions

  constructor(name: string) {
    this.options = {
      name,
      baseUrl: '',
      timeout: 30000,
      retries: 0,
      retryDelay: 1000,
      headers: {},
    }
  }

  /**
   * Set the base URL for the service
   */
  baseUrl(url: string): this {
    this.options.baseUrl = url.replace(/\/$/, '') // Remove trailing slash
    return this
  }

  /**
   * Set request timeout in milliseconds
   */
  timeout(ms: number): this {
    this.options.timeout = ms
    return this
  }

  /**
   * Set number of retries for failed requests
   */
  retry(count: number, delayMs = 1000): this {
    this.options.retries = count
    this.options.retryDelay = delayMs
    return this
  }

  /**
   * Add default headers to all requests
   */
  header(name: string, value: string): this {
    this.options.headers[name] = value
    return this
  }

  /**
   * Add multiple default headers
   */
  headers(headers: Record<string, string>): this {
    Object.assign(this.options.headers, headers)
    return this
  }

  /**
   * Build the service client instance
   */
  build(): ServiceClientInstance {
    if (!this.options.baseUrl) {
      throw new Error(`ServiceClient "${this.options.name}": baseUrl is required`)
    }
    return new ServiceClientImpl(this.options)
  }
}

// ============================================================================
// Implementation
// ============================================================================

class ServiceClientImpl implements ServiceClientInstance {
  readonly name: string
  readonly baseUrl: string
  private options: ServiceClientOptions

  constructor(options: ServiceClientOptions) {
    this.name = options.name
    this.baseUrl = options.baseUrl
    this.options = options
  }

  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options)
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, { ...options, body })
  }

  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body })
  }

  async patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body })
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options)
  }

  async request<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
    const url = this.buildUrl(path, options?.query)
    const timeout = options?.timeout ?? this.options.timeout

    // Create traced request
    const executeRequest = async (): Promise<T> => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      try {
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...this.options.headers,
            ...options?.headers,
          },
          body: options?.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        // Handle non-2xx responses
        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({})) as { code?: string; message?: string; error?: string }
          throw APIError.fromResponse(response.status, errorBody)
        }

        // Handle empty responses (204, etc.)
        if (response.status === 204 || response.headers.get('content-length') === '0') {
          return undefined as T
        }

        return await response.json() as T
      } catch (error) {
        clearTimeout(timeoutId)

        if (error instanceof APIError) {
          throw error
        }

        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            throw APIError.unavailable(`Request to ${this.name} timed out after ${timeout}ms`)
          }
          throw APIError.unavailable(`Request to ${this.name} failed: ${error.message}`)
        }

        throw APIError.unavailable(`Request to ${this.name} failed`)
      }
    }

    // If tracing is enabled, wrap in span
    if (isInitialized()) {
      return withSpan(`${method} ${this.name}${path}`, {
        'http.method': method,
        'http.url': url,
        'target.service': this.name,
        'peer.service': this.name,
      }, () => this.executeWithRetry(executeRequest))
    }

    return this.executeWithRetry(executeRequest)
  }

  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined
    const maxAttempts = this.options.retries + 1

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors (4xx)
        if (error instanceof APIError && error.status >= 400 && error.status < 500) {
          throw error
        }

        // Don't retry if this was the last attempt
        if (attempt === maxAttempts) {
          throw error
        }

        // Wait before retrying (exponential backoff)
        const delay = this.options.retryDelay * Math.pow(2, attempt - 1)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    throw lastError
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    let url = `${this.baseUrl}${normalizedPath}`

    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) {
        params.set(key, String(value))
      }
      url += `?${params.toString()}`
    }

    return url
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a new service client for calling dependent services.
 *
 * @example
 * ```typescript
 * const users = ServiceClient.create('users')
 *   .baseUrl('http://localhost:3001')
 *   .timeout(5000)
 *   .retry(3)
 *   .build()
 *
 * const user = await users.get<User>('/api/users/123')
 * ```
 */
export const ServiceClient = {
  create(name: string): ServiceClientBuilder {
    return new ServiceClientBuilder(name)
  },
}
