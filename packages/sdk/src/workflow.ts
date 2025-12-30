/**
 * Workflow - Durable Execution with PostgreSQL Persistence
 *
 * Provides DBOS-inspired durable workflows that survive process restarts.
 * All state is persisted to PostgreSQL, enabling automatic recovery.
 *
 * @example
 * ```typescript
 * const orderWorkflow = Workflow
 *   .create('process-order')
 *   .input(z.object({ orderId: z.string(), items: z.array(z.string()) }))
 *   .db(postgres)
 *   .timeout('30m')
 *   .trace()
 *   .define(async (ctx, input) => {
 *     // Step 1: Reserve inventory (executed at most once)
 *     const reserved = await ctx.step('reserve-inventory', async () => {
 *       return inventoryService.reserve(input.items)
 *     })
 *
 *     // Step 2: Charge payment
 *     const payment = await ctx.step('charge-payment', async () => {
 *       return paymentService.charge(input.orderId, reserved.total)
 *     })
 *
 *     // Durable sleep (survives restarts)
 *     await ctx.sleep('5m')
 *
 *     return { orderId: input.orderId, status: 'completed' }
 *   })
 *   .build()
 *
 * // Start workflow with idempotency key
 * const handle = await orderWorkflow.start(
 *   { orderId: '123', items: ['item1'] },
 *   { workflowId: 'order-123' }
 * )
 *
 * // Wait for result
 * const result = await handle.result()
 * ```
 */

import type { z } from 'zod'
import type {
  WorkflowContext,
  WorkflowInstance,
  WorkflowHandle,
  WorkflowExecution,
  WorkflowStatus,
  WorkflowFunction,
  StepExecution,
  StepOptions,
  StartOptions,
  ListWorkflowOptions,
  RetryOptions,
  DBInstance,
  DBContext,
  FlowInstance,
} from './types'
import { registerPrimitive } from './manifest'

// ============================================================================
// PostgreSQL Schema Setup
// ============================================================================

const WORKFLOW_SCHEMA = `
-- Workflow executions table
CREATE TABLE IF NOT EXISTS _onepipe_workflows (
  workflow_id TEXT PRIMARY KEY,
  workflow_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input JSONB NOT NULL,
  output JSONB,
  error TEXT,
  timeout_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflows_name_status ON _onepipe_workflows(workflow_name, status);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON _onepipe_workflows(status) WHERE status IN ('pending', 'running');

-- Workflow steps table
CREATE TABLE IF NOT EXISTS _onepipe_workflow_steps (
  id SERIAL PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES _onepipe_workflows(workflow_id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  output JSONB,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(workflow_id, step_name)
);

CREATE INDEX IF NOT EXISTS idx_steps_workflow ON _onepipe_workflow_steps(workflow_id);

-- Workflow signals table
CREATE TABLE IF NOT EXISTS _onepipe_workflow_signals (
  id SERIAL PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES _onepipe_workflows(workflow_id) ON DELETE CASCADE,
  signal_name TEXT NOT NULL,
  data JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_signals_workflow ON _onepipe_workflow_signals(workflow_id, signal_name);

-- Child workflow relationships
CREATE TABLE IF NOT EXISTS _onepipe_workflow_children (
  id SERIAL PRIMARY KEY,
  parent_workflow_id TEXT NOT NULL REFERENCES _onepipe_workflows(workflow_id) ON DELETE CASCADE,
  child_workflow_id TEXT NOT NULL REFERENCES _onepipe_workflows(workflow_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_children_parent ON _onepipe_workflow_children(parent_workflow_id);
`

// ============================================================================
// Builder State
// ============================================================================

interface WorkflowBuilderState<TInput, TOutput> {
  name: string
  inputSchema?: z.ZodType<TInput>
  outputSchema?: z.ZodType<TOutput>
  handler?: WorkflowFunction<TInput, TOutput>
  timeout?: number
  retry?: RetryOptions
  trace: boolean
  db?: DBInstance
}

// ============================================================================
// Workflow Builder
// ============================================================================

/**
 * Workflow Builder - Fluent API for creating durable workflows
 */
class WorkflowBuilder<TInput = unknown, TOutput = unknown> {
  private state: WorkflowBuilderState<TInput, TOutput>

  private constructor(name: string) {
    this.state = {
      name,
      trace: false,
    }
  }

  /**
   * Create a new Workflow builder
   */
  static create(name: string): WorkflowBuilder<unknown, unknown> {
    return new WorkflowBuilder(name)
  }

  /**
   * Set input schema (Zod)
   */
  input<T>(schema: z.ZodType<T>): WorkflowBuilder<T, TOutput> {
    const builder = this as unknown as WorkflowBuilder<T, TOutput>
    builder.state.inputSchema = schema
    return builder
  }

  /**
   * Set output schema (Zod)
   */
  output<T>(schema: z.ZodType<T>): WorkflowBuilder<TInput, T> {
    const builder = this as unknown as WorkflowBuilder<TInput, T>
    builder.state.outputSchema = schema
    return builder
  }

  /**
   * Inject PostgreSQL database (required for persistence)
   */
  db(instance: DBInstance): this {
    if (instance.type !== 'postgres') {
      throw new Error('Workflow requires PostgreSQL database')
    }
    this.state.db = instance
    return this
  }

  /**
   * Set workflow timeout (e.g., '30m', '1h', '24h')
   */
  timeout(duration: string): this {
    this.state.timeout = this.parseDuration(duration)
    return this
  }

  /**
   * Set default retry policy for steps
   */
  retry(options: RetryOptions): this {
    this.state.retry = options
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
   * Define the workflow logic
   */
  define(fn: WorkflowFunction<TInput, TOutput>): this {
    this.state.handler = fn
    return this
  }

  /**
   * Build the Workflow instance
   */
  build(): WorkflowInstance<TInput, TOutput> {
    if (!this.state.handler) {
      throw new Error(`Workflow "${this.state.name}" requires a handler (use .define())`)
    }
    if (!this.state.db) {
      throw new Error(`Workflow "${this.state.name}" requires a PostgreSQL database (use .db())`)
    }

    // Register with manifest for CLI auto-discovery
    registerPrimitive({
      primitive: 'workflow',
      name: this.state.name,
      infrastructure: 'postgresql',
    })

    return new WorkflowInstanceImpl<TInput, TOutput>(this.state)
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
    if (!match) throw new Error(`Invalid duration: ${duration}`)

    const value = parseInt(match[1], 10)
    const unit = match[2]

    switch (unit) {
      case 'ms': return value
      case 's': return value * 1000
      case 'm': return value * 60 * 1000
      case 'h': return value * 60 * 60 * 1000
      case 'd': return value * 24 * 60 * 60 * 1000
      default: return value
    }
  }
}

// ============================================================================
// Workflow Context Implementation
// ============================================================================

class WorkflowContextImpl<TInput> implements WorkflowContext<TInput> {
  readonly workflowId: string
  readonly workflowName: string
  readonly input: TInput
  readonly startedAt: Date
  readonly db: DBContext

  private dbInstance: DBInstance
  private stepIndex = 0
  private traceEnabled: boolean
  private defaultRetry?: RetryOptions
  /** Heartbeat interval ID for long-running operations */
  private heartbeatInterval?: ReturnType<typeof setInterval>

  constructor(
    workflowId: string,
    workflowName: string,
    input: TInput,
    startedAt: Date,
    db: DBInstance,
    traceEnabled: boolean,
    defaultRetry?: RetryOptions
  ) {
    this.workflowId = workflowId
    this.workflowName = workflowName
    this.input = input
    this.startedAt = startedAt
    this.dbInstance = db
    this.db = db
    this.traceEnabled = traceEnabled
    this.defaultRetry = defaultRetry
  }

  /**
   * Update workflow heartbeat to prevent stall detection
   */
  private async updateHeartbeat(): Promise<void> {
    await this.dbInstance.query(
      `UPDATE _onepipe_workflows SET updated_at = NOW() WHERE workflow_id = $1`,
      [this.workflowId]
    )
  }

  /**
   * Start heartbeat interval for long-running operations
   */
  private startHeartbeat(): void {
    // Update every 10 seconds to stay within the 30-second stall threshold
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.updateHeartbeat()
      } catch (err) {
        if (this.traceEnabled) {
          console.error(`[Workflow:${this.workflowName}] Heartbeat failed:`, err)
        }
      }
    }, 10_000)
  }

  /**
   * Stop heartbeat interval
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = undefined
    }
  }

  /**
   * Execute a step with at-most-once semantics
   */
  async step<T>(name: string, fn: () => Promise<T>, options?: StepOptions): Promise<T> {
    const currentStepIndex = this.stepIndex++

    // Check if step already completed
    const existing = await this.dbInstance.query<{
      status: string
      output: string | null
      error: string | null
    }>(
      `SELECT status, output, error FROM _onepipe_workflow_steps
       WHERE workflow_id = $1 AND step_name = $2`,
      [this.workflowId, name]
    )

    if (existing.length > 0) {
      const step = existing[0]
      if (step.status === 'completed') {
        if (this.traceEnabled) {
          console.debug(`[Workflow:${this.workflowName}] Step "${name}" replayed from cache`)
        }
        return JSON.parse(step.output!) as T
      }
      if (step.status === 'failed') {
        throw new Error(step.error || 'Step failed')
      }
    }

    // Record step start
    await this.dbInstance.query(
      `INSERT INTO _onepipe_workflow_steps (workflow_id, step_name, step_index, status, started_at, attempts)
       VALUES ($1, $2, $3, 'running', NOW(), 1)
       ON CONFLICT (workflow_id, step_name)
       DO UPDATE SET status = 'running', started_at = NOW(), attempts = _onepipe_workflow_steps.attempts + 1`,
      [this.workflowId, name, currentStepIndex]
    )

    // Update workflow heartbeat
    await this.dbInstance.query(
      `UPDATE _onepipe_workflows SET updated_at = NOW() WHERE workflow_id = $1`,
      [this.workflowId]
    )

    const retry = options?.retry || this.defaultRetry
    const maxAttempts = retry?.attempts || 1
    const backoff = retry?.backoff || 'linear'
    const baseDelay = retry?.delay || 1000

    let lastError: Error | undefined

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (this.traceEnabled) {
          console.debug(`[Workflow:${this.workflowName}] Executing step "${name}" (attempt ${attempt}/${maxAttempts})`)
        }

        const result = await fn()

        // Record step completion
        await this.dbInstance.query(
          `UPDATE _onepipe_workflow_steps
           SET status = 'completed', output = $3, completed_at = NOW()
           WHERE workflow_id = $1 AND step_name = $2`,
          [this.workflowId, name, JSON.stringify(result)]
        )

        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (attempt < maxAttempts) {
          const delay = backoff === 'exponential'
            ? baseDelay * Math.pow(2, attempt - 1)
            : baseDelay * attempt

          if (this.traceEnabled) {
            console.debug(`[Workflow:${this.workflowName}] Step "${name}" failed, retrying in ${delay}ms`)
          }

          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    // Record step failure
    await this.dbInstance.query(
      `UPDATE _onepipe_workflow_steps
       SET status = 'failed', error = $3, completed_at = NOW()
       WHERE workflow_id = $1 AND step_name = $2`,
      [this.workflowId, name, lastError!.message]
    )

    throw lastError
  }

  /**
   * Execute multiple steps in parallel
   */
  async parallel<T extends readonly unknown[]>(
    steps: [...{ [K in keyof T]: Promise<T[K]> }]
  ): Promise<T> {
    return Promise.all(steps) as Promise<T>
  }

  /**
   * Durable sleep (survives restarts)
   */
  async sleep(duration: string | number): Promise<void> {
    const ms = typeof duration === 'string' ? this.parseDuration(duration) : duration
    const wakeTime = new Date(Date.now() + ms)
    const stepName = `__sleep_${this.stepIndex++}`

    // Check if sleep already completed
    const existing = await this.dbInstance.query<{ status: string; output: string | null }>(
      `SELECT status, output FROM _onepipe_workflow_steps
       WHERE workflow_id = $1 AND step_name = $2`,
      [this.workflowId, stepName]
    )

    if (existing.length > 0 && existing[0].status === 'completed') {
      return // Already slept
    }

    // If wake time has passed, complete immediately
    if (wakeTime <= new Date()) {
      await this.dbInstance.query(
        `INSERT INTO _onepipe_workflow_steps (workflow_id, step_name, step_index, status, output, completed_at)
         VALUES ($1, $2, $3, 'completed', $4, NOW())
         ON CONFLICT (workflow_id, step_name) DO UPDATE SET status = 'completed', completed_at = NOW()`,
        [this.workflowId, stepName, this.stepIndex - 1, JSON.stringify({ wakeTime: wakeTime.toISOString() })]
      )
      return
    }

    // Record pending sleep
    await this.dbInstance.query(
      `INSERT INTO _onepipe_workflow_steps (workflow_id, step_name, step_index, status, output)
       VALUES ($1, $2, $3, 'pending', $4)
       ON CONFLICT (workflow_id, step_name) DO NOTHING`,
      [this.workflowId, stepName, this.stepIndex - 1, JSON.stringify({ wakeTime: wakeTime.toISOString() })]
    )

    // Start heartbeat for long sleeps (>10 seconds)
    if (ms > 10_000) {
      this.startHeartbeat()
    }

    try {
      // Actually sleep
      await new Promise(resolve => setTimeout(resolve, ms))
    } finally {
      // Stop heartbeat
      this.stopHeartbeat()
    }

    // Mark as completed
    await this.dbInstance.query(
      `UPDATE _onepipe_workflow_steps SET status = 'completed', completed_at = NOW()
       WHERE workflow_id = $1 AND step_name = $2`,
      [this.workflowId, stepName]
    )
  }

  /**
   * Start a child workflow and wait for result
   */
  async child<I, O>(
    workflow: WorkflowInstance<I, O>,
    input: I,
    options?: { workflowId?: string }
  ): Promise<O> {
    const childId = options?.workflowId || `${this.workflowId}_child_${crypto.randomUUID()}`

    // Record parent-child relationship
    await this.dbInstance.query(
      `INSERT INTO _onepipe_workflow_children (parent_workflow_id, child_workflow_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [this.workflowId, childId]
    )

    // Start child workflow
    const handle = await workflow.start(input, { workflowId: childId })

    // Start heartbeat while waiting for child
    this.startHeartbeat()

    try {
      // Wait for result
      return await handle.result()
    } finally {
      this.stopHeartbeat()
    }
  }

  /**
   * Wait for an external signal
   */
  async signal<T = unknown>(name: string, timeout?: string): Promise<T> {
    const timeoutMs = timeout ? this.parseDuration(timeout) : undefined
    const startTime = Date.now()

    // Start heartbeat since signal polling can take a long time
    this.startHeartbeat()

    try {
      while (true) {
        // Check for signal
        const signals = await this.dbInstance.query<{ data: string }>(
          `SELECT data FROM _onepipe_workflow_signals
           WHERE workflow_id = $1 AND signal_name = $2 AND processed_at IS NULL
           ORDER BY received_at ASC
           LIMIT 1`,
          [this.workflowId, name]
        )

        if (signals.length > 0) {
          // Mark as processed
          await this.dbInstance.query(
            `UPDATE _onepipe_workflow_signals SET processed_at = NOW()
             WHERE workflow_id = $1 AND signal_name = $2 AND processed_at IS NULL`,
            [this.workflowId, name]
          )
          return JSON.parse(signals[0].data) as T
        }

        // Check timeout
        if (timeoutMs && Date.now() - startTime > timeoutMs) {
          throw new Error(`Signal "${name}" timed out after ${timeout}`)
        }

        // Poll interval
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    } finally {
      this.stopHeartbeat()
    }
  }

  /**
   * Emit event to a Flow
   */
  async emit<T>(flow: FlowInstance<T>, data: T): Promise<void> {
    await flow.append(data)
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
    if (!match) throw new Error(`Invalid duration: ${duration}`)

    const value = parseInt(match[1], 10)
    const unit = match[2]

    switch (unit) {
      case 'ms': return value
      case 's': return value * 1000
      case 'm': return value * 60 * 1000
      case 'h': return value * 60 * 60 * 1000
      case 'd': return value * 24 * 60 * 60 * 1000
      default: return value
    }
  }
}

// ============================================================================
// Workflow Handle Implementation
// ============================================================================

class WorkflowHandleImpl<TOutput> implements WorkflowHandle<TOutput> {
  readonly workflowId: string
  private db: DBInstance

  constructor(workflowId: string, db: DBInstance) {
    this.workflowId = workflowId
    this.db = db
  }

  async status(): Promise<WorkflowStatus> {
    const result = await this.db.query<{ status: WorkflowStatus }>(
      `SELECT status FROM _onepipe_workflows WHERE workflow_id = $1`,
      [this.workflowId]
    )
    if (result.length === 0) {
      throw new Error(`Workflow ${this.workflowId} not found`)
    }
    return result[0].status
  }

  async result(timeout?: string): Promise<TOutput> {
    const timeoutMs = timeout ? this.parseDuration(timeout) : undefined
    const startTime = Date.now()

    while (true) {
      const result = await this.db.query<{
        status: WorkflowStatus
        output: string | null
        error: string | null
      }>(
        `SELECT status, output, error FROM _onepipe_workflows WHERE workflow_id = $1`,
        [this.workflowId]
      )

      if (result.length === 0) {
        throw new Error(`Workflow ${this.workflowId} not found`)
      }

      const workflow = result[0]

      if (workflow.status === 'completed') {
        return JSON.parse(workflow.output!) as TOutput
      }

      if (workflow.status === 'failed') {
        throw new Error(workflow.error || 'Workflow failed')
      }

      if (workflow.status === 'cancelled') {
        throw new Error('Workflow was cancelled')
      }

      if (workflow.status === 'timed_out') {
        throw new Error('Workflow timed out')
      }

      // Check timeout
      if (timeoutMs && Date.now() - startTime > timeoutMs) {
        throw new Error(`Waiting for workflow result timed out after ${timeout}`)
      }

      // Poll interval
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  async signal(name: string, data: unknown): Promise<void> {
    await this.db.query(
      `INSERT INTO _onepipe_workflow_signals (workflow_id, signal_name, data)
       VALUES ($1, $2, $3)`,
      [this.workflowId, name, JSON.stringify(data)]
    )
  }

  async cancel(): Promise<void> {
    await this.db.query(
      `UPDATE _onepipe_workflows
       SET status = 'cancelled', completed_at = NOW(), updated_at = NOW()
       WHERE workflow_id = $1 AND status IN ('pending', 'running')`,
      [this.workflowId]
    )
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
    if (!match) throw new Error(`Invalid duration: ${duration}`)

    const value = parseInt(match[1], 10)
    const unit = match[2]

    switch (unit) {
      case 'ms': return value
      case 's': return value * 1000
      case 'm': return value * 60 * 1000
      case 'h': return value * 60 * 60 * 1000
      case 'd': return value * 24 * 60 * 60 * 1000
      default: return value
    }
  }
}

// ============================================================================
// Workflow Instance Implementation
// ============================================================================

class WorkflowInstanceImpl<TInput, TOutput> implements WorkflowInstance<TInput, TOutput> {
  readonly name: string
  private inputSchema?: z.ZodType<TInput>
  private outputSchema?: z.ZodType<TOutput>
  private handler: WorkflowFunction<TInput, TOutput>
  private timeout?: number
  private retry?: RetryOptions
  private traceEnabled: boolean
  private db: DBInstance
  private schemaInitialized = false

  constructor(state: WorkflowBuilderState<TInput, TOutput>) {
    this.name = state.name
    this.inputSchema = state.inputSchema
    this.outputSchema = state.outputSchema
    this.handler = state.handler!
    this.timeout = state.timeout
    this.retry = state.retry
    this.traceEnabled = state.trace
    this.db = state.db!

    // Register with dashboard
    this.registerWithDashboard()
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      await this.db.query(WORKFLOW_SCHEMA, [])
      this.schemaInitialized = true
    } catch (error) {
      // Schema might already exist, that's fine
      if (this.traceEnabled) {
        console.debug(`[Workflow:${this.name}] Schema initialization:`, error)
      }
      this.schemaInitialized = true
    }
  }

  async start(input: TInput, options?: StartOptions): Promise<WorkflowHandle<TOutput>> {
    await this.ensureSchema()

    // Validate input
    if (this.inputSchema) {
      this.inputSchema.parse(input)
    }

    const workflowId = options?.workflowId || `${this.name}_${crypto.randomUUID()}`
    const timeoutAt = this.timeout || (options?.timeout ? this.parseDuration(options.timeout) : null)

    // Check for existing workflow with same ID (idempotency)
    const existing = await this.db.query<{ status: WorkflowStatus }>(
      `SELECT status FROM _onepipe_workflows WHERE workflow_id = $1`,
      [workflowId]
    )

    if (existing.length > 0) {
      if (this.traceEnabled) {
        console.debug(`[Workflow:${this.name}] Workflow ${workflowId} already exists with status ${existing[0].status}`)
      }
      return new WorkflowHandleImpl<TOutput>(workflowId, this.db)
    }

    // Create workflow record
    await this.db.query(
      `INSERT INTO _onepipe_workflows (workflow_id, workflow_name, status, input, timeout_at)
       VALUES ($1, $2, 'running', $3, $4)`,
      [
        workflowId,
        this.name,
        JSON.stringify(input),
        timeoutAt ? new Date(Date.now() + timeoutAt) : null,
      ]
    )

    // Execute workflow in background
    this.executeWorkflow(workflowId, input).catch(error => {
      console.error(`[Workflow:${this.name}] Execution error:`, error)
    })

    return new WorkflowHandleImpl<TOutput>(workflowId, this.db)
  }

  get(workflowId: string): WorkflowHandle<TOutput> {
    return new WorkflowHandleImpl<TOutput>(workflowId, this.db)
  }

  async list(options?: ListWorkflowOptions): Promise<WorkflowExecution<TOutput>[]> {
    await this.ensureSchema()

    let query = `
      SELECT workflow_id, workflow_name, status, input, output, error, started_at, completed_at
      FROM _onepipe_workflows
      WHERE workflow_name = $1
    `
    const params: unknown[] = [this.name]

    if (options?.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status]
      query += ` AND status = ANY($${params.length + 1})`
      params.push(statuses)
    }

    query += ` ORDER BY started_at DESC`

    if (options?.limit) {
      query += ` LIMIT $${params.length + 1}`
      params.push(options.limit)
    }

    if (options?.offset) {
      query += ` OFFSET $${params.length + 1}`
      params.push(options.offset)
    }

    const workflows = await this.db.query<{
      workflow_id: string
      workflow_name: string
      status: WorkflowStatus
      input: string
      output: string | null
      error: string | null
      started_at: Date
      completed_at: Date | null
    }>(query, params)

    // Fetch steps for each workflow
    const result: WorkflowExecution<TOutput>[] = []

    for (const wf of workflows) {
      const steps = await this.db.query<{
        step_name: string
        step_index: number
        status: string
        output: string | null
        error: string | null
        attempts: number
        started_at: Date | null
        completed_at: Date | null
      }>(
        `SELECT step_name, step_index, status, output, error, attempts, started_at, completed_at
         FROM _onepipe_workflow_steps
         WHERE workflow_id = $1
         ORDER BY step_index`,
        [wf.workflow_id]
      )

      result.push({
        workflowId: wf.workflow_id,
        workflowName: wf.workflow_name,
        status: wf.status,
        input: JSON.parse(wf.input),
        output: wf.output ? JSON.parse(wf.output) : undefined,
        error: wf.error || undefined,
        startedAt: wf.started_at,
        completedAt: wf.completed_at || undefined,
        steps: steps.map(s => ({
          stepName: s.step_name,
          stepIndex: s.step_index,
          status: s.status as StepExecution['status'],
          output: s.output ? JSON.parse(s.output) : undefined,
          error: s.error || undefined,
          attempts: s.attempts,
          startedAt: s.started_at || undefined,
          completedAt: s.completed_at || undefined,
        })),
      })
    }

    return result
  }

  async signal(workflowId: string, signalName: string, data: unknown): Promise<void> {
    await this.db.query(
      `INSERT INTO _onepipe_workflow_signals (workflow_id, signal_name, data)
       VALUES ($1, $2, $3)`,
      [workflowId, signalName, JSON.stringify(data)]
    )
  }

  async cancel(workflowId: string): Promise<void> {
    await this.db.query(
      `UPDATE _onepipe_workflows
       SET status = 'cancelled', completed_at = NOW(), updated_at = NOW()
       WHERE workflow_id = $1 AND status IN ('pending', 'running')`,
      [workflowId]
    )
  }

  async recover(): Promise<number> {
    await this.ensureSchema()

    // Find stalled workflows (no update in 30 seconds while running)
    const stalled = await this.db.query<{ workflow_id: string; input: string }>(
      `SELECT workflow_id, input FROM _onepipe_workflows
       WHERE workflow_name = $1
         AND status = 'running'
         AND updated_at < NOW() - INTERVAL '30 seconds'
       FOR UPDATE SKIP LOCKED`,
      [this.name]
    )

    if (this.traceEnabled && stalled.length > 0) {
      console.debug(`[Workflow:${this.name}] Recovering ${stalled.length} stalled workflows`)
    }

    for (const wf of stalled) {
      // Re-execute the workflow (steps will replay from cache)
      this.executeWorkflow(wf.workflow_id, JSON.parse(wf.input) as TInput).catch(error => {
        console.error(`[Workflow:${this.name}] Recovery error for ${wf.workflow_id}:`, error)
      })
    }

    // Also check for timed out workflows
    await this.db.query(
      `UPDATE _onepipe_workflows
       SET status = 'timed_out', completed_at = NOW(), updated_at = NOW()
       WHERE workflow_name = $1
         AND status = 'running'
         AND timeout_at IS NOT NULL
         AND timeout_at < NOW()`,
      [this.name]
    )

    return stalled.length
  }

  private async executeWorkflow(workflowId: string, input: TInput): Promise<void> {
    const startedAt = new Date()

    const ctx = new WorkflowContextImpl<TInput>(
      workflowId,
      this.name,
      input,
      startedAt,
      this.db,
      this.traceEnabled,
      this.retry
    )

    try {
      if (this.traceEnabled) {
        console.debug(`[Workflow:${this.name}] Starting execution of ${workflowId}`)
      }

      const result = await this.handler(ctx, input)

      // Validate output
      if (this.outputSchema) {
        this.outputSchema.parse(result)
      }

      // Mark as completed
      await this.db.query(
        `UPDATE _onepipe_workflows
         SET status = 'completed', output = $2, completed_at = NOW(), updated_at = NOW()
         WHERE workflow_id = $1`,
        [workflowId, JSON.stringify(result)]
      )

      if (this.traceEnabled) {
        console.debug(`[Workflow:${this.name}] Completed ${workflowId}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Mark as failed
      await this.db.query(
        `UPDATE _onepipe_workflows
         SET status = 'failed', error = $2, completed_at = NOW(), updated_at = NOW()
         WHERE workflow_id = $1`,
        [workflowId, errorMessage]
      )

      if (this.traceEnabled) {
        console.error(`[Workflow:${this.name}] Failed ${workflowId}:`, error)
      }
    }
  }

  private async registerWithDashboard(): Promise<void> {
    const dashboardUrl = process.env.ONEPIPE_DASHBOARD_URL || 'http://localhost:4001'

    try {
      await fetch(`${dashboardUrl}/api/dashboard/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.name,
          type: 'workflow',
        }),
      })
    } catch {
      // Dashboard not running, that's fine
    }
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
    if (!match) throw new Error(`Invalid duration: ${duration}`)

    const value = parseInt(match[1], 10)
    const unit = match[2]

    switch (unit) {
      case 'ms': return value
      case 's': return value * 1000
      case 'm': return value * 60 * 1000
      case 'h': return value * 60 * 60 * 1000
      case 'd': return value * 24 * 60 * 60 * 1000
      default: return value
    }
  }
}

// ============================================================================
// Export
// ============================================================================

/**
 * Create a new Workflow
 */
export const Workflow = {
  create: WorkflowBuilder.create,
}

export type { WorkflowBuilder, WorkflowInstance, WorkflowHandle, WorkflowContext }
