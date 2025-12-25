# AGENTS.md for OnePipe Projects

Template for AI agents working on projects built with OnePipe SDK.

## Commands

```bash
# Install
bun add @onepipe/sdk

# Dev server
bunx @onepipe/cli dev --app ./src/app.ts

# Type check
bunx tsc --noEmit
```

## Tech Stack

- Runtime: Bun
- Framework: OnePipe SDK (stream-first, fluent builder API)
- Database: PostgreSQL (Bun.sql) / SQLite (bun:sqlite)

## OnePipe Primitives

All primitives use fluent builders: `Primitive.create(name)...build()`

| Primitive | Purpose |
|-----------|---------|
| REST | RESTful API with routing, CORS, OpenAPI |
| Flow | Durable event streams with SSE |
| DB | Database abstraction (Postgres, SQLite) |
| Projection | Materialized views from Flow events |
| Signal | Reactive state with schema validation |
| Channel | RPC-style handlers with retry |
| Cache | Redis cache abstraction |
| Auth | Authentication (better-auth wrapper) |
| Server | Combines REST APIs into Bun.serve |
| Workflow | Durable workflows with steps and retries |
| Cron | Scheduled jobs with cron expressions |
| Storage | S3-compatible object storage |
| Migration | Database schema migrations |
| http | Traced HTTP client for external services |

## Code Patterns

### REST API

```typescript
import { REST, DB } from '@onepipe/sdk'

const db = DB.create('main').sqlite(':memory:').build()

const api = REST.create('todos')
  .basePath('/api/todos')
  .db(db)
  .get('/', async (ctx) => {
    const todos = await ctx.db.query('SELECT * FROM todos')
    return ctx.json(todos)
  })
  .get('/:id', async (ctx) => {
    const todo = await ctx.db.query('SELECT * FROM todos WHERE id = ?', [ctx.params.id])
    return todo ? ctx.json(todo) : ctx.notFound()
  })
  .post('/', async (ctx) => {
    const body = await ctx.body()
    const result = await ctx.db.query('INSERT INTO todos (title) VALUES (?)', [body.title])
    return ctx.created(result)
  })
  .build()
```

### Error Handling

```typescript
import { APIError } from '@onepipe/sdk'

// Use APIError, not throw new Error()
throw APIError.notFound('Todo not found')
throw APIError.invalidArgument('Title is required')
throw APIError.permissionDenied('Not authorized')
throw APIError.unavailable('Service in maintenance')
```

### Flow + Projection (Event Sourcing)

```typescript
import { Flow, Projection } from '@onepipe/sdk'
import { z } from 'zod'

const TodoEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('created'), id: z.string(), title: z.string() }),
  z.object({ type: z.literal('completed'), id: z.string() }),
])

const events = Flow.create('todo-events').schema(TodoEvent).build()

const stats = Projection.create('todo-stats')
  .from(events)
  .initial({ total: 0, completed: 0 })
  .reduce((state, event) => {
    if (event.type === 'created') return { ...state, total: state.total + 1 }
    if (event.type === 'completed') return { ...state, completed: state.completed + 1 }
    return state
  })
  .build()

// Append events
await events.append({ type: 'created', id: '1', title: 'Learn OnePipe' })

// Read projection
const current = await stats.get()
```

### Workflow (Durable Execution)

```typescript
import { Workflow } from '@onepipe/sdk'

const orderWorkflow = Workflow.create('process-order')
  .db(db)
  .step('validate', async (ctx, input) => {
    // Validate order - automatically retried on failure
    return { orderId: input.orderId, validated: true }
  })
  .step('charge', async (ctx, data) => {
    // Charge payment - durable, survives restarts
    return { ...data, charged: true }
  })
  .step('fulfill', async (ctx, data) => {
    // Fulfill order
    return { ...data, fulfilled: true }
  })
  .build()

// Start workflow
const handle = await orderWorkflow.start({ orderId: '123' })
const result = await handle.result()
```

### Cron (Scheduled Jobs)

```typescript
import { Cron } from '@onepipe/sdk'

const dailyReport = Cron.create('daily-report')
  .schedule('0 9 * * *') // 9 AM daily
  .db(db)
  .handler(async (ctx) => {
    const stats = await ctx.db.query('SELECT COUNT(*) FROM orders')
    return { generatedAt: new Date(), stats }
  })
  .build()
```

### HTTP Client (Traced Requests)

```typescript
import { http } from '@onepipe/sdk'

// Traced HTTP calls to external services
const user = await http.get('https://api.example.com/users/1')
const created = await http.post('https://api.example.com/orders', {
  body: { item: 'widget', qty: 5 }
})
```

### Server Composition

```typescript
import { Server } from '@onepipe/sdk'

const server = Server.create('app')
  .port(3000)
  .rest(todosApi)
  .rest(usersApi)
  .workflow(orderWorkflow)
  .cron(dailyReport)
  .build()

await server.start()
```

## REST Context Reference

Handlers receive context with:

| Property | Description |
|----------|-------------|
| `ctx.params` | Route parameters (`:id`) |
| `ctx.query` | Query string parameters |
| `ctx.headers` | Request headers |
| `ctx.body()` | Parse request body (async) |
| `ctx.db` | Database instance |
| `ctx.cache` | Cache instance |

Response helpers:

| Method | Status | Use case |
|--------|--------|----------|
| `ctx.json(data)` | 200 | Return JSON |
| `ctx.created(data)` | 201 | After POST |
| `ctx.noContent()` | 204 | After DELETE |
| `ctx.notFound()` | 404 | Resource missing |

## Boundaries

### Always
- Call `.build()` on all primitives
- Use `APIError` for HTTP errors
- Use Zod schemas for Flow events

### Never
- Skip `.build()` - primitives won't work
- Use `throw new Error()` in handlers - use `APIError`
- Mutate state directly in Projection reducers - return new state
