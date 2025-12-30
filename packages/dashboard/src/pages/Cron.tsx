import { useState, useEffect } from 'react'
import {
  Clock,
  ChevronRight,
  RefreshCw,
  Play,
  CheckCircle,
  XCircle,
  Calendar,
  Timer,
} from 'lucide-react'
import { useCronJobs, useCronHistory } from '../lib/db'
import type { CronJob, CronExecution, CronExecutionStatus } from '../lib/types'

// ============================================================================
// Utility Functions
// ============================================================================

function formatTime(timestamp: Date | string): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDateTime(timestamp: Date | string): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatRelativeTime(timestamp: Date | string): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)

  if (seconds < 0) {
    // Future time
    const absSeconds = Math.abs(seconds)
    if (absSeconds < 60) return `in ${absSeconds}s`
    const minutes = Math.floor(absSeconds / 60)
    if (minutes < 60) return `in ${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `in ${hours}h`
    const days = Math.floor(hours / 24)
    return `in ${days}d`
  }

  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function describeCron(expression: string): string {
  const parts = expression.split(' ')
  if (parts.length !== 5) return expression

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  if (minute === '*' && hour === '*') return 'Every minute'
  if (minute === '0' && hour === '*') return 'Every hour'
  if (minute === '0' && hour === '0' && dayOfMonth === '*') return 'Daily at midnight'
  if (minute === '0' && hour === '9' && dayOfMonth === '*') return 'Daily at 9 AM'
  if (minute.includes('/')) {
    const interval = minute.split('/')[1]
    return `Every ${interval} minutes`
  }
  if (dayOfWeek !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const day = parseInt(dayOfWeek, 10)
    return `${days[day] || dayOfWeek}s at ${hour}:${minute.padStart(2, '0')}`
  }
  if (dayOfMonth === '1' && month === '*') return `Monthly on the 1st at ${hour}:${minute.padStart(2, '0')}`

  return `${hour}:${minute.padStart(2, '0')}`
}

// ============================================================================
// Status Components
// ============================================================================

const statusConfig: Record<CronExecutionStatus, { color: string; icon: typeof CheckCircle; label: string }> = {
  pending: { color: 'text-text-muted', icon: Clock, label: 'Pending' },
  running: { color: 'text-accent', icon: Play, label: 'Running' },
  completed: { color: 'text-status-success', icon: CheckCircle, label: 'Completed' },
  failed: { color: 'text-status-error', icon: XCircle, label: 'Failed' },
}

function StatusBadge({ status }: { status: CronExecutionStatus }) {
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${config.color} bg-current/10`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  )
}

// ============================================================================
// Cron Job Card Component
// ============================================================================

function CronJobCard({
  job,
  isSelected,
  onSelect,
}: {
  job: CronJob
  isSelected: boolean
  onSelect: () => void
}) {
  const nextRun = job.nextScheduledTime ? formatRelativeTime(job.nextScheduledTime) : 'Not scheduled'

  return (
    <button
      onClick={onSelect}
      className={`
        w-full p-4 text-left rounded-lg border transition-all
        ${isSelected
          ? 'bg-accent/5 border-accent/50 shadow-glow-sm'
          : 'bg-bg-secondary border-border hover:border-border-hover hover:bg-bg-tertiary/50'
        }
        ${!job.enabled ? 'opacity-50' : ''}
      `}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${isSelected ? 'bg-accent/20' : 'bg-bg-tertiary'}`}>
          <Clock className={`w-4 h-4 ${isSelected ? 'text-accent' : 'text-text-muted'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-mono text-sm font-medium text-text-primary truncate">
              {job.name}
            </h3>
            {!job.enabled && (
              <span className="text-xs text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded">
                Disabled
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            {describeCron(job.schedule)}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs text-text-secondary">{nextRun}</p>
          <p className="text-2xs text-text-muted mt-0.5">{job.timezone}</p>
        </div>
        <ChevronRight
          className={`w-4 h-4 text-text-muted transition-transform ${
            isSelected ? 'rotate-90 text-accent' : ''
          }`}
        />
      </div>
    </button>
  )
}

// ============================================================================
// Execution Row Component
// ============================================================================

function ExecutionRow({
  execution,
  isExpanded,
  onToggle,
}: {
  execution: CronExecution
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="border-b border-border">
      <button
        onClick={onToggle}
        className={`
          w-full flex items-center gap-4 px-4 py-3 text-left
          hover:bg-bg-tertiary/50 transition-colors
          ${isExpanded ? 'bg-bg-tertiary/30' : ''}
        `}
      >
        <ChevronRight
          className={`w-4 h-4 text-text-muted transition-transform flex-shrink-0 ${
            isExpanded ? 'rotate-90' : ''
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-accent/60">
              {formatDateTime(execution.scheduledTime)}
            </span>
            <StatusBadge status={execution.status} />
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            {formatRelativeTime(execution.actualTime)}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          {execution.durationMs !== undefined && (
            <span className="font-mono text-sm text-text-secondary">
              {formatDuration(execution.durationMs)}
            </span>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pl-12 animate-slide-down">
          <div className="space-y-4">
            {/* Execution details */}
            <div className="flex items-center gap-6 text-xs">
              <div>
                <span className="text-text-muted">Scheduled:</span>{' '}
                <span className="font-mono text-text-secondary">{formatTime(execution.scheduledTime)}</span>
              </div>
              <div>
                <span className="text-text-muted">Actual:</span>{' '}
                <span className="font-mono text-text-secondary">{formatTime(execution.actualTime)}</span>
              </div>
              <div>
                <span className="text-text-muted">ID:</span>{' '}
                <span className="font-mono text-text-secondary">{execution.executionId}</span>
              </div>
            </div>

            {/* Output */}
            {execution.output !== undefined && (
              <div>
                <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">Output</h4>
                <pre className="p-3 bg-bg-primary border border-border rounded-md overflow-auto text-xs">
                  <code className="font-mono text-text-primary">
                    {typeof execution.output === 'string'
                      ? execution.output
                      : JSON.stringify(execution.output, null, 2)}
                  </code>
                </pre>
              </div>
            )}

            {/* Error */}
            {execution.error && (
              <div>
                <h4 className="text-xs font-medium text-status-error uppercase tracking-wide mb-2">Error</h4>
                <pre className="p-3 bg-status-error/10 border border-status-error/20 rounded-md overflow-auto text-xs">
                  <code className="font-mono text-status-error">{execution.error}</code>
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main Cron Component
// ============================================================================

export function CronPage() {
  const [selectedJob, setSelectedJob] = useState<string | null>(null)
  const [expandedExecution, setExpandedExecution] = useState<string | null>(null)

  // Fetch cron jobs
  const { data: jobsData, error: jobsError, refetch: refetchJobs, isLoading: jobsLoading } = useCronJobs()

  // Fetch execution history for selected job
  const {
    data: executionsData,
    isLoading: executionsLoading,
    refetch: refetchExecutions,
  } = useCronHistory(selectedJob)

  // Ensure we always have arrays (API might return non-array on error)
  const jobs = Array.isArray(jobsData) ? jobsData : []
  const executions = Array.isArray(executionsData) ? executionsData : []

  // Auto-select first job
  useEffect(() => {
    if (jobs.length > 0 && !selectedJob) {
      setSelectedJob(jobs[0].name)
    }
  }, [jobs, selectedJob])

  // Calculate stats
  const activeJobs = jobs.filter(j => j.enabled).length
  const recentFailed = executions.filter(e => e.status === 'failed').length

  return (
    <div className="h-full p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Scheduled Jobs</h1>
          <p className="text-sm text-text-secondary mt-1">
            Cron jobs and execution history
          </p>
        </div>
        <button
          onClick={() => {
            refetchJobs()
            refetchExecutions()
          }}
          disabled={jobsLoading || executionsLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted
                   hover:text-text-primary bg-bg-secondary rounded-md border border-border
                   transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${jobsLoading || executionsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error display */}
      {jobsError && (
        <div className="p-4 bg-status-error/10 text-status-error rounded-lg text-sm">
          Failed to load cron jobs
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-6">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-text-primary">{jobs.length}</span>
          <span className="text-sm text-text-secondary">jobs</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-accent">{activeJobs}</span>
          <span className="text-sm text-text-secondary">active</span>
        </div>
        {recentFailed > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold text-status-error">{recentFailed}</span>
            <span className="text-sm text-text-secondary">recent failures</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Job list */}
        <div className="col-span-4 space-y-3">
          <h2 className="text-sm font-medium text-text-secondary">Registered Jobs</h2>
          {jobs.length === 0 ? (
            <div className="p-8 text-center text-text-muted bg-bg-secondary rounded-lg border border-border">
              <Calendar className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No cron jobs registered</p>
              <p className="text-xs mt-1">Jobs will appear when your app starts</p>
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => (
                <CronJobCard
                  key={job.name}
                  job={job}
                  isSelected={selectedJob === job.name}
                  onSelect={() => setSelectedJob(job.name)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Execution history */}
        <div className="col-span-8">
          {selectedJob ? (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-bg-tertiary/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-medium text-text-primary font-mono">
                    {selectedJob}
                  </h2>
                  <span className="text-xs text-text-muted">
                    {executions.length} executions
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {jobs.find(j => j.name === selectedJob)?.schedule && (
                    <span className="text-xs text-text-muted font-mono">
                      {jobs.find(j => j.name === selectedJob)?.schedule}
                    </span>
                  )}
                </div>
              </div>

              <div className="max-h-[600px] overflow-auto">
                {executions.length === 0 ? (
                  <div className="p-8 text-center text-text-muted">
                    <Timer className="w-8 h-8 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">No executions yet</p>
                    <p className="text-xs mt-1">Executions will appear after the job runs</p>
                  </div>
                ) : (
                  executions.map((execution) => (
                    <ExecutionRow
                      key={execution.executionId}
                      execution={execution}
                      isExpanded={expandedExecution === execution.executionId}
                      onToggle={() =>
                        setExpandedExecution(
                          expandedExecution === execution.executionId ? null : execution.executionId
                        )
                      }
                    />
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="card p-8 text-center text-text-muted">
              <Calendar className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Select a job to view execution history</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
