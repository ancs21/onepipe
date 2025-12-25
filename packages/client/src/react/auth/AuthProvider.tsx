/**
 * Auth Provider
 *
 * Clerk-like wrapper around better-auth for OnePipe applications.
 * Provides authentication context and React hooks.
 *
 * @example
 * ```tsx
 * import { AuthProvider } from '@onepipe/client/react'
 *
 * function App() {
 *   return (
 *     <AuthProvider baseUrl="http://localhost:3001">
 *       <YourApp />
 *     </AuthProvider>
 *   )
 * }
 * ```
 */

import React, { createContext, useContext, useMemo, type ReactNode } from 'react'
import { createAuthClient } from 'better-auth/react'

// Type for the auth client returned by better-auth
export type AuthClient = ReturnType<typeof createAuthClient>

// Context for the auth client
const AuthClientContext = createContext<AuthClient | null>(null)

/**
 * Hook to access the raw better-auth client
 * For internal use by other auth hooks
 */
export function useAuthClient(): AuthClient {
  const client = useContext(AuthClientContext)
  if (!client) {
    throw new Error('useAuthClient must be used within an AuthProvider')
  }
  return client
}

/**
 * Auth Provider Props
 */
interface AuthProviderProps {
  /**
   * Base URL of your OnePipe/better-auth server
   * @example "http://localhost:3001"
   */
  baseUrl: string

  /**
   * Base path for auth routes (default: /api/auth)
   */
  basePath?: string

  children: ReactNode
}

/**
 * Auth Provider
 *
 * Wraps your app with better-auth client context.
 * Use with auth hooks like useAuth, useUser, useSession.
 *
 * @example
 * ```tsx
 * import { AuthProvider, SignedIn, SignedOut, useUser } from '@onepipe/client/react'
 *
 * function App() {
 *   return (
 *     <AuthProvider baseUrl="http://localhost:3001">
 *       <SignedOut>
 *         <LoginPage />
 *       </SignedOut>
 *       <SignedIn>
 *         <Dashboard />
 *       </SignedIn>
 *     </AuthProvider>
 *   )
 * }
 *
 * function Dashboard() {
 *   const user = useUser()
 *   return <h1>Welcome, {user?.name}</h1>
 * }
 * ```
 */
export function AuthProvider({ baseUrl, basePath = '/api/auth', children }: AuthProviderProps) {
  const authClient = useMemo(
    () =>
      createAuthClient({
        baseURL: baseUrl,
        basePath,
      }),
    [baseUrl, basePath]
  )

  return <AuthClientContext.Provider value={authClient}>{children}</AuthClientContext.Provider>
}
