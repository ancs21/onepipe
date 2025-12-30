# OnePipe SDK Architecture

This document explains how the OnePipe SDK works internally.

## Overview

OnePipe is a **stream-first developer platform SDK** that provides:
- Fluent builder APIs for all primitives
- Automatic infrastructure discovery for deployment
- Cloud-native persistence (PostgreSQL, Redis)
- Unified HTTP serving with dependency injection

## Core Concepts

### 1. Builder Pattern

All primitives follow a **fluent builder pattern**:

```
Builder.create(name)  →  configure()  →  .build()  →  Instance
```

```typescript
const api = REST.create('orders')      // Create builder
  .basePath('/api/orders')             // Configure
  .db(database)                        // Inject dependencies
  .get('/', handler)                   // Add routes
  .build()                             // Build instance
```

### 2. Manifest System (Auto-Discovery)

When you call `.build()`, stateful primitives **register themselves** in a global manifest:

```typescript
// Inside FlowBuilder.build()
registerPrimitive({
  primitive: 'flow',
  name: this.state.name,
  infrastructure: 'postgresql',  // Required infrastructure
  config: { persistence: 'postgres' }
})
```

The CLI reads this manifest to **auto-provision infrastructure**:

```bash
onepipe deploy  # Reads manifest → provisions PostgreSQL, Redis
```

### 3. Runtime Serving

The `serve()` function orchestrates all primitives:

```typescript
import { serve } from '@onepipe/runtime'

serve({
  port: 3000,
  rest: [ordersAPI, usersAPI],    // HTTP endpoints
  flows: [orderEvents],           // Event streams
  workflows: [processOrder],      // Durable execution
  cron: [dailyCleanup],          // Scheduled jobs
  lifecycle,                      // Health checks + shutdown
})
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Developer Code                          │
│  const api = REST.create('orders').db(db).get(...).build() │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Manifest Registration                    │
│  registerPrimitive({ primitive: 'rest', name: 'orders' })  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      serve({ rest: [api] })                 │
│  Creates Bun.serve with routes, injects db/cache/user      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      HTTP Request                           │
│  GET /api/orders → handler(ctx) → ctx.db.query(...)        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL / Redis                       │
│  Persist state, return response                             │
└─────────────────────────────────────────────────────────────┘
```

## Primitives

### Stateless Primitives

| Primitive | Purpose | Persistence |
|-----------|---------|-------------|
| **REST** | HTTP API routes | None |
| **Channel** | RPC handlers | Optional (idempotency) |

### Stateful Primitives

| Primitive | Purpose | Persistence |
|-----------|---------|-------------|
| **Flow** | Event streams | PostgreSQL (`.db()`) |
| **Signal** | Reactive state | Redis (`.cache()`) |
| **Projection** | Materialized views | PostgreSQL (`.db()`) |
| **Workflow** | Durable execution | PostgreSQL (required) |
| **Cron** | Scheduled jobs | PostgreSQL (required) |

## Internal Database Tables

OnePipe creates `_onepipe_*` tables for persistence:

### Flow Events
```sql
_onepipe_flow_events (
  id TEXT PRIMARY KEY,
  flow_name TEXT NOT NULL,
  data JSONB NOT NULL,
  timestamp BIGINT NOT NULL,
  offset_seq BIGINT NOT NULL
)
```

### Workflow Execution
```sql
_onepipe_workflows (
  workflow_id TEXT PRIMARY KEY,
  workflow_name TEXT NOT NULL,
  status TEXT NOT NULL,  -- pending, running, completed, failed, cancelled
  input JSONB,
  output JSONB,
  error TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP   -- Heartbeat updates this
)

_onepipe_workflow_steps (
  id TEXT PRIMARY KEY,
  workflow_id TEXT REFERENCES _onepipe_workflows,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL,
  result JSONB,
  error TEXT,
  UNIQUE(workflow_id, step_name)  -- At-most-once execution
)
```

### Cron Jobs
```sql
_onepipe_cron_jobs (
  job_name TEXT PRIMARY KEY,
  schedule TEXT NOT NULL,
  timezone TEXT
)

_onepipe_cron_executions (
  execution_id TEXT PRIMARY KEY,
  job_name TEXT REFERENCES _onepipe_cron_jobs,
  scheduled_time TIMESTAMP NOT NULL,
  status TEXT NOT NULL,
  output JSONB,
  error TEXT,
  UNIQUE(job_name, scheduled_time)  -- Deduplication
)

_onepipe_cron_locks (
  job_name TEXT PRIMARY KEY,
  locked_by TEXT NOT NULL,      -- Instance ID
  locked_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL -- 30s TTL, renewed every 10s
)
```

### Channel Idempotency
```sql
_onepipe_channel_idempotency (
  channel_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  result JSONB,
  error TEXT,
  status TEXT NOT NULL,  -- pending, completed, failed
  expires_at TIMESTAMP NOT NULL,
  PRIMARY KEY (channel_name, idempotency_key)
)
```

### Projection State
```sql
_onepipe_projection_state (
  name TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  last_offset TEXT NOT NULL,
  event_count BIGINT NOT NULL
)

_onepipe_projection_entities (
  projection_name TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  state JSONB NOT NULL,
  PRIMARY KEY (projection_name, entity_key)
)
```

## Dependency Injection

Primitives inject dependencies into handler contexts:

```typescript
// Builder configuration
const api = REST.create('orders')
  .db(postgres)           // Database
  .cache(redis)           // Cache
  .auth(authInstance)     // Authentication
  .build()

// Handler receives injected dependencies
.get('/:id', async (ctx) => {
  // ctx.db - Database instance
  // ctx.cache - Cache instance
  // ctx.user - Authenticated user (if auth configured)
  // ctx.params - Route parameters
  // ctx.query - Query parameters
  // ctx.headers - Request headers

  const order = await ctx.db.query(
    'SELECT * FROM orders WHERE id = $1',
    [ctx.params.id]
  )
  return order
})
```

## Multi-Instance / Cloud-Native

### How Distributed Locking Works (Cron)

```
Instance A          Instance B          PostgreSQL
    │                   │                   │
    ├──tryLock()───────────────────────────►│
    │                   │                   │ INSERT ... ON CONFLICT
    │◄──────────────────────────────────────┤ RETURNING 1 ✓
    │                   │                   │
    │                   ├──tryLock()───────►│
    │                   │                   │ Conflict, lock exists
    │                   │◄──────────────────┤ 0 rows ✗
    │                   │                   │
    ├──renewLock()─────────────────────────►│ (every 10s)
    │                   │                   │
    ├──releaseLock()───────────────────────►│
    │                   │                   │
```

### How Idempotency Works (Channel)

```typescript
const payment = Channel.create('process-payment')
  .db(postgres)
  .idempotency((input) => input.orderId)  // Extract key from input
  .handler(async (input) => {
    // This only runs ONCE per orderId
    return await chargeCard(input)
  })
  .build()

// Multiple calls with same orderId return cached result
await payment.call({ orderId: '123', amount: 99 })  // Executes
await payment.call({ orderId: '123', amount: 99 })  // Returns cached
```

### How Workflow Recovery Works

```typescript
const workflow = Workflow.create('process-order')
  .db(postgres)
  .define(async (ctx, input) => {
    // Step 1: Fetch data (result cached in DB)
    const data = await ctx.step('fetch', () => fetchData())

    // Step 2: Sleep (survives restart via heartbeat)
    await ctx.sleep('5m')

    // Step 3: Process (idempotent, only runs once)
    return await ctx.step('process', () => process(data))
  })
  .build()
```

**Recovery flow:**
1. Process crashes during `ctx.sleep('5m')`
2. New instance starts, calls `workflow.recover()`
3. Queries `_onepipe_workflows` for `status = 'running'`
4. Queries `_onepipe_workflow_steps` for completed steps
5. Skips completed steps, resumes from sleep
6. Updates `updated_at` heartbeat every 10s

## Lifecycle Management

```typescript
const lifecycle = Lifecycle.create()
  .healthCheck('db', async () => {
    await db.query('SELECT 1')
  })
  .healthCheck('redis', async () => {
    await cache.ping()
  })
  .onShutdown('db', async () => {
    await db.close()
  }, 10)  // Priority 10 (lower = runs first)
  .onShutdown('cache', async () => {
    await cache.disconnect()
  }, 20)
  .build()

serve({ lifecycle, rest: [api] })
```

**Endpoints created:**
- `GET /health` - Liveness probe (always 200)
- `GET /ready` - Readiness probe (checks all health checks)

**Shutdown sequence:**
1. SIGTERM received
2. Stop accepting new requests
3. Run shutdown hooks in priority order
4. Flush OTEL traces
5. Exit process

## Summary

| Component | Purpose |
|-----------|---------|
| **Builders** | Fluent API for primitive configuration |
| **Manifest** | Auto-discovery for infrastructure provisioning |
| **serve()** | Unified HTTP server with DI |
| **_onepipe_* tables** | Cloud-native persistence |
| **Lifecycle** | Health checks + graceful shutdown |
