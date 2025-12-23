/**
 * Metrics - Application Metrics Builder
 *
 * Prometheus-compatible metrics for observability
 *
 * @example
 * ```typescript
 * import { Metrics } from '@onepipe/sdk'
 *
 * const metrics = Metrics.create('my-service').build()
 *
 * // Counter - monotonically increasing value
 * const requestCounter = metrics.counter('http_requests_total', {
 *   help: 'Total HTTP requests',
 *   labels: ['method', 'path', 'status'],
 * })
 * requestCounter.inc({ method: 'GET', path: '/api', status: '200' })
 *
 * // Gauge - value that can go up or down
 * const activeConnections = metrics.gauge('active_connections', {
 *   help: 'Current active connections',
 * })
 * activeConnections.set(42)
 * activeConnections.inc()
 * activeConnections.dec()
 *
 * // Histogram - distribution of values
 * const requestDuration = metrics.histogram('http_request_duration_seconds', {
 *   help: 'Request duration in seconds',
 *   buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
 * })
 * requestDuration.observe(0.123)
 *
 * // Export as Prometheus format
 * const output = metrics.serialize()
 * ```
 */

export type Labels = Record<string, string>

export interface MetricOptions {
  help?: string
  labels?: string[]
}

export interface HistogramOptions extends MetricOptions {
  buckets?: number[]
}

export interface Counter {
  inc(labels?: Labels, value?: number): void
  get(labels?: Labels): number
}

export interface Gauge {
  set(value: number, labels?: Labels): void
  inc(labels?: Labels, value?: number): void
  dec(labels?: Labels, value?: number): void
  get(labels?: Labels): number
}

export interface Histogram {
  observe(value: number, labels?: Labels): void
  startTimer(labels?: Labels): () => void
}

export interface MetricsInstance {
  readonly name: string
  counter(name: string, options?: MetricOptions): Counter
  gauge(name: string, options?: MetricOptions): Gauge
  histogram(name: string, options?: HistogramOptions): Histogram
  serialize(): string
  reset(): void
  handler(): (req: Request) => Response
}

/**
 * Create label key for storage
 */
function labelKey(labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) return ''
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',')
}

/**
 * Counter implementation
 */
class CounterImpl implements Counter {
  private values: Map<string, number> = new Map()
  readonly name: string
  readonly help: string
  readonly labelNames: string[]

  constructor(name: string, options: MetricOptions = {}) {
    this.name = name
    this.help = options.help || ''
    this.labelNames = options.labels || []
  }

  inc(labels?: Labels, value: number = 1): void {
    if (value < 0) {
      throw new Error('Counter can only increase')
    }
    const key = labelKey(labels)
    const current = this.values.get(key) || 0
    this.values.set(key, current + value)
  }

  get(labels?: Labels): number {
    return this.values.get(labelKey(labels)) || 0
  }

  serialize(): string {
    const lines: string[] = []
    if (this.help) {
      lines.push(`# HELP ${this.name} ${this.help}`)
    }
    lines.push(`# TYPE ${this.name} counter`)

    if (this.values.size === 0) {
      lines.push(`${this.name} 0`)
    } else {
      for (const [key, value] of this.values) {
        if (key) {
          lines.push(`${this.name}{${key}} ${value}`)
        } else {
          lines.push(`${this.name} ${value}`)
        }
      }
    }
    return lines.join('\n')
  }

  reset(): void {
    this.values.clear()
  }
}

/**
 * Gauge implementation
 */
class GaugeImpl implements Gauge {
  private values: Map<string, number> = new Map()
  readonly name: string
  readonly help: string
  readonly labelNames: string[]

  constructor(name: string, options: MetricOptions = {}) {
    this.name = name
    this.help = options.help || ''
    this.labelNames = options.labels || []
  }

  set(value: number, labels?: Labels): void {
    this.values.set(labelKey(labels), value)
  }

  inc(labels?: Labels, value: number = 1): void {
    const key = labelKey(labels)
    const current = this.values.get(key) || 0
    this.values.set(key, current + value)
  }

  dec(labels?: Labels, value: number = 1): void {
    const key = labelKey(labels)
    const current = this.values.get(key) || 0
    this.values.set(key, current - value)
  }

  get(labels?: Labels): number {
    return this.values.get(labelKey(labels)) || 0
  }

  serialize(): string {
    const lines: string[] = []
    if (this.help) {
      lines.push(`# HELP ${this.name} ${this.help}`)
    }
    lines.push(`# TYPE ${this.name} gauge`)

    if (this.values.size === 0) {
      lines.push(`${this.name} 0`)
    } else {
      for (const [key, value] of this.values) {
        if (key) {
          lines.push(`${this.name}{${key}} ${value}`)
        } else {
          lines.push(`${this.name} ${value}`)
        }
      }
    }
    return lines.join('\n')
  }

  reset(): void {
    this.values.clear()
  }
}

/**
 * Histogram bucket data
 */
interface HistogramData {
  buckets: Map<number, number>
  sum: number
  count: number
}

/**
 * Histogram implementation
 */
class HistogramImpl implements Histogram {
  private data: Map<string, HistogramData> = new Map()
  readonly name: string
  readonly help: string
  readonly labelNames: string[]
  readonly buckets: number[]

  private static DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

  constructor(name: string, options: HistogramOptions = {}) {
    this.name = name
    this.help = options.help || ''
    this.labelNames = options.labels || []
    this.buckets = (options.buckets || HistogramImpl.DEFAULT_BUCKETS).sort((a, b) => a - b)
  }

  private getOrCreate(key: string): HistogramData {
    let data = this.data.get(key)
    if (!data) {
      data = {
        buckets: new Map(this.buckets.map((b) => [b, 0])),
        sum: 0,
        count: 0,
      }
      this.data.set(key, data)
    }
    return data
  }

  observe(value: number, labels?: Labels): void {
    const key = labelKey(labels)
    const data = this.getOrCreate(key)

    data.sum += value
    data.count++

    for (const bucket of this.buckets) {
      if (value <= bucket) {
        data.buckets.set(bucket, (data.buckets.get(bucket) || 0) + 1)
      }
    }
  }

  startTimer(labels?: Labels): () => void {
    const start = performance.now()
    return () => {
      const duration = (performance.now() - start) / 1000 // Convert to seconds
      this.observe(duration, labels)
    }
  }

  serialize(): string {
    const lines: string[] = []
    if (this.help) {
      lines.push(`# HELP ${this.name} ${this.help}`)
    }
    lines.push(`# TYPE ${this.name} histogram`)

    for (const [key, data] of this.data) {
      const labelPrefix = key ? `${key},` : ''

      // Bucket values (cumulative)
      let cumulative = 0
      for (const bucket of this.buckets) {
        cumulative += data.buckets.get(bucket) || 0
        const bucketLabel = `le="${bucket}"`
        if (key) {
          lines.push(`${this.name}_bucket{${labelPrefix}${bucketLabel}} ${cumulative}`)
        } else {
          lines.push(`${this.name}_bucket{${bucketLabel}} ${cumulative}`)
        }
      }
      // +Inf bucket
      if (key) {
        lines.push(`${this.name}_bucket{${labelPrefix}le="+Inf"} ${data.count}`)
        lines.push(`${this.name}_sum{${key}} ${data.sum}`)
        lines.push(`${this.name}_count{${key}} ${data.count}`)
      } else {
        lines.push(`${this.name}_bucket{le="+Inf"} ${data.count}`)
        lines.push(`${this.name}_sum ${data.sum}`)
        lines.push(`${this.name}_count ${data.count}`)
      }
    }

    // If no data, output zeros
    if (this.data.size === 0) {
      for (const bucket of this.buckets) {
        lines.push(`${this.name}_bucket{le="${bucket}"} 0`)
      }
      lines.push(`${this.name}_bucket{le="+Inf"} 0`)
      lines.push(`${this.name}_sum 0`)
      lines.push(`${this.name}_count 0`)
    }

    return lines.join('\n')
  }

  reset(): void {
    this.data.clear()
  }
}

/**
 * Metrics builder with fluent API
 */
class MetricsBuilder {
  private serviceName: string
  private prefix: string = ''
  private defaultLabels: Labels = {}

  constructor(name: string) {
    this.serviceName = name
  }

  /**
   * Set metric name prefix
   */
  withPrefix(prefix: string): this {
    this.prefix = prefix
    return this
  }

  /**
   * Set default labels for all metrics
   */
  withLabels(labels: Labels): this {
    this.defaultLabels = { ...this.defaultLabels, ...labels }
    return this
  }

  /**
   * Build the metrics instance
   */
  build(): MetricsInstance {
    return new MetricsImpl(this.serviceName, this.prefix, this.defaultLabels)
  }
}

/**
 * Metrics instance implementation
 */
class MetricsImpl implements MetricsInstance {
  readonly name: string
  private prefix: string
  private defaultLabels: Labels
  private counters: Map<string, CounterImpl> = new Map()
  private gauges: Map<string, GaugeImpl> = new Map()
  private histograms: Map<string, HistogramImpl> = new Map()

  constructor(name: string, prefix: string, defaultLabels: Labels) {
    this.name = name
    this.prefix = prefix
    this.defaultLabels = defaultLabels
  }

  private fullName(name: string): string {
    return this.prefix ? `${this.prefix}_${name}` : name
  }

  counter(name: string, options?: MetricOptions): Counter {
    const fullName = this.fullName(name)
    let counter = this.counters.get(fullName)
    if (!counter) {
      counter = new CounterImpl(fullName, options)
      this.counters.set(fullName, counter)
    }
    return counter
  }

  gauge(name: string, options?: MetricOptions): Gauge {
    const fullName = this.fullName(name)
    let gauge = this.gauges.get(fullName)
    if (!gauge) {
      gauge = new GaugeImpl(fullName, options)
      this.gauges.set(fullName, gauge)
    }
    return gauge
  }

  histogram(name: string, options?: HistogramOptions): Histogram {
    const fullName = this.fullName(name)
    let histogram = this.histograms.get(fullName)
    if (!histogram) {
      histogram = new HistogramImpl(fullName, options)
      this.histograms.set(fullName, histogram)
    }
    return histogram
  }

  serialize(): string {
    const sections: string[] = []

    for (const counter of this.counters.values()) {
      sections.push(counter.serialize())
    }
    for (const gauge of this.gauges.values()) {
      sections.push(gauge.serialize())
    }
    for (const histogram of this.histograms.values()) {
      sections.push(histogram.serialize())
    }

    return sections.join('\n\n') + '\n'
  }

  reset(): void {
    for (const counter of this.counters.values()) {
      counter.reset()
    }
    for (const gauge of this.gauges.values()) {
      gauge.reset()
    }
    for (const histogram of this.histograms.values()) {
      histogram.reset()
    }
  }

  handler(): (req: Request) => Response {
    return () => {
      return new Response(this.serialize(), {
        headers: {
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        },
      })
    }
  }
}

/**
 * Global metrics instance
 */
let globalMetrics: MetricsInstance | null = null

/**
 * Metrics entry point
 */
export const Metrics = {
  /**
   * Create a new metrics builder
   */
  create(name: string): MetricsBuilder {
    return new MetricsBuilder(name)
  },

  /**
   * Set global metrics instance
   */
  setGlobal(metrics: MetricsInstance): void {
    globalMetrics = metrics
  },

  /**
   * Get global metrics instance
   */
  getGlobal(): MetricsInstance | null {
    return globalMetrics
  },

  /**
   * Get or create a counter on global metrics
   */
  counter(name: string, options?: MetricOptions): Counter {
    if (!globalMetrics) {
      throw new Error('No global metrics instance. Call Metrics.setGlobal() first.')
    }
    return globalMetrics.counter(name, options)
  },

  /**
   * Get or create a gauge on global metrics
   */
  gauge(name: string, options?: MetricOptions): Gauge {
    if (!globalMetrics) {
      throw new Error('No global metrics instance. Call Metrics.setGlobal() first.')
    }
    return globalMetrics.gauge(name, options)
  },

  /**
   * Get or create a histogram on global metrics
   */
  histogram(name: string, options?: HistogramOptions): Histogram {
    if (!globalMetrics) {
      throw new Error('No global metrics instance. Call Metrics.setGlobal() first.')
    }
    return globalMetrics.histogram(name, options)
  },
}

export type { MetricsBuilder }
