/**
 * OnePipe SDK
 *
 * Stream-First Developer Platform for Bun
 *
 * @example
 * ```typescript
 * import { Flow, REST, Channel, DB, Cache, Auth } from '@onepipe/sdk'
 *
 * const db = DB.create('main').postgres('postgres://...').build()
 * const events = Flow.create('events').schema(EventSchema).build()
 *
 * const api = REST
 *   .create('orders')
 *   .basePath('/api/orders')
 *   .db(db)
 *   .get('/', async (ctx) => ctx.db`SELECT * FROM orders`)
 *   .build()
 * ```
 */

// Core Primitives
export { Flow } from './flow'
export { REST } from './rest'
export { Server } from './server'
export { Channel } from './channel'
export { DB } from './db'
export { Cache } from './cache'
export { PGCache } from './pg-cache'
export { Storage } from './storage'
export { Auth, createAuthRoutes } from './auth'
export { Projection } from './projection'
export { Signal } from './signal'
export { Migration } from './migration'
export { Workflow } from './workflow'
export { Cron } from './cron'
export { Lifecycle } from './lifecycle'

// Runtime Manifest (for CLI auto-discovery)
export {
  registerPrimitive,
  getManifest,
  clearManifest,
  getInfrastructureNeeds,
  type ManifestEntry,
  type PrimitiveType,
  type InfrastructureType,
} from './manifest'

// Telemetry
export { Trace } from './trace'
export { Metrics } from './metrics'
export { Log } from './log'

// OpenTelemetry tracing
export {
  initTracing,
  getTracer,
  shutdown as shutdownTracing,
  flush as flushTracing,
  isInitialized as isTracingInitialized,
  withSpan,
  SpanStatusCode,
  setActiveContext,
  type TracingOptions,
  type Tracer,
  type Span,
} from './otel'

// Traced HTTP client for dependent services
export { http, tracedFetch } from './http-client'

// Service-to-Service Communication (Encore-style)
export { ServiceClient, type ServiceClientInstance, type ServiceClientOptions, type RequestOptions } from './service-client'
export { ServiceRegistry, getServiceUrl, type ServiceRegistryInstance, type ServiceConfig } from './registry'

// Config
export { defineConfig, Config, loadConfig, getEnvironmentConfig } from './config'

// Error handling (Encore-compatible)
export { APIError, ErrorCodeToHTTPStatus } from './types'

// Types
export type {
  // API Error types
  APIErrorCode,

  // Flow types
  FlowOptions,
  FlowInstance,
  RetentionOptions,
  ReadOptions,
  StreamOptions,

  // REST types
  RESTOptions,
  RESTContext,
  RESTHandler,
  RESTInstance,
  RouteDefinition,
  RouteOptions,

  // Channel types
  ChannelOptions,
  ChannelContext,
  ChannelHandler,
  ChannelInstance,
  ChannelCall,
  RetryOptions,

  // Projection types
  ProjectionOptions,
  ProjectionInstance,
  SnapshotOptions,

  // Signal types
  SignalOptions,
  SignalInstance,

  // DB types
  DBOptions,
  DBInstance,
  DrizzleDBInstance,
  DrizzleInstance,
  DrizzleQueryAPI,
  DBContext,
  PoolOptions,

  // Cache types
  CacheOptions,
  CacheInstance,
  CacheContext,

  // Storage types (S3-compatible)
  StorageOptions,
  StorageInstance,
  StorageFile,
  StorageWriteOptions,
  StorageListOptions,
  StorageListResult,
  PresignOptions,

  // Upload types
  UploadedFile,

  // Auth types
  AuthOptions,
  AuthInstance,
  AuthResult,
  AuthUser,

  // Server types
  ServeOptions,
  ServerInstance,

  // Config types
  OnePipeConfig,
  EnvironmentConfig,
  DeployHooks,
  ServiceDefinition,

  // Workflow types
  WorkflowOptions,
  WorkflowContext,
  WorkflowInstance,
  WorkflowHandle,
  WorkflowExecution,
  WorkflowStatus,
  WorkflowFunction,
  StepExecution,
  StepOptions,
  StartOptions,
  ListWorkflowOptions,

  // Cron types
  CronOptions,
  CronContext,
  CronHandler,
  CronInstance,
  CronExecution,
  CronExecutionStatus,
  CronHistoryOptions,

  // Lifecycle types
  LifecycleOptions,
  LifecycleInstance,
  HealthStatus,
  HealthCheckResult,
  HealthResponse,
  ReadinessResponse,
  HealthCheckFn,
  ShutdownHook,

  // Type Inference Helpers (tRPC-style)
  InferFlowEvent,
  InferSignalValue,
  InferAPIs,
  InferFlows,
  InferSignals,
  InferWorkflowInput,
  InferWorkflowOutput,
  InferCronOutput,
  TypedRESTInstance,
  TypedRouteDefinition,
} from './types'

// PGCache types
export type {
  PGCacheOptions,
  PGCacheInstance,
} from './pg-cache'
