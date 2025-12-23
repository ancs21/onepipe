/**
 * OnePipe React Provider
 *
 * Provides the OnePipe client context and TanStack Query provider.
 */

import React, { createContext, useContext, useMemo, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TypedClient } from '../types'

// Context for the OnePipe client
const OnePipeContext = createContext<TypedClient | null>(null)

/**
 * Hook to access the OnePipe client
 */
export function useOnePipeClient<
  TFlows extends Record<string, unknown> = Record<string, unknown>,
  TSignals extends Record<string, unknown> = Record<string, unknown>,
>(): TypedClient<TFlows, TSignals> {
  const client = useContext(OnePipeContext)
  if (!client) {
    throw new Error('useOnePipeClient must be used within a OnePipeProvider')
  }
  return client as TypedClient<TFlows, TSignals>
}

/**
 * Provider props
 */
interface OnePipeProviderProps {
  client: TypedClient
  queryClient?: QueryClient
  children: ReactNode
}

/**
 * OnePipe Provider
 *
 * Wraps your app with the OnePipe client and TanStack Query.
 *
 * @example
 * ```tsx
 * import { OnePipeProvider, createClient } from '@onepipe/client'
 * import type { App } from '../server'
 *
 * const client = createClient<App>({ baseUrl: 'http://localhost:3001' })
 *
 * function App() {
 *   return (
 *     <OnePipeProvider client={client}>
 *       <YourApp />
 *     </OnePipeProvider>
 *   )
 * }
 * ```
 */
export function OnePipeProvider({ client, queryClient, children }: OnePipeProviderProps) {
  const qc = useMemo(() => queryClient || new QueryClient(), [queryClient])

  return (
    <QueryClientProvider client={qc}>
      <OnePipeContext.Provider value={client}>{children}</OnePipeContext.Provider>
    </QueryClientProvider>
  )
}
