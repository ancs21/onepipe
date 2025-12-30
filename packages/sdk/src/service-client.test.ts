import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { ServiceClient } from './service-client'
import { APIError } from './types'

// Mock server for testing
let server: ReturnType<typeof Bun.serve>
const TEST_PORT = 9876
const TEST_URL = `http://localhost:${TEST_PORT}`

beforeAll(() => {
  server = Bun.serve({
    port: TEST_PORT,
    fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // GET /api/users/:id
      if (req.method === 'GET' && path.startsWith('/api/users/')) {
        const id = path.split('/').pop()
        if (id === 'not-found') {
          return Response.json({ error: 'User not found' }, { status: 404 })
        }
        if (id === 'error') {
          return Response.json({ error: 'Internal error' }, { status: 500 })
        }
        return Response.json({ id, name: 'Test User', email: 'test@example.com' })
      }

      // POST /api/users
      if (req.method === 'POST' && path === '/api/users') {
        return req.json().then((data) => {
          const body = data as Record<string, unknown>
          return Response.json({ id: 'new-123', ...body }, { status: 201 })
        })
      }

      // PUT /api/users/:id
      if (req.method === 'PUT' && path.startsWith('/api/users/')) {
        const id = path.split('/').pop()
        return req.json().then((data) => {
          const body = data as Record<string, unknown>
          return Response.json({ id, ...body })
        })
      }

      // PATCH /api/users/:id
      if (req.method === 'PATCH' && path.startsWith('/api/users/')) {
        const id = path.split('/').pop()
        return req.json().then((data) => {
          const body = data as Record<string, unknown>
          return Response.json({ id, patched: true, ...body })
        })
      }

      // DELETE /api/users/:id
      if (req.method === 'DELETE' && path.startsWith('/api/users/')) {
        return new Response(null, { status: 204 })
      }

      // GET /api/search with query params
      if (req.method === 'GET' && path === '/api/search') {
        const query = url.searchParams.get('q')
        const limit = url.searchParams.get('limit')
        return Response.json({ query, limit: Number(limit), results: [] })
      }

      // GET /api/headers - echo headers
      if (req.method === 'GET' && path === '/api/headers') {
        return Response.json({
          authorization: req.headers.get('authorization'),
          'x-custom': req.headers.get('x-custom'),
        })
      }

      // GET /api/slow - slow endpoint for timeout testing
      if (req.method === 'GET' && path === '/api/slow') {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve(Response.json({ slow: true }))
          }, 2000)
        })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    },
  })
})

afterAll(() => {
  server.stop()
})

describe('ServiceClient', () => {
  describe('builder', () => {
    test('creates client with required baseUrl', () => {
      const client = ServiceClient.create('test-service')
        .baseUrl(TEST_URL)
        .build()

      expect(client.name).toBe('test-service')
      expect(client.baseUrl).toBe(TEST_URL)
    })

    test('throws if baseUrl not provided', () => {
      expect(() => {
        ServiceClient.create('test').build()
      }).toThrow('baseUrl is required')
    })

    test('removes trailing slash from baseUrl', () => {
      const client = ServiceClient.create('test')
        .baseUrl(`${TEST_URL}/`)
        .build()

      expect(client.baseUrl).toBe(TEST_URL)
    })

    test('sets timeout', () => {
      const client = ServiceClient.create('test')
        .baseUrl(TEST_URL)
        .timeout(5000)
        .build()

      expect(client).toBeDefined()
    })

    test('sets retry configuration', () => {
      const client = ServiceClient.create('test')
        .baseUrl(TEST_URL)
        .retry(3, 500)
        .build()

      expect(client).toBeDefined()
    })

    test('sets headers', () => {
      const client = ServiceClient.create('test')
        .baseUrl(TEST_URL)
        .header('Authorization', 'Bearer token')
        .headers({ 'X-Custom': 'value' })
        .build()

      expect(client).toBeDefined()
    })
  })

  describe('GET requests', () => {
    test('fetches resource by id', async () => {
      const client = ServiceClient.create('users')
        .baseUrl(TEST_URL)
        .build()

      const user = await client.get<{ id: string; name: string }>('/api/users/123')

      expect(user.id).toBe('123')
      expect(user.name).toBe('Test User')
    })

    test('handles 404 errors', async () => {
      const client = ServiceClient.create('users')
        .baseUrl(TEST_URL)
        .build()

      try {
        await client.get('/api/users/not-found')
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(APIError)
        expect((error as APIError).code).toBe('NotFound')
        expect((error as APIError).status).toBe(404)
      }
    })

    test('handles 500 errors', async () => {
      const client = ServiceClient.create('users')
        .baseUrl(TEST_URL)
        .build()

      try {
        await client.get('/api/users/error')
        expect(true).toBe(false)
      } catch (error) {
        expect(error).toBeInstanceOf(APIError)
        expect((error as APIError).code).toBe('Internal')
        expect((error as APIError).status).toBe(500)
      }
    })

    test('includes query parameters', async () => {
      const client = ServiceClient.create('search')
        .baseUrl(TEST_URL)
        .build()

      const result = await client.get<{ query: string; limit: number }>('/api/search', {
        query: { q: 'test', limit: 10 },
      })

      expect(result.query).toBe('test')
      expect(result.limit).toBe(10)
    })

    test('sends custom headers', async () => {
      const client = ServiceClient.create('test')
        .baseUrl(TEST_URL)
        .header('Authorization', 'Bearer default-token')
        .build()

      const result = await client.get<{ authorization: string; 'x-custom': string }>('/api/headers', {
        headers: { 'X-Custom': 'custom-value' },
      })

      expect(result.authorization).toBe('Bearer default-token')
      expect(result['x-custom']).toBe('custom-value')
    })
  })

  describe('POST requests', () => {
    test('creates resource with body', async () => {
      const client = ServiceClient.create('users')
        .baseUrl(TEST_URL)
        .build()

      const user = await client.post<{ id: string; name: string; email: string }>('/api/users', {
        name: 'New User',
        email: 'new@example.com',
      })

      expect(user.id).toBe('new-123')
      expect(user.name).toBe('New User')
      expect(user.email).toBe('new@example.com')
    })
  })

  describe('PUT requests', () => {
    test('updates resource', async () => {
      const client = ServiceClient.create('users')
        .baseUrl(TEST_URL)
        .build()

      const user = await client.put<{ id: string; name: string }>('/api/users/123', {
        name: 'Updated User',
      })

      expect(user.id).toBe('123')
      expect(user.name).toBe('Updated User')
    })
  })

  describe('PATCH requests', () => {
    test('patches resource', async () => {
      const client = ServiceClient.create('users')
        .baseUrl(TEST_URL)
        .build()

      const user = await client.patch<{ id: string; patched: boolean }>('/api/users/123', {
        name: 'Patched',
      })

      expect(user.id).toBe('123')
      expect(user.patched).toBe(true)
    })
  })

  describe('DELETE requests', () => {
    test('deletes resource and returns undefined', async () => {
      const client = ServiceClient.create('users')
        .baseUrl(TEST_URL)
        .build()

      const result = await client.delete('/api/users/123')

      expect(result).toBeUndefined()
    })
  })

  describe('timeout', () => {
    test('times out slow requests', async () => {
      const client = ServiceClient.create('slow')
        .baseUrl(TEST_URL)
        .timeout(100) // 100ms timeout
        .build()

      try {
        await client.get('/api/slow')
        expect(true).toBe(false)
      } catch (error) {
        expect(error).toBeInstanceOf(APIError)
        expect((error as APIError).code).toBe('Unavailable')
        expect((error as APIError).message).toContain('timed out')
      }
    })

    test('allows override timeout per request', async () => {
      const client = ServiceClient.create('slow')
        .baseUrl(TEST_URL)
        .timeout(100)
        .build()

      try {
        await client.get('/api/slow', { timeout: 50 })
        expect(true).toBe(false)
      } catch (error) {
        expect(error).toBeInstanceOf(APIError)
        expect((error as APIError).message).toContain('timed out')
      }
    })
  })

  describe('retry', () => {
    test('does not retry 4xx errors', async () => {
      let callCount = 0
      const mockServer = Bun.serve({
        port: 9877,
        fetch() {
          callCount++
          return Response.json({ error: 'Bad request' }, { status: 400 })
        },
      })

      try {
        const client = ServiceClient.create('retry-test')
          .baseUrl('http://localhost:9877')
          .retry(3, 10)
          .build()

        await client.get('/test').catch(() => {})

        expect(callCount).toBe(1) // No retries for 4xx
      } finally {
        mockServer.stop()
      }
    })

    test('retries 5xx errors', async () => {
      let callCount = 0
      const mockServer = Bun.serve({
        port: 9878,
        fetch() {
          callCount++
          if (callCount < 3) {
            return Response.json({ error: 'Server error' }, { status: 503 })
          }
          return Response.json({ success: true })
        },
      })

      try {
        const client = ServiceClient.create('retry-test')
          .baseUrl('http://localhost:9878')
          .retry(3, 10)
          .build()

        const result = await client.get<{ success: boolean }>('/test')

        expect(result.success).toBe(true)
        expect(callCount).toBe(3) // 2 failures + 1 success
      } finally {
        mockServer.stop()
      }
    })
  })
})
