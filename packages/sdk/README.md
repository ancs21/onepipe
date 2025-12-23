# @onepipe/sdk

Core SDK for OnePipe - a stream-first developer platform for Bun.

## Installation

```bash
bun add @onepipe/sdk
```

## Features

- **REST** - Fluent API builder with routing, CORS, OpenAPI
- **Flow** - Durable event streams with SSE
- **DB** - Database abstraction (PostgreSQL, MySQL, SQLite)
- **Projection** - Materialized views from events
- **Signal** - Reactive state with schema validation
- **Channel** - RPC handlers with retry
- **Cache** - Redis integration
- **Storage** - S3-compatible object storage

## Quick Start

```typescript
import { REST, DB, Flow, Signal, APIError } from '@onepipe/sdk'
import { z } from 'zod'

const db = DB.create('app').sqlite(':memory:').build()

const events = Flow.create('events')
  .schema(z.object({ type: z.string() }))
  .build()

const api = REST.create('api')
  .basePath('/api')
  .db(db)
  .get('/health', () => ({ status: 'ok' }))
  .build()
```

See the [main README](https://github.com/ancs21/onepipe#readme) for full documentation.

## License

MIT
