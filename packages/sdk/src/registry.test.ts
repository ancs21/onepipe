import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test'
import { ServiceRegistry, getServiceUrl } from './registry'

// Mock servers for testing
let usersServer: ReturnType<typeof Bun.serve>
let ordersServer: ReturnType<typeof Bun.serve>

const USERS_PORT = 9881
const ORDERS_PORT = 9882
const USERS_URL = `http://localhost:${USERS_PORT}`
const ORDERS_URL = `http://localhost:${ORDERS_PORT}`

beforeAll(() => {
  // Users service mock
  usersServer = Bun.serve({
    port: USERS_PORT,
    fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      if (path === '/health') {
        return Response.json({ status: 'healthy' })
      }

      if (req.method === 'GET' && path.startsWith('/api/users/')) {
        const id = path.split('/').pop()
        return Response.json({ id, name: 'Test User', service: 'users' })
      }

      if (req.method === 'POST' && path === '/api/users') {
        return req.json().then((data) => {
          const body = data as Record<string, unknown>
          return Response.json({ id: 'user-123', ...body, service: 'users' })
        })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    },
  })

  // Orders service mock
  ordersServer = Bun.serve({
    port: ORDERS_PORT,
    fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      if (path === '/health') {
        return Response.json({ status: 'healthy' })
      }

      if (req.method === 'GET' && path.startsWith('/api/orders/')) {
        const id = path.split('/').pop()
        return Response.json({ id, status: 'pending', service: 'orders' })
      }

      if (req.method === 'POST' && path === '/api/orders') {
        return req.json().then((data) => {
          const body = data as Record<string, unknown>
          return Response.json({ id: 'order-456', ...body, service: 'orders' })
        })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    },
  })
})

afterAll(() => {
  usersServer.stop()
  ordersServer.stop()
})

describe('ServiceRegistry', () => {
  describe('builder', () => {
    test('creates registry with multiple services', () => {
      const services = ServiceRegistry.create()
        .service('users', USERS_URL)
        .service('orders', ORDERS_URL)
        .build()

      expect(services.serviceNames).toEqual(['users', 'orders'])
      expect(services.users).toBeDefined()
      expect(services.orders).toBeDefined()
    })

    test('sets default timeout', () => {
      const services = ServiceRegistry.create()
        .service('users', USERS_URL)
        .timeout(5000)
        .build()

      expect(services.users).toBeDefined()
    })

    test('sets default retry', () => {
      const services = ServiceRegistry.create()
        .service('users', USERS_URL)
        .retry(3, 500)
        .build()

      expect(services.users).toBeDefined()
    })

    test('sets default headers', () => {
      const services = ServiceRegistry.create()
        .service('users', USERS_URL)
        .headers({ 'X-Api-Key': 'secret' })
        .build()

      expect(services.users).toBeDefined()
    })
  })

  describe('service calls', () => {
    test('calls users service', async () => {
      const services = ServiceRegistry.create()
        .service('users', USERS_URL)
        .service('orders', ORDERS_URL)
        .build()

      const user = await services.users.get<{ id: string; name: string; service: string }>('/api/users/123')

      expect(user.id).toBe('123')
      expect(user.name).toBe('Test User')
      expect(user.service).toBe('users')
    })

    test('calls orders service', async () => {
      const services = ServiceRegistry.create()
        .service('users', USERS_URL)
        .service('orders', ORDERS_URL)
        .build()

      const order = await services.orders.get<{ id: string; status: string; service: string }>('/api/orders/456')

      expect(order.id).toBe('456')
      expect(order.status).toBe('pending')
      expect(order.service).toBe('orders')
    })

    test('makes POST requests', async () => {
      const services = ServiceRegistry.create()
        .service('users', USERS_URL)
        .service('orders', ORDERS_URL)
        .build()

      const user = await services.users.post<{ id: string; name: string }>('/api/users', {
        name: 'New User',
      })

      expect(user.id).toBe('user-123')
      expect(user.name).toBe('New User')
    })

    test('cross-service communication', async () => {
      const services = ServiceRegistry.create()
        .service('users', USERS_URL)
        .service('orders', ORDERS_URL)
        .build()

      // Simulate: get user, then create order
      const user = await services.users.get<{ id: string }>('/api/users/123')
      const order = await services.orders.post<{ id: string; userId: string }>('/api/orders', {
        userId: user.id,
      })

      expect(order.userId).toBe('123')
    })
  })

  describe('healthCheck', () => {
    test('checks health of all services', async () => {
      const services = ServiceRegistry.create()
        .service('users', USERS_URL)
        .service('orders', ORDERS_URL)
        .build()

      const health = await services.healthCheck()

      expect(health.users.healthy).toBe(true)
      expect(health.users.latency).toBeGreaterThanOrEqual(0)
      expect(health.orders.healthy).toBe(true)
      expect(health.orders.latency).toBeGreaterThanOrEqual(0)
    })

    test('reports unhealthy for unavailable services', async () => {
      const services = ServiceRegistry.create()
        .service('unavailable', 'http://localhost:59999') // Non-existent port
        .build()

      const health = await services.healthCheck()

      expect(health.unavailable.healthy).toBe(false)
      expect(health.unavailable.error).toBeDefined()
    })
  })

  describe('serviceNames', () => {
    test('returns list of registered service names', () => {
      const services = ServiceRegistry.create()
        .service('alpha', USERS_URL)
        .service('beta', ORDERS_URL)
        .service('gamma', USERS_URL)
        .build()

      expect(services.serviceNames).toEqual(['alpha', 'beta', 'gamma'])
    })
  })
})

describe('getServiceUrl', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('returns environment variable if set', () => {
    process.env.USERS_SERVICE_URL = 'http://users-prod:3000'

    const url = getServiceUrl('users', 'http://localhost:3001')

    expect(url).toBe('http://users-prod:3000')
  })

  test('returns fallback if env not set', () => {
    delete process.env.USERS_SERVICE_URL

    const url = getServiceUrl('users', 'http://localhost:3001')

    expect(url).toBe('http://localhost:3001')
  })

  test('handles hyphenated service names', () => {
    process.env.ORDER_SERVICE_SERVICE_URL = 'http://orders-prod:3000'

    const url = getServiceUrl('order-service', 'http://localhost:3002')

    expect(url).toBe('http://orders-prod:3000')
  })

  test('converts to uppercase', () => {
    process.env.PAYMENTS_SERVICE_URL = 'http://payments-prod:3000'

    const url = getServiceUrl('payments', 'http://localhost:3003')

    expect(url).toBe('http://payments-prod:3000')
  })
})
