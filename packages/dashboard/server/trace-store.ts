/**
 * SQLite-based Trace Storage
 *
 * Persistent storage for traces using Bun's built-in SQLite.
 * Replaces the in-memory RingBuffer for production use.
 */

import { Database } from 'bun:sqlite'
import { mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import type { TraceData, SpanData, TraceFilterParams, TraceStats } from './collector'

export class TraceStore {
  private db: Database

  constructor(dbPath = '.onepipe/traces.db') {
    // Ensure directory exists
    const dir = dirname(dbPath)
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.init()
  }

  private init(): void {
    // Create traces table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        data TEXT NOT NULL,
        status TEXT NOT NULL,
        duration REAL NOT NULL,
        timestamp INTEGER NOT NULL,
        services TEXT,
        span_count INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `)

    // Create indexes for common queries
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_traces_timestamp ON traces(timestamp DESC)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_traces_status ON traces(status)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_traces_duration ON traces(duration)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_traces_services ON traces(services)`)
  }

  /**
   * Add a trace to the store (merges spans if trace already exists)
   */
  addTrace(trace: TraceData): void {
    // Check if trace with this traceId already exists
    const existing = this.getTrace(trace.traceId)

    if (existing) {
      // MERGE: Combine spans from both traces
      const mergedSpans = this.mergeSpans(existing.spans, trace.spans)

      // Find true root span (span without parentSpanId)
      const rootSpan = mergedSpans.find(s => !s.parentSpanId) || mergedSpans[0]

      // Collect all unique services
      const allServices = [...new Set([
        ...(existing.services || []),
        ...(trace.services || [])
      ])]

      // Create merged trace
      const mergedTrace: TraceData = {
        traceId: trace.traceId,
        rootSpan,
        spans: mergedSpans,
        totalDuration: rootSpan.duration,
        status: mergedSpans.some(s => s.status === 'error') ? 'error' : 'ok',
        timestamp: Math.min(existing.timestamp, trace.timestamp),
        services: allServices,
        spanCount: mergedSpans.length,
      }

      // Update in DB
      this.updateTrace(mergedTrace)
    } else {
      // INSERT: New trace
      this.insertTrace(trace)
    }

    // Cleanup old traces (keep last 10,000)
    this.cleanup()
  }

  /**
   * Merge spans from two traces, deduplicating by spanId
   */
  private mergeSpans(existing: SpanData[], incoming: SpanData[]): SpanData[] {
    const spanMap = new Map<string, SpanData>()

    // Add existing spans
    for (const span of existing) {
      spanMap.set(span.spanId, span)
    }

    // Add incoming spans (overwrites if duplicate spanId)
    for (const span of incoming) {
      spanMap.set(span.spanId, span)
    }

    // Return sorted by start time
    return Array.from(spanMap.values()).sort((a, b) => a.startTime - b.startTime)
  }

  /**
   * Insert a new trace
   */
  private insertTrace(trace: TraceData): void {
    const stmt = this.db.prepare(`
      INSERT INTO traces (id, trace_id, data, status, duration, timestamp, services, span_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      trace.traceId,
      trace.traceId,
      JSON.stringify(trace),
      trace.status,
      trace.totalDuration,
      trace.timestamp,
      JSON.stringify(trace.services || []),
      trace.spanCount || trace.spans.length
    )
  }

  /**
   * Update an existing trace
   */
  private updateTrace(trace: TraceData): void {
    const stmt = this.db.prepare(`
      UPDATE traces
      SET data = ?, status = ?, duration = ?, timestamp = ?, services = ?, span_count = ?
      WHERE trace_id = ?
    `)

    stmt.run(
      JSON.stringify(trace),
      trace.status,
      trace.totalDuration,
      trace.timestamp,
      JSON.stringify(trace.services || []),
      trace.spanCount || trace.spans.length,
      trace.traceId
    )
  }

  /**
   * Remove old traces beyond the limit
   */
  private cleanup(): void {
    const count = this.db.query('SELECT COUNT(*) as count FROM traces').get() as { count: number }
    if (count.count > 10000) {
      this.db.run(`
        DELETE FROM traces WHERE id IN (
          SELECT id FROM traces ORDER BY timestamp ASC LIMIT ?
        )
      `, [count.count - 10000])
    }
  }

  /**
   * Get traces with filtering and pagination
   */
  getTraces(params: TraceFilterParams): { traces: TraceData[]; total: number; hasMore: boolean } {
    const conditions: string[] = ['1=1']
    const args: (string | number)[] = []

    if (params.status && params.status !== 'all') {
      conditions.push('status = ?')
      args.push(params.status)
    }

    if (params.minDuration !== undefined && params.minDuration !== null) {
      conditions.push('duration >= ?')
      args.push(params.minDuration)
    }

    if (params.maxDuration !== undefined && params.maxDuration !== null) {
      conditions.push('duration <= ?')
      args.push(params.maxDuration)
    }

    if (params.startTime !== undefined && params.startTime !== null) {
      conditions.push('timestamp >= ?')
      args.push(params.startTime)
    }

    if (params.endTime !== undefined && params.endTime !== null) {
      conditions.push('timestamp <= ?')
      args.push(params.endTime)
    }

    if (params.search) {
      conditions.push('data LIKE ?')
      args.push(`%${params.search}%`)
    }

    if (params.services && params.services.length > 0) {
      const serviceClauses = params.services.map(() => 'services LIKE ?')
      conditions.push(`(${serviceClauses.join(' OR ')})`)
      for (const service of params.services) {
        args.push(`%"${service}"%`)
      }
    }

    const whereClause = conditions.join(' AND ')

    // Get total count
    const totalResult = this.db.query(`SELECT COUNT(*) as count FROM traces WHERE ${whereClause}`).get(...args) as { count: number }

    // Get paginated results
    const orderBy = params.sortBy === 'duration' ? 'duration' : 'timestamp'
    const orderDir = params.sortOrder === 'asc' ? 'ASC' : 'DESC'

    const rows = this.db.query(`
      SELECT data FROM traces
      WHERE ${whereClause}
      ORDER BY ${orderBy} ${orderDir}
      LIMIT ? OFFSET ?
    `).all(...args, params.limit, params.offset) as { data: string }[]

    return {
      traces: rows.map(r => JSON.parse(r.data) as TraceData),
      total: totalResult.count,
      hasMore: totalResult.count > params.offset + params.limit,
    }
  }

  /**
   * Get a single trace by ID
   */
  getTrace(traceId: string): TraceData | null {
    const row = this.db.query('SELECT data FROM traces WHERE trace_id = ?').get(traceId) as { data: string } | null
    return row ? JSON.parse(row.data) : null
  }

  /**
   * Get trace statistics
   */
  getStats(startTime?: number | null, endTime?: number | null): TraceStats {
    const conditions: string[] = ['1=1']
    const args: number[] = []

    if (startTime !== undefined && startTime !== null) {
      conditions.push('timestamp >= ?')
      args.push(startTime)
    }

    if (endTime !== undefined && endTime !== null) {
      conditions.push('timestamp <= ?')
      args.push(endTime)
    }

    const whereClause = conditions.join(' AND ')

    // Basic stats
    const stats = this.db.query(`
      SELECT
        COUNT(*) as totalCount,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errorCount,
        AVG(duration) as avgDuration
      FROM traces WHERE ${whereClause}
    `).get(...args) as { totalCount: number; errorCount: number; avgDuration: number }

    // Get all durations for percentile calculation
    const durations = this.db.query(`
      SELECT duration FROM traces WHERE ${whereClause} ORDER BY duration
    `).all(...args) as { duration: number }[]

    const p50 = this.percentile(durations.map(d => d.duration), 0.5)
    const p95 = this.percentile(durations.map(d => d.duration), 0.95)
    const p99 = this.percentile(durations.map(d => d.duration), 0.99)

    // Service stats
    const serviceStats = this.getServiceStats(whereClause, args)

    // Duration histogram
    const histogram = this.getDurationHistogram(whereClause, args)

    return {
      totalCount: stats.totalCount || 0,
      errorCount: stats.errorCount || 0,
      avgDuration: stats.avgDuration || 0,
      p50Duration: p50,
      p95Duration: p95,
      p99Duration: p99,
      services: serviceStats,
      errorsByType: {},
      durationHistogram: histogram,
    }
  }

  /**
   * Get list of available services
   */
  getServices(): Array<{ name: string; requestCount: number; errorCount: number }> {
    // Get all unique services from traces
    const rows = this.db.query(`
      SELECT services, status FROM traces
    `).all() as { services: string; status: string }[]

    const serviceMap = new Map<string, { requestCount: number; errorCount: number }>()

    for (const row of rows) {
      try {
        const services = JSON.parse(row.services) as string[]
        for (const service of services) {
          const existing = serviceMap.get(service) || { requestCount: 0, errorCount: 0 }
          existing.requestCount++
          if (row.status === 'error') {
            existing.errorCount++
          }
          serviceMap.set(service, existing)
        }
      } catch {
        // Skip invalid JSON
      }
    }

    return Array.from(serviceMap.entries()).map(([name, stats]) => ({
      name,
      ...stats,
    }))
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0
    const index = Math.floor(sortedValues.length * p)
    return sortedValues[Math.min(index, sortedValues.length - 1)]
  }

  /**
   * Get service-level statistics
   */
  private getServiceStats(whereClause: string, args: number[]): Array<{
    name: string
    requestCount: number
    errorCount: number
    avgDuration: number
  }> {
    const rows = this.db.query(`
      SELECT services, status, duration FROM traces WHERE ${whereClause}
    `).all(...args) as { services: string; status: string; duration: number }[]

    const serviceMap = new Map<string, { requestCount: number; errorCount: number; totalDuration: number }>()

    for (const row of rows) {
      try {
        const services = JSON.parse(row.services) as string[]
        for (const service of services) {
          const existing = serviceMap.get(service) || { requestCount: 0, errorCount: 0, totalDuration: 0 }
          existing.requestCount++
          existing.totalDuration += row.duration
          if (row.status === 'error') {
            existing.errorCount++
          }
          serviceMap.set(service, existing)
        }
      } catch {
        // Skip invalid JSON
      }
    }

    return Array.from(serviceMap.entries()).map(([name, stats]) => ({
      name,
      requestCount: stats.requestCount,
      errorCount: stats.errorCount,
      avgDuration: stats.totalDuration / stats.requestCount,
    }))
  }

  /**
   * Generate duration histogram buckets
   */
  private getDurationHistogram(whereClause: string, args: number[]): Array<{ bucket: string; count: number }> {
    // Define buckets: 0-10ms, 10-50ms, 50-100ms, 100-250ms, 250-500ms, 500ms-1s, 1-5s, 5s+
    const buckets = [
      { name: '0-10ms', min: 0, max: 10 },
      { name: '10-50ms', min: 10, max: 50 },
      { name: '50-100ms', min: 50, max: 100 },
      { name: '100-250ms', min: 100, max: 250 },
      { name: '250-500ms', min: 250, max: 500 },
      { name: '500ms-1s', min: 500, max: 1000 },
      { name: '1-5s', min: 1000, max: 5000 },
      { name: '5s+', min: 5000, max: Infinity },
    ]

    const result: Array<{ bucket: string; count: number }> = []

    for (const bucket of buckets) {
      let query = `SELECT COUNT(*) as count FROM traces WHERE ${whereClause} AND duration >= ?`
      const queryArgs = [...args, bucket.min]

      if (bucket.max !== Infinity) {
        query += ' AND duration < ?'
        queryArgs.push(bucket.max)
      }

      const row = this.db.query(query).get(...queryArgs) as { count: number }
      result.push({ bucket: bucket.name, count: row.count })
    }

    return result
  }

  /**
   * Clear all traces
   */
  clear(): void {
    this.db.run('DELETE FROM traces')
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close()
  }
}
