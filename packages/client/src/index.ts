/**
 * OnePipe Client SDK
 *
 * Typed client for connecting to OnePipe backend servers.
 * Supports automatic type inference from server definitions.
 *
 * @example
 * ```typescript
 * import { createClient } from '@onepipe/client'
 * import type { App } from '../server'
 *
 * const client = createClient<App>({ baseUrl: 'http://localhost:3001' })
 *
 * // Fully typed access to flows
 * const events = await client.flows.todoEvents.read({ tail: 10 })
 * client.flows.todoEvents.subscribe({
 *   onEvent: (e) => console.log(e.type, e.todoId)
 * })
 *
 * // Fully typed access to signals
 * const config = await client.signals.appConfig.get()
 * await client.signals.appConfig.patch({ maintenanceMode: true })
 * ```
 */

// Main client
export { createClient } from './client'

// Types
export type {
  ClientOptions,
  FlowClient,
  SignalClient,
  TypedClient,
  ExtractFlows,
  ExtractSignals,
  InferFlowEvent,
  InferSignalValue,
} from './types'
