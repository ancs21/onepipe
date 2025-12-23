# OnePipe

**Stream-first developer platform SDK for Bun.**

Build production-ready APIs, event streams, and real-time applications with a fluent builder pattern.

[![npm @onepipe/sdk](https://img.shields.io/npm/v/@onepipe/sdk.svg?label=@onepipe/sdk)](https://www.npmjs.com/package/@onepipe/sdk)
[![npm @onepipe/runtime](https://img.shields.io/npm/v/@onepipe/runtime.svg?label=@onepipe/runtime)](https://www.npmjs.com/package/@onepipe/runtime)
[![npm @onepipe/client](https://img.shields.io/npm/v/@onepipe/client.svg?label=@onepipe/client)](https://www.npmjs.com/package/@onepipe/client)
[![npm @onepipe/cli](https://img.shields.io/npm/v/@onepipe/cli.svg?label=@onepipe/cli)](https://www.npmjs.com/package/@onepipe/cli)
[![Snyk Security](https://snyk.io/test/github/ancs21/onepipe/badge.svg)](https://snyk.io/test/github/ancs21/onepipe)
[![CodeRabbit](https://img.shields.io/badge/CodeRabbit-AI%20Review-blue?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIGQ9Ik0xMiAyYTEwIDEwIDAgMSAwIDEwIDEwQTEwIDEwIDAgMCAwIDEyIDJ6Ii8+PC9zdmc+)](https://coderabbit.ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **REST** - Fluent API builder with routing, CORS, OpenAPI, file uploads
- **Flow** - Durable event streams with append, subscribe, and SSE streaming
- **DB** - Unified database abstraction (PostgreSQL, MySQL, SQLite)
- **Projection** - Materialized views from Flow events with reduce functions
- **Signal** - Reactive state/config with schema validation
- **Channel** - RPC-style handlers with retry and tracing
- **Cache** - Redis cache abstraction with pub/sub
- **Storage** - S3-compatible object storage
- **Auth** - Authentication wrapper for better-auth

## Installation

```bash
bun add @onepipe/sdk
```

For the full stack:

```bash
bun add @onepipe/sdk @onepipe/runtime @onepipe/client
```

## Quick Start

```typescript
import { REST, DB, Flow, Signal } from '@onepipe/sdk'
import { serve } from '@onepipe/runtime'
import { z } from 'zod'

// Database
const db = DB.create('app').sqlite(':memory:').build()

// Event stream
const events = Flow.create('events')
  .schema(z.object({ type: z.string(), data: z.unknown() }))
  .build()

// Feature flags
const config = Signal.create('config')
  .schema(z.object({ maintenance: z.boolean() }))
  .default({ maintenance: false })
  .build()

// REST API
const api = REST.create('api')
  .basePath('/api')
  .db(db)
  .get('/health', () => ({ status: 'ok' }))
  .post('/events', async (ctx) => {
    const body = ctx.body()
    await events.append({ type: 'user_action', data: body })
    return ctx.created({ success: true })
  })
  .build()

// Start server
serve({
  port: 3000,
  rest: [api],
  flows: [events],
  signals: [config],
})
```

## Core Primitives

### REST - API Builder

```typescript
import { REST, APIError } from '@onepipe/sdk'

const api = REST.create('users')
  .basePath('/api/users')
  .db(database)
  .cors({ origin: '*' })
  .trace()

  // GET /api/users
  .get('/', async (ctx) => {
    return ctx.db.query('SELECT * FROM users')
  })

  // GET /api/users/:id
  .get('/:id', async (ctx) => {
    const [user] = await ctx.db.query(
      'SELECT * FROM users WHERE id = ?',
      [ctx.params.id]
    )
    if (!user) throw APIError.notFound('User not found')
    return user
  })

  // POST /api/users
  .post('/', async (ctx) => {
    const { name, email } = ctx.body<{ name: string; email: string }>()
    if (!name) throw APIError.invalidArgument('Name is required')

    const user = { id: crypto.randomUUID(), name, email }
    await ctx.db.query(
      'INSERT INTO users (id, name, email) VALUES (?, ?, ?)',
      [user.id, user.name, user.email]
    )
    return ctx.created(user)
  })

  // File uploads
  .post('/avatar', async (ctx) => {
    const file = ctx.file('avatar')
    if (!file) throw APIError.invalidArgument('No file uploaded')

    const buffer = await file.arrayBuffer()
    // Save file...
    return { filename: file.name, size: file.size }
  })

  .build()
```

### Flow - Event Streams

```typescript
import { Flow } from '@onepipe/sdk'
import { z } from 'zod'

const orderEvents = Flow.create('orders')
  .schema(z.discriminatedUnion('type', [
    z.object({ type: z.literal('created'), orderId: z.string() }),
    z.object({ type: z.literal('shipped'), orderId: z.string(), trackingId: z.string() }),
    z.object({ type: z.literal('delivered'), orderId: z.string() }),
  ]))
  .trace()
  .build()

// Append events
await orderEvents.append({ type: 'created', orderId: '123' })
await orderEvents.append({ type: 'shipped', orderId: '123', trackingId: 'TRK456' })

// Read events
const recent = await orderEvents.read({ tail: 10 })

// Subscribe to live events
const unsubscribe = orderEvents.subscribe((event) => {
  console.log('New event:', event.type)
})

// SSE streaming
for await (const event of orderEvents.stream({ live: true })) {
  console.log('Streamed:', event)
}
```

### Projection - Materialized Views

```typescript
import { Projection } from '@onepipe/sdk'

const orderStats = Projection.create('order-stats')
  .from(orderEvents)
  .initial({ total: 0, shipped: 0, delivered: 0 })
  .reduce((state, event) => {
    switch (event.type) {
      case 'created':
        return { ...state, total: state.total + 1 }
      case 'shipped':
        return { ...state, shipped: state.shipped + 1 }
      case 'delivered':
        return { ...state, delivered: state.delivered + 1 }
      default:
        return state
    }
  })
  .build()

// Get current state
const stats = await orderStats.get()
console.log(stats) // { total: 10, shipped: 8, delivered: 5 }

// Subscribe to changes
orderStats.subscribe((stats) => {
  console.log('Stats updated:', stats)
})
```

### Signal - Reactive State

```typescript
import { Signal } from '@onepipe/sdk'
import { z } from 'zod'

const appConfig = Signal.create('app-config')
  .schema(z.object({
    maintenanceMode: z.boolean(),
    maxUsersPerOrg: z.number(),
    features: z.object({
      darkMode: z.boolean(),
      betaFeatures: z.boolean(),
    }),
  }))
  .default({
    maintenanceMode: false,
    maxUsersPerOrg: 100,
    features: { darkMode: true, betaFeatures: false },
  })
  .persist('sqlite') // Optional persistence
  .build()

// Get value
const config = await appConfig.get()

// Set value
await appConfig.set({ ...config, maintenanceMode: true })

// Patch (partial update)
await appConfig.patch({ maintenanceMode: false })

// Subscribe to changes
appConfig.subscribe((config) => {
  console.log('Config changed:', config)
})

// Wait for condition
await appConfig.waitFor((c) => !c.maintenanceMode, 30000)
```

### DB - Database Abstraction

```typescript
import { DB } from '@onepipe/sdk'

// SQLite
const sqlite = DB.create('local').sqlite('./app.db').build()

// PostgreSQL
const postgres = DB.create('main')
  .postgres(process.env.DATABASE_URL)
  .pool({ min: 2, max: 10 })
  .trace()
  .build()

// Queries
const users = await db.query<User>('SELECT * FROM users WHERE active = ?', [true])

// Transactions
await db.transaction(async (tx) => {
  await tx.query('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, fromId])
  await tx.query('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, toId])
})

// Schema introspection
const tables = await db.getTables()
const schema = await db.getTableSchema('users')
```

### Cache - Redis Integration

```typescript
import { Cache } from '@onepipe/sdk'

const cache = Cache.create('main')
  .redis(process.env.REDIS_URL)
  .prefix('app:')
  .defaultTtl(3600)
  .build()

// Basic operations
await cache.set('user:123', { name: 'John' }, { ttl: 300 })
const user = await cache.get<User>('user:123')
await cache.del('user:123')

// Atomic counters
await cache.incr('visits')
await cache.decr('stock:item-1')

// Hash operations
await cache.hset('user:123', 'preferences', { theme: 'dark' })
const prefs = await cache.hget('user:123', 'preferences')

// Pub/Sub
cache.subscribe('notifications', (message) => {
  console.log('Received:', message)
})
await cache.publish('notifications', { type: 'alert', text: 'Hello!' })
```

### Storage - S3-Compatible

```typescript
import { Storage } from '@onepipe/sdk'

const storage = Storage.create('uploads')
  .bucket('my-bucket')
  .endpoint('https://s3.us-east-1.amazonaws.com')
  .region('us-east-1')
  .build()

// Upload
await storage.write('images/photo.jpg', imageBuffer, {
  type: 'image/jpeg',
  acl: 'public-read',
})

// Download
const file = storage.file('images/photo.jpg')
const buffer = await file.arrayBuffer()
const text = await file.text()

// Presigned URLs
const url = storage.presign('images/photo.jpg', { expiresIn: 3600 })

// List files
const { files, hasMore } = await storage.list({ prefix: 'images/', limit: 100 })
```

## Client SDK

Type-safe client for frontend applications:

```typescript
import { createClient } from '@onepipe/client'
import type { App } from './server' // Export your server type

const client = createClient<App>({ baseUrl: 'http://localhost:3000' })

// Flows - fully typed!
const events = await client.flows.orderEvents.read({ tail: 10 })
client.flows.orderEvents.subscribe({
  onEvent: (e) => console.log(e.type, e.orderId),
})

// Signals - fully typed!
const config = await client.signals.appConfig.get()
await client.signals.appConfig.patch({ maintenanceMode: true })
```

### React Hooks

```tsx
import { OnePipeProvider, useFlow, useSignal } from '@onepipe/client/react'
import { createClient } from '@onepipe/client'
import type { App } from './server'

const client = createClient<App>({ baseUrl: 'http://localhost:3000' })

function App() {
  return (
    <OnePipeProvider client={client}>
      <Dashboard />
    </OnePipeProvider>
  )
}

function Dashboard() {
  const { events, isConnected } = useFlow<App>('orderEvents', { live: true })
  const { value: config, patch } = useSignal<App>('appConfig', { live: true })

  return (
    <div>
      <span>{isConnected ? '🟢 Live' : '🔴 Disconnected'}</span>
      <h2>Recent Orders: {events.length}</h2>
      <label>
        <input
          type="checkbox"
          checked={config?.maintenanceMode}
          onChange={(e) => patch({ maintenanceMode: e.target.checked })}
        />
        Maintenance Mode
      </label>
    </div>
  )
}
```

## CLI

```bash
# Start development server
bunx @onepipe/cli dev --app ./src/server.ts

# Deploy to production
bunx @onepipe/cli deploy production

# Show version
bunx @onepipe/cli --version
```

## Configuration

Create `onepipe.config.ts`:

```typescript
import { defineConfig } from '@onepipe/sdk'

export default defineConfig({
  name: 'my-app',
  environments: {
    local: {
      streams: 'embedded',
      database: 'sqlite:./local.db',
    },
    staging: {
      streams: 'https://streams.staging.example.com',
      database: process.env.STAGING_DATABASE_URL,
      redis: process.env.STAGING_REDIS_URL,
    },
    production: {
      streams: 'https://streams.example.com',
      database: process.env.DATABASE_URL,
      redis: process.env.REDIS_URL,
      replicas: 3,
    },
  },
})
```

## Error Handling

Use typed errors with Encore-compatible error codes:

```typescript
import { APIError } from '@onepipe/sdk'

// Throw errors in handlers
throw APIError.notFound('User not found')
throw APIError.invalidArgument('Email is required')
throw APIError.unauthenticated('Invalid token')
throw APIError.permissionDenied('Admin access required')
throw APIError.unavailable('Service in maintenance')
throw APIError.resourceExhausted('Rate limit exceeded')
```

## Packages

| Package | Description |
|---------|-------------|
| `@onepipe/sdk` | Core SDK with all primitives |
| `@onepipe/runtime` | Bun-native HTTP server |
| `@onepipe/client` | Type-safe client SDK |
| `@onepipe/cli` | Command-line interface |

## Requirements

- [Bun](https://bun.sh) v1.0+
- Node.js 22+ (for client SDK in Node environments)

## License

MIT

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

---

Built with Bun. Inspired by [Encore](https://encore.dev) and [tRPC](https://trpc.io).
