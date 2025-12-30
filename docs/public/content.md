# OnePipe - Stream-First Developer Platform for Bun

## About

OnePipe is a stream-first developer platform SDK for Bun. It provides a fluent builder API for creating REST APIs, event flows, database connections, projections, signals, and more.

---

## Documentation

### Getting Started

OnePipe is designed for TypeScript developers building backend applications on Bun. Install the SDK and runtime:

```bash
bun add @onepipe/sdk @onepipe/runtime
```

Create your first API:

```typescript
import { REST, DB } from '@onepipe/sdk'
import { serve } from '@onepipe/runtime'

const db = DB.create('main').sqlite(':memory:').build()

const api = REST.create('hello')
  .basePath('/api')
  .db(db)
  .get('/hello', async () => ({ message: 'Hello, World!' }))
  .build()

serve({ port: 3000, rest: [api] })
```

### REST API Builder

The REST primitive provides a fluent API for building HTTP endpoints:

- Automatic routing with path parameters
- CORS configuration
- OpenAPI/Swagger generation
- Request/response validation
- Database injection via context
- Authentication middleware

### Event Flows

Flows are durable, append-only event streams:

- Append events with schema validation
- Subscribe to real-time updates via SSE
- Query historical events
- Replay events for debugging

### Projections

Projections build materialized views from event streams:

- Define initial state
- Reduce events into accumulated state
- Persist to database for durability
- Query current state efficiently

### Signals

Signals provide reactive state management:

- Schema-validated configuration
- Persistent storage
- Change notifications
- Default values

### Channels

Channels enable RPC-style communication:

- Request/response patterns
- Automatic retries
- Timeout handling
- Distributed tracing

### Database

Unified database abstraction:

- SQLite (via bun:sqlite)
- PostgreSQL (via Bun.sql)
- MySQL support
- Type-safe queries

### Cache

Redis-compatible caching:

- Get/set operations
- TTL support
- Batch operations

### Authentication

Wrapper for better-auth:

- Session management
- OAuth providers
- JWT tokens

---

## Blog Posts

### Introducing OnePipe: Stream-First Development for Bun
Date: December 23, 2025

Today we're excited to announce the public release of OnePipe, a stream-first developer platform SDK designed specifically for Bun. OnePipe brings event sourcing, projections, and reactive patterns to TypeScript developers.

### Using Claude Code to Build Features with OnePipe
Date: December 22, 2025

AI-assisted development meets stream-first architecture. Learn how to use Claude Code to rapidly implement OnePipe features - from idea to working code in minutes. Includes effective prompts, real-world workflows, and productivity tips.

### Integrating OnePipe with Hono, Elysia, Express & More
Date: December 21, 2025

OnePipe works seamlessly with your existing stack. Learn how to add event sourcing, projections, and caching to Hono, Elysia, Express, and Fastify without rewriting your app. Includes gradual migration strategies.

### Building Event-Driven APIs with Flows and Projections
Date: December 20, 2025

Learn how to build scalable, event-driven APIs using OnePipe's Flow and Projection primitives. This tutorial walks through building a complete order management system with event sourcing.

### Why We Built OnePipe for Bun
Date: December 18, 2025

Bun's speed, built-in SQLite, native PostgreSQL via Bun.sql, and Redis caching support make it the perfect runtime for building modern backend applications. This post explains our technical decisions and includes database comparison guidelines.

---

## API Reference

The complete API reference is available at /docs/api and includes:

- REST class and methods
- Flow class and methods
- Projection class and methods
- Signal class and methods
- Channel class and methods
- DB class and methods
- Cache class and methods
- Auth class and methods
- APIError class and error codes
- Server configuration options

---

## Links

- GitHub: https://github.com/ancs21/onepipe
- Documentation: /docs
- Blog: /blog
- API Reference: /docs/api

## License

MIT License
