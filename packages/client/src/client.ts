/**
 * OnePipe Client
 *
 * Typed client for connecting to OnePipe backend servers.
 * Uses JavaScript Proxy for ergonomic API access.
 *
 * @example
 * ```typescript
 * import { createClient } from '@onepipe/client'
 * import type { App } from '../server'
 *
 * const client = createClient<App>({ baseUrl: 'http://localhost:3001' })
 *
 * // Fully typed!
 * client.flows.todoEvents.subscribe({ onEvent: (e) => console.log(e.type) })
 * const config = await client.signals.appConfig.get()
 * ```
 */

import type { ServerInstance, FlowInstance, SignalInstance } from '@onepipe/sdk'
import type { ClientOptions, FlowClient, SignalClient, TypedClient, ExtractFlows, ExtractSignals } from './types'

/**
 * Create a flow client for a specific flow
 */
function createFlowClient<T>(name: string, options: ClientOptions): FlowClient<T> {
  const baseUrl = options.baseUrl.replace(/\/$/, '')
  const flowUrl = `${baseUrl}/__onepipe/flows/${encodeURIComponent(name)}`

  const getHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...options.headers,
  })

  return {
    async read(opts = {}) {
      const params = new URLSearchParams()
      if (opts.tail !== undefined) params.set('tail', String(opts.tail))
      if (opts.limit !== undefined) params.set('limit', String(opts.limit))
      if (opts.offset !== undefined) params.set('offset', opts.offset)

      const url = `${flowUrl}/events${params.toString() ? `?${params}` : ''}`
      const response = await fetch(url, { headers: getHeaders() })

      if (!response.ok) {
        throw new Error(`Failed to read flow: ${response.statusText}`)
      }

      return response.json()
    },

    async append(event) {
      const response = await fetch(`${flowUrl}/events`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(event),
      })

      if (!response.ok) {
        throw new Error(`Failed to append to flow: ${response.statusText}`)
      }
    },

    subscribe({ onEvent, onError, onConnect, onDisconnect }) {
      const eventSource = new EventSource(`${flowUrl}/stream`)
      let connected = false

      eventSource.onopen = () => {
        connected = true
        onConnect?.()
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          onEvent(data)
        } catch (error) {
          onError?.(error instanceof Error ? error : new Error('Failed to parse event'))
        }
      }

      eventSource.onerror = () => {
        if (connected) {
          connected = false
          onDisconnect?.()
        }
        onError?.(new Error('SSE connection error'))
      }

      return () => {
        eventSource.close()
        if (connected) {
          onDisconnect?.()
        }
      }
    },
  }
}

/**
 * Create a signal client for a specific signal
 */
function createSignalClient<T>(name: string, options: ClientOptions): SignalClient<T> {
  const baseUrl = options.baseUrl.replace(/\/$/, '')
  const signalUrl = `${baseUrl}/__onepipe/signals/${encodeURIComponent(name)}`

  const getHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...options.headers,
  })

  return {
    async get() {
      const response = await fetch(signalUrl, { headers: getHeaders() })

      if (!response.ok) {
        throw new Error(`Failed to get signal: ${response.statusText}`)
      }

      return response.json()
    },

    async set(value) {
      const response = await fetch(signalUrl, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(value),
      })

      if (!response.ok) {
        throw new Error(`Failed to set signal: ${response.statusText}`)
      }

      return response.json()
    },

    async patch(partial) {
      const response = await fetch(signalUrl, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(partial),
      })

      if (!response.ok) {
        throw new Error(`Failed to patch signal: ${response.statusText}`)
      }

      return response.json()
    },

    subscribe({ onValue, onError, onConnect, onDisconnect }) {
      const eventSource = new EventSource(`${signalUrl}/stream`)
      let connected = false

      eventSource.onopen = () => {
        connected = true
        onConnect?.()
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          onValue(data)
        } catch (error) {
          onError?.(error instanceof Error ? error : new Error('Failed to parse signal value'))
        }
      }

      eventSource.onerror = () => {
        if (connected) {
          connected = false
          onDisconnect?.()
        }
        onError?.(new Error('SSE connection error'))
      }

      return () => {
        eventSource.close()
        if (connected) {
          onDisconnect?.()
        }
      }
    },
  }
}

/**
 * Create a typed OnePipe client
 *
 * @example
 * ```typescript
 * import type { App } from '../server'
 *
 * const client = createClient<App>({ baseUrl: 'http://localhost:3001' })
 *
 * // Fully typed access to flows
 * const events = await client.flows.todoEvents.read({ tail: 10 })
 *
 * // Fully typed access to signals
 * const config = await client.signals.appConfig.get()
 * ```
 */
export function createClient<TServer>(
  options: ClientOptions
): TypedClient<ExtractFlows<TServer>, ExtractSignals<TServer>> {
  // Use Proxy for lazy client creation
  const flowsProxy = new Proxy(
    {} as Record<string, FlowClient<unknown>>,
    {
      get(_target, prop: string) {
        return createFlowClient(prop, options)
      },
    }
  )

  const signalsProxy = new Proxy(
    {} as Record<string, SignalClient<unknown>>,
    {
      get(_target, prop: string) {
        return createSignalClient(prop, options)
      },
    }
  )

  return {
    flows: flowsProxy,
    signals: signalsProxy,
  } as TypedClient<ExtractFlows<TServer>, ExtractSignals<TServer>>
}

export type { ClientOptions, FlowClient, SignalClient, TypedClient }
