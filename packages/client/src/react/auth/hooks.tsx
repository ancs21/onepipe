/**
 * Auth Hooks
 *
 * Clerk-like hooks for accessing authentication state.
 *
 * @example
 * ```tsx
 * import { useAuth, useUser, useSession } from '@onepipe/client/react'
 *
 * function Profile() {
 *   const { isSignedIn, signOut } = useAuth()
 *   const user = useUser()
 *
 *   if (!isSignedIn) return <p>Please sign in</p>
 *
 *   return (
 *     <div>
 *       <h1>Welcome, {user?.name}</h1>
 *       <button onClick={() => signOut()}>Sign Out</button>
 *     </div>
 *   )
 * }
 * ```
 */

import { useAuthClient } from './AuthProvider'

/**
 * User type from better-auth session
 */
export interface AuthUser {
  id: string
  email: string
  name?: string | null
  image?: string | null
  emailVerified: boolean
  createdAt?: Date
  updatedAt?: Date
  [key: string]: unknown
}

/**
 * Session type from better-auth
 */
export interface AuthSession {
  user: AuthUser
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
 * Auth state and methods returned by useAuth
 */
export interface UseAuthReturn {
  /**
   * Whether a user is currently signed in
   */
  isSignedIn: boolean

  /**
   * Whether the auth state has finished loading
   */
  isLoaded: boolean

  /**
   * Current user, or null if not signed in
   */
  user: AuthUser | null

  /**
   * Sign out the current user
   */
  signOut: () => Promise<void>

  /**
   * Sign in with email and password
   */
  signIn: {
    email: (params: { email: string; password: string }) => Promise<unknown>
    social: (params: { provider: string; callbackURL?: string }) => Promise<void>
  }

  /**
   * Sign up with email and password
   */
  signUp: {
    email: (params: {
      email: string
      password: string
      name: string
    }) => Promise<unknown>
  }
}

/**
 * Hook for auth state and methods
 *
 * Similar to Clerk's useAuth hook. Provides auth state and sign in/out methods.
 *
 * @example
 * ```tsx
 * function LoginButton() {
 *   const { isSignedIn, signIn, signOut } = useAuth()
 *
 *   if (isSignedIn) {
 *     return <button onClick={() => signOut()}>Sign Out</button>
 *   }
 *
 *   return (
 *     <button onClick={() => signIn.social({ provider: 'github' })}>
 *       Sign In with GitHub
 *     </button>
 *   )
 * }
 * ```
 */
export function useAuth(): UseAuthReturn {
  const client = useAuthClient()
  const { data: session, isPending } = client.useSession()

  return {
    isSignedIn: !!session?.user,
    isLoaded: !isPending,
    user: session?.user ?? null,

    signOut: async () => {
      await client.signOut()
    },

    signIn: {
      email: async (params) => {
        const result = await client.signIn.email(params)
        return result
      },
      social: async (params) => {
        await client.signIn.social(params)
      },
    },

    signUp: {
      email: async (params) => {
        const result = await client.signUp.email(params)
        return result
      },
    },
  }
}

/**
 * Hook to get the current user
 *
 * Similar to Clerk's useUser hook. Returns the current user or null.
 *
 * @example
 * ```tsx
 * function UserProfile() {
 *   const user = useUser()
 *
 *   if (!user) return <p>Not signed in</p>
 *
 *   return (
 *     <div>
 *       <img src={user.image} alt={user.name} />
 *       <h2>{user.name}</h2>
 *       <p>{user.email}</p>
 *     </div>
 *   )
 * }
 * ```
 */
export function useUser(): AuthUser | null {
  const { user } = useAuth()
  return user
}

/**
 * Hook to get the full session data
 *
 * Similar to Clerk's useSession hook. Returns session data including user and session info.
 *
 * @example
 * ```tsx
 * function SessionInfo() {
 *   const { session, isLoaded } = useSession()
 *
 *   if (!isLoaded) return <p>Loading...</p>
 *   if (!session) return <p>No session</p>
 *
 *   return (
 *     <div>
 *       <p>Session ID: {session.session.id}</p>
 *       <p>Expires: {session.session.expiresAt.toLocaleString()}</p>
 *     </div>
 *   )
 * }
 * ```
 */
export function useSession(): {
  session: AuthSession | null
  isLoaded: boolean
  isSignedIn: boolean
} {
  const client = useAuthClient()
  const { data: session, isPending } = client.useSession()

  return {
    session: session as AuthSession | null,
    isLoaded: !isPending,
    isSignedIn: !!session?.user,
  }
}
