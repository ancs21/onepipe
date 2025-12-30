import { useState, useEffect, useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts'
import { TrendingUp, TrendingDown, Activity, Clock, Zap, Server } from 'lucide-react'
import { api } from '../lib/api'
import type { MetricPoint } from '../lib/types'

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

function MetricCard({
  title,
  value,
  unit,
  change,
  changeType,
  icon: Icon,
}: {
  title: string
  value: number | string
  unit: string
  change?: number
  changeType?: 'positive' | 'negative' | 'neutral'
  icon: typeof Activity
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-text-muted uppercase tracking-wide">{title}</p>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-semibold text-text-primary">{value}</span>
            <span className="text-sm text-text-secondary">{unit}</span>
          </div>
        </div>
        <div className="p-2 bg-accent/10 rounded-lg">
          <Icon className="w-4 h-4 text-accent" />
        </div>
      </div>
      {change !== undefined && (
        <div className="flex items-center gap-1 mt-2">
          {changeType === 'positive' ? (
            <TrendingUp className="w-3 h-3 text-status-success" />
          ) : changeType === 'negative' ? (
            <TrendingDown className="w-3 h-3 text-status-error" />
          ) : null}
          <span
            className={`text-xs ${
              changeType === 'positive'
                ? 'text-status-success'
                : changeType === 'negative'
                ? 'text-status-error'
                : 'text-text-muted'
            }`}
          >
            {change > 0 ? '+' : ''}
            {change}% from last hour
          </span>
        </div>
      )}
    </div>
  )
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        {description && (
          <p className="text-xs text-text-muted mt-0.5">{description}</p>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

interface TooltipPayload {
  value: number
  name: string
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
  label?: number
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (!active || !payload?.length) return null

  return (
    <div className="bg-white border border-border rounded-lg px-3 py-2 shadow-elevated">
      <p className="text-xs text-text-muted mb-1">{formatTime(label ?? 0)}</p>
      {payload.map((entry, index) => (
        <p key={index} className="text-sm font-mono font-medium" style={{ color: entry.color }}>
          {entry.value.toFixed(1)} {entry.name === 'value' ? '' : entry.name}
        </p>
      ))}
    </div>
  )
}

export function Metrics() {
  const [requestRate, setRequestRate] = useState<MetricPoint[]>([])
  const [latencyP50, setLatencyP50] = useState<MetricPoint[]>([])
  const [latencyP99, setLatencyP99] = useState<MetricPoint[]>([])
  const [errorRate, setErrorRate] = useState<MetricPoint[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        setError(null)
        const data = await api.getMetrics()
        if (data.requestRate?.length) setRequestRate(data.requestRate)
        if (data.latencyP50?.length) setLatencyP50(data.latencyP50)
        if (data.latencyP99?.length) setLatencyP99(data.latencyP99)
        if (data.errorRate?.length) setErrorRate(data.errorRate)
      } catch (err) {
        setError('Failed to load metrics')
        console.error('Failed to load metrics:', err)
      }
    }
    loadMetrics()
    const interval = setInterval(loadMetrics, 2000)
    return () => clearInterval(interval)
  }, [])

  const currentRequestRate = requestRate[requestRate.length - 1]?.value || 0
  const currentLatency = latencyP50[latencyP50.length - 1]?.value || 0
  const currentErrorRate = errorRate[errorRate.length - 1]?.value || 0

  // Memoize combined latency chart data
  const latencyChartData = useMemo(() => {
    return latencyP50.map((p50, i) => ({
      timestamp: p50.timestamp,
      p50: p50.value,
      p99: latencyP99[i]?.value || 0,
    }))
  }, [latencyP50, latencyP99])

  return (
    <div className="h-full p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Metrics</h1>
        <p className="text-sm text-text-secondary mt-1">
          Real-time application performance metrics
        </p>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-4 bg-status-error/10 text-status-error rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          title="Request Rate"
          value={currentRequestRate.toFixed(0)}
          unit="req/s"
          icon={Zap}
        />
        <MetricCard
          title="Latency P50"
          value={currentLatency.toFixed(0)}
          unit="ms"
          icon={Clock}
        />
        <MetricCard
          title="Latency P99"
          value={(latencyP99[latencyP99.length - 1]?.value || 0).toFixed(0)}
          unit="ms"
          icon={Activity}
        />
        <MetricCard
          title="Error Rate"
          value={currentErrorRate.toFixed(1)}
          unit="%"
          icon={Server}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Request Rate" description="Requests per second over time">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={requestRate}>
              <defs>
                <linearGradient id="requestGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#E7E5E4"
                horizontal={true}
                vertical={false}
              />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTime}
                stroke="#D6D3D1"
                tick={{ fill: '#57534E', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                stroke="#D6D3D1"
                tick={{ fill: '#57534E', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={30}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#4F46E5"
                strokeWidth={2}
                fill="url(#requestGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Response Latency" description="P50 and P99 latency in milliseconds">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={latencyChartData}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#E7E5E4"
                horizontal={true}
                vertical={false}
              />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTime}
                stroke="#D6D3D1"
                tick={{ fill: '#57534E', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                stroke="#D6D3D1"
                tick={{ fill: '#57534E', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={30}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="p50"
                stroke="#059669"
                strokeWidth={2}
                dot={false}
                name="P50"
              />
              <Line
                type="monotone"
                dataKey="p99"
                stroke="#D97706"
                strokeWidth={2}
                dot={false}
                name="P99"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Error Rate" description="Percentage of failed requests">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={errorRate}>
              <defs>
                <linearGradient id="errorGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#DC2626" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#E7E5E4"
                horizontal={true}
                vertical={false}
              />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTime}
                stroke="#D6D3D1"
                tick={{ fill: '#57534E', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                stroke="#D6D3D1"
                tick={{ fill: '#57534E', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={30}
                domain={[0, 10]}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#DC2626"
                strokeWidth={2}
                fill="url(#errorGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Active Connections" description="Current connection pool usage">
          <div className="flex items-center justify-center h-[200px]">
            <p className="text-sm text-text-muted">No connection data available</p>
          </div>
        </ChartCard>
      </div>
    </div>
  )
}
