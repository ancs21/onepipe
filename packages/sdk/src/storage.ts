/**
 * Storage - S3-compatible Object Storage using Bun's native S3 client
 *
 * @example
 * ```typescript
 * const storage = Storage
 *   .create('uploads')
 *   .bucket('my-app-uploads')
 *   .endpoint('https://s3.us-east-1.amazonaws.com')
 *   .trace()
 *   .build()
 *
 * // Upload a file
 * await storage.write('images/photo.jpg', imageBuffer, { type: 'image/jpeg' })
 *
 * // Read a file
 * const file = storage.file('images/photo.jpg')
 * const data = await file.arrayBuffer()
 *
 * // Generate presigned URL
 * const url = storage.presign('images/photo.jpg', { expiresIn: 3600 })
 *
 * // List files
 * const result = await storage.list({ prefix: 'images/' })
 * ```
 */

import { S3Client } from 'bun'
import type {
  StorageOptions,
  StorageInstance,
  StorageFile,
  StorageWriteOptions,
  StorageListOptions,
  StorageListResult,
  PresignOptions,
} from './types'

// Builder state
interface StorageBuilderState {
  name: string
  bucket?: string
  endpoint?: string
  region?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  trace: boolean
}

/**
 * Storage Builder - Fluent API for creating S3-compatible storage
 */
class StorageBuilder {
  private state: StorageBuilderState

  private constructor(name: string) {
    this.state = {
      name,
      trace: false,
    }
  }

  /**
   * Create a new Storage builder
   */
  static create(name: string): StorageBuilder {
    return new StorageBuilder(name)
  }

  /**
   * Set the S3 bucket name
   */
  bucket(name: string): this {
    this.state.bucket = name
    return this
  }

  /**
   * Set the S3 endpoint URL
   * @example 'https://s3.us-east-1.amazonaws.com' (AWS)
   * @example 'https://<account>.r2.cloudflarestorage.com' (Cloudflare R2)
   * @example 'https://storage.googleapis.com' (GCS)
   */
  endpoint(url: string): this {
    this.state.endpoint = url
    return this
  }

  /**
   * Set the AWS region
   */
  region(region: string): this {
    this.state.region = region
    return this
  }

  /**
   * Set explicit credentials (otherwise uses environment variables)
   */
  credentials(options: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }): this {
    this.state.accessKeyId = options.accessKeyId
    this.state.secretAccessKey = options.secretAccessKey
    this.state.sessionToken = options.sessionToken
    return this
  }

  /**
   * Enable tracing
   */
  trace(): this {
    this.state.trace = true
    return this
  }

  /**
   * Build the Storage instance
   */
  build(): StorageInstance {
    if (!this.state.bucket) {
      throw new Error('Storage bucket is required. Use .bucket("my-bucket") to set it.')
    }
    return new StorageInstanceImpl(this.state as StorageBuilderState & { bucket: string })
  }
}

/**
 * StorageFile implementation wrapping Bun's S3File
 */
class StorageFileImpl implements StorageFile {
  readonly key: string
  private s3File: ReturnType<InstanceType<typeof S3Client>['file']>
  private _size = 0
  private _type = 'application/octet-stream'
  private _etag?: string
  private _lastModified?: Date
  private statLoaded = false
  private traceEnabled: boolean
  private storageName: string

  constructor(
    key: string,
    s3File: ReturnType<InstanceType<typeof S3Client>['file']>,
    traceEnabled: boolean,
    storageName: string
  ) {
    this.key = key
    this.s3File = s3File
    this.traceEnabled = traceEnabled
    this.storageName = storageName
  }

  private async loadStat(): Promise<void> {
    if (this.statLoaded) return
    try {
      const stat = await this.s3File.stat()
      this._size = stat.size
      this._type = stat.type || 'application/octet-stream'
      this._etag = stat.etag
      this._lastModified = stat.lastModified
      this.statLoaded = true
    } catch {
      // File might not exist
      this.statLoaded = true
    }
  }

  get size(): number {
    return this._size
  }

  get type(): string {
    return this._type
  }

  get etag(): string | undefined {
    return this._etag
  }

  get lastModified(): Date | undefined {
    return this._lastModified
  }

  async text(): Promise<string> {
    const start = this.traceEnabled ? performance.now() : 0
    try {
      const result = await this.s3File.text()
      if (this.traceEnabled) {
        console.debug(`[Storage:${this.storageName}] text(${this.key}) took ${(performance.now() - start).toFixed(2)}ms`)
      }
      return result
    } catch (error) {
      if (this.traceEnabled) {
        console.error(`[Storage:${this.storageName}] text(${this.key}) failed:`, error)
      }
      throw error
    }
  }

  async json<T = unknown>(): Promise<T> {
    const start = this.traceEnabled ? performance.now() : 0
    try {
      const result = await this.s3File.json() as T
      if (this.traceEnabled) {
        console.debug(`[Storage:${this.storageName}] json(${this.key}) took ${(performance.now() - start).toFixed(2)}ms`)
      }
      return result
    } catch (error) {
      if (this.traceEnabled) {
        console.error(`[Storage:${this.storageName}] json(${this.key}) failed:`, error)
      }
      throw error
    }
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const start = this.traceEnabled ? performance.now() : 0
    try {
      const result = await this.s3File.arrayBuffer()
      if (this.traceEnabled) {
        console.debug(`[Storage:${this.storageName}] arrayBuffer(${this.key}) took ${(performance.now() - start).toFixed(2)}ms`)
      }
      return result
    } catch (error) {
      if (this.traceEnabled) {
        console.error(`[Storage:${this.storageName}] arrayBuffer(${this.key}) failed:`, error)
      }
      throw error
    }
  }

  async bytes(): Promise<Uint8Array> {
    const start = this.traceEnabled ? performance.now() : 0
    try {
      const result = await this.s3File.bytes()
      if (this.traceEnabled) {
        console.debug(`[Storage:${this.storageName}] bytes(${this.key}) took ${(performance.now() - start).toFixed(2)}ms`)
      }
      return result
    } catch (error) {
      if (this.traceEnabled) {
        console.error(`[Storage:${this.storageName}] bytes(${this.key}) failed:`, error)
      }
      throw error
    }
  }

  stream(): ReadableStream<Uint8Array> {
    return this.s3File.stream()
  }

  async delete(): Promise<void> {
    const start = this.traceEnabled ? performance.now() : 0
    try {
      await this.s3File.delete()
      if (this.traceEnabled) {
        console.debug(`[Storage:${this.storageName}] delete(${this.key}) took ${(performance.now() - start).toFixed(2)}ms`)
      }
    } catch (error) {
      if (this.traceEnabled) {
        console.error(`[Storage:${this.storageName}] delete(${this.key}) failed:`, error)
      }
      throw error
    }
  }

  async exists(): Promise<boolean> {
    const start = this.traceEnabled ? performance.now() : 0
    try {
      const result = await this.s3File.exists()
      if (this.traceEnabled) {
        console.debug(`[Storage:${this.storageName}] exists(${this.key}) = ${result} took ${(performance.now() - start).toFixed(2)}ms`)
      }
      return result
    } catch (error) {
      if (this.traceEnabled) {
        console.error(`[Storage:${this.storageName}] exists(${this.key}) failed:`, error)
      }
      throw error
    }
  }

  presign(options?: PresignOptions): string {
    return this.s3File.presign({
      expiresIn: options?.expiresIn ?? 3600,
      method: options?.method,
      acl: options?.acl,
    })
  }
}

/**
 * Storage instance implementation
 */
class StorageInstanceImpl implements StorageInstance {
  readonly name: string
  readonly bucket: string
  private client: InstanceType<typeof S3Client>
  private traceEnabled: boolean

  constructor(state: StorageBuilderState & { bucket: string }) {
    this.name = state.name
    this.bucket = state.bucket
    this.traceEnabled = state.trace

    // Create S3 client with explicit or environment credentials
    this.client = new S3Client({
      bucket: state.bucket,
      endpoint: state.endpoint,
      region: state.region,
      accessKeyId: state.accessKeyId,
      secretAccessKey: state.secretAccessKey,
      sessionToken: state.sessionToken,
    })

    // Register with dashboard
    this.registerWithDashboard()
  }

  private async registerWithDashboard(): Promise<void> {
    const dashboardUrl = process.env.ONEPIPE_DASHBOARD_URL
    if (!dashboardUrl) return

    try {
      await fetch(`${dashboardUrl}/api/dashboard/storage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.name,
          bucket: this.bucket,
        }),
      })
    } catch {
      // Dashboard not running, ignore
    }
  }

  file(key: string): StorageFile {
    const s3File = this.client.file(key)
    return new StorageFileImpl(key, s3File, this.traceEnabled, this.name)
  }

  async write(
    key: string,
    data: string | ArrayBuffer | Uint8Array | Blob | ReadableStream,
    options?: StorageWriteOptions
  ): Promise<void> {
    const start = this.traceEnabled ? performance.now() : 0
    try {
      const s3File = this.client.file(key)
      // Wrap ReadableStream in Response for Bun S3 compatibility
      const writeData = data instanceof ReadableStream
        ? new Response(data)
        : data
      await s3File.write(writeData, {
        type: options?.type,
        acl: options?.acl,
      })
      if (this.traceEnabled) {
        console.debug(`[Storage:${this.name}] write(${key}) took ${(performance.now() - start).toFixed(2)}ms`)
      }
    } catch (error) {
      if (this.traceEnabled) {
        console.error(`[Storage:${this.name}] write(${key}) failed:`, error)
      }
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.file(key)
    await file.delete()
  }

  async exists(key: string): Promise<boolean> {
    const file = this.file(key)
    return file.exists()
  }

  async list(options?: StorageListOptions): Promise<StorageListResult> {
    const start = this.traceEnabled ? performance.now() : 0
    try {
      const result = await this.client.list({
        prefix: options?.prefix,
        maxKeys: options?.limit,
        continuationToken: options?.cursor,
        delimiter: options?.delimiter,
      })

      const files = (result.contents || []).map((item) => ({
        key: item.key,
        size: item.size ?? 0,
        lastModified: item.lastModified ? new Date(item.lastModified) : undefined,
      }))

      // Extract prefix strings from commonPrefixes objects
      const prefixes = (result.commonPrefixes || []).map(
        (p: { prefix: string } | string) => typeof p === 'string' ? p : p.prefix
      )

      const listResult: StorageListResult = {
        files,
        prefixes,
        cursor: result.nextContinuationToken,
        hasMore: result.isTruncated || false,
      }

      if (this.traceEnabled) {
        console.debug(`[Storage:${this.name}] list() returned ${files.length} files, took ${(performance.now() - start).toFixed(2)}ms`)
      }

      return listResult
    } catch (error) {
      if (this.traceEnabled) {
        console.error(`[Storage:${this.name}] list() failed:`, error)
      }
      throw error
    }
  }

  presign(key: string, options?: PresignOptions): string {
    const file = this.file(key)
    return file.presign(options)
  }
}

/**
 * Create a new Storage instance
 */
export const Storage = {
  create: StorageBuilder.create,
}

export type { StorageBuilder, StorageInstance }
