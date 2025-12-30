import { useState, useMemo, useRef, useEffect } from 'react'
import {
  Shield,
  Users,
  Key,
  Activity,
  RefreshCw,
  Trash2,
  Check,
  X,
  Search,
  Clock,
  Monitor,
  Circle,
  Plus,
  MoreVertical,
  Copy,
  UserCheck,
  Loader2,
} from 'lucide-react'
import {
  useAuthStats,
  useAuthUsers,
  useAuthSessions,
  useAuthEvents,
  useRevokeSession,
  useCreateUser,
  useDeleteUser,
  useGenerateToken,
  useImpersonateUser,
} from '../lib/db'
import type { AuthUser, AuthSession, AuthEvent } from '../lib/types'

// ============================================================================
// Types
// ============================================================================

type TabId = 'users' | 'sessions' | 'events'

interface Toast {
  id: string
  message: string
  type: 'success' | 'error'
}

// ============================================================================
// Toast Context
// ============================================================================

const ToastContext = ({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) => (
  <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
    {toasts.map((toast) => (
      <div
        key={toast.id}
        className={`
          flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border backdrop-blur-sm
          animate-in slide-in-from-right-full duration-200
          ${toast.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
            : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
          }
        `}
      >
        {toast.type === 'success' ? (
          <Check className="w-4 h-4 flex-shrink-0" />
        ) : (
          <X className="w-4 h-4 flex-shrink-0" />
        )}
        <span className="text-sm font-medium">{toast.message}</span>
        <button onClick={() => onDismiss(toast.id)} className="ml-2 opacity-60 hover:opacity-100">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    ))}
  </div>
)

// ============================================================================
// Create User Modal
// ============================================================================

function CreateUserModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean
  onClose: () => void
  onSuccess: (message: string) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('user')
  const createUser = useCreateUser()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createUser.mutateAsync({ email, password, name: name || undefined, role })
      onSuccess(`User ${email} created successfully`)
      setEmail('')
      setPassword('')
      setName('')
      setRole('user')
      onClose()
    } catch (err) {
      onSuccess(`Failed to create user: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-bg-primary border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Plus className="w-5 h-5 text-indigo-500" />
            Create Test User
          </h2>
          <p className="text-xs text-text-muted mt-1">
            Create a user for testing auth-protected APIs
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="test@example.com"
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg
                       text-sm text-text-primary placeholder:text-text-muted
                       focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Password <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg
                       text-sm text-text-primary placeholder:text-text-muted
                       focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg
                       text-sm text-text-primary placeholder:text-text-muted
                       focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg
                       text-sm text-text-primary
                       focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
              <option value="moderator">moderator</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary
                       bg-bg-secondary border border-border rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createUser.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700
                       rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {createUser.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create User
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============================================================================
// User Actions Dropdown
// ============================================================================

function UserActionsDropdown({
  user,
  onToast,
}: {
  user: AuthUser
  onToast: (message: string, type: 'success' | 'error') => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const generateToken = useGenerateToken()
  const impersonateUser = useImpersonateUser()
  const deleteUser = useDeleteUser()

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

  const handleCopyToken = async () => {
    try {
      const result = await generateToken.mutateAsync({ userId: user.id, expiresIn: 7 * 24 * 60 * 60 })
      await navigator.clipboard.writeText(result.token)
      onToast('Token copied to clipboard (expires in 7 days)', 'success')
    } catch (err) {
      onToast(`Failed to generate token: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
    setIsOpen(false)
  }

  const handleImpersonate = async () => {
    try {
      const result = await impersonateUser.mutateAsync(user.id)
      window.open(result.url, '_blank')
      onToast(`Opened app as ${user.email}`, 'success')
    } catch (err) {
      onToast(`Failed to impersonate: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
    setIsOpen(false)
  }

  const handleDelete = async () => {
    try {
      await deleteUser.mutateAsync(user.id)
      onToast(`User ${user.email} deleted`, 'success')
    } catch (err) {
      onToast(`Failed to delete user: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
    setShowDeleteConfirm(false)
    setIsOpen(false)
  }

  const isLoading = generateToken.isPending || impersonateUser.isPending || deleteUser.isPending

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary
                 transition-colors disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <MoreVertical className="w-4 h-4" />
        )}
      </button>

      {isOpen && !showDeleteConfirm && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-bg-primary border border-border
                      rounded-lg shadow-lg z-50 py-1 animate-in fade-in zoom-in-95 duration-150">
          <button
            onClick={handleCopyToken}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-text-primary
                     hover:bg-bg-tertiary transition-colors"
          >
            <Copy className="w-3.5 h-3.5 text-text-muted" />
            Copy JWT Token
          </button>
          <button
            onClick={handleImpersonate}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-text-primary
                     hover:bg-bg-tertiary transition-colors"
          >
            <UserCheck className="w-3.5 h-3.5 text-text-muted" />
            Impersonate User
          </button>
          <div className="my-1 border-t border-border" />
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-500
                     hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete User
          </button>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-bg-primary border border-border
                      rounded-lg shadow-lg z-50 p-3 animate-in fade-in zoom-in-95 duration-150">
          <p className="text-xs text-text-primary mb-3">
            Delete <span className="font-medium">{user.email}</span>?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-text-secondary
                       bg-bg-secondary border border-border rounded-md hover:bg-bg-tertiary"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteUser.isPending}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600
                       rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              {deleteUser.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Stat Card Component
// ============================================================================

function StatCard({
  label,
  value,
  icon: Icon,
  color = 'text-indigo-500',
}: {
  label: string
  value: number | string
  icon: typeof Users
  color?: string
}) {
  return (
    <div className="stat-card">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-text-primary font-mono tabular-nums">
        {value ?? '—'}
      </div>
    </div>
  )
}

// ============================================================================
// Users Tab
// ============================================================================

function UsersTab({ onToast }: { onToast: (message: string, type: 'success' | 'error') => void }) {
  const [search, setSearch] = useState('')
  const { data: users, isLoading } = useAuthUsers(search || undefined)

  const filteredUsers = useMemo(() => {
    if (!users) return []
    if (!search) return users
    const q = search.toLowerCase()
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.name?.toLowerCase().includes(q) ||
        u.role?.toLowerCase().includes(q)
    )
  }, [users, search])

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-6 py-3 border-b border-border bg-bg-secondary/50">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users..."
            className="w-full pl-9 pr-3 py-2 bg-bg-secondary border border-border rounded-lg
                     text-sm text-text-primary placeholder:text-text-muted
                     focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent
                     transition-all"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto bg-bg-primary">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 text-text-muted animate-spin" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <Users className="w-8 h-8 mb-3 opacity-50" />
            <p className="text-sm">No users found</p>
            <p className="text-xs mt-1">Create a test user to get started</p>
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div className="sticky top-0 z-10 grid grid-cols-[1fr_120px_100px_80px_120px_48px] gap-4 px-4 py-2 border-b border-border bg-bg-tertiary/70 backdrop-blur-sm text-2xs font-medium text-text-muted uppercase tracking-wider">
              <span>Email</span>
              <span>Name</span>
              <span>Role</span>
              <span className="text-center">Verified</span>
              <span className="text-right">Created</span>
              <span></span>
            </div>

            {/* Rows */}
            {filteredUsers.map((user) => (
              <UserRow key={user.id} user={user} onToast={onToast} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function UserRow({ user, onToast }: { user: AuthUser; onToast: (message: string, type: 'success' | 'error') => void }) {
  const createdAt = new Date(user.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  })

  return (
    <div className="grid grid-cols-[1fr_120px_100px_80px_120px_48px] gap-4 px-4 py-2.5 border-b border-border/30 hover:bg-bg-tertiary/30 transition-colors text-xs group">
      {/* Email with avatar */}
      <div className="flex items-center gap-2.5 min-w-0">
        {user.image ? (
          <img src={user.image} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-medium text-indigo-500">
              {user.email.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <span className="font-mono text-text-primary truncate">{user.email}</span>
      </div>

      {/* Name */}
      <span className="text-text-secondary truncate self-center">{user.name || '—'}</span>

      {/* Role */}
      <div className="self-center">
        {user.role ? (
          <span className="px-1.5 py-0.5 text-2xs font-medium bg-bg-tertiary text-text-secondary rounded">
            {user.role}
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </div>

      {/* Verified */}
      <div className="flex justify-center self-center">
        {user.emailVerified ? (
          <Check className="w-4 h-4 text-status-success" />
        ) : (
          <X className="w-4 h-4 text-text-muted" />
        )}
      </div>

      {/* Created */}
      <span className="text-text-muted text-right font-mono tabular-nums self-center">{createdAt}</span>

      {/* Actions */}
      <div className="flex justify-end self-center">
        <UserActionsDropdown user={user} onToast={onToast} />
      </div>
    </div>
  )
}

// ============================================================================
// Sessions Tab
// ============================================================================

function SessionsTab() {
  const { data: sessions, isLoading } = useAuthSessions()
  const revokeSession = useRevokeSession()

  const handleRevoke = (sessionId: string) => {
    if (confirm('Are you sure you want to revoke this session?')) {
      revokeSession.mutate(sessionId)
    }
  }

  return (
    <div className="flex-1 overflow-auto bg-bg-primary">
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-5 h-5 text-text-muted animate-spin" />
        </div>
      ) : !sessions || sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-muted">
          <Key className="w-8 h-8 mb-3 opacity-50" />
          <p className="text-sm">No active sessions</p>
          <p className="text-xs mt-1">Sessions will appear when users log in</p>
        </div>
      ) : (
        <>
          {/* Column headers */}
          <div className="sticky top-0 z-10 grid grid-cols-[100px_140px_140px_100px_1fr_80px] gap-4 px-4 py-2 border-b border-border bg-bg-tertiary/70 backdrop-blur-sm text-2xs font-medium text-text-muted uppercase tracking-wider">
            <span>User ID</span>
            <span>Expires</span>
            <span>Created</span>
            <span>IP Address</span>
            <span>User Agent</span>
            <span className="text-right">Actions</span>
          </div>

          {/* Rows */}
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              onRevoke={() => handleRevoke(session.id)}
              isRevoking={revokeSession.isPending}
            />
          ))}
        </>
      )}
    </div>
  )
}

function SessionRow({
  session,
  onRevoke,
  isRevoking,
}: {
  session: AuthSession
  onRevoke: () => void
  isRevoking: boolean
}) {
  const expiresAt = new Date(session.expiresAt)
  const createdAt = new Date(session.createdAt)
  const isExpired = expiresAt < new Date()

  const formatDate = (date: Date) =>
    date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

  return (
    <div className="grid grid-cols-[100px_140px_140px_100px_1fr_80px] gap-4 px-4 py-2.5 border-b border-border/30 hover:bg-bg-tertiary/30 transition-colors text-xs group">
      {/* User ID */}
      <span className="font-mono text-text-primary self-center">{session.userId.slice(0, 8)}...</span>

      {/* Expires */}
      <div className="flex items-center gap-1.5 self-center">
        <Circle className={`w-1.5 h-1.5 fill-current ${isExpired ? 'text-status-error' : 'text-status-success'}`} />
        <span className={`font-mono tabular-nums ${isExpired ? 'text-status-error' : 'text-text-secondary'}`}>
          {formatDate(expiresAt)}
        </span>
      </div>

      {/* Created */}
      <span className="text-text-muted font-mono tabular-nums self-center">{formatDate(createdAt)}</span>

      {/* IP Address */}
      <span className="font-mono text-text-muted self-center">{session.ipAddress || '—'}</span>

      {/* User Agent */}
      <div className="flex items-center gap-1.5 min-w-0 self-center">
        <Monitor className="w-3 h-3 text-text-muted flex-shrink-0" />
        <span className="text-text-muted truncate">{session.userAgent || '—'}</span>
      </div>

      {/* Actions */}
      <div className="flex justify-end self-center">
        <button
          onClick={onRevoke}
          disabled={isRevoking || isExpired}
          className="inline-flex items-center gap-1 px-2 py-1 text-2xs font-medium
                   text-status-error hover:text-status-error bg-status-error/10 hover:bg-status-error/20
                   rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-3 h-3" />
          Revoke
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Events Tab
// ============================================================================

function EventsTab() {
  const { data: events, isLoading } = useAuthEvents(100)

  return (
    <div className="flex-1 overflow-auto bg-bg-primary">
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-5 h-5 text-text-muted animate-spin" />
        </div>
      ) : !events || events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-muted">
          <Activity className="w-8 h-8 mb-3 opacity-50" />
          <p className="text-sm">No auth events</p>
          <p className="text-xs mt-1">Events will appear as users authenticate</p>
        </div>
      ) : (
        <>
          {/* Column headers */}
          <div className="sticky top-0 z-10 grid grid-cols-[100px_1fr_80px_160px_120px] gap-4 px-4 py-2 border-b border-border bg-bg-tertiary/70 backdrop-blur-sm text-2xs font-medium text-text-muted uppercase tracking-wider">
            <span>Type</span>
            <span>Email</span>
            <span>Status</span>
            <span>Timestamp</span>
            <span className="text-right">IP Address</span>
          </div>

          {/* Rows */}
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </>
      )}
    </div>
  )
}

function EventRow({ event }: { event: AuthEvent }) {
  const timestamp = new Date(event.timestamp)

  const typeConfig: Record<string, { bg: string; text: string }> = {
    login: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
    logout: { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400' },
    register: { bg: 'bg-violet-500/10', text: 'text-violet-600 dark:text-violet-400' },
    password_reset: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400' },
    failed_login: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400' },
  }

  const config = typeConfig[event.type] || { bg: 'bg-bg-tertiary', text: 'text-text-secondary' }

  return (
    <div className="grid grid-cols-[100px_1fr_80px_160px_120px] gap-4 px-4 py-2.5 border-b border-border/30 hover:bg-bg-tertiary/30 transition-colors text-xs group">
      {/* Type */}
      <div className="self-center">
        <span className={`px-1.5 py-0.5 text-2xs font-medium rounded ${config.bg} ${config.text}`}>
          {event.type.replace('_', ' ')}
        </span>
      </div>

      {/* Email */}
      <span className="font-mono text-text-primary self-center truncate">{event.email || '—'}</span>

      {/* Status */}
      <div className="flex items-center gap-1.5 self-center">
        <Circle className={`w-1.5 h-1.5 fill-current ${event.success ? 'text-status-success' : 'text-status-error'}`} />
        <span className={event.success ? 'text-status-success' : 'text-status-error'}>
          {event.success ? 'OK' : 'Fail'}
        </span>
      </div>

      {/* Timestamp */}
      <span className="text-text-muted font-mono tabular-nums self-center">
        {timestamp.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })}
      </span>

      {/* IP Address */}
      <span className="font-mono text-text-muted text-right self-center">{event.ipAddress || '—'}</span>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export default function Auth() {
  const [activeTab, setActiveTab] = useState<TabId>('users')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const { data: stats, isLoading: statsLoading, refetch } = useAuthStats()

  const tabs: { id: TabId; label: string; icon: typeof Users }[] = [
    { id: 'users', label: 'Users', icon: Users },
    { id: 'sessions', label: 'Sessions', icon: Key },
    { id: 'events', label: 'Events', icon: Activity },
  ]

  const addToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  // Show "not configured" state
  if (!statsLoading && stats && !stats.configured) {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border bg-bg-primary">
          <h1 className="text-xl font-semibold text-text-primary flex items-center gap-3">
            Authentication
          </h1>
          <p className="text-sm text-text-muted mt-1">
            User management, sessions, and auth events
          </p>
        </div>

        {/* Not configured message */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-bg-secondary flex items-center justify-center">
              <Shield className="w-8 h-8 text-text-muted" />
            </div>
            <h2 className="text-lg font-medium text-text-primary mb-2">No auth configured</h2>
            <p className="text-sm text-text-muted mb-4">
              Add authentication to your app using the Auth builder with better-auth.
            </p>
            <pre className="text-left text-xs bg-bg-secondary border border-border rounded-lg p-4 font-mono text-text-secondary overflow-x-auto">
{`import { Auth } from '@onepipe/sdk'
import { betterAuth } from 'better-auth'

const auth = Auth
  .create('main')
  .provider(betterAuth({...}))
  .basePath('/api/auth')
  .build()

serve({ auth, ... })`}
            </pre>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border bg-bg-primary">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-text-primary flex items-center gap-3">
              <Shield className="w-5 h-5 text-indigo-500" />
              Authentication
              {stats?.name && (
                <span className="text-xs font-normal text-text-muted bg-bg-secondary px-2 py-0.5 rounded">
                  {stats.name}
                </span>
              )}
            </h1>
            <p className="text-sm text-text-muted mt-1">
              User management, sessions, and auth events
              {stats?.basePath && <span className="font-mono ml-1">({stats.basePath})</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white
                       bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Create User
            </button>
            <button
              onClick={() => refetch()}
              disabled={statsLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted
                       hover:text-text-primary bg-bg-secondary rounded-md border border-border
                       transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${statsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            label="Total Users"
            value={stats?.totalUsers ?? '—'}
            icon={Users}
            color="text-indigo-500"
          />
          <StatCard
            label="Active Sessions"
            value={stats?.activeSessions ?? '—'}
            icon={Key}
            color="text-emerald-500"
          />
          <StatCard
            label="Recent Logins"
            value={stats?.recentLogins ?? '—'}
            icon={Clock}
            color="text-amber-500"
          />
          <StatCard
            label="Failed Logins"
            value={stats?.recentFailures ?? '—'}
            icon={X}
            color="text-rose-500"
          />
        </div>
      </div>

      {/* Tab Bar */}
      <div className="px-6 py-3 border-b border-border bg-bg-secondary/50">
        <div className="flex gap-1 p-1 bg-bg-secondary border border-border rounded-lg w-fit">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md
                  transition-all duration-150
                  ${
                    activeTab === tab.id
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-muted hover:text-text-secondary hover:bg-bg-tertiary'
                  }
                `}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'users' && <UsersTab onToast={addToast} />}
        {activeTab === 'sessions' && <SessionsTab />}
        {activeTab === 'events' && <EventsTab />}
      </div>

      {/* Create User Modal */}
      <CreateUserModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={(msg) => addToast(msg, 'success')}
      />

      {/* Toasts */}
      <ToastContext toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
