import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

interface ShortcutHandler {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  handler: () => void
  description: string
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0

export function useKeyboardShortcuts(
  shortcuts: ShortcutHandler[],
  enabled: boolean = true
) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return

      // Skip if user is typing in an input
      const target = event.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        // Allow CMD+K even in inputs
        if (!(event.key === 'k' && (event.metaKey || event.ctrlKey))) {
          return
        }
      }

      for (const shortcut of shortcuts) {
        const metaKeyMatch = isMac
          ? shortcut.metaKey ? event.metaKey : !event.metaKey
          : shortcut.metaKey ? event.ctrlKey : !event.ctrlKey

        const ctrlKeyMatch = shortcut.ctrlKey
          ? (isMac ? event.ctrlKey : event.ctrlKey)
          : true

        const shiftKeyMatch = shortcut.shiftKey ? event.shiftKey : !event.shiftKey

        if (
          event.key.toLowerCase() === shortcut.key.toLowerCase() &&
          metaKeyMatch &&
          shiftKeyMatch
        ) {
          event.preventDefault()
          shortcut.handler()
          return
        }
      }
    },
    [shortcuts, enabled]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

// Global navigation shortcuts hook
export function useNavigationShortcuts(onOpenCommandPalette: () => void) {
  const navigate = useNavigate()

  const shortcuts: ShortcutHandler[] = [
    {
      key: 'k',
      metaKey: true,
      handler: onOpenCommandPalette,
      description: 'Open command palette',
    },
    {
      key: '1',
      metaKey: true,
      handler: () => navigate('/services'),
      description: 'Go to Services',
    },
    {
      key: '2',
      metaKey: true,
      handler: () => navigate('/api'),
      description: 'Go to API Explorer',
    },
    {
      key: '3',
      metaKey: true,
      handler: () => navigate('/traces'),
      description: 'Go to Traces',
    },
    {
      key: '4',
      metaKey: true,
      handler: () => navigate('/metrics'),
      description: 'Go to Metrics',
    },
    {
      key: '5',
      metaKey: true,
      handler: () => navigate('/logs'),
      description: 'Go to Logs',
    },
    {
      key: '6',
      metaKey: true,
      handler: () => navigate('/flows'),
      description: 'Go to Flows',
    },
    {
      key: '7',
      metaKey: true,
      handler: () => navigate('/database'),
      description: 'Go to Database',
    },
  ]

  useKeyboardShortcuts(shortcuts)
}
