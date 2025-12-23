/**
 * REST Builder Tests
 */

import { describe, test, expect, mock } from 'bun:test'
import { REST } from './rest'

describe('REST', () => {
  describe('REST.create()', () => {
    test('creates a REST builder with name', () => {
      const builder = REST.create('api')
      expect(builder).toBeDefined()
    })

    test('builds a REST instance', () => {
      const api = REST.create('orders')
        .basePath('/api/orders')
        .build()

      expect(api).toBeDefined()
      expect(api.name).toBe('orders')
      expect(api.basePath).toBe('/api/orders')
    })
  })

  describe('RESTBuilder', () => {
    test('sets base path', () => {
      const api = REST.create('users')
        .basePath('/api/users')
        .build()

      expect(api.basePath).toBe('/api/users')
    })

    test('CORS requires explicit origin', () => {
      expect(() => {
        REST.create('api')
          .basePath('/api')
          .cors({} as any)
          .build()
      }).toThrow('CORS requires explicit origin configuration')
    })

    test('enables CORS with custom options', () => {
      const api = REST.create('api')
        .basePath('/api')
        .cors({
          origin: 'https://example.com',
          methods: ['GET', 'POST'],
          headers: ['Authorization'],
        })
        .build()

      expect(api.name).toBe('api')
    })

    test('registers GET route', () => {
      const api = REST.create('users')
        .basePath('/api/users')
        .get('/', async () => [])
        .build()

      expect(api.routes).toHaveLength(1)
      expect(api.routes[0].method).toBe('GET')
      expect(api.routes[0].path).toBe('/')
    })

    test('registers POST route', () => {
      const api = REST.create('users')
        .basePath('/api/users')
        .post('/', async () => ({ id: '1' }))
        .build()

      expect(api.routes).toHaveLength(1)
      expect(api.routes[0].method).toBe('POST')
    })

    test('registers PUT route', () => {
      const api = REST.create('users')
        .basePath('/api/users')
        .put('/:id', async () => ({}))
        .build()

      expect(api.routes).toHaveLength(1)
      expect(api.routes[0].method).toBe('PUT')
      expect(api.routes[0].path).toBe('/:id')
    })

    test('registers PATCH route', () => {
      const api = REST.create('users')
        .basePath('/api/users')
        .patch('/:id', async () => ({}))
        .build()

      expect(api.routes[0].method).toBe('PATCH')
    })

    test('registers DELETE route', () => {
      const api = REST.create('users')
        .basePath('/api/users')
        .delete('/:id', async () => ({}))
        .build()

      expect(api.routes[0].method).toBe('DELETE')
    })

    test('registers multiple routes', () => {
      const api = REST.create('users')
        .basePath('/api/users')
        .get('/', async () => [])
        .get('/:id', async () => ({}))
        .post('/', async () => ({}))
        .put('/:id', async () => ({}))
        .delete('/:id', async () => ({}))
        .build()

      expect(api.routes).toHaveLength(5)
    })

    test('supports route options', () => {
      const api = REST.create('users')
        .basePath('/api/users')
        .get('/public', { public: true }, async () => [])
        .build()

      expect(api.routes[0].options?.public).toBe(true)
    })
  })

  describe('RESTInstance.handler()', () => {
    test('returns a request handler function', () => {
      const api = REST.create('test')
        .basePath('/api/test')
        .get('/', async () => ({ ok: true }))
        .build()

      const handler = api.handler()
      expect(typeof handler).toBe('function')
    })

    test('handles GET request', async () => {
      const api = REST.create('test')
        .basePath('/api/test')
        .get('/', async () => ({ message: 'hello' }))
        .build()

      const handler = api.handler()
      const request = new Request('http://localhost/api/test/')
      const response = await handler(request)

      expect(response.status).toBe(200)
      const body = await response.json() as { message: string }
      expect(body.message).toBe('hello')
    })

    test('handles path parameters', async () => {
      const api = REST.create('users')
        .basePath('/api/users')
        .get('/:id', async (ctx) => ({ userId: ctx.params.id }))
        .build()

      const handler = api.handler()
      const request = new Request('http://localhost/api/users/123')
      const response = await handler(request)

      expect(response.status).toBe(200)
      const body = await response.json() as { userId: string }
      expect(body.userId).toBe('123')
    })

    test('handles query parameters', async () => {
      const api = REST.create('search')
        .basePath('/api/search')
        .get('/', async (ctx) => ({ query: ctx.query.q }))
        .build()

      const handler = api.handler()
      const request = new Request('http://localhost/api/search/?q=test')
      const response = await handler(request)

      expect(response.status).toBe(200)
      const body = await response.json() as { query: string }
      expect(body.query).toBe('test')
    })

    test('returns 404 for unmatched routes', async () => {
      const api = REST.create('test')
        .basePath('/api/test')
        .get('/exists', async () => ({}))
        .build()

      const handler = api.handler()
      const request = new Request('http://localhost/api/test/not-found')
      const response = await handler(request)

      expect(response.status).toBe(404)
    })

    test('returns 405 for wrong method', async () => {
      const api = REST.create('test')
        .basePath('/api/test')
        .get('/', async () => ({}))
        .build()

      const handler = api.handler()
      const request = new Request('http://localhost/api/test/', { method: 'POST' })
      const response = await handler(request)

      expect(response.status).toBe(405)
    })
  })

  describe('RESTContext helpers', () => {
    test('ctx.json() returns JSON response', async () => {
      const api = REST.create('test')
        .basePath('/api')
        .get('/', async (ctx) => ctx.json({ data: 'test' }))
        .build()

      const handler = api.handler()
      const response = await handler(new Request('http://localhost/api/'))

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    test('ctx.json() with custom status', async () => {
      const api = REST.create('test')
        .basePath('/api')
        .get('/', async (ctx) => ctx.json({ data: 'test' }, 201))
        .build()

      const handler = api.handler()
      const response = await handler(new Request('http://localhost/api/'))

      expect(response.status).toBe(201)
    })

    test('ctx.created() returns 201', async () => {
      const api = REST.create('test')
        .basePath('/api')
        .post('/', async (ctx) => ctx.created({ id: '1' }))
        .build()

      const handler = api.handler()
      const response = await handler(new Request('http://localhost/api/', { method: 'POST' }))

      expect(response.status).toBe(201)
    })

    test('ctx.noContent() returns 204', async () => {
      const api = REST.create('test')
        .basePath('/api')
        .delete('/:id', async (ctx) => ctx.noContent())
        .build()

      const handler = api.handler()
      const response = await handler(new Request('http://localhost/api/1', { method: 'DELETE' }))

      expect(response.status).toBe(204)
    })

    test('ctx.notFound() returns 404', async () => {
      const api = REST.create('test')
        .basePath('/api')
        .get('/:id', async (ctx) => ctx.notFound('User not found'))
        .build()

      const handler = api.handler()
      const response = await handler(new Request('http://localhost/api/1'))

      expect(response.status).toBe(404)
      const body = await response.json() as { error: string }
      expect(body.error).toBe('User not found')
    })

    test('ctx.unauthorized() returns 401', async () => {
      const api = REST.create('test')
        .basePath('/api')
        .get('/', async (ctx) => ctx.unauthorized())
        .build()

      const handler = api.handler()
      const response = await handler(new Request('http://localhost/api/'))

      expect(response.status).toBe(401)
    })

    test('ctx.forbidden() returns 403', async () => {
      const api = REST.create('test')
        .basePath('/api')
        .get('/', async (ctx) => ctx.forbidden())
        .build()

      const handler = api.handler()
      const response = await handler(new Request('http://localhost/api/'))

      expect(response.status).toBe(403)
    })

    test('ctx.badRequest() returns 400', async () => {
      const api = REST.create('test')
        .basePath('/api')
        .post('/', async (ctx) => ctx.badRequest('Invalid input'))
        .build()

      const handler = api.handler()
      const response = await handler(new Request('http://localhost/api/', { method: 'POST' }))

      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toBe('Invalid input')
    })
  })

  describe('Body parsing', () => {
    test('parses JSON body', async () => {
      const api = REST.create('test')
        .basePath('/api')
        .post('/', async (ctx) => {
          const body = ctx.body<{ name: string }>()
          return { received: body.name }
        })
        .build()

      const handler = api.handler()
      const response = await handler(
        new Request('http://localhost/api/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'test' }),
        })
      )

      expect(response.status).toBe(200)
      const body = await response.json() as { received: string }
      expect(body.received).toBe('test')
    })

    test('parses text body', async () => {
      const api = REST.create('test')
        .basePath('/api')
        .post('/', async (ctx) => {
          const body = ctx.body<string>()
          return { received: body }
        })
        .build()

      const handler = api.handler()
      const response = await handler(
        new Request('http://localhost/api/', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: 'hello world',
        })
      )

      expect(response.status).toBe(200)
      const body = await response.json() as { received: string }
      expect(body.received).toBe('hello world')
    })

    test('parses form-urlencoded body', async () => {
      const api = REST.create('test')
        .basePath('/api')
        .post('/', async (ctx) => {
          const body = ctx.body<{ name: string; value: string }>()
          return { name: body.name, value: body.value }
        })
        .build()

      const handler = api.handler()
      const response = await handler(
        new Request('http://localhost/api/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'name=test&value=123',
        })
      )

      expect(response.status).toBe(200)
      const body = await response.json() as { name: string; value: string }
      expect(body.name).toBe('test')
      expect(body.value).toBe('123')
    })

    test('handles missing body gracefully', async () => {
      const api = REST.create('test')
        .basePath('/api')
        .post('/', async (ctx) => {
          const body = ctx.body<unknown>()
          return { body }
        })
        .build()

      const handler = api.handler()
      const response = await handler(
        new Request('http://localhost/api/', { method: 'POST' })
      )

      expect(response.status).toBe(200)
      const result = await response.json() as { body: unknown }
      expect(result.body).toBe(null)
    })
  })

  describe('CORS handling', () => {
    test('handles OPTIONS preflight request', async () => {
      const api = REST.create('test')
        .basePath('/api')
        .cors({ origin: '*' })
        .get('/', async () => ({}))
        .build()

      const handler = api.handler()
      const request = new Request('http://localhost/api/', { method: 'OPTIONS' })
      const response = await handler(request)

      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    test('adds CORS headers to responses', async () => {
      const api = REST.create('test')
        .basePath('/api')
        .cors({ origin: 'https://example.com' })
        .get('/', async () => ({}))
        .build()

      const handler = api.handler()
      const response = await handler(new Request('http://localhost/api/'))

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com')
    })
  })
})
