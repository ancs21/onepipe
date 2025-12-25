/**
 * Traced HTTP Client
 *
 * HTTP client with automatic OTEL tracing for calls to dependent services.
 * Child spans are automatically created under the current active span.
 *
 * @example
 * ```typescript
 * import { http } from '@onepipe/sdk'
 *
 * // In a REST handler:
 * const api = REST.create('orders').trace()
 *   .post('/checkout', async (ctx) => {
 *     // This call will appear as a child span in the trace
 *     const payment = await http.post('https://payments-api/charge', {
 *       amount: 100
 *     })
 *     return ctx.json({ success: true })
 *   })
 *   .build()
 * ```
 */

import { withSpan, isInitialized } from './otel'

/**
 * Traced fetch wrapper for calling dependent services.
 * Automatically creates OTEL child spans when tracing is enabled.
 */
export async function tracedFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  // If tracing is not initialized, just use regular fetch
  if (!isInitialized()) {
    return fetch(url, options)
  }

  const method = options?.method || 'GET'
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    hostname = 'unknown'
  }

  return withSpan(`http.client ${method} ${hostname}`, {
    'http.method': method,
    'http.url': url,
    'http.host': hostname,
    'peer.service': hostname,
  }, async () => {
    const response = await fetch(url, options)
    return response
  })
}

/**
 * HTTP client with convenience methods for common operations.
 * All methods are automatically traced when OTEL is initialized.
 */
export const http = {
  /**
   * Make a GET request
   */
  get: (url: string, options?: RequestInit): Promise<Response> =>
    tracedFetch(url, { ...options, method: 'GET' }),

  /**
   * Make a POST request with JSON body
   */
  post: (url: string, body?: unknown, options?: RequestInit): Promise<Response> =>
    tracedFetch(url, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    }),

  /**
   * Make a PUT request with JSON body
   */
  put: (url: string, body?: unknown, options?: RequestInit): Promise<Response> =>
    tracedFetch(url, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    }),

  /**
   * Make a PATCH request with JSON body
   */
  patch: (url: string, body?: unknown, options?: RequestInit): Promise<Response> =>
    tracedFetch(url, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    }),

  /**
   * Make a DELETE request
   */
  delete: (url: string, options?: RequestInit): Promise<Response> =>
    tracedFetch(url, { ...options, method: 'DELETE' }),
}
