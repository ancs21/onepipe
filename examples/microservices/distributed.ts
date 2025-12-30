/**
 * Microservices Example - Distributed Mode
 *
 * Demonstrates true service-to-service communication across separate processes.
 * Each service runs independently and calls others via ServiceClient.
 *
 * Usage:
 *   # Terminal 1: Start users service
 *   SERVICE=users bun run examples/microservices/distributed.ts
 *
 *   # Terminal 2: Start inventory service
 *   SERVICE=inventory bun run examples/microservices/distributed.ts
 *
 *   # Terminal 3: Start orders service (calls users + inventory)
 *   SERVICE=orders bun run examples/microservices/distributed.ts
 *
 *   # Terminal 4: Start gateway (calls all services)
 *   SERVICE=gateway bun run examples/microservices/distributed.ts
 *
 * Or use the run-all script:
 *   bun run examples/microservices/run-all.ts
 */

import { REST, Server, APIError, ServiceRegistry, getServiceUrl, initTracing } from '@onepipe/sdk'

const SERVICE = process.env.SERVICE || 'gateway'

// ============================================================================
// Service Configuration
// ============================================================================

const PORTS: Record<string, number> = {
  users: 3001,
  inventory: 3002,
  orders: 3003,
  gateway: 3000,
}

const PORT = PORTS[SERVICE] || 3000

// Initialize tracing for this service
initTracing({
  serviceName: SERVICE,
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4000/v1/traces',
})

// Service registry for calling other services
const services = ServiceRegistry.create()
  .service('users', getServiceUrl('users', 'http://localhost:3001'))
  .service('inventory', getServiceUrl('inventory', 'http://localhost:3002'))
  .service('orders', getServiceUrl('orders', 'http://localhost:3003'))
  .timeout(5000)
  .retry(2, 500)
  .build()

// ============================================================================
// Types
// ============================================================================

interface User {
  id: string
  name: string
  email: string
}

interface Product {
  id: string
  name: string
  price: number
  stock: number
}

interface Order {
  id: string
  userId: string
  userName: string
  items: Array<{
    productId: string
    productName: string
    quantity: number
    price: number
  }>
  total: number
  status: string
  createdAt: string
}

// ============================================================================
// Users Service (port 3001)
// ============================================================================

function createUsersService() {
  const users = new Map<string, User>([
    ['user-1', { id: 'user-1', name: 'Alice Johnson', email: 'alice@example.com' }],
    ['user-2', { id: 'user-2', name: 'Bob Smith', email: 'bob@example.com' }],
    ['user-3', { id: 'user-3', name: 'Carol White', email: 'carol@example.com' }],
  ])

  return REST.create('users')
    .basePath('/api/users')
    .trace()
    .get('/', async (ctx) => ctx.json(Array.from(users.values())))
    .get('/:id', async (ctx) => {
      const user = users.get(ctx.params.id)
      if (!user) return ctx.notFound('User not found')
      return ctx.json(user)
    })
    .post('/', async (ctx) => {
      const body = await ctx.body<{ name: string; email: string }>()
      const id = `user-${Date.now()}`
      const user: User = { id, ...body }
      users.set(id, user)
      return ctx.created(user)
    })
    .build()
}

// ============================================================================
// Inventory Service (port 3002)
// ============================================================================

function createInventoryService() {
  const products = new Map<string, Product>([
    ['prod-1', { id: 'prod-1', name: 'Laptop', price: 999.99, stock: 50 }],
    ['prod-2', { id: 'prod-2', name: 'Keyboard', price: 79.99, stock: 200 }],
    ['prod-3', { id: 'prod-3', name: 'Mouse', price: 29.99, stock: 150 }],
    ['prod-4', { id: 'prod-4', name: 'Monitor', price: 299.99, stock: 30 }],
    ['prod-5', { id: 'prod-5', name: 'Headphones', price: 149.99, stock: 0 }],
  ])

  return REST.create('inventory')
    .basePath('/api/products')
    .trace()
    .get('/', async (ctx) => ctx.json(Array.from(products.values())))
    .get('/:id', async (ctx) => {
      const product = products.get(ctx.params.id)
      if (!product) return ctx.notFound('Product not found')
      return ctx.json(product)
    })
    .post('/:id/reserve', async (ctx) => {
      const body = await ctx.body<{ quantity: number }>()
      const product = products.get(ctx.params.id)
      if (!product) throw APIError.notFound('Product not found')
      if (product.stock < body.quantity) {
        throw APIError.invalidArgument(`Insufficient stock. Available: ${product.stock}`)
      }
      product.stock -= body.quantity
      return ctx.json({ reserved: body.quantity, remaining: product.stock })
    })
    .build()
}

// ============================================================================
// Orders Service (port 3003) - Calls Users + Inventory
// ============================================================================

function createOrdersService() {
  const orders = new Map<string, Order>()

  return REST.create('orders')
    .basePath('/api/orders')
    .trace()
    .get('/', async (ctx) => ctx.json(Array.from(orders.values())))
    .get('/:id', async (ctx) => {
      const order = orders.get(ctx.params.id)
      if (!order) return ctx.notFound('Order not found')
      return ctx.json(order)
    })
    .post('/', async (ctx) => {
      const body = await ctx.body<{ userId: string; items: Array<{ productId: string; quantity: number }> }>()

      // Call users service to verify user
      let user: User
      try {
        user = await services.users.get<User>(`/api/users/${body.userId}`)
      } catch (error) {
        if (error instanceof APIError && error.code === 'NotFound') {
          throw APIError.invalidArgument(`User ${body.userId} not found`)
        }
        throw error
      }

      // Call inventory service to get products and reserve stock
      const orderItems: Order['items'] = []
      let total = 0

      for (const item of body.items) {
        // Get product details
        let product: Product
        try {
          product = await services.inventory.get<Product>(`/api/products/${item.productId}`)
        } catch (error) {
          if (error instanceof APIError && error.code === 'NotFound') {
            throw APIError.invalidArgument(`Product ${item.productId} not found`)
          }
          throw error
        }

        // Reserve stock
        try {
          await services.inventory.post(`/api/products/${item.productId}/reserve`, {
            quantity: item.quantity,
          })
        } catch (error) {
          if (error instanceof APIError) {
            throw APIError.invalidArgument(`Cannot reserve ${item.productId}: ${error.message}`)
          }
          throw error
        }

        orderItems.push({
          productId: product.id,
          productName: product.name,
          quantity: item.quantity,
          price: product.price,
        })
        total += product.price * item.quantity
      }

      const orderId = `order-${Date.now()}`
      const order: Order = {
        id: orderId,
        userId: user.id,
        userName: user.name,
        items: orderItems,
        total: Math.round(total * 100) / 100,
        status: 'confirmed',
        createdAt: new Date().toISOString(),
      }

      orders.set(orderId, order)
      return ctx.created(order)
    })
    .build()
}

// ============================================================================
// Gateway Service (port 3000) - Calls All Services
// ============================================================================

function createGatewayService() {
  return REST.create('gateway')
    .basePath('/api')
    .trace()
    .cors({ origin: '*' })
    // Proxy to users
    .get('/users', async (ctx) => ctx.json(await services.users.get<User[]>('/api/users')))
    .get('/users/:id', async (ctx) => ctx.json(await services.users.get<User>(`/api/users/${ctx.params.id}`)))
    // Proxy to inventory
    .get('/products', async (ctx) => ctx.json(await services.inventory.get<Product[]>('/api/products')))
    .get('/products/:id', async (ctx) => ctx.json(await services.inventory.get<Product>(`/api/products/${ctx.params.id}`)))
    // Proxy to orders
    .get('/orders', async (ctx) => ctx.json(await services.orders.get<Order[]>('/api/orders')))
    .get('/orders/:id', async (ctx) => ctx.json(await services.orders.get<Order>(`/api/orders/${ctx.params.id}`)))
    .post('/orders', async (ctx) => {
      const body = await ctx.body()
      return ctx.created(await services.orders.post<Order>('/api/orders', body))
    })
    // Dashboard - aggregates from all services
    .get('/dashboard', async (ctx) => {
      const [users, products, orders] = await Promise.all([
        services.users.get<User[]>('/api/users'),
        services.inventory.get<Product[]>('/api/products'),
        services.orders.get<Order[]>('/api/orders'),
      ])
      return ctx.json({
        summary: {
          totalUsers: users.length,
          totalProducts: products.length,
          totalOrders: orders.length,
          totalRevenue: orders.reduce((sum, o) => sum + o.total, 0),
        },
        recentOrders: orders.slice(-5),
        lowStock: products.filter(p => p.stock < 10),
      })
    })
    .build()
}

// Health check API
const healthApi = REST.create('health')
  .get('/health', async (ctx) => {
    if (SERVICE === 'gateway' || SERVICE === 'orders') {
      const health = await services.healthCheck()
      return ctx.json({ service: SERVICE, status: 'healthy', dependencies: health })
    }
    return ctx.json({ service: SERVICE, status: 'healthy' })
  })
  .build()

// ============================================================================
// Start the requested service
// ============================================================================

const serviceMap: Record<string, () => ReturnType<ReturnType<typeof REST.create>['build']>> = {
  users: createUsersService,
  inventory: createInventoryService,
  orders: createOrdersService,
  gateway: createGatewayService,
}

const createService = serviceMap[SERVICE]
if (!createService) {
  console.error(`Unknown service: ${SERVICE}`)
  console.error('Available: users, inventory, orders, gateway')
  process.exit(1)
}

Server.create()
  .port(PORT)
  .use(createService())
  .use(healthApi)
  .start()

console.log(`${SERVICE} service running on http://localhost:${PORT}`)
