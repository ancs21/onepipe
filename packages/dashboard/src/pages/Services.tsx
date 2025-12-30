import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ReactFlow,
  type Node,
  type Edge,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import {
  Server,
  Database,
  Activity,
  MessageSquare,
  Layers,
  Radio,
  Zap,
  HardDrive,
  Shield,
  RefreshCw,
  ChevronRight,
  Circle,
  GitBranch,
  Clock,
  X,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react'
import { useServices, useDatabases, useFlows, useWorkflows, useCronJobs } from '../lib/db'
import type { ServiceGraph, ServiceInfo, ServiceType, DatabaseInfo, FlowInfo, WorkflowInfo, CronJob, ServiceDependency } from '../lib/types'

// ============================================================================
// Service Type Configuration
// ============================================================================

interface ServiceTypeConfig {
  id: ServiceType
  label: string
  pluralLabel: string
  icon: typeof Server
  description: string
  color: string
}

const SERVICE_TYPES: ServiceTypeConfig[] = [
  {
    id: 'rest',
    label: 'REST API',
    pluralLabel: 'REST APIs',
    icon: Server,
    description: 'HTTP endpoints and routes',
    color: 'text-emerald-500',
  },
  {
    id: 'db',
    label: 'Database',
    pluralLabel: 'Databases',
    icon: Database,
    description: 'PostgreSQL, MySQL, SQLite',
    color: 'text-blue-500',
  },
  {
    id: 'flow',
    label: 'Flow',
    pluralLabel: 'Flows',
    icon: Activity,
    description: 'Event streams and queues',
    color: 'text-violet-500',
  },
  {
    id: 'channel',
    label: 'Channel',
    pluralLabel: 'Channels',
    icon: MessageSquare,
    description: 'RPC handlers with retry',
    color: 'text-amber-500',
  },
  {
    id: 'projection',
    label: 'Projection',
    pluralLabel: 'Projections',
    icon: Layers,
    description: 'Materialized views',
    color: 'text-cyan-500',
  },
  {
    id: 'signal',
    label: 'Signal',
    pluralLabel: 'Signals',
    icon: Radio,
    description: 'Reactive state',
    color: 'text-rose-500',
  },
  {
    id: 'cache',
    label: 'Cache',
    pluralLabel: 'Caches',
    icon: Zap,
    description: 'Redis cache layer',
    color: 'text-yellow-500',
  },
  {
    id: 'storage',
    label: 'Storage',
    pluralLabel: 'Storage',
    icon: HardDrive,
    description: 'S3-compatible storage',
    color: 'text-orange-500',
  },
  {
    id: 'auth',
    label: 'Auth',
    pluralLabel: 'Auth',
    icon: Shield,
    description: 'Authentication services',
    color: 'text-indigo-500',
  },
  {
    id: 'workflow',
    label: 'Workflow',
    pluralLabel: 'Workflows',
    icon: GitBranch,
    description: 'Durable executions',
    color: 'text-purple-500',
  },
  {
    id: 'cron',
    label: 'Cron Job',
    pluralLabel: 'Cron Jobs',
    icon: Clock,
    description: 'Scheduled tasks',
    color: 'text-teal-500',
  },
]

// ============================================================================
// Service Type Card Component
// ============================================================================

interface ServiceTypeCardProps {
  config: ServiceTypeConfig
  services: ServiceInfo[]
  databases?: DatabaseInfo[]
  flows?: FlowInfo[]
  workflows?: WorkflowInfo[]
  cronJobs?: CronJob[]
  isExpanded: boolean
  onToggle: () => void
}

function ServiceTypeCard({ config, services, databases, flows, workflows, cronJobs, isExpanded, onToggle }: ServiceTypeCardProps) {
  const Icon = config.icon

  // Calculate counts based on service type
  let count = services.length
  let items: Array<{ name: string; status: string; detail?: string }> = []

  if (config.id === 'db' && databases) {
    count = databases.length
    items = databases.map(db => ({
      name: db.name,
      status: 'healthy',
      detail: db.type,
    }))
  } else if (config.id === 'flow' && flows) {
    count = flows.length
    items = flows.map(f => ({
      name: f.name,
      status: 'healthy',
      detail: `${f.eventCount} events`,
    }))
  } else if (config.id === 'workflow' && workflows) {
    count = workflows.length
    items = workflows.map(w => ({
      name: w.name,
      status: w.failedCount > 0 ? 'error' : w.runningCount > 0 ? 'healthy' : 'idle',
      detail: `${w.runningCount} running`,
    }))
  } else if (config.id === 'cron' && cronJobs) {
    count = cronJobs.length
    items = cronJobs.map(c => ({
      name: c.name,
      status: c.enabled ? 'healthy' : 'idle',
      detail: c.schedule,
    }))
  } else {
    items = services.map(s => ({
      name: s.name,
      status: s.errorCount > 0 ? 'error' : s.requestCount > 0 ? 'healthy' : 'idle',
      detail: s.routes ? `${s.routes.length} routes` : `${s.requestCount} req`,
    }))
  }

  const hasError = items.some(i => i.status === 'error')
  const hasActivity = items.some(i => i.status === 'healthy')

  return (
    <div className="group">
      <button
        onClick={onToggle}
        className={`
          w-full text-left p-4 rounded-lg border transition-all duration-200
          ${isExpanded
            ? 'bg-bg-secondary border-border shadow-sm'
            : 'bg-bg-primary border-border/50 hover:border-border hover:bg-bg-secondary/50'
          }
        `}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            {/* Icon */}
            <div className={`p-2 rounded-md bg-bg-tertiary ${config.color}`}>
              <Icon className="w-4 h-4" />
            </div>

            {/* Info */}
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-text-primary">
                  {config.pluralLabel}
                </span>
                {/* Status dot */}
                <Circle
                  className={`w-2 h-2 fill-current ${
                    hasError ? 'text-status-error' :
                    hasActivity ? 'text-status-success' :
                    'text-text-muted'
                  }`}
                />
              </div>
              <p className="text-xs text-text-muted mt-0.5">
                {config.description}
              </p>
            </div>
          </div>

          {/* Count and expand */}
          <div className="flex items-center gap-2">
            <span className={`
              text-lg font-mono font-semibold
              ${count > 0 ? 'text-text-primary' : 'text-text-muted'}
            `}>
              {count}
            </span>
            <ChevronRight
              className={`w-4 h-4 text-text-muted transition-transform duration-200 ${
                isExpanded ? 'rotate-90' : ''
              }`}
            />
          </div>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-2 ml-4 pl-4 border-l-2 border-border/50 space-y-1">
          {count === 0 ? (
            <p className="text-xs text-text-muted py-2 italic">
              No {config.pluralLabel.toLowerCase()} configured
            </p>
          ) : (
            items.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-bg-tertiary/50"
              >
                <div className="flex items-center gap-2">
                  <Circle
                    className={`w-1.5 h-1.5 fill-current ${
                      item.status === 'error' ? 'text-status-error' :
                      item.status === 'healthy' ? 'text-status-success' :
                      'text-text-muted'
                    }`}
                  />
                  <span className="text-xs font-mono text-text-primary">
                    {item.name}
                  </span>
                </div>
                {item.detail && (
                  <span className="text-2xs text-text-muted">
                    {item.detail}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Dependency Graph Components
// ============================================================================

interface ServiceNodeData extends Record<string, unknown> {
  name: string
  type: ServiceType
  routes?: Array<{ method: string; path: string; auth: boolean }>
  requestCount: number
  errorCount: number
  selected?: boolean
}

function ServiceNode({ data }: { data: ServiceInfo & { selected?: boolean } }) {
  const config = SERVICE_TYPES.find(t => t.id === data.type) || SERVICE_TYPES[0]
  const Icon = config?.icon || Server

  return (
    <div
      className={`
        px-3 py-2 rounded-lg border bg-bg-primary min-w-[140px]
        transition-all duration-200
        ${data.selected
          ? 'border-accent shadow-md ring-1 ring-accent/20'
          : 'border-border hover:border-accent/50'
        }
      `}
    >
      <Handle type="target" position={Position.Top} className="!bg-accent !w-2 !h-2" />

      <div className="flex items-center gap-2">
        <div className={`p-1 rounded ${config?.color || 'text-text-muted'}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <span className="font-mono text-xs text-text-primary truncate">{data.name}</span>
      </div>

      <div className="flex items-center gap-2 mt-1.5 text-2xs">
        <span className="text-text-muted">{data.requestCount} req</span>
        {data.errorCount > 0 && (
          <span className="text-status-error">{data.errorCount} err</span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-accent !w-2 !h-2" />
    </div>
  )
}

const nodeTypes = { service: ServiceNode }

function getEdgeColor(errorRate: number): string {
  if (errorRate > 0.1) return 'var(--color-status-error)' // >10% errors - red
  if (errorRate > 0.01) return 'var(--color-status-warning)' // >1% errors - amber
  return 'var(--color-accent)' // healthy - teal
}

function formatLatency(ms: number): string {
  if (ms < 1) return '<1ms'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

function getLayoutedElements(
  services: ServiceInfo[],
  dependencies: ServiceGraph['dependencies']
): { nodes: Node<ServiceNodeData>[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 })

  services.forEach((service) => {
    dagreGraph.setNode(service.name, { width: 160, height: 60 })
  })

  dependencies.forEach((dep) => {
    dagreGraph.setEdge(dep.source, dep.target)
  })

  dagre.layout(dagreGraph)

  const nodes: Node<ServiceNodeData>[] = services.map((service) => ({
    id: service.name,
    type: 'service',
    position: {
      x: dagreGraph.node(service.name).x - 80,
      y: dagreGraph.node(service.name).y - 30,
    },
    data: { ...service },
  }))

  // Find max call count for edge thickness scaling
  const maxCalls = Math.max(...dependencies.map(d => d.callCount), 1)

  const edges: Edge[] = dependencies.map((dep) => {
    const errorRate = dep.callCount > 0 ? dep.errorCount / dep.callCount : 0
    const edgeColor = getEdgeColor(errorRate)

    // Scale stroke width based on call count (1.5 to 4)
    const strokeWidth = 1.5 + (dep.callCount / maxCalls) * 2.5

    // Build label with call count and latency
    let label = ''
    if (dep.callCount > 0) {
      label = `${dep.callCount}`
      if (dep.avgLatency > 0) {
        label += ` · ${formatLatency(dep.avgLatency)}`
      }
      if (dep.errorCount > 0) {
        label += ` · ${dep.errorCount} err`
      }
    }

    return {
      id: `${dep.source}-${dep.target}`,
      source: dep.source,
      target: dep.target,
      animated: dep.callCount > 0,
      style: {
        stroke: edgeColor,
        strokeWidth,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edgeColor,
        width: 16,
        height: 16,
      },
      label: label || undefined,
      labelStyle: {
        fontSize: 9,
        fill: dep.errorCount > 0 ? 'var(--color-status-error)' : 'var(--color-text-muted)',
        fontWeight: dep.errorCount > 0 ? 600 : 400,
      },
      labelBgStyle: { fill: 'var(--color-bg-primary)', fillOpacity: 0.9 },
    }
  })

  return { nodes, edges }
}

// ============================================================================
// Dependency Detail Panel
// ============================================================================

interface DependencyDetailPanelProps {
  dependency: ServiceDependency
  onClose: () => void
}

function DependencyDetailPanel({ dependency, onClose }: DependencyDetailPanelProps) {
  const errorRate = dependency.callCount > 0
    ? (dependency.errorCount / dependency.callCount) * 100
    : 0
  const successRate = 100 - errorRate

  // Determine status based on error rate
  const status = errorRate > 10 ? 'error' : errorRate > 1 ? 'warning' : 'healthy'
  const StatusIcon = status === 'error' ? XCircle : status === 'warning' ? AlertTriangle : CheckCircle2
  const statusColor = status === 'error' ? 'text-status-error' : status === 'warning' ? 'text-status-warning' : 'text-status-success'
  const statusLabel = status === 'error' ? 'Unhealthy' : status === 'warning' ? 'Degraded' : 'Healthy'

  return (
    <div className="w-80 flex-shrink-0 border-l border-border bg-bg-secondary flex flex-col animate-slide-left">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-sm text-text-primary truncate">{dependency.source}</span>
          <ArrowRight className="w-4 h-4 text-text-muted flex-shrink-0" />
          <span className="font-mono text-sm text-text-primary truncate">{dependency.target}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-bg-tertiary rounded transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4 text-text-muted" />
        </button>
      </div>

      {/* Status Banner */}
      <div className={`px-4 py-2.5 flex items-center gap-2 border-b border-border ${
        status === 'error' ? 'bg-status-error/10' :
        status === 'warning' ? 'bg-status-warning/10' :
        'bg-status-success/10'
      }`}>
        <StatusIcon className={`w-4 h-4 ${statusColor}`} />
        <span className={`text-sm font-medium ${statusColor}`}>{statusLabel}</span>
        <span className="text-xs text-text-muted ml-auto">
          {dependency.callCount.toLocaleString()} calls
        </span>
      </div>

      {/* Metrics */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div>
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">
            Metrics
          </h3>
          <div className="space-y-3">
            {/* Call Count */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Call Count</span>
              <span className="text-sm font-mono font-medium text-text-primary">
                {dependency.callCount.toLocaleString()}
              </span>
            </div>

            {/* Error Count */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Error Count</span>
              <span className={`text-sm font-mono font-medium ${
                dependency.errorCount > 0 ? 'text-status-error' : 'text-text-primary'
              }`}>
                {dependency.errorCount.toLocaleString()}
              </span>
            </div>

            {/* Average Latency */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Avg Latency</span>
              <span className="text-sm font-mono font-medium text-text-primary">
                {formatLatency(dependency.avgLatency)}
              </span>
            </div>

            {/* Divider */}
            <div className="border-t border-border my-2" />

            {/* Error Rate */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Error Rate</span>
              <span className={`text-sm font-mono font-medium ${
                errorRate > 10 ? 'text-status-error' :
                errorRate > 1 ? 'text-status-warning' :
                'text-status-success'
              }`}>
                {errorRate.toFixed(1)}%
              </span>
            </div>

            {/* Success Rate */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Success Rate</span>
              <span className={`text-sm font-mono font-medium ${
                successRate >= 99 ? 'text-status-success' :
                successRate >= 90 ? 'text-status-warning' :
                'text-status-error'
              }`}>
                {successRate.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* Success Rate Bar */}
        <div>
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
            Success Rate
          </h3>
          <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                successRate >= 99 ? 'bg-status-success' :
                successRate >= 90 ? 'bg-status-warning' :
                'bg-status-error'
              }`}
              style={{ width: `${successRate}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-2xs text-text-muted">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Services Component
// ============================================================================

export function Services() {
  const { data: graph = { services: [], dependencies: [] }, isLoading, error, refetch } = useServices()
  const { data: databasesData } = useDatabases()
  const { data: flowsData } = useFlows()
  const { data: workflowsData } = useWorkflows()
  const { data: cronJobsData } = useCronJobs()

  // Ensure arrays (API might return non-array)
  const databases = Array.isArray(databasesData) ? databasesData : []
  const flows = Array.isArray(flowsData) ? flowsData : []
  const workflows = Array.isArray(workflowsData) ? workflowsData : []
  const cronJobs = Array.isArray(cronJobsData) ? cronJobsData : []

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ServiceNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [expandedTypes, setExpandedTypes] = useState<Set<ServiceType>>(new Set())
  const [selectedDependency, setSelectedDependency] = useState<ServiceDependency | null>(null)

  // Group services by type
  const servicesByType = useMemo(() => {
    const grouped = new Map<ServiceType, ServiceInfo[]>()
    SERVICE_TYPES.forEach(t => grouped.set(t.id, []))
    graph.services.forEach(s => {
      const list = grouped.get(s.type) || []
      list.push(s)
      grouped.set(s.type, list)
    })
    return grouped
  }, [graph.services])

  // Calculate totals
  const totals = useMemo(() => {
    const dbCount = databases.length
    const flowCount = flows.length
    const restCount = servicesByType.get('rest')?.length || 0
    return {
      services: dbCount + flowCount + restCount,
      dependencies: graph.dependencies.length,
    }
  }, [databases, flows, servicesByType, graph.dependencies])

  // Update graph layout
  useEffect(() => {
    if (graph.services.length > 0) {
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        graph.services,
        graph.dependencies
      )
      setNodes(layoutedNodes)
      setEdges(layoutedEdges)
    }
  }, [graph, setNodes, setEdges])

  const toggleType = useCallback((type: ServiceType) => {
    setExpandedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }, [])

  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    const dep = graph.dependencies.find(
      d => d.source === edge.source && d.target === edge.target
    )
    if (dep) {
      setSelectedDependency(dep)
    }
  }, [graph.dependencies])

  const hasGraphData = graph.services.length > 0

  return (
    <div className="h-full p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Services</h1>
          <p className="text-sm text-text-muted mt-0.5">
            Infrastructure primitives and dependencies
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted
                   hover:text-text-primary bg-bg-secondary rounded-md border border-border
                   transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-3 bg-status-error/10 text-status-error rounded-lg text-sm border border-status-error/20">
          Failed to load services
        </div>
      )}

      {/* Summary stats */}
      <div className="flex items-center gap-6 py-3 px-4 bg-bg-secondary/50 rounded-lg border border-border/50">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-mono font-bold text-text-primary">{totals.services}</span>
          <span className="text-xs text-text-muted uppercase tracking-wide">Services</span>
        </div>
        <div className="w-px h-8 bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-2xl font-mono font-bold text-accent">{totals.dependencies}</span>
          <span className="text-xs text-text-muted uppercase tracking-wide">Dependencies</span>
        </div>
      </div>

      {/* Service Type Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {SERVICE_TYPES.map((config) => (
          <ServiceTypeCard
            key={config.id}
            config={config}
            services={servicesByType.get(config.id) || []}
            databases={config.id === 'db' ? databases : undefined}
            flows={config.id === 'flow' ? flows : undefined}
            workflows={config.id === 'workflow' ? workflows : undefined}
            cronJobs={config.id === 'cron' ? cronJobs : undefined}
            isExpanded={expandedTypes.has(config.id)}
            onToggle={() => toggleType(config.id)}
          />
        ))}
      </div>

      {/* Dependency Graph */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide">
            Dependency Graph
          </h2>
          {selectedDependency && (
            <span className="text-xs text-text-muted">
              Click edge for details
            </span>
          )}
        </div>
        <div className="card overflow-hidden flex" style={{ height: '400px' }}>
          {!hasGraphData ? (
            <div className="flex-1 flex items-center justify-center text-text-muted">
              <div className="text-center">
                <Server className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">No service dependencies detected</p>
                <p className="text-xs mt-1 text-text-muted">
                  Dependencies appear as services communicate
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1">
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onEdgeClick={handleEdgeClick}
                  nodeTypes={nodeTypes}
                  fitView
                  attributionPosition="bottom-left"
                  proOptions={{ hideAttribution: true }}
                >
                  <Background color="var(--color-border)" gap={24} size={1} />
                  <Controls
                    className="!bg-bg-primary !border-border !shadow-sm [&>button]:!bg-bg-primary [&>button]:!border-border [&>button]:!text-text-muted [&>button:hover]:!bg-bg-secondary"
                  />
                </ReactFlow>
              </div>
              {selectedDependency && (
                <DependencyDetailPanel
                  dependency={selectedDependency}
                  onClose={() => setSelectedDependency(null)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
