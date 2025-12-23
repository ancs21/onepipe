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
export { Storage } from './storage'
export { Auth, createAuthRoutes } from './auth'
export { Projection } from './projection'
export { Signal } from './signal'
export { Migration } from './migration'

// Telemetry
export { Trace } from './trace'
export { Metrics } from './metrics'
export { Log } from './log'

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

  // Type Inference Helpers (tRPC-style)
  InferFlowEvent,
  InferSignalValue,
  InferAPIs,
  InferFlows,
  InferSignals,
  TypedRESTInstance,
  TypedRouteDefinition,
} from './types'
