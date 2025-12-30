/**
 * Cron - Scheduled Jobs with PostgreSQL Persistence
 *
 * Provides reliable scheduled job execution backed by PostgreSQL.
 * Supports cron expressions, catch-up execution, and distributed locking.
 *
 * @example
 * ```typescript
 * const dailyReport = Cron
 *   .create('daily-report')
 *   .schedule('0 9 * * *')      // Every day at 9 AM
 *   .db(postgres)
 *   .timezone('America/New_York')
 *   .catchUp(true)              // Run missed executions
 *   .trace()
 *   .handler(async (ctx) => {
 *     const data = await ctx.db.query('SELECT * FROM orders WHERE date = CURRENT_DATE')
 *     await sendReport(data)
 *     return { sent: true, count: data.length }
 *   })
 *   .build()
 *
 * // Start scheduler
 * dailyReport.start()
 *
 * // Manual trigger
 * await dailyReport.trigger()
 *
 * // Get execution history
 * const history = await dailyReport.history({ limit: 10 })
 * ```
 */

import type {
  CronContext,
  CronHandler,
  CronInstance,
  CronExecution,
  CronExecutionStatus,
  CronHistoryOptions,
  DBInstance,
  DBContext,
  FlowInstance,
  WorkflowInstance,
} from './types'
import { registerPrimitive } from './manifest'

// ============================================================================
// PostgreSQL Schema Setup
// ============================================================================

const CRON_SCHEMA = `
-- Cron jobs registry
CREATE TABLE IF NOT EXISTS _onepipe_cron_jobs (
  job_name TEXT PRIMARY KEY,
  schedule TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  catch_up BOOLEAN NOT NULL DEFAULT false,
  max_catch_up INTEGER NOT NULL DEFAULT 10,
  last_scheduled_time TIMESTAMPTZ,
  next_scheduled_time TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cron execution history
CREATE TABLE IF NOT EXISTS _onepipe_cron_executions (
  execution_id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL REFERENCES _onepipe_cron_jobs(job_name) ON DELETE CASCADE,
  scheduled_time TIMESTAMPTZ NOT NULL,
  actual_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  output JSONB,
  error TEXT,
  duration_ms INTEGER,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_name, scheduled_time)
);

CREATE INDEX IF NOT EXISTS idx_cron_executions_job ON _onepipe_cron_executions(job_name, scheduled_time DESC);
CREATE INDEX IF NOT EXISTS idx_cron_executions_status ON _onepipe_cron_executions(status) WHERE status IN ('pending', 'running');

-- Lock table for distributed cron (leader election)
CREATE TABLE IF NOT EXISTS _onepipe_cron_locks (
  job_name TEXT PRIMARY KEY,
  locked_by TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
`

// ============================================================================
// Simple Cron Parser (no external dependency)
// ============================================================================

interface CronParts {
  minute: number[]
  hour: number[]
  dayOfMonth: number[]
  month: number[]
  dayOfWeek: number[]
}

function parseCronExpression(expression: string): CronParts {
  const parts = expression.trim().split(/\s+/)

  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${expression} (expected 5 parts)`)
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  }
}

function parseField(field: string, min: number, max: number): number[] {
  const values: number[] = []

  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.push(i)
    } else if (part.includes('/')) {
      const [range, step] = part.split('/')
      const stepNum = parseInt(step, 10)
      const [start, end] = range === '*' ? [min, max] : range.split('-').map(n => parseInt(n, 10))
      for (let i = start; i <= (end || max); i += stepNum) values.push(i)
    } else if (part.includes('-')) {
      const [start, end] = part.split('-').map(n => parseInt(n, 10))
      for (let i = start; i <= end; i++) values.push(i)
    } else {
      values.push(parseInt(part, 10))
    }
  }

  return [...new Set(values)].filter(v => v >= min && v <= max).sort((a, b) => a - b)
}

function getNextCronTime(cron: CronParts, after: Date, timezone: string): Date {
  // Simple implementation - iterate minute by minute until match
  const date = new Date(after.getTime())
  date.setSeconds(0, 0)
  date.setMinutes(date.getMinutes() + 1) // Start from next minute

  // Max iterations to prevent infinite loop (1 year worth of minutes)
  const maxIterations = 525600

  for (let i = 0; i < maxIterations; i++) {
    const minute = date.getMinutes()
    const hour = date.getHours()
    const dayOfMonth = date.getDate()
    const month = date.getMonth() + 1
    const dayOfWeek = date.getDay()

    if (
      cron.minute.includes(minute) &&
      cron.hour.includes(hour) &&
      cron.dayOfMonth.includes(dayOfMonth) &&
      cron.month.includes(month) &&
      cron.dayOfWeek.includes(dayOfWeek)
    ) {
      return date
    }

    date.setMinutes(date.getMinutes() + 1)
  }

  throw new Error('Could not find next cron time within 1 year')
}

function getPreviousCronTime(cron: CronParts, before: Date, timezone: string): Date {
  const date = new Date(before.getTime())
  date.setSeconds(0, 0)

  // Max iterations
  const maxIterations = 525600

  for (let i = 0; i < maxIterations; i++) {
    date.setMinutes(date.getMinutes() - 1)

    const minute = date.getMinutes()
    const hour = date.getHours()
    const dayOfMonth = date.getDate()
    const month = date.getMonth() + 1
    const dayOfWeek = date.getDay()

    if (
      cron.minute.includes(minute) &&
      cron.hour.includes(hour) &&
      cron.dayOfMonth.includes(dayOfMonth) &&
      cron.month.includes(month) &&
      cron.dayOfWeek.includes(dayOfWeek)
    ) {
      return date
    }
  }

  throw new Error('Could not find previous cron time within 1 year')
}

// ============================================================================
// Builder State
// ============================================================================

interface CronBuilderState<TOutput> {
  name: string
  schedule?: string
  timezone: string
  catchUp: boolean
  maxCatchUp: number
  trace: boolean
  db?: DBInstance
  handler?: CronHandler<TOutput>
  workflow?: {
    instance: WorkflowInstance<unknown, unknown>
    inputFn?: (ctx: CronContext) => unknown
  }
}

// ============================================================================
// Cron Builder
// ============================================================================

/**
 * Cron Builder - Fluent API for creating scheduled jobs
 */
class CronBuilder<TOutput = void> {
  private state: CronBuilderState<TOutput>

  private constructor(name: string) {
    this.state = {
      name,
      timezone: 'UTC',
      catchUp: false,
      maxCatchUp: 10,
      trace: false,
    }
  }

  /**
   * Create a new Cron builder
   */
  static create(name: string): CronBuilder<void> {
    return new CronBuilder(name)
  }

  /**
   * Set cron schedule expression
   * Examples:
   * - '* * * * *'     - Every minute
   * - '0 * * * *'     - Every hour
   * - '0 9 * * *'     - Every day at 9 AM
   * - '0 9 * * 1'     - Every Monday at 9 AM
   * - '0 0 1 * *'     - First day of every month
   * - '0/15 * * * *'  - Every 15 minutes
   */
  schedule(expression: string): this {
    // Validate expression
    parseCronExpression(expression)
    this.state.schedule = expression
    return this
  }

  /**
   * Set timezone for schedule (default: UTC)
   */
  timezone(tz: string): this {
    this.state.timezone = tz
    return this
  }

  /**
   * Enable catch-up mode for missed executions
   */
  catchUp(enabled: boolean): this {
    this.state.catchUp = enabled
    return this
  }

  /**
   * Set maximum number of catch-up executions (default: 10)
   */
  maxCatchUp(count: number): this {
    this.state.maxCatchUp = count
    return this
  }

  /**
   * Inject PostgreSQL database (required for persistence)
   */
  db(instance: DBInstance): this {
    if (instance.type !== 'postgres') {
      throw new Error('Cron requires PostgreSQL database')
    }
    this.state.db = instance
    return this
  }

  /**
   * Enable distributed tracing
   */
  trace(): this {
    this.state.trace = true
    return this
  }

  /**
   * Set handler function
   */
  handler<T>(fn: CronHandler<T>): CronBuilder<T> {
    const builder = this as unknown as CronBuilder<T>
    builder.state.handler = fn
    return builder
  }

  /**
   * Trigger a workflow instead of a handler
   */
  workflow<I, O>(
    workflowInstance: WorkflowInstance<I, O>,
    inputFn?: (ctx: CronContext) => I
  ): CronBuilder<O> {
    const builder = this as unknown as CronBuilder<O>
    builder.state.workflow = {
      instance: workflowInstance as WorkflowInstance<unknown, unknown>,
      inputFn: inputFn as ((ctx: CronContext) => unknown) | undefined,
    }
    return builder
  }

  /**
   * Build the Cron instance
   */
  build(): CronInstance<TOutput> {
    if (!this.state.schedule) {
      throw new Error(`Cron "${this.state.name}" requires a schedule (use .schedule())`)
    }
    if (!this.state.db) {
      throw new Error(`Cron "${this.state.name}" requires a PostgreSQL database (use .db())`)
    }
    if (!this.state.handler && !this.state.workflow) {
      throw new Error(`Cron "${this.state.name}" requires either a handler or workflow`)
    }

    // Register with manifest for CLI auto-discovery
    registerPrimitive({
      primitive: 'cron',
      name: this.state.name,
      infrastructure: 'postgresql',
      config: { schedule: this.state.schedule },
    })

    return new CronInstanceImpl<TOutput>(this.state)
  }
}

// ============================================================================
// Cron Context Implementation
// ============================================================================

class CronContextImpl implements CronContext {
  readonly jobName: string
  readonly scheduledTime: Date
  readonly actualTime: Date
  readonly executionId: string
  readonly db: DBContext

  private dbInstance: DBInstance

  constructor(
    jobName: string,
    scheduledTime: Date,
    actualTime: Date,
    executionId: string,
    db: DBInstance
  ) {
    this.jobName = jobName
    this.scheduledTime = scheduledTime
    this.actualTime = actualTime
    this.executionId = executionId
    this.dbInstance = db
    this.db = db
  }

  async emit<T>(flow: FlowInstance<T>, data: T): Promise<void> {
    await flow.append(data)
  }
}

// ============================================================================
// Cron Instance Implementation
// ============================================================================

class CronInstanceImpl<TOutput> implements CronInstance<TOutput> {
  readonly name: string
  readonly schedule: string
  private timezone: string
  private catchUp: boolean
  private maxCatchUp: number
  private traceEnabled: boolean
  private db: DBInstance
  private handler?: CronHandler<TOutput>
  private workflow?: {
    instance: WorkflowInstance<unknown, unknown>
    inputFn?: (ctx: CronContext) => unknown
  }

  private running = false
  private intervalId?: ReturnType<typeof setInterval>
  private instanceId = crypto.randomUUID()
  private schemaInitialized = false
  private cronParts: CronParts

  constructor(state: CronBuilderState<TOutput>) {
    this.name = state.name
    this.schedule = state.schedule!
    this.timezone = state.timezone
    this.catchUp = state.catchUp
    this.maxCatchUp = state.maxCatchUp
    this.traceEnabled = state.trace
    this.db = state.db!
    this.handler = state.handler
    this.workflow = state.workflow
    this.cronParts = parseCronExpression(this.schedule)

    // Register with dashboard
    this.registerWithDashboard()
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      await this.db.query(CRON_SCHEMA, [])
      this.schemaInitialized = true
    } catch (error) {
      if (this.traceEnabled) {
        console.debug(`[Cron:${this.name}] Schema initialization:`, error)
      }
      this.schemaInitialized = true
    }
  }

  start(): void {
    if (this.running) return
    this.running = true

    if (this.traceEnabled) {
      console.debug(`[Cron:${this.name}] Starting scheduler (schedule: ${this.schedule})`)
    }

    // Initialize and start polling
    this.initialize().then(() => {
      this.intervalId = setInterval(() => this.tick(), 1000)
    })
  }

  stop(): void {
    if (!this.running) return
    this.running = false

    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }

    if (this.traceEnabled) {
      console.debug(`[Cron:${this.name}] Stopped scheduler`)
    }
  }

  async trigger(): Promise<CronExecution<TOutput>> {
    // Initialize to ensure job is registered (required for FK constraint)
    await this.initialize()

    const scheduledTime = new Date()
    const executionId = `${this.name}_manual_${crypto.randomUUID()}`

    return this.executeJob(scheduledTime, executionId)
  }

  async history(options?: CronHistoryOptions): Promise<CronExecution<TOutput>[]> {
    await this.ensureSchema()

    let query = `
      SELECT execution_id, job_name, scheduled_time, actual_time, status, output, error, duration_ms
      FROM _onepipe_cron_executions
      WHERE job_name = $1
    `
    const params: unknown[] = [this.name]

    if (options?.since) {
      query += ` AND scheduled_time >= $${params.length + 1}`
      params.push(options.since)
    }

    query += ` ORDER BY scheduled_time DESC`

    if (options?.limit) {
      query += ` LIMIT $${params.length + 1}`
      params.push(options.limit)
    }

    const executions = await this.db.query<{
      execution_id: string
      job_name: string
      scheduled_time: Date
      actual_time: Date
      status: CronExecutionStatus
      output: string | null
      error: string | null
      duration_ms: number | null
    }>(query, params)

    return executions.map(e => ({
      executionId: e.execution_id,
      jobName: e.job_name,
      scheduledTime: e.scheduled_time,
      actualTime: e.actual_time,
      status: e.status,
      output: e.output ? JSON.parse(e.output) : undefined,
      error: e.error || undefined,
      durationMs: e.duration_ms || undefined,
    }))
  }

  nextRun(): Date | null {
    if (!this.running) return null

    try {
      return getNextCronTime(this.cronParts, new Date(), this.timezone)
    } catch {
      return null
    }
  }

  isRunning(): boolean {
    return this.running
  }

  private async initialize(): Promise<void> {
    await this.ensureSchema()

    // Register or update job
    const nextTime = getNextCronTime(this.cronParts, new Date(), this.timezone)

    await this.db.query(
      `INSERT INTO _onepipe_cron_jobs (job_name, schedule, timezone, catch_up, max_catch_up, next_scheduled_time)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (job_name) DO UPDATE
       SET schedule = $2, timezone = $3, catch_up = $4, max_catch_up = $5, next_scheduled_time = $6, updated_at = NOW()`,
      [this.name, this.schedule, this.timezone, this.catchUp, this.maxCatchUp, nextTime]
    )

    // Run catch-up if enabled
    if (this.catchUp) {
      await this.runCatchUp()
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return

    try {
      // Try to acquire lock
      const locked = await this.tryLock()
      if (!locked) return

      try {
        const now = new Date()

        // Get job info
        const jobs = await this.db.query<{
          next_scheduled_time: Date | null
          last_scheduled_time: Date | null
        }>(
          `SELECT next_scheduled_time, last_scheduled_time FROM _onepipe_cron_jobs WHERE job_name = $1`,
          [this.name]
        )

        if (jobs.length === 0) return

        const job = jobs[0]
        const nextScheduled = job.next_scheduled_time

        if (nextScheduled && nextScheduled <= now) {
          // Check idempotency
          const exists = await this.db.query(
            `SELECT 1 FROM _onepipe_cron_executions WHERE job_name = $1 AND scheduled_time = $2`,
            [this.name, nextScheduled]
          )

          if (exists.length === 0) {
            const executionId = `${this.name}_${nextScheduled.getTime()}`
            await this.executeJob(nextScheduled, executionId)
          }

          // Update next scheduled time
          const nextNextTime = getNextCronTime(this.cronParts, nextScheduled, this.timezone)
          await this.db.query(
            `UPDATE _onepipe_cron_jobs
             SET last_scheduled_time = $2, next_scheduled_time = $3, updated_at = NOW()
             WHERE job_name = $1`,
            [this.name, nextScheduled, nextNextTime]
          )
        }
      } finally {
        await this.releaseLock()
      }
    } catch (error) {
      if (this.traceEnabled) {
        console.error(`[Cron:${this.name}] Tick error:`, error)
      }
    }
  }

  private async runCatchUp(): Promise<void> {
    const now = new Date()

    // Get last scheduled time
    const jobs = await this.db.query<{ last_scheduled_time: Date | null }>(
      `SELECT last_scheduled_time FROM _onepipe_cron_jobs WHERE job_name = $1`,
      [this.name]
    )

    if (jobs.length === 0 || !jobs[0].last_scheduled_time) return

    const lastScheduled = jobs[0].last_scheduled_time
    let catchUpCount = 0

    // Find missed executions
    let checkTime = lastScheduled

    while (catchUpCount < this.maxCatchUp) {
      try {
        const nextTime = getNextCronTime(this.cronParts, checkTime, this.timezone)

        if (nextTime >= now) break

        // Check if already executed
        const exists = await this.db.query(
          `SELECT 1 FROM _onepipe_cron_executions WHERE job_name = $1 AND scheduled_time = $2`,
          [this.name, nextTime]
        )

        if (exists.length === 0) {
          if (this.traceEnabled) {
            console.debug(`[Cron:${this.name}] Catching up missed execution at ${nextTime.toISOString()}`)
          }

          const executionId = `${this.name}_catchup_${nextTime.getTime()}`
          await this.executeJob(nextTime, executionId)
          catchUpCount++
        }

        checkTime = nextTime
      } catch {
        break
      }
    }

    if (catchUpCount > 0 && this.traceEnabled) {
      console.debug(`[Cron:${this.name}] Caught up ${catchUpCount} missed executions`)
    }
  }

  private async executeJob(scheduledTime: Date, executionId: string): Promise<CronExecution<TOutput>> {
    const actualTime = new Date()
    const startTime = Date.now()

    // Record execution start
    await this.db.query(
      `INSERT INTO _onepipe_cron_executions (execution_id, job_name, scheduled_time, actual_time, status)
       VALUES ($1, $2, $3, $4, 'running')
       ON CONFLICT (job_name, scheduled_time) DO NOTHING`,
      [executionId, this.name, scheduledTime, actualTime]
    )

    const ctx = new CronContextImpl(
      this.name,
      scheduledTime,
      actualTime,
      executionId,
      this.db
    )

    let output: TOutput | undefined
    let error: string | undefined
    let status: CronExecutionStatus = 'completed'

    // Start heartbeat to renew lock during long-running jobs
    const heartbeatInterval = setInterval(async () => {
      try {
        await this.renewLock()
        if (this.traceEnabled) {
          console.debug(`[Cron:${this.name}] Lock renewed for execution ${executionId}`)
        }
      } catch (err) {
        console.error(`[Cron:${this.name}] Failed to renew lock:`, err)
      }
    }, 10_000) // Renew every 10 seconds

    try {
      if (this.traceEnabled) {
        console.debug(`[Cron:${this.name}] Executing job (scheduled: ${scheduledTime.toISOString()})`)
      }

      if (this.workflow) {
        // Trigger workflow
        const input = this.workflow.inputFn
          ? this.workflow.inputFn(ctx)
          : { scheduledTime, actualTime, executionId }

        const handle = await this.workflow.instance.start(input, {
          workflowId: `cron_${executionId}`,
        })

        output = await handle.result() as TOutput
      } else if (this.handler) {
        // Execute handler
        output = await this.handler(ctx)
      }

      if (this.traceEnabled) {
        console.debug(`[Cron:${this.name}] Job completed successfully`)
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      status = 'failed'

      if (this.traceEnabled) {
        console.error(`[Cron:${this.name}] Job failed:`, err)
      }
    } finally {
      // Stop heartbeat
      clearInterval(heartbeatInterval)
    }

    const durationMs = Date.now() - startTime

    // Update execution record
    await this.db.query(
      `UPDATE _onepipe_cron_executions
       SET status = $2, output = $3, error = $4, duration_ms = $5, completed_at = NOW()
       WHERE execution_id = $1`,
      [executionId, status, output ? JSON.stringify(output) : null, error || null, durationMs]
    )

    return {
      executionId,
      jobName: this.name,
      scheduledTime,
      actualTime,
      status,
      output,
      error,
      durationMs,
    }
  }

  /**
   * Renew the lock for long-running jobs
   */
  private async renewLock(): Promise<void> {
    await this.db.query(
      `UPDATE _onepipe_cron_locks
       SET expires_at = NOW() + INTERVAL '30 seconds', locked_at = NOW()
       WHERE job_name = $1 AND locked_by = $2`,
      [this.name, this.instanceId],
      { trace: false }
    )
  }

  private async tryLock(): Promise<boolean> {
    try {
      const result = await this.db.query(
        `INSERT INTO _onepipe_cron_locks (job_name, locked_by, locked_at, expires_at)
         VALUES ($1, $2, NOW(), NOW() + INTERVAL '30 seconds')
         ON CONFLICT (job_name) DO UPDATE
         SET locked_by = $2, locked_at = NOW(), expires_at = NOW() + INTERVAL '30 seconds'
         WHERE _onepipe_cron_locks.expires_at < NOW()
           OR _onepipe_cron_locks.locked_by = $2
         RETURNING 1`,
        [this.name, this.instanceId],
        { trace: false }  // Don't trace internal lock operations
      )
      return result.length > 0
    } catch {
      return false
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      await this.db.query(
        `DELETE FROM _onepipe_cron_locks WHERE job_name = $1 AND locked_by = $2`,
        [this.name, this.instanceId],
        { trace: false }  // Don't trace internal lock operations
      )
    } catch {
      // Ignore errors
    }
  }

  private async registerWithDashboard(): Promise<void> {
    const dashboardUrl = process.env.ONEPIPE_DASHBOARD_URL || 'http://localhost:4001'

    try {
      await fetch(`${dashboardUrl}/api/dashboard/cron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.name,
          schedule: this.schedule,
          timezone: this.timezone,
          type: 'cron',
        }),
      })
    } catch {
      // Dashboard not running, that's fine
    }
  }
}

// ============================================================================
// Export
// ============================================================================

/**
 * Create a new Cron job
 */
export const Cron = {
  create: CronBuilder.create,
}

export type { CronBuilder, CronInstance, CronContext }
