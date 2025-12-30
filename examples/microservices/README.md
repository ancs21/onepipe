# Microservices Example

Demonstrates service-to-service communication using OnePipe's `ServiceClient` and `ServiceRegistry`.

## Quick Start (Single Process)

Run all services in one process with auto-discovery and dashboard:

```bash
onepipe dev --app examples/microservices/index.ts
```

Open http://localhost:4000 to see the dashboard.

## Distributed Mode (Multiple Processes)

Run services in separate processes to see true service-to-service tracing:

### Option 1: Run All Services

```bash
bun run examples/microservices/run-all.ts
```

### Option 2: Run Services Individually

```bash
# Terminal 1: Start dashboard
cd packages/dashboard && bun run dev

# Terminal 2-5: Start each service
SERVICE=users bun run examples/microservices/distributed.ts
SERVICE=inventory bun run examples/microservices/distributed.ts
SERVICE=orders bun run examples/microservices/distributed.ts
SERVICE=gateway bun run examples/microservices/distributed.ts
```

## Architecture

```
┌─────────────┐
│   Gateway   │ :3000 ─────────────────────────────────────┐
└──────┬──────┘                                            │
       │                                                   │
       ├──────────────────┬──────────────────┐             │
       │                  │                  │             │
       ▼                  ▼                  ▼             │
┌─────────────┐   ┌─────────────┐   ┌─────────────┐        │
│    Users    │   │  Inventory  │   │   Orders    │        │
│    :3001    │   │    :3002    │   │    :3003    │────────┤
└─────────────┘   └─────────────┘   └──────┬──────┘        │
                                           │               │
                         ┌─────────────────┼───────────────┘
                         ▼                 ▼
                  ┌─────────────┐   ┌─────────────┐
                  │    Users    │   │  Inventory  │
                  └─────────────┘   └─────────────┘
```

## API Endpoints

| Service | Port | Endpoints |
|---------|------|-----------|
| Gateway | 3000 | `/api/users`, `/api/products`, `/api/orders`, `/api/dashboard` |
| Users | 3001 | `/api/users`, `/api/users/:id` |
| Inventory | 3002 | `/api/products`, `/api/products/:id`, `/api/products/:id/reserve` |
| Orders | 3003 | `/api/orders`, `/api/orders/:id` |

## Test Commands

```bash
# List users
curl http://localhost:3000/api/users

# List products
curl http://localhost:3000/api/products

# Create order (triggers service-to-service calls)
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-1","items":[{"productId":"prod-1","quantity":1},{"productId":"prod-2","quantity":2}]}'

# Get dashboard summary
curl http://localhost:3000/api/dashboard

# Health check
curl http://localhost:3000/health
```

## Viewing Dependencies

1. Open Dashboard at http://localhost:4000
2. Go to **Services** page
3. Make some API calls
4. View the **Dependency Graph** showing service connections
5. Click on edges to see call counts, latency, and error rates

## Key Concepts

### ServiceRegistry

```typescript
const services = ServiceRegistry.create()
  .service('users', getServiceUrl('users', 'http://localhost:3001'))
  .service('inventory', getServiceUrl('inventory', 'http://localhost:3002'))
  .timeout(5000)
  .retry(2)
  .build()
```

### Service Calls with Tracing

```typescript
// Automatically adds target.service attribute to spans
const user = await services.users.get<User>(`/api/users/${userId}`)
const order = await services.orders.post<Order>('/api/orders', data)
```

### Environment Variables

```bash
# Service URLs can be configured via environment
USERS_SERVICE_URL=http://users:3001
INVENTORY_SERVICE_URL=http://inventory:3002
ORDERS_SERVICE_URL=http://orders:3003
```

## Files

| File | Description |
|------|-------------|
| `index.ts` | Combined entrypoint (all services in one process) |
| `distributed.ts` | Multi-service runner (one service per process) |
| `run-all.ts` | Script to start all services |
