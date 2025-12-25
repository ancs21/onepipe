/**
 * Auth Components
 *
 * Clerk-like components for conditional rendering based on auth state.
 *
 * @example
 * ```tsx
 * import {
 *   SignedIn,
 *   SignedOut,
 *   SignInButton,
 *   SignOutButton,
 *   UserButton
 * } from '@onepipe/client/react'
 *
 * function Header() {
 *   return (
 *     <header>
 *       <SignedOut>
 *         <SignInButton />
 *       </SignedOut>
 *       <SignedIn>
 *         <UserButton />
 *       </SignedIn>
 *     </header>
 *   )
 * }
 * ```
 */

import React, { useState, useRef, useEffect, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { useAuth, useUser } from './hooks'

/**
 * Render children only when user is signed in
 *
 * @example
 * ```tsx
 * <SignedIn>
 *   <Dashboard />
 * </SignedIn>
 * ```
 */
export function SignedIn({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth()

  if (!isLoaded || !isSignedIn) return null

  return <>{children}</>
}

/**
 * Render children only when user is signed out
 *
 * @example
 * ```tsx
 * <SignedOut>
 *   <LandingPage />
 * </SignedOut>
 * ```
 */
export function SignedOut({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth()

  if (!isLoaded || isSignedIn) return null

  return <>{children}</>
}

/**
 * Sign In Button Props
 */
interface SignInButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /**
   * OAuth provider to sign in with (default: shows form)
   */
  provider?: 'github' | 'google' | 'discord' | string

  /**
   * URL to redirect to after sign in
   */
  redirectUrl?: string

  /**
   * Custom children (default: "Sign In")
   */
  children?: ReactNode

  /**
   * Mode: redirect to sign in page, or show modal
   */
  mode?: 'redirect' | 'modal'
}

/**
 * Button to trigger sign in
 *
 * @example
 * ```tsx
 * // OAuth sign in
 * <SignInButton provider="github">Sign in with GitHub</SignInButton>
 *
 * // Default button
 * <SignInButton />
 * ```
 */
export function SignInButton({
  provider,
  redirectUrl,
  children,
  mode = 'redirect',
  ...buttonProps
}: SignInButtonProps) {
  const { signIn } = useAuth()

  const handleClick = async () => {
    if (provider) {
      await signIn.social({
        provider,
        callbackURL: redirectUrl || window.location.href,
      })
    } else {
      // Redirect to sign in page
      window.location.href = '/sign-in' + (redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : '')
    }
  }

  return (
    <button onClick={handleClick} {...buttonProps}>
      {children ?? 'Sign In'}
    </button>
  )
}

/**
 * Sign Out Button Props
 */
interface SignOutButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /**
   * URL to redirect to after sign out
   */
  redirectUrl?: string

  /**
   * Custom children (default: "Sign Out")
   */
  children?: ReactNode
}

/**
 * Button to sign out
 *
 * @example
 * ```tsx
 * <SignOutButton>Log out</SignOutButton>
 * ```
 */
export function SignOutButton({ redirectUrl, children, ...buttonProps }: SignOutButtonProps) {
  const { signOut } = useAuth()

  const handleClick = async () => {
    await signOut()
    if (redirectUrl) {
      window.location.href = redirectUrl
    }
  }

  return (
    <button onClick={handleClick} {...buttonProps}>
      {children ?? 'Sign Out'}
    </button>
  )
}

/**
 * User Button Props
 */
interface UserButtonProps {
  /**
   * URL to redirect to after sign out
   */
  afterSignOutUrl?: string

  /**
   * Size of the avatar (default: 32)
   */
  size?: number

  /**
   * Show name next to avatar
   */
  showName?: boolean
}

/**
 * User avatar button with dropdown menu
 *
 * Similar to Clerk's UserButton. Shows user avatar with sign out option.
 *
 * @example
 * ```tsx
 * <UserButton afterSignOutUrl="/" />
 * ```
 */
export function UserButton({ afterSignOutUrl, size = 32, showName = false }: UserButtonProps) {
  const user = useUser()
  const { signOut } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!user) return null

  const initials = user.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : user.email[0].toUpperCase()

  const handleSignOut = async () => {
    await signOut()
    if (afterSignOutUrl) {
      window.location.href = afterSignOutUrl
    }
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          borderRadius: '9999px',
        }}
        aria-label="User menu"
        aria-expanded={isOpen}
      >
        {user.image ? (
          <img
            src={user.image}
            alt={user.name || user.email}
            style={{
              width: size,
              height: size,
              borderRadius: '50%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            style={{
              width: size,
              height: size,
              borderRadius: '50%',
              backgroundColor: '#6366f1',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: size * 0.4,
              fontWeight: 600,
            }}
          >
            {initials}
          </div>
        )}
        {showName && user.name && (
          <span style={{ fontSize: '14px', fontWeight: 500 }}>{user.name}</span>
        )}
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '4px',
            minWidth: '200px',
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            border: '1px solid #e5e7eb',
            overflow: 'hidden',
            zIndex: 50,
          }}
        >
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ fontWeight: 600, fontSize: '14px', color: '#111827' }}>
              {user.name || 'User'}
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{user.email}</div>
          </div>

          <div style={{ padding: '4px' }}>
            <button
              onClick={handleSignOut}
              style={{
                width: '100%',
                padding: '8px 12px',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                color: '#374151',
                borderRadius: '4px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f3f4f6')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Protect a route/component - redirects to sign in if not authenticated
 *
 * @example
 * ```tsx
 * <Protect redirectUrl="/sign-in">
 *   <DashboardPage />
 * </Protect>
 * ```
 */
export function Protect({
  children,
  redirectUrl = '/sign-in',
  fallback,
}: {
  children: ReactNode
  redirectUrl?: string
  fallback?: ReactNode
}) {
  const { isSignedIn, isLoaded } = useAuth()

  // Still loading
  if (!isLoaded) {
    return fallback ? <>{fallback}</> : null
  }

  // Not signed in - redirect
  if (!isSignedIn) {
    if (typeof window !== 'undefined') {
      window.location.href = redirectUrl
    }
    return fallback ? <>{fallback}</> : null
  }

  return <>{children}</>
}
