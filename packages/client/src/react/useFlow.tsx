/**
 * useFlow Hook
 *
 * React hook for subscribing to Flow events with real-time updates.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useOnePipeClient } from './provider'
import type { ExtractFlows } from '../types'

/**
 * Options for useFlow hook
 */
interface UseFlowOptions {
  /** Enable live SSE subscription */
  live?: boolean
  /** Number of recent events to fetch */
  tail?: number
  /** Maximum events to fetch */
  limit?: number
  /** Start from this offset */
  offset?: string
  /** Refetch interval in ms (only when not live) */
  refetchInterval?: number
}

/**
 * Return type for useFlow hook
 */
interface UseFlowResult<T> {
  /** Array of events */
  events: T[]
  /** Loading state */
  isLoading: boolean
  /** Error if any */
  error: Error | null
  /** Whether live connection is active */
  isConnected: boolean
  /** Append a new event */
  append: (event: T) => Promise<void>
  /** Refetch events */
  refetch: () => void
}

/**
 * useFlow - Subscribe to a Flow with real-time updates
 *
 * @example
 * ```tsx
 * import { useFlow } from '@onepipe/client/react'
 * import type { App } from '../server'
 *
 * function OrderEvents() {
 *   const { events, isConnected, append } = useFlow<App>('orderEvents', { live: true })
 *
 *   return (
 *     <div>
 *       <span>{isConnected ? 'Live' : 'Disconnected'}</span>
 *       {events.map((e, i) => (
 *         <div key={i}>{e.type}: {e.orderId}</div>
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */
export function useFlow<
  TServer,
  TFlowName extends keyof ExtractFlows<TServer> & string = keyof ExtractFlows<TServer> & string,
>(
  flowName: TFlowName,
  options: UseFlowOptions = {}
): UseFlowResult<ExtractFlows<TServer>[TFlowName]> {
  type TEvent = ExtractFlows<TServer>[TFlowName]

  const client = useOnePipeClient<ExtractFlows<TServer>, Record<string, unknown>>()
  const queryClient = useQueryClient()
  const flowClient = useMemo(() => client.flows[flowName], [client, flowName])

  const [isConnected, setIsConnected] = useState(false)
  const [liveEvents, setLiveEvents] = useState<TEvent[]>([])

  // Query key for this flow
  const queryKey = useMemo(
    () => ['onepipe', 'flow', flowName, { tail: options.tail, limit: options.limit, offset: options.offset }],
    [flowName, options.tail, options.limit, options.offset]
  )

  // Fetch initial events
  const {
    data: fetchedEvents = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () =>
      flowClient.read({
        tail: options.tail,
        limit: options.limit,
        offset: options.offset,
      }),
    refetchInterval: options.live ? false : options.refetchInterval,
  })

  // Subscribe to live events
  useEffect(() => {
    if (!options.live) return

    const unsubscribe = flowClient.subscribe({
      onEvent: (event: TEvent) => {
        setLiveEvents((prev) => [...prev, event])
        // Also update the query cache
        queryClient.setQueryData<TEvent[]>(queryKey, (old = []) => [...old, event])
      },
      onConnect: () => setIsConnected(true),
      onDisconnect: () => setIsConnected(false),
      onError: (err) => console.error('Flow subscription error:', err),
    })

    return () => {
      unsubscribe()
      setIsConnected(false)
    }
  }, [flowClient, options.live, queryClient, queryKey])

  // Merge fetched and live events
  const events = useMemo(() => {
    if (options.live) {
      // When live, we get initial fetch + accumulated live events
      return fetchedEvents as TEvent[]
    }
    return fetchedEvents as TEvent[]
  }, [fetchedEvents, options.live])

  // Append function
  const append = useCallback(
    async (event: TEvent) => {
      await flowClient.append(event)
      // Optimistically add to local state if live
      if (options.live) {
        setLiveEvents((prev) => [...prev, event])
      }
    },
    [flowClient, options.live]
  )

  return {
    events,
    isLoading,
    error: error as Error | null,
    isConnected,
    append,
    refetch,
  }
}
