# OnePipe

Backend primitives for Bun. Events, workflows, cron - stuff that usually needs 5 different libraries.

[![npm @onepipe/sdk](https://img.shields.io/npm/v/@onepipe/sdk.svg?label=@onepipe/sdk)](https://www.npmjs.com/package/@onepipe/sdk)
[![npm @onepipe/runtime](https://img.shields.io/npm/v/@onepipe/runtime.svg?label=@onepipe/runtime)](https://www.npmjs.com/package/@onepipe/runtime)
[![npm @onepipe/client](https://img.shields.io/npm/v/@onepipe/client.svg?label=@onepipe/client)](https://www.npmjs.com/package/@onepipe/client)
[![npm @onepipe/cli](https://img.shields.io/npm/v/@onepipe/cli.svg?label=@onepipe/cli)](https://www.npmjs.com/package/@onepipe/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## The Problem

You're building with Bun. You need:
- A REST API (easy, use Hono or Elysia)
- Background jobs (ok, add BullMQ)
- Scheduled tasks (install node-cron)
- Event streaming (set up Kafka? Redis Streams?)
- Durable workflows (Temporal? That's a whole deployment)

Each tool has its own patterns, its own way of doing things. Your codebase becomes a patchwork.

## What OnePipe Does

One consistent API for all of it:

```typescript
// Same pattern everywhere
Flow.create('events').db(postgres).build()
Cron.create('cleanup').schedule('0 * * * *').db(postgres).build()
Workflow.create('order').db(postgres).define(...).build()
REST.create('api').basePath('/api').get('/health', ...).build()
```

Everything uses PostgreSQL for durability. No Redis required (though you can use it). No external services to deploy. Just your app and a database.

## Quick Look

```typescript
import { REST, Flow, Workflow, Cron, DB } from '@onepipe/sdk'
import { serve } from '@onepipe/runtime'

const db = DB.create('main').postgres(process.env.DATABASE_URL).build()

// Event stream - append-only log, survives restarts
const orders = Flow.create('orders').db(db).build()

// Workflow - steps are checkpointed, resumes after crash
const processOrder = Workflow.create('process-order')
  .db(db)
  .define(async (ctx, order) => {
    await ctx.step('validate', () => validateOrder(order))
    await ctx.step('charge', () => chargeCard(order))
    await ctx.sleep('1h')  // yes, really sleeps 1 hour, survives restart
    await ctx.step('ship', () => shipOrder(order))
  })
  .build()

// Cron - distributed lock, runs once even with multiple instances
const cleanup = Cron.create('cleanup')
  .schedule('0 3 * * *')
  .db(db)
  .handler(() => db.query('DELETE FROM sessions WHERE expired_at < NOW()'))
  .build()

// REST API
const api = REST.create('api')
  .basePath('/api')
  .db(db)
  .post('/orders', async (ctx) => {
    const order = ctx.body()
    await orders.append({ type: 'created', ...order })
    await processOrder.start(order)
    return ctx.created({ id: order.id })
  })
  .build()

serve({ port: 3000, rest: [api], flows: [orders], workflows: [processOrder], cron: [cleanup] })
```

## Install

```bash
bun add @onepipe/sdk @onepipe/runtime
```

## What's Included

**REST** - API builder. Routes, CORS, file uploads. Nothing fancy, just works.

**Flow** - Event streams. Append events, subscribe to them, replay history. Like Kafka but simpler.

**Projection** - Build state from events. Classic event sourcing reducer pattern.

**Workflow** - Long-running processes. Each step is saved. Crashes? It resumes where it left off.

**Cron** - Scheduled jobs. With PostgreSQL, only one instance runs the job (distributed lock).

**Signal** - Reactive config/state. Change a value, all subscribers get notified. With Redis, syncs across instances.

**Channel** - RPC with retry and idempotency. For when you need exactly-once semantics.

**DB** - Thin wrapper around Bun's postgres/sqlite. Connection pooling, transactions.

**Cache** - Redis wrapper. Get/set/pub-sub.

## Multi-Instance

The tricky part with scaling: cron jobs run multiple times, in-memory state diverges, workflows get confused.

OnePipe handles this with PostgreSQL:

```typescript
// Cron acquires a lock before running
// Other instances skip if lock is held
const cron = Cron.create('daily-report')
  .db(postgres)  // <-- this enables distributed locking
  .schedule('0 9 * * *')
  .handler(...)
  .build()

// Workflow state is in the database
// Any instance can resume a workflow
const workflow = Workflow.create('process')
  .db(postgres)  // <-- enables durability
  .define(...)
  .build()

// Signal syncs via Redis pub/sub
const config = Signal.create('config')
  .cache(redis)  // <-- enables cross-instance sync
  .build()
```

Without `.db()` or `.cache()`, everything runs in-memory. Fine for local dev, not for production with multiple replicas.

## Flows and Projections

Events as the source of truth:

```typescript
const events = Flow.create('user-events')
  .db(postgres)
  .build()

// Append events
await events.append({ type: 'signed_up', userId: '123' })
await events.append({ type: 'upgraded', userId: '123', plan: 'pro' })

// Build state from events
const userStats = Projection.create('user-stats')
  .from(events)
  .initial({ total: 0, pro: 0 })
  .reduce((state, event) => {
    if (event.type === 'signed_up') return { ...state, total: state.total + 1 }
    if (event.type === 'upgraded') return { ...state, pro: state.pro + 1 }
    return state
  })
  .db(postgres)  // persist the computed state
  .build()

const stats = await userStats.get()  // { total: 1, pro: 1 }
```

## REST API

```typescript
import { REST, APIError } from '@onepipe/sdk'

const api = REST.create('users')
  .basePath('/api/users')
  .db(database)

  .get('/', (ctx) => ctx.db.query('SELECT * FROM users'))

  .get('/:id', async (ctx) => {
    const [user] = await ctx.db.query('SELECT * FROM users WHERE id = $1', [ctx.params.id])
    if (!user) throw APIError.notFound('User not found')
    return user
  })

  .post('/', async (ctx) => {
    const { name, email } = ctx.body()
    const [user] = await ctx.db.query(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
      [name, email]
    )
    return ctx.created(user)
  })

  .build()
```

## Workflows

For processes that take time and shouldn't lose progress:

```typescript
const onboarding = Workflow.create('user-onboarding')
  .db(postgres)
  .define(async (ctx, userId) => {
    // Each step is saved. If this crashes after step 2,
    // it resumes at step 3 on restart.

    await ctx.step('send-welcome', () => sendWelcomeEmail(userId))
    await ctx.step('create-workspace', () => createDefaultWorkspace(userId))

    // Sleep for real - workflow state saved, process can restart
    await ctx.sleep('24h')

    await ctx.step('send-tips', () => sendTipsEmail(userId))

    // Wait for external signal
    const feedback = await ctx.signal('user-feedback', '7d')

    if (feedback?.rating > 4) {
      await ctx.step('request-review', () => askForReview(userId))
    }
  })
  .build()

// Start a workflow
await onboarding.start('user-123')

// Send a signal to a running workflow
await onboarding.signal('workflow-id', 'user-feedback', { rating: 5 })
```

## Client SDK

Type-safe client for frontend:

```typescript
import { createClient } from '@onepipe/client'
import type { App } from './server'

const client = createClient<App>({ baseUrl: 'http://localhost:3000' })

// Subscribe to live events
client.flows.orders.subscribe({
  onEvent: (event) => console.log('New order:', event)
})

// Read/write signals
const config = await client.signals.appConfig.get()
await client.signals.appConfig.patch({ maintenance: true })
```

React hooks included:

```tsx
import { useFlow, useSignal } from '@onepipe/client/react'

function Dashboard() {
  const { events } = useFlow('orders', { live: true })
  const { value: config, patch } = useSignal('appConfig')

  return <div>{events.length} orders</div>
}
```

## CLI

```bash
bunx @onepipe/cli dev --app ./src/server.ts
bunx @onepipe/cli deploy --target kubernetes
bunx @onepipe/cli deploy --target cloudrun
```

## Packages

| Package | What it does |
|---------|--------------|
| `@onepipe/sdk` | All the primitives |
| `@onepipe/runtime` | HTTP server, wires everything together |
| `@onepipe/client` | Frontend client + React hooks |
| `@onepipe/cli` | Dev server, deployment |

## Requirements

- Bun 1.0+
- PostgreSQL (for durability features)
- Redis (optional, for cross-instance Signal sync)

## License

MIT


