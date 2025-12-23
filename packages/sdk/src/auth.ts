/**
 * Auth Builder
 *
 * Thin wrapper around better-auth for OnePipe integration
 *
 * @example
 * ```typescript
 * import { Auth } from '@onepipe/sdk'
 * import { betterAuth } from 'better-auth'
 *
 * // Create better-auth instance
 * const betterAuthInstance = betterAuth({
 *   database: {
 *     provider: 'sqlite',
 *     url: './auth.db',
 *   },
 *   emailAndPassword: {
 *     enabled: true,
 *   },
 *   socialProviders: {
 *     github: {
 *       clientId: process.env.GITHUB_CLIENT_ID!,
 *       clientSecret: process.env.GITHUB_CLIENT_SECRET!,
 *     },
 *   },
 * })
 *
 * // Wrap with OnePipe Auth
 * const auth = Auth
 *   .create('main')
 *   .provider(betterAuthInstance)
 *   .sessionCookie('onepipe_session')
 *   .build()
 *
 * // Use in REST API
 * const api = REST
 *   .create('protected')
 *   .basePath('/api/protected')
 *   .auth(auth)
 *   .get('/profile', async (ctx) => {
 *     // ctx.user is automatically populated
 *     return { user: ctx.user }
 *   })
 *   .build()
 *
 * // Role-based access
 * const adminApi = REST
 *   .create('admin')
 *   .basePath('/api/admin')
 *   .auth(auth, { roles: ['admin'] })
 *   .get('/users', async (ctx) => {
 *     return await ctx.db`SELECT * FROM users`
 *   })
 *   .build()
 * ```
 */

import type { AuthOptions, AuthInstance, AuthResult, AuthUser } from './types'

/**
 * Auth builder with fluent API
 */
export class AuthBuilder {
  private options: AuthBuilderOptions

  constructor(name: string) {
    this.options = {
      name,
      sessionCookie: 'session',
      headerName: 'Authorization',
      tokenPrefix: 'Bearer ',
    }
  }

  /**
   * Set the better-auth provider instance
   */
  provider(betterAuth: BetterAuthInstance): this {
    this.options.provider = betterAuth
    return this
  }

  /**
   * Set session cookie name
   */
  sessionCookie(name: string): this {
    this.options.sessionCookie = name
    return this
  }

  /**
   * Set authorization header name
   */
  headerName(name: string): this {
    this.options.headerName = name
    return this
  }

  /**
   * Set token prefix (e.g., 'Bearer ')
   */
  tokenPrefix(prefix: string): this {
    this.options.tokenPrefix = prefix
    return this
  }

  /**
   * Set custom user mapper
   */
  mapUser(mapper: (session: BetterAuthSession) => AuthUser): this {
    this.options.userMapper = mapper
    return this
  }

  /**
   * Build the auth instance
   */
  build(): AuthInstance {
    if (!this.options.provider) {
      throw new Error('Auth requires a better-auth provider. Use .provider(betterAuth({...}))')
    }
    return new BetterAuthWrapper(this.options)
  }
}

interface AuthBuilderOptions {
  name: string
  provider?: BetterAuthInstance
  sessionCookie: string
  headerName: string
  tokenPrefix: string
  userMapper?: (session: BetterAuthSession) => AuthUser
}

/**
 * Better-auth instance interface
 * This matches the better-auth API
 */
interface BetterAuthInstance {
  api: {
    getSession: (options: { headers: Headers }) => Promise<BetterAuthSession | null>
  }
  handler: (request: Request) => Promise<Response>
}

interface BetterAuthSession {
  user: {
    id: string
    email: string
    name?: string
    image?: string
    emailVerified: boolean
    createdAt: Date
    updatedAt: Date
    role?: string
    [key: string]: unknown
  }
  session: {
    id: string
    userId: string
    expiresAt: Date
    token: string
    createdAt: Date
    updatedAt: Date
    [key: string]: unknown
  }
}

/**
 * Better-auth wrapper implementation
 */
class BetterAuthWrapper implements AuthInstance {
  readonly name: string
  private options: AuthBuilderOptions
  private provider: BetterAuthInstance

  constructor(options: AuthBuilderOptions) {
    this.name = options.name
    this.options = options
    this.provider = options.provider!
  }

  /**
   * Get auth middleware for request validation
   */
  middleware(): (req: Request) => Promise<AuthResult> {
    return async (req: Request): Promise<AuthResult> => {
      try {
        const session = await this.provider.api.getSession({
          headers: req.headers,
        })

        if (!session) {
          return {
            authenticated: false,
            error: 'No valid session found',
          }
        }

        const user = this.mapSessionToUser(session)

        return {
          authenticated: true,
          user,
        }
      } catch (error) {
        return {
          authenticated: false,
          error: error instanceof Error ? error.message : 'Authentication failed',
        }
      }
    }
  }

  /**
   * Get middleware that requires specific role(s)
   */
  requireRole(role: string | string[]): (req: Request) => Promise<AuthResult> {
    const roles = Array.isArray(role) ? role : [role]

    return async (req: Request): Promise<AuthResult> => {
      const result = await this.middleware()(req)

      if (!result.authenticated) {
        return result
      }

      const userRole = result.user?.role
      if (!userRole || !roles.includes(userRole)) {
        return {
          authenticated: true,
          user: result.user,
          error: `Required role: ${roles.join(' or ')}`,
        }
      }

      return result
    }
  }

  /**
   * Get middleware that requires specific permission(s)
   */
  requirePermission(permission: string | string[]): (req: Request) => Promise<AuthResult> {
    const permissions = Array.isArray(permission) ? permission : [permission]

    return async (req: Request): Promise<AuthResult> => {
      const result = await this.middleware()(req)

      if (!result.authenticated) {
        return result
      }

      const userPermissions = result.user?.permissions as string[] | undefined
      if (!userPermissions || !permissions.some((p) => userPermissions.includes(p))) {
        return {
          authenticated: true,
          user: result.user,
          error: `Required permission: ${permissions.join(' or ')}`,
        }
      }

      return result
    }
  }

  /**
   * Get the better-auth handler for auth routes
   * Mount this at /api/auth/* for login, register, etc.
   */
  handler(): (req: Request) => Promise<Response> {
    return this.provider.handler
  }

  /**
   * Validate a token directly
   */
  async validateToken(token: string): Promise<AuthResult> {
    const headers = new Headers()
    headers.set(this.options.headerName, `${this.options.tokenPrefix}${token}`)

    try {
      const session = await this.provider.api.getSession({ headers })

      if (!session) {
        return {
          authenticated: false,
          error: 'Invalid token',
        }
      }

      return {
        authenticated: true,
        user: this.mapSessionToUser(session),
      }
    } catch (error) {
      return {
        authenticated: false,
        error: error instanceof Error ? error.message : 'Token validation failed',
      }
    }
  }

  /**
   * Map better-auth session to OnePipe AuthUser
   */
  private mapSessionToUser(session: BetterAuthSession): AuthUser {
    if (this.options.userMapper) {
      return this.options.userMapper(session)
    }

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      emailVerified: session.user.emailVerified,
      image: session.user.image,
      sessionId: session.session.id,
      sessionExpiresAt: session.session.expiresAt,
    }
  }
}

/**
 * Auth entry point
 */
export const Auth = {
  /**
   * Create a new auth builder
   */
  create(name: string): AuthBuilder {
    return new AuthBuilder(name)
  },
}

/**
 * Helper to create auth routes handler for use with REST
 *
 * @example
 * ```typescript
 * import { createAuthRoutes } from '@onepipe/sdk'
 *
 * // Mount auth routes at /api/auth/*
 * const authRoutes = createAuthRoutes(auth)
 * ```
 */
export function createAuthRoutes(auth: AuthInstance): {
  basePath: string
  handler: (req: Request) => Promise<Response>
} {
  const wrapper = auth as BetterAuthWrapper
  return {
    basePath: '/api/auth',
    handler: wrapper.handler(),
  }
}
