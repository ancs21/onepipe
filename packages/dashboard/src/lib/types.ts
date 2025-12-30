// API Routes
export interface RouteInfo {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  auth: boolean
  description?: string
}

// Traces
export interface SpanEvent {
  name: string
  timestamp: number
  attributes?: Record<string, string | number | boolean>
}

export interface Span {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTime: number
  endTime: number
  duration: number
  status: 'ok' | 'error' | 'unset'
  statusMessage?: string
  attributes: Record<string, string | number | boolean>
  events?: SpanEvent[]
}

export interface Trace {
  traceId: string
  rootSpan: Span
  spans: Span[]
  totalDuration: number
  status: 'ok' | 'error'
  timestamp: number
  services?: string[]
  spanCount?: number
}

export interface TraceFilters {
  status: 'all' | 'ok' | 'error'
  services: string[]
  minDuration: number | null
  maxDuration: number | null
  search: string
  httpStatusCodes: number[]
}

export interface TimeRange {
  type: 'relative' | 'absolute'
  minutes?: number
  start?: Date
  end?: Date
}

export interface TraceStats {
  totalCount: number
  errorCount: number
  avgDuration: number
  p50Duration: number
  p95Duration: number
  p99Duration: number
  services: ServiceStats[]
  errorsByType: Record<string, number>
  durationHistogram: HistogramBucket[]
}

export interface ServiceStats {
  name: string
  requestCount: number
  errorCount: number
  avgDuration: number
}

export interface HistogramBucket {
  bucket: string
  count: number
}

export interface TracesResponse {
  traces: Trace[]
  total: number
  hasMore: boolean
}

export interface TraceServicesResponse {
  services: Array<{
    name: string
    traceCount: number
    lastSeen: number
  }>
}

// Metrics
export interface MetricPoint {
  timestamp: number
  value: number
}

export interface Counter {
  name: string
  value: number
  labels?: Record<string, string>
}

export interface Gauge {
  name: string
  value: number
  labels?: Record<string, string>
}

export interface Histogram {
  name: string
  count: number
  sum: number
  buckets: { le: number; count: number }[]
  labels?: Record<string, string>
}

export interface MetricsData {
  counters: Counter[]
  gauges: Gauge[]
  histograms: Histogram[]
  requestRate: MetricPoint[]
  latencyP50: MetricPoint[]
  latencyP99: MetricPoint[]
  errorRate?: MetricPoint[]
}

// Logs
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface LogEntry {
  id: string
  level: LogLevel
  message: string
  timestamp: string
  service?: string
  traceId?: string
  context?: Record<string, unknown>
}

// Flows
export interface FlowEvent<T = unknown> {
  id: string
  flowName: string
  data: T
  timestamp: number
  offset: string
}

export interface FlowInfo {
  name: string
  eventCount: number
  lastOffset?: string
}

// Services
export type ServiceType = 'rest' | 'flow' | 'db' | 'cache' | 'channel' | 'projection' | 'signal' | 'storage' | 'auth' | 'workflow' | 'cron'

export interface ServiceInfo {
  name: string
  type: ServiceType
  routes?: RouteInfo[]
  requestCount: number
  errorCount: number
  status?: 'healthy' | 'warning' | 'error' | 'idle'
}

export interface ServiceDependency {
  source: string
  target: string
  callCount: number
  errorCount: number
  avgLatency: number
}

export interface ServiceGraph {
  services: ServiceInfo[]
  dependencies: ServiceDependency[]
}

// Dashboard state
export interface DashboardState {
  connected: boolean
  services: string[]
  routes: RouteInfo[]
}

// Database types
export interface DatabaseInfo {
  name: string
  type: 'postgres' | 'mysql' | 'sqlite'
}

export interface TableInfo {
  name: string
  type: 'table' | 'view'
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  defaultValue: string | null
}

export interface QueryResult {
  rows: Record<string, unknown>[]
  error?: string
}

// Workflow Types
export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out'

export interface WorkflowExecution {
  workflowId: string
  workflowName: string
  status: WorkflowStatus
  input: unknown
  output?: unknown
  error?: string
  startedAt: Date | string
  completedAt?: Date | string
  steps: StepExecution[]
}

export interface StepExecution {
  stepName: string
  stepIndex: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  output?: unknown
  error?: string
  attempts: number
  startedAt?: Date | string
  completedAt?: Date | string
}

export interface WorkflowInfo {
  name: string
  runningCount: number
  completedCount: number
  failedCount: number
}

// Cron Types
export type CronExecutionStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface CronJob {
  name: string
  schedule: string
  timezone: string
  enabled: boolean
  nextScheduledTime?: Date | string
  lastScheduledTime?: Date | string
}

export interface CronExecution {
  executionId: string
  jobName: string
  scheduledTime: Date | string
  actualTime: Date | string
  status: CronExecutionStatus
  output?: unknown
  error?: string
  durationMs?: number
}

// Auth Types
export interface AuthUser {
  id: string
  email: string
  name?: string
  role?: string
  emailVerified: boolean
  image?: string
  createdAt: Date | string
  updatedAt: Date | string
}

export interface AuthSession {
  id: string
  userId: string
  token: string
  expiresAt: Date | string
  createdAt: Date | string
  userAgent?: string
  ipAddress?: string
}

export type AuthEventType = 'login' | 'logout' | 'register' | 'password_reset' | 'failed_login'

export interface AuthEvent {
  id: string
  type: AuthEventType
  userId?: string
  email?: string
  timestamp: Date | string
  success: boolean
  ipAddress?: string
  userAgent?: string
  error?: string
}

export interface AuthProvider {
  name: string
  type: 'email' | 'oauth' | 'magic_link'
  enabled: boolean
}

export interface AuthStats {
  configured: boolean
  name?: string
  basePath?: string
  totalUsers: number
  activeSessions: number
  recentLogins: number
  recentFailures: number
}
