# @onepipe/client

Type-safe client SDK for OnePipe applications.

## Installation

```bash
bun add @onepipe/client
```

For React:
```bash
bun add @onepipe/client @tanstack/react-query
```

## Usage

```typescript
import { createClient } from '@onepipe/client'
import type { App } from './server' // Your server type

const client = createClient<App>({
  baseUrl: 'http://localhost:3000',
  token: 'optional-auth-token',
})

// Flows - fully typed
const events = await client.flows.orderEvents.read({ tail: 10 })
client.flows.orderEvents.subscribe({
  onEvent: (e) => console.log(e),
})

// Signals - fully typed
const config = await client.signals.appConfig.get()
await client.signals.appConfig.patch({ feature: true })
```

## React Hooks

```tsx
import { OnePipeProvider, useFlow, useSignal } from '@onepipe/client/react'

function App() {
  return (
    <OnePipeProvider client={client}>
      <Dashboard />
    </OnePipeProvider>
  )
}

function Dashboard() {
  const { events, isConnected } = useFlow<App>('events', { live: true })
  const { value, patch } = useSignal<App>('config', { live: true })

  return <div>...</div>
}
```

## License

MIT
