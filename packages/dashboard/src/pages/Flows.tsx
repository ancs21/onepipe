import { useState, useEffect } from 'react'
import {
  Waves,
  ChevronRight,
  RefreshCw,
  Play,
} from 'lucide-react'
import { useFlows, useFlowEvents } from '../lib/db'
import type { FlowInfo, FlowEvent } from '../lib/types'

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function FlowCard({
  flow,
  isSelected,
  onSelect,
}: {
  flow: FlowInfo
  isSelected: boolean
  onSelect: () => void
}) {
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
          <Waves className={`w-4 h-4 ${isSelected ? 'text-accent' : 'text-text-muted'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-mono text-sm font-medium text-text-primary truncate">
            {flow.name}
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            {flow.eventCount.toLocaleString()} events
          </p>
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

function EventRow({
  event,
  isExpanded,
  onToggle,
}: {
  event: FlowEvent
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
        <span className="font-mono text-xs text-accent/60 w-24 flex-shrink-0">
          {event.offset}
        </span>
        <span className="font-mono text-sm text-text-primary flex-1 truncate">
          {JSON.stringify(event.data).slice(0, 80)}...
        </span>
        <span className="text-xs text-text-muted flex-shrink-0">
          {formatRelativeTime(event.timestamp)}
        </span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pl-12 animate-slide-down">
          <div className="space-y-2">
            <div className="flex items-center gap-4 text-xs">
              <span className="text-text-muted">Offset:</span>
              <span className="font-mono text-text-secondary">{event.offset}</span>
              <span className="text-text-muted">Time:</span>
              <span className="font-mono text-text-secondary">{formatTime(event.timestamp)}</span>
            </div>
            <pre className="p-3 bg-bg-primary border border-border rounded-md overflow-auto">
              <code className="font-mono text-xs text-text-primary">
                {JSON.stringify(event.data, null, 2)}
              </code>
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

export function Flows() {
  const [selectedFlow, setSelectedFlow] = useState<string | null>(null)
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)
  const [isLive, setIsLive] = useState(true)

  // Fetch flows with auto-refresh
  const { data: flows = [], error } = useFlows()

  // Fetch events for selected flow with auto-refresh when live
  const { data: events = [], isLoading: eventsLoading, refetch: refetchEvents } = useFlowEvents(
    selectedFlow,
    isLive
  )

  // Auto-select first flow when flows load
  useEffect(() => {
    if (flows.length > 0 && !selectedFlow) {
      setSelectedFlow(flows[0].name)
    }
  }, [flows, selectedFlow])

  const selectedFlowInfo = flows.find((f) => f.name === selectedFlow)
  const totalEvents = flows.reduce((sum, f) => sum + f.eventCount, 0)
  const errorMessage = error ? 'Failed to load flows' : null

  return (
    <div className="h-full p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Flows</h1>
        <p className="text-sm text-text-secondary mt-1">
          Browse your durable event streams
        </p>
      </div>

      {/* Error display */}
      {errorMessage && (
        <div className="p-4 bg-status-error/10 text-status-error rounded-lg text-sm">
          {errorMessage}
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-6">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-text-primary">{flows.length}</span>
          <span className="text-sm text-text-secondary">flows</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-accent">
            {totalEvents.toLocaleString()}
          </span>
          <span className="text-sm text-text-secondary">total events</span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Flow list */}
        <div className="col-span-4 space-y-3">
          <h2 className="text-sm font-medium text-text-secondary">Streams</h2>
          <div className="space-y-2">
            {flows.map((flow) => (
              <FlowCard
                key={flow.name}
                flow={flow}
                isSelected={selectedFlow === flow.name}
                onSelect={() => setSelectedFlow(flow.name)}
              />
            ))}
          </div>
        </div>

        {/* Events */}
        <div className="col-span-8">
          {selectedFlow ? (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-bg-tertiary/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-medium text-text-primary font-mono">
                    {selectedFlow}
                  </h2>
                  {selectedFlowInfo && (
                    <span className="text-xs text-text-muted">
                      {selectedFlowInfo.eventCount.toLocaleString()} events
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsLive(!isLive)}
                    className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors ${
                      isLive
                        ? 'bg-status-success/10 text-status-success'
                        : 'bg-bg-secondary text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {isLive ? (
                      <>
                        <div className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
                        Live
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3" />
                        Paused
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => refetchEvents()}
                    disabled={eventsLoading}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-secondary
                             hover:text-text-primary transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${eventsLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
              </div>

              <div className="max-h-[500px] overflow-auto">
                {events.length === 0 ? (
                  <div className="p-8 text-center text-text-muted">No events found</div>
                ) : (
                  events.map((event) => (
                    <EventRow
                      key={event.id}
                      event={event}
                      isExpanded={expandedEvent === event.id}
                      onToggle={() =>
                        setExpandedEvent(expandedEvent === event.id ? null : event.id)
                      }
                    />
                  ))
                )}
              </div>

              {/* Load more */}
              <div className="px-4 py-3 border-t border-border bg-bg-tertiary/30 text-center">
                <button className="text-xs text-accent hover:text-accent-hover transition-colors">
                  Load more events
                </button>
              </div>
            </div>
          ) : (
            <div className="card p-8 text-center text-text-muted">
              Select a flow to view events
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
