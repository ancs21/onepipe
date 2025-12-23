/**
 * Client SDK Type Helpers
 *
 * These types enable tRPC-style automatic type inference
 * from server definitions to client code.
 */

import type { FlowInstance, SignalInstance, ServerInstance } from '@onepipe/sdk'

/**
 * Extract event type from a FlowInstance
 */
export type InferFlowEvent<T> = T extends FlowInstance<infer E> ? E : never

/**
 * Extract value type from a SignalInstance
 */
export type InferSignalValue<T> = T extends SignalInstance<infer V> ? V : never

/**
 * Extract flows record from a server instance
 */
export type ExtractFlows<T> = T extends ServerInstance<infer _A, infer F, infer _S>
  ? { [K in keyof F]: F[K] extends FlowInstance<infer E> ? E : never }
  : never

/**
 * Extract signals record from a server instance
 */
export type ExtractSignals<T> = T extends ServerInstance<infer _A, infer _F, infer S>
  ? { [K in keyof S]: S[K] extends SignalInstance<infer V> ? V : never }
  : never

/**
 * Client options
 */
export interface ClientOptions {
  baseUrl: string
  token?: string
  headers?: Record<string, string>
}

/**
 * Flow client for a specific flow
 */
export interface FlowClient<T> {
  /**
   * Read events from the flow
   */
  read(options?: { tail?: number; limit?: number; offset?: string }): Promise<T[]>

  /**
   * Append an event to the flow
   */
  append(event: T): Promise<void>

  /**
   * Subscribe to live events via SSE
   */
  subscribe(options: {
    onEvent: (event: T) => void
    onError?: (error: Error) => void
    onConnect?: () => void
    onDisconnect?: () => void
  }): () => void
}

/**
 * Signal client for a specific signal
 */
export interface SignalClient<T> {
  /**
   * Get current value
   */
  get(): Promise<T>

  /**
   * Set value (full replace)
   */
  set(value: T): Promise<T>

  /**
   * Patch value (partial update)
   */
  patch(partial: Partial<T>): Promise<T>

  /**
   * Subscribe to live value changes via SSE
   */
  subscribe(options: {
    onValue: (value: T) => void
    onError?: (error: Error) => void
    onConnect?: () => void
    onDisconnect?: () => void
  }): () => void
}

/**
 * Typed client interface
 */
export interface TypedClient<
  TFlows extends Record<string, unknown> = Record<string, unknown>,
  TSignals extends Record<string, unknown> = Record<string, unknown>,
> {
  flows: {
    [K in keyof TFlows]: FlowClient<TFlows[K]>
  }
  signals: {
    [K in keyof TSignals]: SignalClient<TSignals[K]>
  }
}
