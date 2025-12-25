/**
 * SQLite-based Auth Storage for Dashboard Dev Tools
 *
 * Provides user management, session storage, and token generation
 * for testing auth-protected APIs (similar to Clerk's dev tools).
 */

import { Database } from 'bun:sqlite'
import { mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

export interface AuthUser {
  id: string
  email: string
  name: string | null
  role: string
  emailVerified: boolean
  createdAt: number
}

export interface AuthSession {
  id: string
  userId: string
  token: string
  expiresAt: number
  createdAt: number
}

interface UserRow {
  id: string
  email: string
  password_hash: string
  name: string | null
  role: string
  created_at: number
}

interface SessionRow {
  id: string
  user_id: string
  token: string
  expires_at: number
  created_at: number
}

/**
 * Simple password hashing using SHA-256
 * For production, use bcrypt or argon2
 */
function hashPassword(password: string): string {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + 'onepipe-salt')
  const hashBuffer = new Bun.CryptoHasher('sha256').update(data).digest()
  return Buffer.from(hashBuffer).toString('hex')
}

function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash
}

/**
 * Generate a secure random token
 */
function generateToken(): string {
  return crypto.randomUUID() + '-' + crypto.randomUUID()
}

/**
 * Generate a simple JWT-like token (base64 encoded JSON)
 * For production, use proper JWT library
 */
function generateJWT(userId: string, email: string, role: string, expiresAt: number, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    sub: userId,
    email,
    role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(expiresAt / 1000),
  }

  const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const headerB64 = encode(header)
  const payloadB64 = encode(payload)

  // Create signature
  const signatureInput = `${headerB64}.${payloadB64}`
  const signature = new Bun.CryptoHasher('sha256')
    .update(signatureInput + secret)
    .digest()
  const signatureB64 = Buffer.from(signature).toString('base64url')

  return `${headerB64}.${payloadB64}.${signatureB64}`
}

export interface DevJWTPayload {
  sub: string
  email: string
  role: string
  iat: number
  exp: number
}

/**
 * Verify and decode a dev JWT token
 * Returns the payload if valid, null if invalid or expired
 */
export function verifyDevJWT(token: string, secret = 'onepipe-dev-secret'): DevJWTPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, signatureB64] = parts

    // Verify signature
    const signatureInput = `${headerB64}.${payloadB64}`
    const expectedSignature = new Bun.CryptoHasher('sha256')
      .update(signatureInput + secret)
      .digest()
    const expectedSignatureB64 = Buffer.from(expectedSignature).toString('base64url')

    if (signatureB64 !== expectedSignatureB64) {
      return null // Invalid signature
    }

    // Decode payload
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf-8')
    const payload = JSON.parse(payloadJson) as DevJWTPayload

    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null // Expired
    }

    return payload
  } catch {
    return null
  }
}

export class AuthStore {
  private db: Database
  private secret: string

  constructor(dbPath = '.onepipe/auth.db', secret = 'onepipe-dev-secret') {
    // Ensure directory exists
    const dir = dirname(dbPath)
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.secret = secret
    this.init()
  }

  private init(): void {
    // Create users table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        role TEXT DEFAULT 'user',
        created_at INTEGER DEFAULT (unixepoch())
      )
    `)

    // Create sessions table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `)

    // Create indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`)
  }

  // =========================================================================
  // User Management
  // =========================================================================

  createUser(email: string, password: string, name?: string, role = 'user'): AuthUser {
    const id = crypto.randomUUID()
    const passwordHash = hashPassword(password)
    const createdAt = Math.floor(Date.now() / 1000)

    this.db.run(
      `INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, email, passwordHash, name || null, role, createdAt]
    )

    return {
      id,
      email,
      name: name || null,
      role,
      emailVerified: false,
      createdAt,
    }
  }

  getUser(id: string): AuthUser | null {
    const row = this.db.query<UserRow, [string]>(
      `SELECT * FROM users WHERE id = ?`
    ).get(id)

    if (!row) return null

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      emailVerified: false,
      createdAt: row.created_at,
    }
  }

  getUserByEmail(email: string): AuthUser | null {
    const row = this.db.query<UserRow, [string]>(
      `SELECT * FROM users WHERE email = ?`
    ).get(email)

    if (!row) return null

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      emailVerified: false,
      createdAt: row.created_at,
    }
  }

  listUsers(search?: string): AuthUser[] {
    let query = `SELECT * FROM users`
    const params: string[] = []

    if (search) {
      query += ` WHERE email LIKE ? OR name LIKE ?`
      params.push(`%${search}%`, `%${search}%`)
    }

    query += ` ORDER BY created_at DESC`

    const rows = this.db.query<UserRow, string[]>(query).all(...params)

    return rows.map(row => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      emailVerified: false,
      createdAt: row.created_at,
    }))
  }

  deleteUser(id: string): boolean {
    const result = this.db.run(`DELETE FROM users WHERE id = ?`, [id])
    return result.changes > 0
  }

  verifyCredentials(email: string, password: string): AuthUser | null {
    const row = this.db.query<UserRow, [string]>(
      `SELECT * FROM users WHERE email = ?`
    ).get(email)

    if (!row || !verifyPassword(password, row.password_hash)) {
      return null
    }

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      emailVerified: false,
      createdAt: row.created_at,
    }
  }

  // =========================================================================
  // Session Management
  // =========================================================================

  createSession(userId: string, expiresInSeconds = 7 * 24 * 60 * 60): AuthSession {
    const id = crypto.randomUUID()
    const token = generateToken()
    const createdAt = Math.floor(Date.now() / 1000)
    const expiresAt = createdAt + expiresInSeconds

    this.db.run(
      `INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, userId, token, expiresAt, createdAt]
    )

    return { id, userId, token, expiresAt, createdAt }
  }

  getSessionByToken(token: string): (AuthSession & { user: AuthUser }) | null {
    const row = this.db.query<SessionRow & UserRow, [string]>(`
      SELECT s.*, u.email, u.name, u.role, u.created_at as user_created_at
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND s.expires_at > unixepoch()
    `).get(token)

    if (!row) return null

    return {
      id: row.id,
      userId: row.user_id,
      token: row.token,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      user: {
        id: row.user_id,
        email: row.email,
        name: row.name,
        role: row.role,
        emailVerified: false,
        createdAt: row.created_at,
      },
    }
  }

  listSessions(userId?: string): AuthSession[] {
    let query = `SELECT * FROM sessions WHERE expires_at > unixepoch()`
    const params: string[] = []

    if (userId) {
      query += ` AND user_id = ?`
      params.push(userId)
    }

    query += ` ORDER BY created_at DESC`

    const rows = this.db.query<SessionRow, string[]>(query).all(...params)

    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      token: row.token,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }))
  }

  revokeSession(id: string): boolean {
    const result = this.db.run(`DELETE FROM sessions WHERE id = ?`, [id])
    return result.changes > 0
  }

  revokeUserSessions(userId: string): number {
    const result = this.db.run(`DELETE FROM sessions WHERE user_id = ?`, [userId])
    return result.changes
  }

  // =========================================================================
  // Token Generation (for API testing)
  // =========================================================================

  generateToken(userId: string, expiresInSeconds = 7 * 24 * 60 * 60): { token: string; expiresAt: number } | null {
    const user = this.getUser(userId)
    if (!user) return null

    const expiresAt = Date.now() + expiresInSeconds * 1000
    const token = generateJWT(user.id, user.email, user.role, expiresAt, this.secret)

    return { token, expiresAt }
  }

  /**
   * Generate an impersonation URL that signs in as the user
   */
  generateImpersonationUrl(userId: string, baseUrl: string): { url: string } | null {
    const user = this.getUser(userId)
    if (!user) return null

    // Create a short-lived session for impersonation (5 minutes)
    const session = this.createSession(userId, 5 * 60)

    return {
      url: `${baseUrl}?__impersonate_token=${session.token}`,
    }
  }

  // =========================================================================
  // Stats
  // =========================================================================

  getStats(): {
    totalUsers: number
    activeSessions: number
  } {
    const userCount = this.db.query<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM users`
    ).get()

    const sessionCount = this.db.query<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM sessions WHERE expires_at > unixepoch()`
    ).get()

    return {
      totalUsers: userCount?.count || 0,
      activeSessions: sessionCount?.count || 0,
    }
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  cleanupExpiredSessions(): number {
    const result = this.db.run(`DELETE FROM sessions WHERE expires_at <= unixepoch()`)
    return result.changes
  }

  close(): void {
    this.db.close()
  }
}

// Global auth store instance
let globalAuthStore: AuthStore | null = null

export function getAuthStore(): AuthStore {
  if (!globalAuthStore) {
    globalAuthStore = new AuthStore()
  }
  return globalAuthStore
}

export function setAuthStore(store: AuthStore): void {
  globalAuthStore = store
}
