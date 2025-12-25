/**
 * OnePipe Client React Hooks
 *
 * @example
 * ```tsx
 * import { OnePipeProvider, useFlow, useSignal } from '@onepipe/client/react'
 * import { createClient } from '@onepipe/client'
 * import type { App } from '../server'
 *
 * const client = createClient<App>({ baseUrl: 'http://localhost:3001' })
 *
 * function App() {
 *   return (
 *     <OnePipeProvider client={client}>
 *       <Dashboard />
 *     </OnePipeProvider>
 *   )
 * }
 *
 * function Dashboard() {
 *   const { events } = useFlow<App>('todoEvents', { live: true })
 *   const { value: config } = useSignal<App>('appConfig', { live: true })
 *
 *   return (
 *     <div>
 *       <h1>Events: {events.length}</h1>
 *       <p>Maintenance: {config?.maintenanceMode ? 'Yes' : 'No'}</p>
 *     </div>
 *   )
 * }
 * ```
 */

export { OnePipeProvider, useOnePipeClient } from './provider'
export { useFlow } from './useFlow'
export { useSignal } from './useSignal'

// Auth (Clerk-like API)
export {
  // Provider
  AuthProvider,
  useAuthClient,
  type AuthClient,
  // Hooks
  useAuth,
  useUser,
  useSession,
  type AuthUser,
  type AuthSession,
  type UseAuthReturn,
  // Components
  SignedIn,
  SignedOut,
  SignInButton,
  SignOutButton,
  UserButton,
  Protect,
} from './auth'
