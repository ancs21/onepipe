/**
 * Microservices Example - Combined Entrypoint
 *
 * Starts all services in a single process for development.
 * Uses ServiceRegistry for service-to-service calls to enable dependency tracking.
 *
 * Run with: onepipe dev --app examples/microservices/index.ts
 *
 * For production, run each service separately with distributed.ts
 */

import { REST, Server, APIError, ServiceRegistry, getServiceUrl, initTracing } from '@onepipe/sdk'

const PORT = Number(process.env.PORT) || 3000

// ============================================================================
// Tracing (sends to dashboard)
// ============================================================================

initTracing({
  serviceName: 'microservices-demo',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4000/v1/traces',
})

// ============================================================================
// Service Registry (enables dependency tracking)
// ============================================================================

const services = ServiceRegistry.create()
  .service('users', getServiceUrl('users', `http://localhost:${PORT}`))
  .service('inventory', getServiceUrl('inventory', `http://localhost:${PORT}`))
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

interface OrderItem {
  productId: string
  quantity: number
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
  status: 'pending' | 'confirmed' | 'failed'
  createdAt: string
}

// ============================================================================
// In-Memory Stores
// ============================================================================

const users = new Map<string, User>([
  ['user-1', { id: 'user-1', name: 'Alice Johnson', email: 'alice@example.com' }],
  ['user-2', { id: 'user-2', name: 'Bob Smith', email: 'bob@example.com' }],
  ['user-3', { id: 'user-3', name: 'Carol White', email: 'carol@example.com' }],
])

const products = new Map<string, Product>([
  ['prod-1', { id: 'prod-1', name: 'Laptop', price: 999.99, stock: 50 }],
  ['prod-2', { id: 'prod-2', name: 'Keyboard', price: 79.99, stock: 200 }],
  ['prod-3', { id: 'prod-3', name: 'Mouse', price: 29.99, stock: 150 }],
  ['prod-4', { id: 'prod-4', name: 'Monitor', price: 299.99, stock: 30 }],
  ['prod-5', { id: 'prod-5', name: 'Headphones', price: 149.99, stock: 0 }],
])

const orders = new Map<string, Order>()

// ============================================================================
// Users API
// ============================================================================

const usersApi = REST.create('users')
  .basePath('/api/users')
  .trace()
  .get('/', async (ctx) => {
    return ctx.json(Array.from(users.values()))
  })
  .get('/:id', async (ctx) => {
    const user = users.get(ctx.params.id)
    if (!user) {
      return ctx.notFound('User not found')
    }
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

// ============================================================================
// Inventory API
// ============================================================================

const inventoryApi = REST.create('inventory')
  .basePath('/api/products')
  .trace()
  .get('/', async (ctx) => {
    return ctx.json(Array.from(products.values()))
  })
  .get('/:id', async (ctx) => {
    const product = products.get(ctx.params.id)
    if (!product) {
      return ctx.notFound('Product not found')
    }
    return ctx.json(product)
  })
  .get('/:id/stock', async (ctx) => {
    const product = products.get(ctx.params.id)
    if (!product) {
      return ctx.notFound('Product not found')
    }
    return ctx.json({ productId: product.id, available: product.stock })
  })
  .post('/:id/reserve', async (ctx) => {
    const body = await ctx.body<{ quantity: number }>()
    const product = products.get(ctx.params.id)

    if (!product) {
      throw APIError.notFound('Product not found')
    }

    if (product.stock < body.quantity) {
      throw APIError.invalidArgument(`Insufficient stock for ${product.name}. Available: ${product.stock}`)
    }

    product.stock -= body.quantity
    products.set(ctx.params.id, product)

    return ctx.json({
      productId: product.id,
      reserved: body.quantity,
      remaining: product.stock,
    })
  })
  .build()

// ============================================================================
// Orders API (calls Users + Inventory via ServiceRegistry)
// ============================================================================

const ordersApi = REST.create('orders')
  .basePath('/api/orders')
  .trace()
  .get('/', async (ctx) => {
    return ctx.json(Array.from(orders.values()))
  })
  .get('/:id', async (ctx) => {
    const order = orders.get(ctx.params.id)
    if (!order) {
      return ctx.notFound('Order not found')
    }
    return ctx.json(order)
  })
  .post('/', async (ctx) => {
    const body = await ctx.body<{ userId: string; items: OrderItem[] }>()

    // Call users service via ServiceRegistry (creates traced dependency)
    let user: User
    try {
      user = await services.users.get<User>(`/api/users/${body.userId}`)
    } catch (error) {
      if (error instanceof APIError && error.code === 'NotFound') {
        throw APIError.invalidArgument(`User ${body.userId} not found`)
      }
      throw error
    }

    // Call inventory service for each product (creates traced dependencies)
    const orderItems: Order['items'] = []
    let total = 0

    for (const item of body.items) {
      // Get product details via ServiceRegistry
      let product: Product
      try {
        product = await services.inventory.get<Product>(`/api/products/${item.productId}`)
      } catch (error) {
        if (error instanceof APIError && error.code === 'NotFound') {
          throw APIError.invalidArgument(`Product ${item.productId} not found`)
        }
        throw error
      }

      // Reserve stock via ServiceRegistry
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

    // Create order
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

// ============================================================================
// Gateway API (aggregated endpoints via ServiceRegistry)
// ============================================================================

const gatewayApi = REST.create('gateway')
  .basePath('/api')
  .trace()
  .cors({ origin: '*' })
  .get('/dashboard', async (ctx) => {
    // Fetch from services via ServiceRegistry (creates traced dependencies)
    const [allUsers, allProducts] = await Promise.all([
      services.users.get<User[]>('/api/users'),
      services.inventory.get<Product[]>('/api/products'),
    ])

    return ctx.json({
      summary: {
        totalUsers: allUsers.length,
        totalProducts: allProducts.length,
        totalOrders: orders.size,
        totalRevenue: Array.from(orders.values()).reduce((sum, o) => sum + o.total, 0),
      },
      recentOrders: Array.from(orders.values()).slice(-5),
      lowStock: allProducts.filter(p => p.stock < 10),
    })
  })
  .build()

// ============================================================================
// Start Server
// ============================================================================

Server.create()
  .port(PORT)
  .use(usersApi)
  .use(inventoryApi)
  .use(ordersApi)
  .use(gatewayApi)
  .start()

console.log(`
Microservices Demo running on http://localhost:${PORT}

Endpoints:
  GET  /api/users          - List users
  GET  /api/users/:id      - Get user
  POST /api/users          - Create user

  GET  /api/products       - List products
  GET  /api/products/:id   - Get product
  POST /api/products/:id/reserve - Reserve stock

  GET  /api/orders         - List orders
  GET  /api/orders/:id     - Get order
  POST /api/orders         - Create order (calls users + inventory)

  GET  /api/dashboard      - Aggregated stats (calls users + inventory)

  GET  /health             - Health check
  GET  /ready              - Readiness check

Dashboard: http://localhost:4000

Try creating an order to see service dependencies:
  curl -X POST http://localhost:${PORT}/api/orders \\
    -H "Content-Type: application/json" \\
    -d '{"userId":"user-1","items":[{"productId":"prod-1","quantity":1}]}'
`)
