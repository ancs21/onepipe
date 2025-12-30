import type {
  RouteInfo,
  Trace,
  MetricsData,
  LogEntry,
  FlowInfo,
  FlowEvent,
  ServiceGraph,
} from './types'

const API_BASE = '/api/dashboard'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }
  return response.json()
}

export const api = {
  // Routes
  async getRoutes(): Promise<RouteInfo[]> {
    return fetchJson(`${API_BASE}/routes`)
  },

  // Traces
  async getTraces(limit = 50): Promise<Trace[]> {
    return fetchJson(`${API_BASE}/traces?limit=${limit}`)
  },

  async getTrace(traceId: string): Promise<Trace | null> {
    return fetchJson(`${API_BASE}/traces/${traceId}`)
  },

  // Metrics
  async getMetrics(): Promise<MetricsData> {
    return fetchJson(`${API_BASE}/metrics`)
  },

  // Logs (SSE)
  subscribeLogs(
    onLog: (log: LogEntry) => void,
    onError?: (error: Event) => void
  ): () => void {
    const eventSource = new EventSource(`${API_BASE}/logs/stream`)

    eventSource.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data)
        onLog(log)
      } catch {
        // Ignore parse errors
      }
    }

    eventSource.onerror = (error) => {
      onError?.(error)
    }

    return () => eventSource.close()
  },

  async getLogs(limit = 100): Promise<LogEntry[]> {
    return fetchJson(`${API_BASE}/logs?limit=${limit}`)
  },

  // Flows
  async getFlows(): Promise<FlowInfo[]> {
    return fetchJson(`${API_BASE}/flows`)
  },

  async getFlowEvents(flowName: string, limit = 50): Promise<FlowEvent[]> {
    return fetchJson(`${API_BASE}/flows/${flowName}/events?limit=${limit}`)
  },

  // Services
  async getServiceGraph(): Promise<ServiceGraph> {
    return fetchJson(`${API_BASE}/services`)
  },

  // Request proxy (for API testing)
  async sendRequest(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<{ status: number; headers: Record<string, string>; body: unknown; duration: number }> {
    const response = await fetch(`${API_BASE}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, path, body, headers }),
    })
    return response.json()
  },
}
