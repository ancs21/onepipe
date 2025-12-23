# @onepipe/runtime

Bun-native HTTP server for OnePipe applications.

## Installation

```bash
bun add @onepipe/runtime @onepipe/sdk
```

## Usage

```typescript
import { REST, Flow, Signal } from '@onepipe/sdk'
import { serve } from '@onepipe/runtime'

const api = REST.create('api').basePath('/api').build()
const events = Flow.create('events').build()

serve({
  port: 3000,
  rest: [api],
  flows: [events],
})
```

## Options

```typescript
serve({
  port: 3000,              // Server port
  hostname: '0.0.0.0',     // Bind address
  rest: [],                // REST API instances
  flows: [],               // Flow instances
  projections: [],         // Projection instances
  signals: [],             // Signal instances
  channels: [],            // Channel instances
  embeddedStreams: true,   // Enable embedded stream server
})
```

## License

MIT
