import { useState, useEffect } from 'react'
import {
  GitBranch,
  ChevronRight,
  RefreshCw,
  Play,
  Pause,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Circle,
} from 'lucide-react'
import { useWorkflows, useWorkflowExecutions } from '../lib/db'
import type { WorkflowInfo, WorkflowExecution, WorkflowStatus, StepExecution } from '../lib/types'

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

function formatDuration(startedAt: Date | string, completedAt?: Date | string): string {
  const start = typeof startedAt === 'string' ? new Date(startedAt) : startedAt
  const end = completedAt
    ? (typeof completedAt === 'string' ? new Date(completedAt) : completedAt)
    : new Date()

  const ms = end.getTime() - start.getTime()

  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`
}

function formatRelativeTime(timestamp: Date | string): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)

  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ============================================================================
// Status Components
// ============================================================================

const statusConfig: Record<WorkflowStatus, { color: string; icon: typeof CheckCircle; label: string }> = {
  pending: { color: 'text-text-muted', icon: Clock, label: 'Pending' },
  running: { color: 'text-accent', icon: Play, label: 'Running' },
  completed: { color: 'text-status-success', icon: CheckCircle, label: 'Completed' },
  failed: { color: 'text-status-error', icon: XCircle, label: 'Failed' },
  cancelled: { color: 'text-status-warning', icon: Pause, label: 'Cancelled' },
  timed_out: { color: 'text-status-warning', icon: AlertTriangle, label: 'Timed Out' },
}

function StatusBadge({ status }: { status: WorkflowStatus }) {
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${config.color} bg-current/10`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  )
}

function StepStatusDot({ status }: { status: StepExecution['status'] }) {
  const colors: Record<StepExecution['status'], string> = {
    pending: 'bg-text-muted',
    running: 'bg-accent animate-pulse',
    completed: 'bg-status-success',
    failed: 'bg-status-error',
  }

  return <div className={`w-2 h-2 rounded-full ${colors[status]}`} />
}

// ============================================================================
// Workflow Card Component
// ============================================================================

function WorkflowCard({
  workflow,
  isSelected,
  onSelect,
}: {
  workflow: WorkflowInfo
  isSelected: boolean
  onSelect: () => void
}) {
  const total = workflow.runningCount + workflow.completedCount + workflow.failedCount

  return (
    <button
      onClick={onSelect}
      className={`
        w-full p-4 text-left rounded-lg border transition-all
        ${isSelected
          ? 'bg-accent/5 border-accent/50 shadow-glow-sm'
          : 'bg-bg-secondary border-border hover:border-border-hover hover:bg-bg-tertiary/50'
        }
      `}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${isSelected ? 'bg-accent/20' : 'bg-bg-tertiary'}`}>
          <GitBranch className={`w-4 h-4 ${isSelected ? 'text-accent' : 'text-text-muted'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-mono text-sm font-medium text-text-primary truncate">
            {workflow.name}
          </h3>
          <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
            {workflow.runningCount > 0 && (
              <span className="flex items-center gap-1">
                <Circle className="w-2 h-2 fill-accent text-accent animate-pulse" />
                {workflow.runningCount} running
              </span>
            )}
            <span>{total} total</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {workflow.failedCount > 0 && (
            <span className="text-xs text-status-error font-medium">{workflow.failedCount} failed</span>
          )}
          <ChevronRight
            className={`w-4 h-4 text-text-muted transition-transform ${
              isSelected ? 'rotate-90 text-accent' : ''
            }`}
          />
        </div>
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
  execution: WorkflowExecution
  isExpanded: boolean
  onToggle: () => void
}) {
  const duration = formatDuration(execution.startedAt, execution.completedAt)
  const isRunning = execution.status === 'running'

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
            <span className="font-mono text-xs text-accent/60 truncate">
              {execution.workflowId.slice(0, 20)}...
            </span>
            <StatusBadge status={execution.status} />
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-text-muted">
            <span>{execution.steps.length} steps</span>
            <span>{formatRelativeTime(execution.startedAt)}</span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <span className={`font-mono text-sm ${isRunning ? 'text-accent' : 'text-text-secondary'}`}>
            {duration}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pl-12 animate-slide-down">
          <div className="space-y-4">
            {/* Execution details */}
            <div className="flex items-center gap-6 text-xs">
              <div>
                <span className="text-text-muted">Started:</span>{' '}
                <span className="font-mono text-text-secondary">{formatTime(execution.startedAt)}</span>
              </div>
              {execution.completedAt && (
                <div>
                  <span className="text-text-muted">Completed:</span>{' '}
                  <span className="font-mono text-text-secondary">{formatTime(execution.completedAt)}</span>
                </div>
              )}
              <div>
                <span className="text-text-muted">ID:</span>{' '}
                <span className="font-mono text-text-secondary">{execution.workflowId}</span>
              </div>
            </div>

            {/* Steps timeline */}
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wide">Steps</h4>
              <div className="space-y-1">
                {execution.steps.map((step, index) => (
                  <StepRow key={step.stepName} step={step} index={index} />
                ))}
              </div>
            </div>

            {/* Input/Output */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">Input</h4>
                <pre className="p-3 bg-bg-primary border border-border rounded-md overflow-auto text-xs">
                  <code className="font-mono text-text-primary">
                    {JSON.stringify(execution.input, null, 2)}
                  </code>
                </pre>
              </div>
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
            </div>

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
// Step Row Component
// ============================================================================

function StepRow({ step, index }: { step: StepExecution; index: number }) {
  const duration = step.startedAt && step.completedAt
    ? formatDuration(step.startedAt, step.completedAt)
    : step.startedAt
      ? formatDuration(step.startedAt)
      : '-'

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded hover:bg-bg-tertiary/50">
      <span className="text-xs text-text-muted w-4">{index + 1}</span>
      <StepStatusDot status={step.status} />
      <span className="font-mono text-sm text-text-primary flex-1">{step.stepName}</span>
      {step.attempts > 1 && (
        <span className="text-xs text-status-warning">{step.attempts} attempts</span>
      )}
      <span className="font-mono text-xs text-text-muted">{duration}</span>
    </div>
  )
}

// ============================================================================
// Status Filter Component
// ============================================================================

function StatusFilter({
  selected,
  onChange,
}: {
  selected: string
  onChange: (status: string) => void
}) {
  const options = [
    { value: 'all', label: 'All' },
    { value: 'running', label: 'Running' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
  ]

  return (
    <div className="flex items-center gap-1 bg-bg-secondary rounded-md p-0.5">
      {options.map(option => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`
            px-2 py-1 text-xs rounded transition-colors
            ${selected === option.value
              ? 'bg-bg-tertiary text-text-primary'
              : 'text-text-muted hover:text-text-secondary'
            }
          `}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// ============================================================================
// Main Workflows Component
// ============================================================================

export function Workflows() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null)
  const [expandedExecution, setExpandedExecution] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')

  // Fetch workflows
  const { data: workflowsData, error: workflowsError, refetch: refetchWorkflows, isLoading: workflowsLoading } = useWorkflows()

  // Fetch executions for selected workflow
  const {
    data: executionsData,
    isLoading: executionsLoading,
    refetch: refetchExecutions,
  } = useWorkflowExecutions(selectedWorkflow, statusFilter)

  // Ensure we always have arrays (API might return non-array on error)
  const workflows = Array.isArray(workflowsData) ? workflowsData : []
  const executions = Array.isArray(executionsData) ? executionsData : []

  // Auto-select first workflow
  useEffect(() => {
    if (workflows.length > 0 && !selectedWorkflow) {
      setSelectedWorkflow(workflows[0].name)
    }
  }, [workflows, selectedWorkflow])

  // Calculate totals
  const totalRunning = workflows.reduce((sum, w) => sum + w.runningCount, 0)
  const totalCompleted = workflows.reduce((sum, w) => sum + w.completedCount, 0)
  const totalFailed = workflows.reduce((sum, w) => sum + w.failedCount, 0)

  return (
    <div className="h-full p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Workflows</h1>
          <p className="text-sm text-text-secondary mt-1">
            Durable workflow executions and step tracking
          </p>
        </div>
        <button
          onClick={() => {
            refetchWorkflows()
            refetchExecutions()
          }}
          disabled={workflowsLoading || executionsLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted
                   hover:text-text-primary bg-bg-secondary rounded-md border border-border
                   transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${workflowsLoading || executionsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error display */}
      {workflowsError && (
        <div className="p-4 bg-status-error/10 text-status-error rounded-lg text-sm">
          Failed to load workflows
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-6">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-text-primary">{workflows.length}</span>
          <span className="text-sm text-text-secondary">workflows</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-accent">{totalRunning}</span>
          <span className="text-sm text-text-secondary">running</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-status-success">{totalCompleted}</span>
          <span className="text-sm text-text-secondary">completed</span>
        </div>
        {totalFailed > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold text-status-error">{totalFailed}</span>
            <span className="text-sm text-text-secondary">failed</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Workflow list */}
        <div className="col-span-4 space-y-3">
          <h2 className="text-sm font-medium text-text-secondary">Registered Workflows</h2>
          {workflows.length === 0 ? (
            <div className="p-8 text-center text-text-muted bg-bg-secondary rounded-lg border border-border">
              <GitBranch className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No workflows registered</p>
              <p className="text-xs mt-1">Workflows will appear when your app starts</p>
            </div>
          ) : (
            <div className="space-y-2">
              {workflows.map((workflow) => (
                <WorkflowCard
                  key={workflow.name}
                  workflow={workflow}
                  isSelected={selectedWorkflow === workflow.name}
                  onSelect={() => setSelectedWorkflow(workflow.name)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Executions */}
        <div className="col-span-8">
          {selectedWorkflow ? (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-bg-tertiary/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-medium text-text-primary font-mono">
                    {selectedWorkflow}
                  </h2>
                  <span className="text-xs text-text-muted">
                    {executions.length} executions
                  </span>
                </div>
                <StatusFilter selected={statusFilter} onChange={setStatusFilter} />
              </div>

              <div className="max-h-[600px] overflow-auto">
                {executions.length === 0 ? (
                  <div className="p-8 text-center text-text-muted">
                    <Clock className="w-8 h-8 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">No executions found</p>
                    <p className="text-xs mt-1">Start a workflow to see executions here</p>
                  </div>
                ) : (
                  executions.map((execution) => (
                    <ExecutionRow
                      key={execution.workflowId}
                      execution={execution}
                      isExpanded={expandedExecution === execution.workflowId}
                      onToggle={() =>
                        setExpandedExecution(
                          expandedExecution === execution.workflowId ? null : execution.workflowId
                        )
                      }
                    />
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="card p-8 text-center text-text-muted">
              <GitBranch className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Select a workflow to view executions</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
