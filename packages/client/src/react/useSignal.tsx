/**
 * useSignal Hook
 *
 * React hook for reading and updating Signal values with real-time updates.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useOnePipeClient } from './provider'
import type { ExtractSignals } from '../types'

/**
 * Options for useSignal hook
 */
interface UseSignalOptions {
  /** Enable live SSE subscription */
  live?: boolean
  /** Refetch interval in ms (only when not live) */
  refetchInterval?: number
}

/**
 * Return type for useSignal hook
 */
interface UseSignalResult<T> {
  /** Current signal value */
  value: T | undefined
  /** Loading state */
  isLoading: boolean
  /** Error if any */
  error: Error | null
  /** Whether live connection is active */
  isConnected: boolean
  /** Set value (full replace) */
  set: (value: T) => Promise<void>
  /** Patch value (partial update) */
  patch: (partial: Partial<T>) => Promise<void>
  /** Refetch value */
  refetch: () => void
}

/**
 * useSignal - Subscribe to a Signal with real-time updates
 *
 * @example
 * ```tsx
 * import { useSignal } from '@onepipe/client/react'
 * import type { App } from '../server'
 *
 * function ConfigPanel() {
 *   const { value, set, patch, isConnected } = useSignal<App>('appConfig', { live: true })
 *
 *   if (!value) return <div>Loading...</div>
 *
 *   return (
 *     <div>
 *       <span>{isConnected ? 'Live' : 'Disconnected'}</span>
 *       <label>
 *         Maintenance Mode:
 *         <input
 *           type="checkbox"
 *           checked={value.maintenanceMode}
 *           onChange={(e) => patch({ maintenanceMode: e.target.checked })}
 *         />
 *       </label>
 *     </div>
 *   )
 * }
 * ```
 */
export function useSignal<
  TServer,
  TSignalName extends keyof ExtractSignals<TServer> & string = keyof ExtractSignals<TServer> & string,
>(
  signalName: TSignalName,
  options: UseSignalOptions = {}
): UseSignalResult<ExtractSignals<TServer>[TSignalName]> {
  type TValue = ExtractSignals<TServer>[TSignalName]

  const client = useOnePipeClient<Record<string, unknown>, ExtractSignals<TServer>>()
  const queryClient = useQueryClient()
  const signalClient = useMemo(() => client.signals[signalName], [client, signalName])

  const [isConnected, setIsConnected] = useState(false)

  // Query key for this signal
  const queryKey = useMemo(() => ['onepipe', 'signal', signalName], [signalName])

  // Fetch current value
  const {
    data: value,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => signalClient.get() as Promise<TValue>,
    refetchInterval: options.live ? false : options.refetchInterval,
  })

  // Set mutation
  const setMutation = useMutation({
    mutationFn: (newValue: TValue) => signalClient.set(newValue) as Promise<TValue>,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data)
    },
  })

  // Patch mutation
  const patchMutation = useMutation({
    mutationFn: (partial: Partial<TValue>) => signalClient.patch(partial) as Promise<TValue>,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data)
    },
  })

  // Subscribe to live updates
  useEffect(() => {
    if (!options.live) return

    const unsubscribe = signalClient.subscribe({
      onValue: (newValue: TValue) => {
        queryClient.setQueryData(queryKey, newValue)
      },
      onConnect: () => setIsConnected(true),
      onDisconnect: () => setIsConnected(false),
      onError: (err) => console.error('Signal subscription error:', err),
    })

    return () => {
      unsubscribe()
      setIsConnected(false)
    }
  }, [signalClient, options.live, queryClient, queryKey])

  // Set function
  const set = useCallback(
    async (newValue: TValue) => {
      await setMutation.mutateAsync(newValue)
    },
    [setMutation]
  )

  // Patch function
  const patch = useCallback(
    async (partial: Partial<TValue>) => {
      await patchMutation.mutateAsync(partial)
    },
    [patchMutation]
  )

  return {
    value,
    isLoading,
    error: error as Error | null,
    isConnected,
    set,
    patch,
    refetch,
  }
}
