/**
 * OnePipe Auth (Clerk-like API)
 *
 * Authentication components and hooks for OnePipe applications.
 * Wraps better-auth with a Clerk-like developer experience.
 *
 * @example
 * ```tsx
 * import {
 *   AuthProvider,
 *   SignedIn,
 *   SignedOut,
 *   SignInButton,
 *   SignOutButton,
 *   UserButton,
 *   useAuth,
 *   useUser,
 *   useSession,
 *   Protect,
 * } from '@onepipe/client/react'
 *
 * function App() {
 *   return (
 *     <AuthProvider baseUrl="http://localhost:3001">
 *       <header>
 *         <SignedOut>
 *           <SignInButton provider="github">Login</SignInButton>
 *         </SignedOut>
 *         <SignedIn>
 *           <UserButton afterSignOutUrl="/" />
 *         </SignedIn>
 *       </header>
 *
 *       <main>
 *         <SignedIn>
 *           <Dashboard />
 *         </SignedIn>
 *         <SignedOut>
 *           <LandingPage />
 *         </SignedOut>
 *       </main>
 *     </AuthProvider>
 *   )
 * }
 *
 * function Dashboard() {
 *   const user = useUser()
 *   return <h1>Welcome, {user?.name}!</h1>
 * }
 * ```
 */

// Provider
export { AuthProvider, useAuthClient, type AuthClient } from './AuthProvider'

// Hooks
export { useAuth, useUser, useSession, type AuthUser, type AuthSession, type UseAuthReturn } from './hooks'

// Components
export {
  SignedIn,
  SignedOut,
  SignInButton,
  SignOutButton,
  UserButton,
  Protect,
} from './components'
