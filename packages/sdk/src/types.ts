/**
 * Core types for OnePipe SDK
 */

import type { z } from 'zod'

// ============================================================================
// API Error Types (Encore-compatible)
// ============================================================================

/**
 * Standard API error codes (aligned with Encore Cloud)
 */
export type APIErrorCode =
  | 'OK'
  | 'Canceled'
  | 'Unknown'
  | 'InvalidArgument'
  | 'DeadlineExceeded'
  | 'NotFound'
  | 'AlreadyExists'
  | 'PermissionDenied'
  | 'ResourceExhausted'
  | 'FailedPrecondition'
  | 'Aborted'
  | 'OutOfRange'
  | 'Unimplemented'
  | 'Internal'
  | 'Unavailable'
  | 'DataLoss'
  | 'Unauthenticated'

/**
 * Mapping of error codes to HTTP status codes
 */
export const ErrorCodeToHTTPStatus: Record<APIErrorCode, number> = {
  OK: 200,
  Canceled: 499,
  Unknown: 500,
  InvalidArgument: 400,
  DeadlineExceeded: 504,
  NotFound: 404,
  AlreadyExists: 409,
  PermissionDenied: 403,
  ResourceExhausted: 429,
  FailedPrecondition: 412,
  Aborted: 409,
  OutOfRange: 400,
  Unimplemented: 501,
  Internal: 500,
  Unavailable: 503,
  DataLoss: 500,
  Unauthenticated: 401,
}

/**
 * Structured API error with typed error codes
 * Use this to throw errors from handlers that will be properly serialized
 */
export class APIError extends Error {
  readonly code: APIErrorCode
  readonly details?: unknown

  constructor(code: APIErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'APIError'
    this.code = code
    this.details = details
  }

  /**
   * Get HTTP status code for this error
   */
  get status(): number {
    return ErrorCodeToHTTPStatus[this.code]
  }

  /**
   * Convert to JSON response (safe for client consumption)
   */
  toJSON(): { code: APIErrorCode; message: string } {
    // Note: details intentionally not exposed to clients for security
    return {
      code: this.code,
      message: this.message,
    }
  }

  // Convenience factory methods
  static invalidArgument(message: string, details?: unknown): APIError {
    return new APIError('InvalidArgument', message, details)
  }

  static notFound(message = 'Not Found', details?: unknown): APIError {
    return new APIError('NotFound', message, details)
  }

  static unauthenticated(message = 'Unauthenticated', details?: unknown): APIError {
    return new APIError('Unauthenticated', message, details)
  }

  static permissionDenied(message = 'Permission Denied', details?: unknown): APIError {
    return new APIError('PermissionDenied', message, details)
  }

  static internal(message = 'Internal Error', details?: unknown): APIError {
    return new APIError('Internal', message, details)
  }

  static unavailable(message = 'Service Unavailable', details?: unknown): APIError {
    return new APIError('Unavailable', message, details)
  }

  static resourceExhausted(message = 'Resource Exhausted', details?: unknown): APIError {
    return new APIError('ResourceExhausted', message, details)
  }
}

// ============================================================================
// Flow Types
// ============================================================================

export interface FlowOptions<T> {
  name: string
  schema?: z.ZodType<T>
  retention?: RetentionOptions
  trace?: boolean
}

export interface RetentionOptions {
  maxAge?: string  // e.g., '30d', '7d', '1h'
  maxBytes?: number
}

export interface FlowInstance<T> {
  readonly name: string
  append(data: T): Promise<void>
  read(options?: ReadOptions): Promise<T[]>
  subscribe(handler: (data: T) => void): () => void
  stream(options?: StreamOptions): AsyncIterable<T>
}

export interface ReadOptions {
  offset?: string
  tail?: number
  limit?: number
}

export interface StreamOptions {
  offset?: string
  live?: boolean | 'sse' | 'long-poll'
}

// ============================================================================
// REST Types
// ============================================================================

export interface RESTOptions {
  name: string
  basePath: string
}

/**
 * Represents an uploaded file from multipart/form-data
 */
export interface UploadedFile {
  /** Original filename from the client */
  name: string
  /** MIME type (e.g., 'image/png', 'application/pdf') */
  type: string
  /** File size in bytes */
  size: number
  /** File contents as ArrayBuffer */
  arrayBuffer(): Promise<ArrayBuffer>
  /** File contents as text */
  text(): Promise<string>
  /** File contents as Blob */
  blob(): Blob
  /** Stream the file contents */
  stream(): ReadableStream<Uint8Array>
}

export interface RESTContext<TUser = unknown> {
  params: Record<string, string>
  query: Record<string, string>
  headers: Headers
  responseHeaders: Headers
  user?: TUser
  db: DBContext
  cache?: CacheContext
  /** Get parsed body (JSON, form-urlencoded, or text) */
  body<T>(): T
  /** Get a single uploaded file by field name */
  file(name: string): UploadedFile | undefined
  /** Get all uploaded files (optionally filtered by field name) */
  files(name?: string): UploadedFile[]
  /** Get form field value (for multipart forms) */
  formField(name: string): string | undefined
  /** Get all form fields (for multipart forms) */
  formFields(): Record<string, string>
  json<T>(data: T, status?: number): Response
  created<T>(data: T): Response
  noContent(): Response
  notFound(message?: string): Response
  unauthorized(message?: string): Response
  forbidden(message?: string): Response
  badRequest(message?: string): Response
}

export type RESTHandler<TUser = unknown> = (ctx: RESTContext<TUser>) => Promise<Response | unknown>

export interface RouteOptions {
  public?: boolean
}

export interface RESTInstance {
  readonly name: string
  readonly basePath: string
  readonly routes: RouteDefinition[]
  handler(): (req: Request) => Promise<Response>
}

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  handler: RESTHandler
  options?: RouteOptions
}

// ============================================================================
// Channel Types
// ============================================================================

export interface ChannelOptions<TInput, TOutput> {
  name: string
  input?: z.ZodType<TInput>
  output?: z.ZodType<TOutput>
  retry?: RetryOptions
  timeout?: string
  trace?: boolean
}

export interface RetryOptions {
  attempts?: number
  backoff?: 'linear' | 'exponential'
  delay?: number
}

export interface ChannelContext<TUser = unknown> {
  user?: TUser
  span(name: string): void
  emit<T>(flow: string, data: T): Promise<void>
  db: DBContext
}

export type ChannelHandler<TInput, TOutput, TUser = unknown> = (
  input: TInput,
  ctx: ChannelContext<TUser>
) => Promise<TOutput>

export interface ChannelInstance<TInput, TOutput> {
  readonly name: string
  call(input: TInput): Promise<TOutput>
  history(options?: { since?: string; limit?: number }): Promise<ChannelCall<TInput, TOutput>[]>
}

export interface ChannelCall<TInput, TOutput> {
  id: string
  input: TInput
  output?: TOutput
  error?: string
  timestamp: number
  duration: number
}

// ============================================================================
// Projection Types
// ============================================================================

export interface ProjectionOptions<TState, TEvent> {
  name: string
  from: FlowInstance<TEvent> | string
  initial: TState
  reduce: (state: TState, event: TEvent) => TState
  snapshot?: SnapshotOptions
}

export interface SnapshotOptions {
  every?: number
  storage?: 'sqlite' | 'memory'
  onStartup?: 'restore' | 'rebuild'
}

export interface ProjectionInstance<TState> {
  readonly name: string
  get(): Promise<TState>
  get(key: string): Promise<TState | undefined>
  keys(): Promise<string[]>
  values(): Promise<TState[]>
  subscribe(handler: (state: TState) => void): () => void
  subscribeKey(key: string, handler: (state: TState | undefined) => void): () => void
  rebuild(): Promise<void>
  metadata(): { eventCount: number; lastOffset: string; subscriberCount: number }
  stop(): void
}

// ============================================================================
// Signal Types
// ============================================================================

export interface SignalOptions<T> {
  name: string
  schema?: z.ZodType<T>
  default: T
}

export interface SignalInstance<T> {
  readonly name: string
  get(): Promise<T>
  set(value: T): Promise<void>
  update(updater: (current: T) => T): Promise<void>
  patch(partial: Partial<T>): Promise<void>
  subscribe(handler: (value: T) => void): () => void
  waitFor(predicate: (value: T) => boolean, timeout?: number): Promise<T>
  reset(): Promise<void>
  metadata(): { name: string; subscriberCount: number; persist: string }
  close(): void
}

// ============================================================================
// Database Types
// ============================================================================

export interface DBOptions {
  name: string
  type: 'postgres' | 'mysql' | 'sqlite'
  url: string
  pool?: PoolOptions
  trace?: boolean
}

export interface PoolOptions {
  min?: number
  max?: number
}

export interface QueryOptions {
  /** Override trace setting for this query (default: use builder setting) */
  trace?: boolean
}

export interface DBContext {
  query<T>(sql: string, params?: unknown[], options?: QueryOptions): Promise<T[]>
  transaction<T>(fn: (tx: DBContext) => Promise<T>): Promise<T>
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

export interface DBInstance extends DBContext {
  readonly name: string
  readonly type: 'postgres' | 'mysql' | 'sqlite'
  close(): Promise<void>
  getTables(): Promise<TableInfo[]>
  getTableSchema(tableName: string): Promise<ColumnInfo[]>
}

// ============================================================================
// Cache Types
// ============================================================================

export interface CacheOptions {
  name: string
  url: string
  prefix?: string
  defaultTtl?: number
  maxConnections?: number
  cluster?: string[]
  trace?: boolean
}

export interface CacheContext {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, options?: { ttl?: number }): Promise<void>
  del(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  incr(key: string, by?: number): Promise<number>
  decr(key: string, by?: number): Promise<number>
}

export interface CacheInstance {
  readonly name: string
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, options?: { ttl?: number }): Promise<void>
  del(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  ttl(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<void>
  incr(key: string, by?: number): Promise<number>
  decr(key: string, by?: number): Promise<number>
  // Hash operations
  hset(key: string, field: string, value: unknown): Promise<void>
  hget<T>(key: string, field: string): Promise<T | null>
  hgetall<T>(key: string): Promise<T | null>
  hdel(key: string, field: string): Promise<void>
  // List operations
  lpush<T>(key: string, value: T): Promise<number>
  rpush<T>(key: string, value: T): Promise<number>
  lpop<T>(key: string): Promise<T | null>
  rpop<T>(key: string): Promise<T | null>
  lrange<T>(key: string, start: number, stop: number): Promise<T[]>
  // Set operations
  sadd(key: string, ...members: string[]): Promise<number>
  srem(key: string, ...members: string[]): Promise<number>
  smembers(key: string): Promise<string[]>
  sismember(key: string, member: string): Promise<boolean>
  // Pub/Sub
  publish(channel: string, message: unknown): Promise<void>
  subscribe(channel: string, callback: (message: unknown) => void): () => void
  // Context for handlers
  context(): CacheContext
  close(): Promise<void>
}

// ============================================================================
// Auth Types
// ============================================================================

export interface AuthOptions {
  name: string
  provider: unknown  // better-auth instance
}

export interface AuthInstance<TUser extends AuthUser = AuthUser> {
  readonly name: string
  readonly basePath: string
  middleware(): (req: Request) => Promise<AuthResult<TUser>>
  requireRole(role: string | string[]): (req: Request) => Promise<AuthResult<TUser>>
  requirePermission(permission: string | string[]): (req: Request) => Promise<AuthResult<TUser>>
  handler(): (req: Request) => Promise<Response>
  validateToken(token: string): Promise<AuthResult<TUser>>
  // Session management
  getSession(request: Request): Promise<AuthSession | null>
  listSessions(userId: string): Promise<AuthSession[]>
  revokeSession(sessionId: string): Promise<void>
  revokeAllSessions(userId: string): Promise<void>
}

export interface AuthResult<TUser extends AuthUser = AuthUser> {
  authenticated: boolean
  user?: TUser
  error?: APIError | string
}

export interface AuthSession {
  id: string
  userId: string
  token: string
  expiresAt: Date
  createdAt: Date
  userAgent?: string
  ipAddress?: string
}

export interface AuthUser {
  id: string
  email?: string
  name?: string
  role?: string
  [key: string]: unknown
}

// ============================================================================
// Server Types
// ============================================================================

export interface ServeOptions {
  port?: number
  hostname?: string
  rest?: RESTInstance[]
  channels?: ChannelInstance<unknown, unknown>[]
  flows?: FlowInstance<unknown>[]
  projections?: ProjectionInstance<unknown>[]
  signals?: SignalInstance<unknown>[]
  auth?: AuthInstance
  db?: DBInstance
  cache?: CacheInstance
}

// ============================================================================
// Storage Types (S3-compatible)
// ============================================================================

export interface StorageOptions {
  name: string
  /** S3 bucket name */
  bucket: string
  /** S3 endpoint URL (e.g., https://s3.us-east-1.amazonaws.com) */
  endpoint?: string
  /** AWS region */
  region?: string
  /** Access key ID (defaults to S3_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID env var) */
  accessKeyId?: string
  /** Secret access key (defaults to S3_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY env var) */
  secretAccessKey?: string
  /** Session token for temporary credentials */
  sessionToken?: string
  /** Enable tracing */
  trace?: boolean
}

export interface StorageFile {
  /** File key/path in the bucket */
  key: string
  /** File size in bytes */
  size: number
  /** MIME type */
  type: string
  /** ETag (content hash) */
  etag?: string
  /** Last modified timestamp */
  lastModified?: Date
  /** Read file as text */
  text(): Promise<string>
  /** Read file as JSON */
  json<T = unknown>(): Promise<T>
  /** Read file as ArrayBuffer */
  arrayBuffer(): Promise<ArrayBuffer>
  /** Read file as Uint8Array */
  bytes(): Promise<Uint8Array>
  /** Get readable stream */
  stream(): ReadableStream<Uint8Array>
  /** Delete the file */
  delete(): Promise<void>
  /** Check if file exists */
  exists(): Promise<boolean>
  /** Generate a presigned URL */
  presign(options?: PresignOptions): string
}

export interface PresignOptions {
  /** URL expiration in seconds (default: 3600) */
  expiresIn?: number
  /** HTTP method (default: GET) */
  method?: 'GET' | 'PUT' | 'DELETE'
  /** ACL for PUT requests */
  acl?: 'private' | 'public-read' | 'public-read-write'
}

export interface StorageWriteOptions {
  /** MIME type */
  type?: string
  /** Cache-Control header */
  cacheControl?: string
  /** Content-Disposition header */
  contentDisposition?: string
  /** ACL */
  acl?: 'private' | 'public-read' | 'public-read-write'
}

export interface StorageListOptions {
  /** Filter by prefix */
  prefix?: string
  /** Maximum number of results */
  limit?: number
  /** Continuation token for pagination */
  cursor?: string
  /** Delimiter for directory-like listing */
  delimiter?: string
}

export interface StorageListResult {
  /** List of files */
  files: Array<{ key: string; size: number; lastModified?: Date }>
  /** Common prefixes (directories) when using delimiter */
  prefixes: string[]
  /** Continuation token for next page */
  cursor?: string
  /** Whether there are more results */
  hasMore: boolean
}

export interface StorageInstance {
  readonly name: string
  readonly bucket: string
  /** Get a file reference (lazy, no network request) */
  file(key: string): StorageFile
  /** Write data to a file */
  write(key: string, data: string | ArrayBuffer | Uint8Array | Blob | ReadableStream, options?: StorageWriteOptions): Promise<void>
  /** Delete a file */
  delete(key: string): Promise<void>
  /** Check if a file exists */
  exists(key: string): Promise<boolean>
  /** List files in the bucket */
  list(options?: StorageListOptions): Promise<StorageListResult>
  /** Generate a presigned URL */
  presign(key: string, options?: PresignOptions): string
}

// ============================================================================
// Config Types
// ============================================================================

export interface OnePipeConfig {
  name: string
  environments: Record<string, EnvironmentConfig>
  hooks?: DeployHooks
}

export interface EnvironmentConfig {
  streams: string | 'embedded'
  database?: string
  redis?: string
  replicas?: number
}

export interface DeployHooks {
  preDeploy?: (env: string) => Promise<void>
  postDeploy?: (env: string) => Promise<void>
}

// ============================================================================
// Workflow Types (Durable Execution)
// ============================================================================

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out'

export interface WorkflowOptions<TInput, TOutput> {
  name: string
  input?: z.ZodType<TInput>
  output?: z.ZodType<TOutput>
  timeout?: string
  retry?: RetryOptions
  trace?: boolean
}

export interface WorkflowContext<TInput> {
  /** Workflow execution ID */
  readonly workflowId: string
  /** Workflow name */
  readonly workflowName: string
  /** Input data */
  readonly input: TInput
  /** When the workflow started */
  readonly startedAt: Date

  /**
   * Execute a step with at-most-once semantics
   * If the step was already completed, returns cached result
   */
  step<T>(name: string, fn: () => Promise<T>, options?: StepOptions): Promise<T>

  /**
   * Execute multiple steps in parallel
   */
  parallel<T extends readonly unknown[]>(steps: [...{ [K in keyof T]: Promise<T[K]> }]): Promise<T>

  /**
   * Durable sleep (survives restarts)
   */
  sleep(duration: string | number): Promise<void>

  /**
   * Start a child workflow and wait for result
   */
  child<I, O>(workflow: WorkflowInstance<I, O>, input: I, options?: { workflowId?: string }): Promise<O>

  /**
   * Wait for an external signal
   */
  signal<T = unknown>(name: string, timeout?: string): Promise<T>

  /**
   * Emit event to a Flow
   */
  emit<T>(flow: FlowInstance<T>, data: T): Promise<void>

  /** Database access (read-only in workflow, use step for writes) */
  readonly db: DBContext
}

export interface StepOptions {
  timeout?: string
  retry?: RetryOptions
}

export interface StartOptions {
  /** Custom workflow ID for idempotency */
  workflowId?: string
  /** Timeout for this execution */
  timeout?: string
}

export interface WorkflowHandle<TOutput> {
  /** Workflow execution ID */
  readonly workflowId: string

  /** Get current status */
  status(): Promise<WorkflowStatus>

  /** Wait for result (blocks until complete or timeout) */
  result(timeout?: string): Promise<TOutput>

  /** Send a signal to the workflow */
  signal(name: string, data: unknown): Promise<void>

  /** Cancel the workflow */
  cancel(): Promise<void>
}

export interface WorkflowExecution<TOutput = unknown> {
  workflowId: string
  workflowName: string
  status: WorkflowStatus
  input: unknown
  output?: TOutput
  error?: string
  startedAt: Date
  completedAt?: Date
  steps: StepExecution[]
}

export interface StepExecution {
  stepName: string
  stepIndex: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  output?: unknown
  error?: string
  attempts: number
  startedAt?: Date
  completedAt?: Date
}

export interface ListWorkflowOptions {
  status?: WorkflowStatus | WorkflowStatus[]
  limit?: number
  offset?: number
}

export interface WorkflowInstance<TInput, TOutput> {
  readonly name: string

  /** Start a new workflow execution */
  start(input: TInput, options?: StartOptions): Promise<WorkflowHandle<TOutput>>

  /** Get handle to existing workflow by ID */
  get(workflowId: string): WorkflowHandle<TOutput>

  /** List workflow executions */
  list(options?: ListWorkflowOptions): Promise<WorkflowExecution<TOutput>[]>

  /** Send a signal to a workflow */
  signal(workflowId: string, signalName: string, data: unknown): Promise<void>

  /** Cancel a workflow */
  cancel(workflowId: string): Promise<void>

  /** Resume stalled/crashed workflows (called internally by recovery loop) */
  recover(): Promise<number>
}

export type WorkflowFunction<TInput, TOutput> = (
  ctx: WorkflowContext<TInput>,
  input: TInput
) => Promise<TOutput>

// ============================================================================
// Cron Types (Scheduled Jobs)
// ============================================================================

export type CronExecutionStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface CronOptions {
  name: string
  schedule: string
  timezone?: string
  catchUp?: boolean
  maxCatchUp?: number
  trace?: boolean
}

export interface CronContext {
  /** Job name */
  readonly jobName: string
  /** Scheduled execution time */
  readonly scheduledTime: Date
  /** Actual execution time */
  readonly actualTime: Date
  /** Unique execution ID */
  readonly executionId: string
  /** Database access */
  readonly db: DBContext
  /** Emit event to a Flow */
  emit<T>(flow: FlowInstance<T>, data: T): Promise<void>
}

export type CronHandler<TOutput> = (ctx: CronContext) => Promise<TOutput>

export interface CronExecution<TOutput = unknown> {
  executionId: string
  jobName: string
  scheduledTime: Date
  actualTime: Date
  status: CronExecutionStatus
  output?: TOutput
  error?: string
  durationMs?: number
}

export interface CronHistoryOptions {
  limit?: number
  since?: Date
}

export interface CronInstance<TOutput> {
  readonly name: string
  readonly schedule: string

  /** Start the scheduler */
  start(): void

  /** Stop the scheduler */
  stop(): void

  /** Manual trigger */
  trigger(): Promise<CronExecution<TOutput>>

  /** Get execution history */
  history(options?: CronHistoryOptions): Promise<CronExecution<TOutput>[]>

  /** Get next scheduled execution time */
  nextRun(): Date | null

  /** Check if scheduler is running */
  isRunning(): boolean
}

// ============================================================================
// Type Inference Helpers (tRPC-style)
// ============================================================================

/**
 * Extract the event type from a FlowInstance
 */
export type InferFlowEvent<T> = T extends FlowInstance<infer E> ? E : never

/**
 * Extract the value type from a SignalInstance
 */
export type InferSignalValue<T> = T extends SignalInstance<infer V> ? V : never

/**
 * Route definition with type information
 */
export interface TypedRouteDefinition<
  TMethod extends string = string,
  TPath extends string = string,
  TResponse = unknown,
> {
  method: TMethod
  path: TPath
  _response?: TResponse // Phantom type for inference
}

/**
 * REST API with typed routes
 */
export interface TypedRESTInstance<TRoutes extends Record<string, unknown> = Record<string, unknown>> {
  readonly name: string
  readonly basePath: string
  readonly routes: RouteDefinition[]
  readonly _routes?: TRoutes // Phantom type for inference
  handler(): (req: Request) => Promise<Response>
}

/**
 * Server instance with typed APIs, Flows, and Signals
 */
export interface ServerInstance<
  TAPIs extends Record<string, TypedRESTInstance> = Record<string, TypedRESTInstance>,
  TFlows extends Record<string, FlowInstance<unknown>> = Record<string, FlowInstance<unknown>>,
  TSignals extends Record<string, SignalInstance<unknown>> = Record<string, SignalInstance<unknown>>,
> {
  readonly port: number
  readonly apis: TAPIs
  readonly flows: TFlows
  readonly signals: TSignals
  stop(): void
}

/**
 * Helper to extract API types from a server
 */
export type InferAPIs<T> = T extends ServerInstance<infer A, infer _F, infer _S> ? A : never

/**
 * Helper to extract Flow types from a server
 */
export type InferFlows<T> = T extends ServerInstance<infer _A, infer F, infer _S> ? F : never

/**
 * Helper to extract Signal types from a server
 */
export type InferSignals<T> = T extends ServerInstance<infer _A, infer _F, infer S> ? S : never

/**
 * Extract the input type from a WorkflowInstance
 */
export type InferWorkflowInput<T> = T extends WorkflowInstance<infer I, infer _O> ? I : never

/**
 * Extract the output type from a WorkflowInstance
 */
export type InferWorkflowOutput<T> = T extends WorkflowInstance<infer _I, infer O> ? O : never

/**
 * Extract the output type from a CronInstance
 */
export type InferCronOutput<T> = T extends CronInstance<infer O> ? O : never
