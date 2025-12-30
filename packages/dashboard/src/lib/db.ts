/**
 * TanStack Query Hooks
 *
 * Reactive data fetching with caching and auto-refresh
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  ServiceGraph,
  FlowInfo,
  FlowEvent,
  Trace,
  RouteInfo,
  LogEntry,
  MetricsData,
  DatabaseInfo,
  TableInfo,
  ColumnInfo,
  QueryResult,
  TraceFilters,
  TimeRange,
  TracesResponse,
  TraceStats,
  TraceServicesResponse,
  WorkflowInfo,
  WorkflowExecution,
  CronJob,
  CronExecution,
  AuthUser,
  AuthSession,
  AuthEvent,
  AuthStats,
} from './types'

const API_BASE = '/api/dashboard'

async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
  }
  return response.json()
}

/**
 * Hook for fetching service graph - refreshes every 5 seconds
 */
export function useServices() {
  return useQuery({
    queryKey: ['services'],
    queryFn: () => fetchJSON<ServiceGraph>(`${API_BASE}/services`),
    refetchInterval: 5000,
  })
}

/**
 * Hook for fetching flows list - refreshes every 5 seconds
 */
export function useFlows() {
  return useQuery({
    queryKey: ['flows'],
    queryFn: () => fetchJSON<FlowInfo[]>(`${API_BASE}/flows`),
    refetchInterval: 5000,
  })
}

/**
 * Hook for fetching flow events - refreshes every 2 seconds
 */
export function useFlowEvents(flowName: string | null, enabled = true) {
  return useQuery({
    queryKey: ['flowEvents', flowName],
    queryFn: () => fetchJSON<FlowEvent[]>(`${API_BASE}/flows/${encodeURIComponent(flowName!)}/events`),
    enabled: enabled && !!flowName,
    refetchInterval: 2000,
  })
}

/**
 * Hook for fetching traces - refreshes every 2 seconds
 */
export function useTraces(limit = 100) {
  return useQuery({
    queryKey: ['traces', limit],
    queryFn: () => fetchJSON<Trace[]>(`${API_BASE}/traces?limit=${limit}`),
    refetchInterval: 2000,
  })
}

/**
 * Hook for fetching routes - refreshes every 10 seconds
 */
export function useRoutes() {
  return useQuery({
    queryKey: ['routes'],
    queryFn: () => fetchJSON<RouteInfo[]>(`${API_BASE}/routes`),
    refetchInterval: 10000,
  })
}

/**
 * Hook for fetching logs - refreshes every 2 seconds
 */
export function useLogs(limit = 200) {
  return useQuery({
    queryKey: ['logs', limit],
    queryFn: () => fetchJSON<LogEntry[]>(`${API_BASE}/logs?limit=${limit}`),
    refetchInterval: 2000,
  })
}

/**
 * Hook for fetching metrics - refreshes every 2 seconds
 */
export function useMetrics() {
  return useQuery({
    queryKey: ['metrics'],
    queryFn: () => fetchJSON<MetricsData>(`${API_BASE}/metrics`),
    refetchInterval: 2000,
  })
}

/**
 * Hook for fetching databases list - refreshes every 5 seconds
 */
export function useDatabases() {
  return useQuery({
    queryKey: ['databases'],
    queryFn: () => fetchJSON<DatabaseInfo[]>(`${API_BASE}/databases`),
    refetchInterval: 5000,
  })
}

/**
 * Hook for fetching tables in a database
 */
export function useTables(dbName: string | null, enabled = true) {
  return useQuery({
    queryKey: ['tables', dbName],
    queryFn: () => fetchJSON<TableInfo[]>(`${API_BASE}/databases/${encodeURIComponent(dbName!)}/tables`),
    enabled: enabled && !!dbName,
  })
}

/**
 * Hook for fetching table schema
 */
export function useTableSchema(dbName: string | null, tableName: string | null, enabled = true) {
  return useQuery({
    queryKey: ['schema', dbName, tableName],
    queryFn: () => fetchJSON<ColumnInfo[]>(`${API_BASE}/databases/${encodeURIComponent(dbName!)}/tables/${encodeURIComponent(tableName!)}`),
    enabled: enabled && !!dbName && !!tableName,
  })
}

/**
 * Hook for executing a query
 */
export function useExecuteQuery(dbName: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (sql: string): Promise<QueryResult> => {
      const response = await fetch(`${API_BASE}/databases/${encodeURIComponent(dbName)}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      })
      return response.json()
    },
    onSuccess: () => {
      // Invalidate table data after query
      queryClient.invalidateQueries({ queryKey: ['tables', dbName] })
    },
  })
}

/**
 * Hook for fetching filtered traces with pagination - refreshes every 2 seconds
 */
export function useTracesFiltered(filters: TraceFilters, timeRange: TimeRange, limit = 50, offset = 0) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))

  if (filters.status !== 'all') {
    params.set('status', filters.status)
  }
  if (filters.services.length > 0) {
    params.set('services', filters.services.join(','))
  }
  if (filters.minDuration !== null) {
    params.set('minDuration', String(filters.minDuration))
  }
  if (filters.maxDuration !== null) {
    params.set('maxDuration', String(filters.maxDuration))
  }
  if (filters.search) {
    params.set('search', filters.search)
  }
  if (filters.httpStatusCodes.length > 0) {
    params.set('httpStatus', filters.httpStatusCodes.join(','))
  }

  // Time range
  if (timeRange.type === 'relative' && timeRange.minutes) {
    const startTime = Date.now() - timeRange.minutes * 60 * 1000
    params.set('startTime', String(startTime))
  } else if (timeRange.type === 'absolute' && timeRange.start && timeRange.end) {
    params.set('startTime', String(timeRange.start.getTime()))
    params.set('endTime', String(timeRange.end.getTime()))
  }

  return useQuery({
    queryKey: ['traces', 'filtered', filters, timeRange, limit, offset],
    queryFn: () => fetchJSON<TracesResponse>(`${API_BASE}/traces?${params.toString()}`),
    refetchInterval: 2000,
  })
}

/**
 * Hook for fetching trace statistics - refreshes every 5 seconds
 */
export function useTraceStats(timeRange: TimeRange) {
  const params = new URLSearchParams()

  if (timeRange.type === 'relative' && timeRange.minutes) {
    const startTime = Date.now() - timeRange.minutes * 60 * 1000
    params.set('startTime', String(startTime))
  } else if (timeRange.type === 'absolute' && timeRange.start && timeRange.end) {
    params.set('startTime', String(timeRange.start.getTime()))
    params.set('endTime', String(timeRange.end.getTime()))
  }

  return useQuery({
    queryKey: ['traces', 'stats', timeRange],
    queryFn: () => fetchJSON<TraceStats>(`${API_BASE}/traces/stats?${params.toString()}`),
    refetchInterval: 5000,
  })
}

/**
 * Hook for fetching available trace services - refreshes every 10 seconds
 */
export function useTraceServices() {
  return useQuery({
    queryKey: ['traces', 'services'],
    queryFn: () => fetchJSON<TraceServicesResponse>(`${API_BASE}/traces/services`),
    refetchInterval: 10000,
  })
}

/**
 * Hook for fetching a single trace by ID
 */
export function useTrace(traceId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['trace', traceId],
    queryFn: () => fetchJSON<Trace>(`${API_BASE}/traces/${encodeURIComponent(traceId!)}`),
    enabled: enabled && !!traceId,
  })
}

// ============================================================================
// Workflow Hooks
// ============================================================================

/**
 * Hook for fetching workflow list - refreshes every 5 seconds
 */
export function useWorkflows() {
  return useQuery({
    queryKey: ['workflows'],
    queryFn: () => fetchJSON<WorkflowInfo[]>(`${API_BASE}/workflows`),
    refetchInterval: 5000,
  })
}

/**
 * Hook for fetching workflow executions - refreshes every 2 seconds
 */
export function useWorkflowExecutions(workflowName: string | null, status?: string, enabled = true) {
  const params = new URLSearchParams()
  if (status && status !== 'all') {
    params.set('status', status)
  }

  return useQuery({
    queryKey: ['workflowExecutions', workflowName, status],
    queryFn: () => fetchJSON<WorkflowExecution[]>(
      `${API_BASE}/workflows/${encodeURIComponent(workflowName!)}/executions?${params.toString()}`
    ),
    enabled: enabled && !!workflowName,
    refetchInterval: 2000,
  })
}

/**
 * Hook for fetching a single workflow execution
 */
export function useWorkflowExecution(workflowId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['workflowExecution', workflowId],
    queryFn: () => fetchJSON<WorkflowExecution>(`${API_BASE}/workflows/execution/${encodeURIComponent(workflowId!)}`),
    enabled: enabled && !!workflowId,
    refetchInterval: 1000,
  })
}

// ============================================================================
// Cron Hooks
// ============================================================================

/**
 * Hook for fetching cron jobs - refreshes every 5 seconds
 */
export function useCronJobs() {
  return useQuery({
    queryKey: ['cronJobs'],
    queryFn: () => fetchJSON<CronJob[]>(`${API_BASE}/cron`),
    refetchInterval: 5000,
  })
}

/**
 * Hook for fetching cron execution history - refreshes every 2 seconds
 */
export function useCronHistory(jobName: string | null, enabled = true) {
  return useQuery({
    queryKey: ['cronHistory', jobName],
    queryFn: () => fetchJSON<CronExecution[]>(`${API_BASE}/cron/${encodeURIComponent(jobName!)}/history`),
    enabled: enabled && !!jobName,
    refetchInterval: 2000,
  })
}

// ============================================================================
// Database Explorer Hooks
// ============================================================================

/**
 * Hook for fetching table data preview (first 10 rows)
 */
export function useTablePreview(dbName: string | null, tableName: string | null, enabled = true) {
  return useQuery({
    queryKey: ['tablePreview', dbName, tableName],
    queryFn: async (): Promise<QueryResult> => {
      const response = await fetch(`${API_BASE}/databases/${encodeURIComponent(dbName!)}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: `SELECT * FROM "${tableName}" LIMIT 10` }),
      })
      return response.json()
    },
    enabled: enabled && !!dbName && !!tableName,
  })
}

// ============================================================================
// Auth Hooks
// ============================================================================

/**
 * Hook for fetching auth stats - refreshes every 5 seconds
 */
export function useAuthStats() {
  return useQuery({
    queryKey: ['auth', 'stats'],
    queryFn: () => fetchJSON<AuthStats>(`${API_BASE}/auth/stats`),
    refetchInterval: 5000,
  })
}

/**
 * Hook for fetching auth users - refreshes every 5 seconds
 */
export function useAuthUsers(search?: string) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)

  return useQuery({
    queryKey: ['auth', 'users', search],
    queryFn: () => fetchJSON<AuthUser[]>(`${API_BASE}/auth/users?${params.toString()}`),
    refetchInterval: 5000,
  })
}

/**
 * Hook for fetching auth sessions - refreshes every 5 seconds
 */
export function useAuthSessions(userId?: string) {
  const params = new URLSearchParams()
  if (userId) params.set('userId', userId)

  return useQuery({
    queryKey: ['auth', 'sessions', userId],
    queryFn: () => fetchJSON<AuthSession[]>(`${API_BASE}/auth/sessions?${params.toString()}`),
    refetchInterval: 5000,
  })
}

/**
 * Hook for fetching auth events - refreshes every 2 seconds
 */
export function useAuthEvents(limit = 50) {
  return useQuery({
    queryKey: ['auth', 'events', limit],
    queryFn: () => fetchJSON<AuthEvent[]>(`${API_BASE}/auth/events?limit=${limit}`),
    refetchInterval: 2000,
  })
}

/**
 * Mutation hook for revoking a session
 */
export function useRevokeSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch(`${API_BASE}/auth/sessions/${sessionId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error('Failed to revoke session')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] })
      queryClient.invalidateQueries({ queryKey: ['auth', 'stats'] })
    },
  })
}

/**
 * Mutation hook for creating a user
 */
export function useCreateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { email: string; password: string; name?: string; role?: string }) => {
      const response = await fetch(`${API_BASE}/auth/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to create user')
      }
      return result.user as AuthUser
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'users'] })
      queryClient.invalidateQueries({ queryKey: ['auth', 'stats'] })
    },
  })
}

/**
 * Mutation hook for deleting a user
 */
export function useDeleteUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await fetch(`${API_BASE}/auth/users/${userId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to delete user')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'users'] })
      queryClient.invalidateQueries({ queryKey: ['auth', 'stats'] })
    },
  })
}

/**
 * Mutation hook for generating a token for a user
 */
export function useGenerateToken() {
  return useMutation({
    mutationFn: async (data: { userId: string; expiresIn?: number }) => {
      const response = await fetch(`${API_BASE}/auth/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate token')
      }
      return result as { token: string; expiresAt: number }
    },
  })
}

/**
 * Mutation hook for getting an impersonation URL
 */
export function useImpersonateUser() {
  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await fetch(`${API_BASE}/auth/impersonate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate impersonation URL')
      }
      return result as { url: string }
    },
  })
}
