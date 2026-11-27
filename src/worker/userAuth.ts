// Local account authentication (email/phone + password, OTP, reset).
// Runs alongside the Freebuff identity: a local account session cookie wins.
import type { Env } from './auth'

export const USER_COOKIE = 'apryadi_session'

export const accountSchema = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS account_sessions (
    token TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    expires_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS account_codes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    code TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS account_security (
    account_id TEXT PRIMARY KEY,
    pin_hash TEXT NOT NULL DEFAULT '',
    pin_salt TEXT NOT NULL DEFAULT '',
    updated_at BIGINT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    window_start BIGINT NOT NULL
  )`,
]

export function randomToken(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export function randomCode(): string {
  const b = new Uint32Array(1)
  crypto.getRandomValues(b)
  return String(b[0] % 1000000).padStart(6, '0')
}

export function makeSalt(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b))
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    // 100k is the ceiling Cloudflare Workers accepts for PBKDF2; higher values
    // throw at runtime and every register/login attempt fails with a 500.
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  )
  return btoa(String.fromCharCode(...new Uint8Array(bits)))
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

export function readCookie(request: Request, name: string): string {
  const header = request.headers.get('cookie') || ''
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

export type AccountRow = {
  id: string
  name: string
  email: string
  phone: string
  password_hash: string
  salt: string
  verified: number
  created_at: number
}

export async function accountFromRequest(
  request: Request,
  env: Env,
): Promise<{ sub: string; name: string; email: string } | null> {
  if (!env.DB) return null
  const token = readCookie(request, USER_COOKIE)
  if (!token) return null
  const row = await env.DB.prepare(
    `SELECT a.id, a.name, a.email, s.expires_at FROM account_sessions s
     JOIN accounts a ON a.id = s.account_id WHERE s.token = ?`,
  )
    .bind(token)
    .first<{ id: string; name: string; email: string; expires_at: number }>()
  if (!row) return null
  if (row.expires_at < Date.now()) {
    await env.DB.prepare('DELETE FROM account_sessions WHERE token = ?').bind(token).run()
    return null
  }
  return { sub: `account:${row.id}`, name: row.name, email: row.email }
}

/** Brute-force guard: max 6 failures per identifier per 10 minutes. */
export async function checkThrottle(db: D1Database, key: string): Promise<boolean> {
  const row = await db.prepare('SELECT count, window_start FROM login_attempts WHERE key = ?').bind(key).first<{ count: number; window_start: number }>()
  if (!row) return true
  if (Date.now() - row.window_start > 10 * 60 * 1000) return true
  return row.count < 6
}

export async function noteFailure(db: D1Database, key: string): Promise<void> {
  const row = await db.prepare('SELECT count, window_start FROM login_attempts WHERE key = ?').bind(key).first<{ count: number; window_start: number }>()
  if (!row || Date.now() - row.window_start > 10 * 60 * 1000) {
    await db.prepare(
      'INSERT INTO login_attempts (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start',
    ).bind(key, Date.now()).run()
  } else {
    await db.prepare('UPDATE login_attempts SET count = count + 1 WHERE key = ?').bind(key).run()
  }
}

export async function clearFailures(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run()
}
