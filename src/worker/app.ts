import { isSameOriginRequest } from '@freebuff/auth'
import type { FreebuffUser } from '@freebuff/auth'
import { Hono, type Handler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { appOrigin, currentUser, isLocalPreview, type Env } from './auth'
import {
  ensureSchema, mapTx, mapSavedAccount, mapNotification, mapProfile, mapAudit,
  getBalance, computeSummary, type TxRow, type SavedAccountRow, type NotificationRow, type ProfileRow, type AuditRow,
} from './db'
import { generateTotpSecret, totpCode, verifyTotp } from './totp'
import {
  USER_COOKIE, accountFromRequest, checkThrottle, clearFailures, constantTimeEqual,
  hashPassword as hashAccountPassword, makeSalt, noteFailure, randomCode, randomToken,
  type AccountRow,
} from './userAuth'
import type {
  Transaction, SavedAccount, AppNotification, Profile, AuditLog, BalanceSummary,
} from '../shared/types'

type AppContext = {
  Bindings: Env & { DB: D1Database }
  Variables: { user: FreebuffUser; db: D1Database; admin: { id: string; username: string; role: string } }
}
type Authenticate = (request: Request, env: Env) => Promise<FreebuffUser | null>

// ---------- helpers ----------
function json(c: any, data: any, status = 200) {
  return c.json(data, status)
}
function uid() { return crypto.randomUUID() }

/**
 * CSRF guard. Uses the canonical origin when configured, otherwise the origin
 * this request was addressed to, and finally the browser-set Sec-Fetch-Site
 * header (the preview proxy can rewrite Host while the page stays same-origin).
 */
function sameOrigin(request: Request, env: Env): boolean {
  const origin = appOrigin(request, env) ?? new URL(request.url).origin
  if (isSameOriginRequest(request, origin)) return true
  // TLS terminates at the preview proxy, so compare hosts rather than schemes.
  const header = request.headers.get('origin')
  if (header && header !== 'null') {
    try {
      const originHost = new URL(header).host
      const allowed = new Set([new URL(origin).host, new URL(request.url).host])
      return allowed.has(originHost)
    } catch {
      return false
    }
  }
  return request.headers.get('sec-fetch-site') === 'same-origin'
}
function now() { return Date.now() }

async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
  return btoa(String.fromCharCode(...new Uint8Array(bits)))
}
function randomSalt() {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b))
}

async function ensureAdminSeed(db: D1Database) {
  const existing = await db.prepare('SELECT id FROM admin_users WHERE username = ?').bind('apryadi').first()
  if (existing) return
  const salt = randomSalt()
  const hash = await hashPassword('megalodon123', salt)
  await db.prepare(
    'INSERT INTO admin_users (id, username, password_hash, salt, role, totp_secret, totp_enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(uid(), 'apryadi', hash, salt, 'superadmin', generateTotpSecret(), 0, now()).run()
}

async function getAdminSession(db: D1Database, token: string): Promise<{ id: string; username: string; role: string } | null> {
  if (!token) return null
  const row = await db.prepare(
    'SELECT s.expires_at, a.id, a.username, a.role FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_id WHERE s.token = ?',
  ).bind(token).first<{ expires_at: number; id: string; username: string; role: string }>()
  if (!row) return null
  if (row.expires_at < now()) {
    await db.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run()
    return null
  }
  return { id: row.id, username: row.username, role: row.role }
}

async function ensureProfile(db: D1Database, user: FreebuffUser) {
  const existing = await db.prepare('SELECT sub FROM profiles WHERE sub = ?').bind(user.sub).first()
  if (existing) return
  await db.prepare(
    'INSERT INTO profiles (sub, name, email, phone, joined_at, avatar_url) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(user.sub, user.name || '', user.email || '', '', now(), '').run()
}

async function addNotification(db: D1Database, sub: string, title: string, message: string, kind = 'info') {
  await db.prepare(
    'INSERT INTO notifications (id, owner_sub, title, message, kind, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
  ).bind(uid(), sub, title, message, kind, now()).run()
}

export function createApp(authenticate: Authenticate = currentUser) {
  const app = new Hono<AppContext>()
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })
  app.use('/api/*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'Request too large.' }, 413) }))

  // ---------- session ----------
  app.get('/api/session', async (c) => {
    const user = await authenticate(c.req.raw, c.env)
    const mode = isLocalPreview(c.req.raw, c.env)
      ? 'local'
      : c.env.FREEBUFF_CLIENT_ID && c.env.APP_ORIGIN
        ? 'freebuff'
        : 'setup'
    let isAdmin = false
    const adminToken = getCookie(c, 'admin_session')
    if (adminToken && c.env.DB) {
      await ensureSchema(c.env.DB)
      const admin = await getAdminSession(c.env.DB, adminToken)
      if (admin) isAdmin = true
    }
    return c.json({
      user,
      mode,
      database: Boolean(c.env.DB),
      isAdmin,
      storage: (c.env as any).APRYADI_STORAGE || (c.env.DB ? 'd1' : 'none'),
      storageNote: (c.env as any).APRYADI_STORAGE_DESCRIBE || '',
    })
  })

  // Account auth routes are CSRF-checked too (login/register CSRF protection).
  app.use('/api/auth/*', async (c, next) => {
    if (!['GET', 'HEAD'].includes(c.req.method) && !sameOrigin(c.req.raw, c.env))
      return c.json({ error: 'Cross-origin request refused.' }, 403)
    await next()
  })

  // ---------- local account auth ----------
  const norm = (v: unknown, max = 120) => String(v ?? '').trim().slice(0, max)
  const emailOk = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)
  const phoneOk = (v: string) => /^\+?[0-9]{8,16}$/.test(v.replace(/[\s-]/g, ''))
  const issueCode = async (db: D1Database, accountId: string, purpose: string) => {
    const code = randomCode()
    await db.prepare(
      'INSERT INTO account_codes (id, account_id, code, purpose, expires_at, consumed, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    ).bind(uid(), accountId, code, purpose, now() + 10 * 60 * 1000, now()).run()
    return code
  }
  const consumeCode = async (db: D1Database, accountId: string, code: string, purpose: string) => {
    const row = await db.prepare(
      `SELECT id FROM account_codes WHERE account_id = ? AND purpose = ? AND consumed = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(accountId, purpose, now()).first<{ id: string }>()
    if (!row) return false
    const full = await db.prepare('SELECT code FROM account_codes WHERE id = ?').bind(row.id).first<{ code: string }>()
    if (!full || !constantTimeEqual(full.code, code)) return false
    await db.prepare('UPDATE account_codes SET consumed = 1 WHERE id = ?').bind(row.id).run()
    return true
  }
  const startSession = async (c: any, accountId: string) => {
    const token = randomToken()
    const expires = now() + 1000 * 60 * 60 * 24 * 7
    await c.env.DB.prepare('INSERT INTO account_sessions (token, account_id, expires_at) VALUES (?, ?, ?)')
      .bind(token, accountId, expires).run()
    setCookie(c, USER_COOKIE, token, {
      httpOnly: true,
      secure: c.req.url.startsWith('https'),
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })
  }

  app.post('/api/auth/register', async (c) => {
    if (!c.env.DB) return c.json({ error: 'Database not configured.' }, 503)
    await ensureSchema(c.env.DB)
    const body: any = await c.req.json().catch(() => null)
    const name = norm(body?.name, 80)
    const email = norm(body?.email).toLowerCase()
    const phone = norm(body?.phone, 24).replace(/[\s-]/g, '')
    const password = String(body?.password ?? '')
    if (name.length < 2) return c.json({ error: 'Nama minimal 2 karakter.' }, 400)
    if (!emailOk(email)) return c.json({ error: 'Format email tidak valid.' }, 400)
    if (phone && !phoneOk(phone)) return c.json({ error: 'Format nomor HP tidak valid.' }, 400)
    if (password.length < 8) return c.json({ error: 'Password minimal 8 karakter.' }, 400)
    const dup = await c.env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first()
    if (dup) return c.json({ error: 'Email sudah terdaftar.' }, 409)
    const salt = makeSalt()
    const hash = await hashAccountPassword(password, salt)
    const id = uid()
    await c.env.DB.prepare(
      'INSERT INTO accounts (id, name, email, phone, password_hash, salt, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
    ).bind(id, name, email, phone, hash, salt, now()).run()
    await ensureProfile(c.env.DB, { sub: `account:${id}`, name, email })
    await c.env.DB.prepare('UPDATE profiles SET phone = ? WHERE sub = ?').bind(phone, `account:${id}`).run()
    const code = await issueCode(c.env.DB, id, 'verify')
    return c.json({ ok: true, requiresOtp: true, demoCode: code, message: 'Kode OTP demo ditampilkan karena pengiriman email/SMS belum dikonfigurasi.' }, 201)
  })

  app.post('/api/auth/verify', async (c) => {
    if (!c.env.DB) return c.json({ error: 'Database not configured.' }, 503)
    await ensureSchema(c.env.DB)
    const body: any = await c.req.json().catch(() => null)
    const email = norm(body?.email).toLowerCase()
    const code = norm(body?.code, 10)
    const acc = await c.env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first<{ id: string }>()
    if (!acc) return c.json({ error: 'Akun tidak ditemukan.' }, 404)
    const ok = await consumeCode(c.env.DB, acc.id, code, 'verify')
    if (!ok) return c.json({ error: 'Kode OTP salah atau kedaluwarsa.' }, 400)
    await c.env.DB.prepare('UPDATE accounts SET verified = 1 WHERE id = ?').bind(acc.id).run()
    await startSession(c, acc.id)
    return c.json({ ok: true })
  })

  app.post('/api/auth/resend', async (c) => {
    if (!c.env.DB) return c.json({ error: 'Database not configured.' }, 503)
    await ensureSchema(c.env.DB)
    const body: any = await c.req.json().catch(() => null)
    const email = norm(body?.email).toLowerCase()
    const acc = await c.env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first<{ id: string }>()
    if (!acc) return c.json({ error: 'Akun tidak ditemukan.' }, 404)
    const code = await issueCode(c.env.DB, acc.id, 'verify')
    return c.json({ ok: true, demoCode: code })
  })

  app.post('/api/auth/login', async (c) => {
    if (!c.env.DB) return c.json({ error: 'Database not configured.' }, 503)
    await ensureSchema(c.env.DB)
    const body: any = await c.req.json().catch(() => null)
    const identifier = norm(body?.identifier).toLowerCase().replace(/[\s-]/g, '')
    const password = String(body?.password ?? '')
    if (!identifier || !password) return c.json({ error: 'Email/nomor HP dan password wajib diisi.' }, 400)
    const key = `user:${identifier}`
    if (!(await checkThrottle(c.env.DB, key)))
      return c.json({ error: 'Terlalu banyak percobaan. Coba lagi dalam 10 menit.' }, 429)
    const acc = await c.env.DB.prepare('SELECT * FROM accounts WHERE email = ? OR phone = ?')
      .bind(identifier, identifier).first<AccountRow>()
    if (!acc) {
      await noteFailure(c.env.DB, key)
      return c.json({ error: 'Email/nomor HP atau password salah.' }, 401)
    }
    const hash = await hashAccountPassword(password, acc.salt)
    if (!constantTimeEqual(hash, acc.password_hash)) {
      await noteFailure(c.env.DB, key)
      return c.json({ error: 'Email/nomor HP atau password salah.' }, 401)
    }
    await clearFailures(c.env.DB, key)
    if (!acc.verified) {
      const code = await issueCode(c.env.DB, acc.id, 'verify')
      return c.json({ error: 'Akun belum diverifikasi. Masukkan kode OTP.', requiresOtp: true, demoCode: code }, 403)
    }
    await startSession(c, acc.id)
    return c.json({ ok: true, account: { name: acc.name, email: acc.email } })
  })

  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, USER_COOKIE)
    if (token && c.env.DB) {
      await c.env.DB.prepare('DELETE FROM account_sessions WHERE token = ?').bind(token).run()
    }
    deleteCookie(c, USER_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/api/auth/me', async (c) => {
    if (!c.env.DB) return c.json({ account: null })
    await ensureSchema(c.env.DB)
    const account = await accountFromRequest(c.req.raw, c.env)
    return c.json({ account })
  })

  app.post('/api/auth/forgot', async (c) => {
    if (!c.env.DB) return c.json({ error: 'Database not configured.' }, 503)
    await ensureSchema(c.env.DB)
    const body: any = await c.req.json().catch(() => null)
    const identifier = norm(body?.identifier).toLowerCase().replace(/[\s-]/g, '')
    const acc = await c.env.DB.prepare('SELECT id FROM accounts WHERE email = ? OR phone = ?')
      .bind(identifier, identifier).first<{ id: string }>()
    if (!acc) return c.json({ error: 'Akun tidak ditemukan.' }, 404)
    const code = await issueCode(c.env.DB, acc.id, 'reset')
    return c.json({ ok: true, demoCode: code })
  })

  app.post('/api/auth/reset', async (c) => {
    if (!c.env.DB) return c.json({ error: 'Database not configured.' }, 503)
    await ensureSchema(c.env.DB)
    const body: any = await c.req.json().catch(() => null)
    const identifier = norm(body?.identifier).toLowerCase().replace(/[\s-]/g, '')
    const code = norm(body?.code, 10)
    const password = String(body?.password ?? '')
    if (password.length < 8) return c.json({ error: 'Password minimal 8 karakter.' }, 400)
    const acc = await c.env.DB.prepare('SELECT id FROM accounts WHERE email = ? OR phone = ?')
      .bind(identifier, identifier).first<{ id: string }>()
    if (!acc) return c.json({ error: 'Akun tidak ditemukan.' }, 404)
    const ok = await consumeCode(c.env.DB, acc.id, code, 'reset')
    if (!ok) return c.json({ error: 'Kode reset salah atau kedaluwarsa.' }, 400)
    const salt = makeSalt()
    const hash = await hashAccountPassword(password, salt)
    await c.env.DB.prepare('UPDATE accounts SET password_hash = ?, salt = ? WHERE id = ?').bind(hash, salt, acc.id).run()
    await c.env.DB.prepare('DELETE FROM account_sessions WHERE account_id = ?').bind(acc.id).run()
    return c.json({ ok: true })
  })

  // ---------- admin auth ----------
  app.post('/api/admin/login', async (c) => {
    if (!c.env.DB) return c.json({ error: 'Database not configured.' }, 503)
    await ensureSchema(c.env.DB)
    await ensureAdminSeed(c.env.DB)
    const body: any = await c.req.json().catch(() => null)
    const username = String(body?.username || '').trim()
    const password = String(body?.password || '')
    const totp = String(body?.totp || '').trim()
    if (!username || !password) return c.json({ error: 'Username and password required.' }, 400)
    const throttleKey = `admin:${username}`
    if (!(await checkThrottle(c.env.DB, throttleKey)))
      return c.json({ error: 'Terlalu banyak percobaan. Coba lagi dalam 10 menit.' }, 429)
    const row = await c.env.DB.prepare(
      'SELECT id, username, password_hash, salt, role, totp_secret, totp_enabled FROM admin_users WHERE username = ?',
    ).bind(username).first<any>()
    if (!row) {
      await noteFailure(c.env.DB, throttleKey)
      return c.json({ error: 'Invalid credentials.' }, 401)
    }
    const hash = await hashPassword(password, row.salt)
    if (hash !== row.password_hash) {
      await noteFailure(c.env.DB, throttleKey)
      return c.json({ error: 'Invalid credentials.' }, 401)
    }
    await clearFailures(c.env.DB, throttleKey)
    if (row.totp_enabled) {
      if (!totp) return c.json({ error: '2FA code required.', requires2fa: true }, 401)
      const ok = await verifyTotp(row.totp_secret, totp)
      if (!ok) return c.json({ error: 'Invalid 2FA code.' }, 401)
    }
    const token = crypto.randomUUID() + crypto.randomUUID()
    const expires = now() + 1000 * 60 * 60 * 8
    await c.env.DB.prepare(
      'INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)',
    ).bind(token, row.id, expires).run()
    setCookie(c, 'admin_session', token, {
      httpOnly: true,
      secure: c.req.url.startsWith('https'),
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 8,
    })
    return c.json({ ok: true, admin: { id: row.id, username: row.username, role: row.role } })
  })

  app.post('/api/admin/logout', async (c) => {
    const token = getCookie(c, 'admin_session')
    if (token && c.env.DB) {
      await c.env.DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run()
    }
    deleteCookie(c, 'admin_session', { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/api/admin/session', async (c) => {
    if (!c.env.DB) return c.json({ admin: null })
    await ensureSchema(c.env.DB)
    const token = getCookie(c, 'admin_session')
    const admin = token ? await getAdminSession(c.env.DB, token) : null
    return c.json({ admin })
  })

  // admin guard middleware
  const adminGuard = async (c: any, next: any) => {
    if (!c.env.DB) return c.json({ error: 'Database not configured.' }, 503)
    if (!['GET', 'HEAD'].includes(c.req.method) && !sameOrigin(c.req.raw, c.env)) {
      return c.json({ error: 'Cross-origin request refused.' }, 403)
    }
    await ensureSchema(c.env.DB)
    const token = getCookie(c, 'admin_session')
    const admin = token ? await getAdminSession(c.env.DB, token) : null
    if (!admin) return c.json({ error: 'Admin sign in required.' }, 401)
    c.set('admin', admin)
    await next()
  }

  // ---------- user guard ----------
  const userGuard = async (c: any, next: any) => {
    const user = await authenticate(c.req.raw, c.env)
    if (!user) return c.json({ error: 'Sign in required.' }, 401)
    if (!['GET', 'HEAD'].includes(c.req.method) && !sameOrigin(c.req.raw, c.env)) {
      return c.json({ error: 'Cross-origin request refused.' }, 403)
    }
    if (!c.env.DB) return c.json({ error: 'This app is still being set up.' }, 503)
    await ensureSchema(c.env.DB)
    await ensureProfile(c.env.DB, user)
    c.set('user', user)
    c.set('db', c.env.DB)
    await next()
  }

  app.use('/api/profile*', userGuard)
  app.use('/api/balance*', userGuard)
  app.use('/api/transactions*', userGuard)
  app.use('/api/deposit*', userGuard)
  app.use('/api/withdraw*', userGuard)
  app.use('/api/transfer*', userGuard)
  app.use('/api/receive*', userGuard)
  app.use('/api/saved-accounts*', userGuard)
  app.use('/api/notifications*', userGuard)
  app.use('/api/reports*', userGuard)

  // ---------- account password / transaction PIN ----------
  const accountIdOf = (sub: string) => (sub.startsWith('account:') ? sub.slice('account:'.length) : '')

  app.get('/api/profile/pin-status', async (c) => {
    const id = accountIdOf(c.get('user').sub)
    if (!id) return c.json({ hasPin: false })
    const row = await c.env.DB.prepare('SELECT pin_hash FROM account_security WHERE account_id = ?').bind(id).first<{ pin_hash: string }>()
    return c.json({ hasPin: Boolean(row?.pin_hash) })
  })

  app.post('/api/profile/pin', async (c) => {
    const id = accountIdOf(c.get('user').sub)
    if (!id) return c.json({ error: 'Fitur PIN hanya untuk akun email/HP.' }, 400)
    const body: any = await c.req.json().catch(() => null)
    const pin = String(body?.pin ?? '').trim()
    if (!/^[0-9]{4,6}$/.test(pin)) return c.json({ error: 'PIN harus 4-6 digit angka.' }, 400)
    const salt = makeSalt()
    const hash = await hashAccountPassword(pin, salt)
    await c.env.DB.prepare(
      'INSERT INTO account_security (account_id, pin_hash, pin_salt, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET pin_hash = excluded.pin_hash, pin_salt = excluded.pin_salt, updated_at = excluded.updated_at',
    ).bind(id, hash, salt, now()).run()
    return c.json({ ok: true })
  })

  const verifyTransactionPin = async (db: D1Database, sub: string, pin: string): Promise<'ok' | 'missing' | 'wrong'> => {
    const id = accountIdOf(sub)
    if (!id) return 'ok'
    const row = await db.prepare('SELECT pin_hash, pin_salt FROM account_security WHERE account_id = ?').bind(id).first<{ pin_hash: string; pin_salt: string }>()
    if (!row?.pin_hash) return 'missing'
    const hash = await hashAccountPassword(pin, row.pin_salt)
    return constantTimeEqual(hash, row.pin_hash) ? 'ok' : 'wrong'
  }

  app.post('/api/profile/password', async (c) => {
    const user = c.get('user')
    const id = accountIdOf(user.sub)
    if (!id) return c.json({ error: 'Akun platform tidak memiliki password lokal.' }, 400)
    const body: any = await c.req.json().catch(() => null)
    const current = String(body?.currentPassword ?? '')
    const next = String(body?.newPassword ?? '')
    if (next.length < 8) return c.json({ error: 'Password baru minimal 8 karakter.' }, 400)
    const acc = await c.env.DB.prepare('SELECT password_hash, salt FROM accounts WHERE id = ?').bind(id).first<{ password_hash: string; salt: string }>()
    if (!acc) return c.json({ error: 'Akun tidak ditemukan.' }, 404)
    const currentHash = await hashAccountPassword(current, acc.salt)
    if (!constantTimeEqual(currentHash, acc.password_hash)) return c.json({ error: 'Password saat ini salah.' }, 401)
    const salt = makeSalt()
    const hash = await hashAccountPassword(next, salt)
    await c.env.DB.prepare('UPDATE accounts SET password_hash = ?, salt = ? WHERE id = ?').bind(hash, salt, id).run()
    return c.json({ ok: true })
  })

  // ---------- profile ----------
  app.get('/api/profile', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const row = await db.prepare('SELECT * FROM profiles WHERE sub = ?').bind(user.sub).first<ProfileRow>()
    return c.json({ profile: row ? mapProfile(row) : null })
  })
  app.patch('/api/profile', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const body: any = await c.req.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : undefined
    const phone = typeof body?.phone === 'string' ? body.phone.trim().slice(0, 30) : undefined
    const avatarUrl = typeof body?.avatarUrl === 'string' ? body.avatarUrl.trim().slice(0, 500) : undefined
    const fields: string[] = []
    const vals: any[] = []
    if (name !== undefined) { fields.push('name = ?'); vals.push(name) }
    if (phone !== undefined) { fields.push('phone = ?'); vals.push(phone) }
    if (avatarUrl !== undefined) { fields.push('avatar_url = ?'); vals.push(avatarUrl) }
    if (fields.length) {
      vals.push(user.sub)
      await db.prepare(`UPDATE profiles SET ${fields.join(', ')} WHERE sub = ?`).bind(...vals).run()
    }
    const row = await db.prepare('SELECT * FROM profiles WHERE sub = ?').bind(user.sub).first<ProfileRow>()
    return c.json({ profile: row ? mapProfile(row) : null })
  })

  // ---------- balance ----------
  app.get('/api/balance', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const summary = await computeSummary(db, user.sub)
    return c.json({ balance: summary })
  })

  // ---------- transactions list (with filters) ----------
  app.get('/api/transactions', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const q = c.req.query('q') || ''
    const type = c.req.query('type') || 'all'
    const status = c.req.query('status') || 'all'
    const sort = c.req.query('sort') || 'newest'
    const limit = Math.min(parseInt(c.req.query('limit') || '200', 10) || 200, 500)
    let sql = 'SELECT * FROM transactions WHERE owner_sub = ?'
    const params: any[] = [user.sub]
    if (q.trim()) {
      sql += ' AND (note LIKE ? OR CAST(amount AS TEXT) LIKE ? OR type LIKE ? OR reference LIKE ?)'
      const like = `%${q.trim()}%`
      params.push(like, like, like, like)
    }
    if (type !== 'all') {
      if (type === 'in') sql += " AND type IN ('deposit','transfer_in','qris_in','admin_adjustment')"
      else if (type === 'out') sql += " AND type IN ('withdraw','transfer_out','qris_out')"
      else { sql += ' AND type = ?'; params.push(type) }
    }
    if (status !== 'all') { sql += ' AND status = ?'; params.push(status) }
    if (sort === 'oldest') sql += ' ORDER BY created_at ASC, id ASC'
    else if (sort === 'amount_desc') sql += ' ORDER BY amount DESC, created_at DESC'
    else if (sort === 'amount_asc') sql += ' ORDER BY amount ASC, created_at DESC'
    else sql += ' ORDER BY created_at DESC, id DESC'
    sql += ' LIMIT ?'
    params.push(limit)
    const result = await db.prepare(sql).bind(...params).all<TxRow>()
    return c.json({ transactions: result.results.map(mapTx) })
  })

  app.get('/api/transactions/:id', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const row = await db.prepare('SELECT * FROM transactions WHERE id = ? AND owner_sub = ?').bind(c.req.param('id'), user.sub).first<TxRow>()
    if (!row) return c.json({ error: 'Not found.' }, 404)
    return c.json({ transaction: mapTx(row) })
  })

  // ---------- deposit (tambah tabungan) ----------
  app.post('/api/deposit', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const body: any = await c.req.json().catch(() => null)
    const amount = Number(body?.amount)
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) return c.json({ error: 'Nominal tidak valid.' }, 400)
    if (amount > 1000000000) return c.json({ error: 'Nominal terlalu besar.' }, 400)
    const note = String(body?.note || '').trim().slice(0, 200)
    const txDate = body?.date ? new Date(body.date).getTime() : now()
    const createdAt = Number.isFinite(txDate) ? txDate : now()
    const balanceBefore = await getBalance(db, user.sub)
    const balanceAfter = balanceBefore + amount
    const txId = uid()
    const reference = 'DEP-' + txId.slice(0, 8).toUpperCase()
    await db.prepare(
      `INSERT INTO transactions (id, owner_sub, type, amount, note, status, balance_before, balance_after, counterparty, reference, created_at)
       VALUES (?, ?, 'deposit', ?, ?, 'success', ?, ?, '', ?, ?)`,
    ).bind(txId, user.sub, amount, note || 'Tambah tabungan', balanceBefore, balanceAfter, reference, createdAt).run()
    await addNotification(db, user.sub, 'Tabungan berhasil ditambahkan', `Rp${amount.toLocaleString('id-ID')} telah ditambahkan ke saldo Anda.`, 'success')
    return c.json({ transaction: { id: txId, type: 'deposit', amount, note, status: 'success', balanceBefore, balanceAfter, counterparty: '', reference, createdAt } })
  })

  // ---------- withdraw (tarik saldo) ----------
  app.post('/api/withdraw', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const body: any = await c.req.json().catch(() => null)
    const amount = Number(body?.amount)
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) return c.json({ error: 'Nominal tidak valid.' }, 400)
    const note = String(body?.note || '').trim().slice(0, 200)
    const pin = String(body?.pin || '')
    if (!pin) return c.json({ error: 'PIN transaksi diperlukan.' }, 400)
    const pinCheck = await verifyTransactionPin(db, user.sub, pin)
    if (pinCheck === 'wrong') return c.json({ error: 'PIN transaksi salah.' }, 401)
    const balanceBefore = await getBalance(db, user.sub)
    if (amount > balanceBefore) return c.json({ error: 'Saldo tidak mencukupi.' }, 400)
    const balanceAfter = balanceBefore - amount
    const txId = uid()
    const reference = 'WDR-' + txId.slice(0, 8).toUpperCase()
    await db.prepare(
      `INSERT INTO transactions (id, owner_sub, type, amount, note, status, balance_before, balance_after, counterparty, reference, created_at)
       VALUES (?, ?, 'withdraw', ?, ?, 'success', ?, ?, ?, ?, ?)`,
    ).bind(txId, user.sub, amount, note || 'Tarik saldo', balanceBefore, balanceAfter, String(body?.destination || ''), reference, now()).run()
    await addNotification(db, user.sub, 'Penarikan berhasil', `Rp${amount.toLocaleString('id-ID')} telah ditarik dari saldo Anda.`, 'success')
    return c.json({ transaction: { id: txId, type: 'withdraw', amount, note, status: 'success', balanceBefore, balanceAfter, counterparty: body?.destination || '', reference, createdAt: now() } })
  })

  // ---------- transfer (kirim uang) ----------
  app.post('/api/transfer', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const body: any = await c.req.json().catch(() => null)
    const amount = Number(body?.amount)
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) return c.json({ error: 'Nominal tidak valid.' }, 400)
    const recipient = String(body?.recipient || '').trim()
    const recipientName = String(body?.recipientName || '').trim()
    const bank = String(body?.bank || '').trim()
    const note = String(body?.note || '').trim().slice(0, 200)
    const pin = String(body?.pin || '')
    if (!recipient) return c.json({ error: 'Nomor rekening tujuan diperlukan.' }, 400)
    if (!pin) return c.json({ error: 'PIN transaksi diperlukan.' }, 400)
    const pinCheck = await verifyTransactionPin(db, user.sub, pin)
    if (pinCheck === 'wrong') return c.json({ error: 'PIN transaksi salah.' }, 401)
    const fee = amount >= 100000 ? 0 : 2500
    const total = amount + fee
    const balanceBefore = await getBalance(db, user.sub)
    if (total > balanceBefore) return c.json({ error: 'Saldo tidak mencukupi (termasuk biaya).' }, 400)
    const balanceAfter = balanceBefore - total
    const txId = uid()
    const reference = 'TRF-' + txId.slice(0, 8).toUpperCase()
    const cp = recipientName ? `${recipientName} (${recipient})` : recipient
    await db.prepare(
      `INSERT INTO transactions (id, owner_sub, type, amount, note, status, balance_before, balance_after, counterparty, reference, created_at)
       VALUES (?, ?, 'transfer_out', ?, ?, 'success', ?, ?, ?, ?, ?)`,
    ).bind(txId, user.sub, total, note || `Transfer ke ${cp}`, balanceBefore, balanceAfter, cp, reference, now()).run()
    if (fee > 0) {
      await addNotification(db, user.sub, 'Transfer berhasil', `Rp${amount.toLocaleString('id-ID')} + biaya Rp${fee.toLocaleString('id-ID')} telah ditransfer.`, 'success')
    } else {
      await addNotification(db, user.sub, 'Transfer berhasil', `Rp${amount.toLocaleString('id-ID')} telah ditransfer ke ${cp}.`, 'success')
    }
    return c.json({ transaction: { id: txId, type: 'transfer_out', amount: total, note, status: 'success', balanceBefore, balanceAfter, counterparty: cp, reference, createdAt: now(), fee } })
  })

  // ---------- receive / qris ----------
  app.post('/api/receive/qris', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const body: any = await c.req.json().catch(() => null)
    const amount = body?.amount ? Number(body.amount) : 0
    if (amount && (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount))) return c.json({ error: 'Nominal tidak valid.' }, 400)
    const note = String(body?.note || '').trim().slice(0, 200)
    const txId = uid()
    const reference = 'QRIS-' + txId.slice(0, 8).toUpperCase()
    const amt = amount || 0
    const balanceBefore = await getBalance(db, user.sub)
    await db.prepare(
      `INSERT INTO transactions (id, owner_sub, type, amount, note, status, balance_before, balance_after, counterparty, reference, created_at)
       VALUES (?, ?, 'qris_in', ?, ?, 'pending', ?, ?, '', ?, ?)`,
    ).bind(txId, user.sub, amt, note || 'Permintaan pembayaran QRIS', balanceBefore, balanceBefore, reference, now()).run()
    return c.json({
      payment: {
        id: txId,
        reference,
        amount: amt,
        status: 'pending',
        qrPayload: `00020101021226...${reference}...5802ID5913ApryadiGoal6007Jakarta62070703***6304ABCD`,
        note,
        createdAt: now(),
      },
    })
  })

  app.get('/api/receive/qris/:id', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const row = await db.prepare('SELECT * FROM transactions WHERE id = ? AND owner_sub = ?').bind(c.req.param('id'), user.sub).first<TxRow>()
    if (!row) return c.json({ error: 'Not found.' }, 404)
    return c.json({ payment: mapTx(row) })
  })

  // Demo confirm payment (simulates webhook) - credits balance
  app.post('/api/receive/confirm/:id', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const row = await db.prepare('SELECT * FROM transactions WHERE id = ? AND owner_sub = ?').bind(c.req.param('id'), user.sub).first<TxRow>()
    if (!row) return c.json({ error: 'Not found.' }, 404)
    if (row.status === 'success') return c.json({ ok: true, already: true })
    const amount = row.amount || 0
    if (amount <= 0) {
      const body: any = await c.req.json().catch(() => null)
      const a = Number(body?.amount)
      if (!Number.isFinite(a) || a <= 0) return c.json({ error: 'Nominal pembayaran diperlukan.' }, 400)
      await db.prepare('UPDATE transactions SET amount = ? WHERE id = ?').bind(a, row.id).run()
    }
    const fresh = await db.prepare('SELECT * FROM transactions WHERE id = ?').bind(row.id).first<TxRow>()
    const amt = fresh!.amount
    const balanceBefore = await getBalance(db, user.sub)
    const balanceAfter = balanceBefore + amt
    await db.prepare(
      `UPDATE transactions SET status='success', amount=?, balance_before=?, balance_after=? WHERE id=?`,
    ).bind(amt, balanceBefore, balanceAfter, row.id).run()
    await addNotification(db, user.sub, 'Pembayaran diterima', `Rp${amt.toLocaleString('id-ID')} telah diterima via QRIS.`, 'success')
    return c.json({ ok: true })
  })

  // ---------- saved accounts ----------
  app.get('/api/saved-accounts', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const result = await db.prepare('SELECT * FROM saved_accounts WHERE owner_sub = ? ORDER BY created_at DESC').bind(user.sub).all<SavedAccountRow>()
    return c.json({ accounts: result.results.map(mapSavedAccount) })
  })
  app.post('/api/saved-accounts', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const body: any = await c.req.json().catch(() => null)
    const name = String(body?.name || '').trim().slice(0, 60)
    const accountNumber = String(body?.accountNumber || '').trim().slice(0, 40)
    const bank = String(body?.bank || '').trim().slice(0, 40)
    if (!name || !accountNumber) return c.json({ error: 'Nama dan nomor rekening diperlukan.' }, 400)
    const id = uid()
    await db.prepare(
      'INSERT INTO saved_accounts (id, owner_sub, name, account_number, bank, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(id, user.sub, name, accountNumber, bank, now()).run()
    return c.json({ account: { id, name, accountNumber, bank, createdAt: now() } })
  })
  app.delete('/api/saved-accounts/:id', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    await db.prepare('DELETE FROM saved_accounts WHERE id = ? AND owner_sub = ?').bind(c.req.param('id'), user.sub).run()
    return c.json({ ok: true })
  })

  // ---------- notifications ----------
  app.get('/api/notifications', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const result = await db.prepare('SELECT * FROM notifications WHERE owner_sub = ? ORDER BY created_at DESC LIMIT 100').bind(user.sub).all<NotificationRow>()
    return c.json({ notifications: result.results.map(mapNotification) })
  })
  app.patch('/api/notifications/:id', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const body: any = await c.req.json().catch(() => null)
    const read = body?.read !== false
    await db.prepare('UPDATE notifications SET read = ? WHERE id = ? AND owner_sub = ?').bind(read ? 1 : 0, c.req.param('id'), user.sub).run()
    return c.json({ ok: true })
  })
  app.post('/api/notifications/read-all', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    await db.prepare('UPDATE notifications SET read = 1 WHERE owner_sub = ?').bind(user.sub).run()
    return c.json({ ok: true })
  })

  // ---------- reports ----------
  app.get('/api/reports', async (c) => {
    const user = c.get('user')
    const db = c.get('db')
    const period = c.req.query('period') || 'month'
    let since = 0
    const n = now()
    if (period === 'today') since = n - 24 * 60 * 60 * 1000
    else if (period === 'week') since = n - 7 * 24 * 60 * 60 * 1000
    else if (period === 'month') since = n - 30 * 24 * 60 * 60 * 1000
    else if (period === 'year') since = n - 365 * 24 * 60 * 60 * 1000
    else if (period === 'custom') {
      const from = parseInt(c.req.query('from') || '0', 10)
      const to = parseInt(c.req.query('to') || String(n), 10)
      since = from
      const result = await db.prepare(
        'SELECT * FROM transactions WHERE owner_sub = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC',
      ).bind(user.sub, from, to).all<TxRow>()
      const txs = result.results.map(mapTx)
      const summary = await computeSummary(db, user.sub)
      return c.json({ period, transactions: txs, summary })
    }
    const result = await db.prepare(
      'SELECT * FROM transactions WHERE owner_sub = ? AND created_at >= ? ORDER BY created_at DESC',
    ).bind(user.sub, since).all<TxRow>()
    const txs = result.results.map(mapTx)
    const summary = await computeSummary(db, user.sub)
    return c.json({ period, transactions: txs, summary, since })
  })

  // ---------- admin routes ----------
  app.use('/api/admin/users*', adminGuard)
  app.use('/api/admin/transactions*', adminGuard)
  app.use('/api/admin/pending*', adminGuard)
  app.use('/api/admin/audit*', adminGuard)
  app.use('/api/admin/stats*', adminGuard)
  app.use('/api/admin/notify*', adminGuard)
  app.use('/api/admin/settings*', adminGuard)
  app.use('/api/admin/totp*', adminGuard)
  app.use('/api/admin/failed*', adminGuard)

  app.get('/api/admin/stats', async (c) => {
    const database = c.env.DB
    const users = await database.prepare('SELECT COUNT(*) AS c FROM profiles').first<{ c: number }>()
    const txs = await database.prepare('SELECT COUNT(*) AS c FROM transactions').first<{ c: number }>()
    const pending = await database.prepare("SELECT COUNT(*) AS c FROM transactions WHERE status='pending'").first<{ c: number }>()
    const volume = await database.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE status='success'").first<{ s: number }>()
    return c.json({
      users: users?.c ?? 0,
      transactions: txs?.c ?? 0,
      pending: pending?.c ?? 0,
      volume: volume?.s ?? 0,
    })
  })

  app.get('/api/admin/users', async (c) => {
    const db = c.env.DB
    const result = await db.prepare('SELECT * FROM profiles ORDER BY joined_at DESC LIMIT 500').all<ProfileRow>()
    const profiles = result.results.map(mapProfile)
    const out = []
    for (const p of profiles) {
      const bal = await getBalance(db, p.sub)
      const cnt = await db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE owner_sub = ?').bind(p.sub).first<{ c: number }>()
      out.push({ ...p, balance: bal, txCount: cnt?.c ?? 0 })
    }
    return c.json({ users: out })
  })

  app.get('/api/admin/users/:sub', async (c) => {
    const db = c.env.DB
    const sub = c.req.param('sub')
    const row = await db.prepare('SELECT * FROM profiles WHERE sub = ?').bind(sub).first<ProfileRow>()
    if (!row) return c.json({ error: 'Not found.' }, 404)
    const bal = await getBalance(db, sub)
    const txResult = await db.prepare('SELECT * FROM transactions WHERE owner_sub = ? ORDER BY created_at DESC LIMIT 100').bind(sub).all<TxRow>()
    return c.json({ profile: mapProfile(row), balance: bal, transactions: txResult.results.map(mapTx) })
  })

  app.patch('/api/admin/users/:sub', async (c) => {
    const db = c.env.DB
    const admin = c.get('admin')
    const sub = c.req.param('sub')
    const body: any = await c.req.json().catch(() => null)
    const action = String(body?.action || '')
    const reason = String(body?.reason || '').trim()
    const note = String(body?.note || '').trim().slice(0, 500)
    if (!reason) return c.json({ error: 'Alasan wajib diisi.' }, 400)
    if (action === 'adjust_balance') {
      const amount = Number(body?.amount)
      if (!Number.isFinite(amount) || amount === 0) return c.json({ error: 'Nominal tidak valid.' }, 400)
      const balanceBefore = await getBalance(db, sub)
      const balanceAfter = balanceBefore + amount
      if (balanceAfter < 0) return c.json({ error: 'Saldo tidak boleh negatif.' }, 400)
      const txId = uid()
      await db.prepare(
        `INSERT INTO transactions (id, owner_sub, type, amount, note, status, balance_before, balance_after, counterparty, reference, created_at)
         VALUES (?, ?, 'admin_adjustment', ?, ?, 'success', ?, ?, ?, ?, ?)`,
      ).bind(txId, sub, amount, note || `Penyesuaian admin: ${reason}`, balanceBefore, balanceAfter, `Admin: ${admin.username}`, 'ADJ-' + txId.slice(0, 8).toUpperCase(), now()).run()
      await db.prepare(
        `INSERT INTO audit_logs (id, admin_id, admin_username, action, target_sub, reason, note, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(uid(), admin.id, admin.username, 'adjust_balance', sub, reason, note, amount, now()).run()
      await addNotification(db, sub, 'Penyesuaian saldo', `Saldo Anda disesuaikan oleh admin: ${amount >= 0 ? '+' : ''}Rp${amount.toLocaleString('id-ID')}. Alasan: ${reason}`, 'info')
      return c.json({ ok: true, balanceBefore, balanceAfter })
    }
    if (action === 'suspend' || action === 'activate') {
      await db.prepare(
        `INSERT INTO audit_logs (id, admin_id, admin_username, action, target_sub, reason, note, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).bind(uid(), admin.id, admin.username, action, sub, reason, note, now()).run()
      return c.json({ ok: true })
    }
    return c.json({ error: 'Aksi tidak dikenal.' }, 400)
  })

  app.get('/api/admin/transactions', async (c) => {
    const db = c.env.DB
    const result = await db.prepare('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 500').all<TxRow>()
    return c.json({ transactions: result.results.map(mapTx) })
  })

  app.get('/api/admin/pending', async (c) => {
    const db = c.env.DB
    const result = await db.prepare("SELECT * FROM transactions WHERE status='pending' ORDER BY created_at DESC LIMIT 200").all<TxRow>()
    return c.json({ transactions: result.results.map(mapTx) })
  })

  app.get('/api/admin/failed', async (c) => {
    const db = c.env.DB
    const result = await db.prepare("SELECT * FROM transactions WHERE status='failed' ORDER BY created_at DESC LIMIT 200").all<TxRow>()
    return c.json({ transactions: result.results.map(mapTx) })
  })

  app.patch('/api/admin/transactions/:id', async (c) => {
    const db = c.env.DB
    const admin = c.get('admin')
    const body: any = await c.req.json().catch(() => null)
    const status = String(body?.status || '')
    const reason = String(body?.reason || '').trim()
    if (!['success', 'failed'].includes(status)) return c.json({ error: 'Status tidak valid.' }, 400)
    if (!reason) return c.json({ error: 'Alasan wajib diisi.' }, 400)
    const row = await db.prepare('SELECT * FROM transactions WHERE id = ?').bind(c.req.param('id')).first<TxRow>()
    if (!row) return c.json({ error: 'Not found.' }, 404)
    if (row.status === status) return c.json({ ok: true })
    if (row.status === 'pending' && status === 'success') {
      const balanceBefore = await getBalance(db, row.owner_sub)
      const balanceAfter = balanceBefore + row.amount
      await db.prepare('UPDATE transactions SET status=?, balance_before=?, balance_after=? WHERE id=?').bind(status, balanceBefore, balanceAfter, row.id).run()
    } else {
      await db.prepare('UPDATE transactions SET status=? WHERE id=?').bind(status, row.id).run()
    }
    await db.prepare(
      `INSERT INTO audit_logs (id, admin_id, admin_username, action, target_sub, reason, note, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid(), admin.id, admin.username, `tx_${status}`, row.owner_sub, reason, `Tx ${row.id}`, row.amount, now()).run()
    return c.json({ ok: true })
  })

  app.get('/api/admin/audit', async (c) => {
    const db = c.env.DB
    const result = await db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500').all<AuditRow>()
    return c.json({ logs: result.results.map(mapAudit) })
  })

  app.post('/api/admin/notify', async (c) => {
    const db = c.env.DB
    const body: any = await c.req.json().catch(() => null)
    const title = String(body?.title || '').trim().slice(0, 80)
    const message = String(body?.message || '').trim().slice(0, 500)
    const target = String(body?.target || 'all')
    if (!title || !message) return c.json({ error: 'Judul dan pesan diperlukan.' }, 400)
    if (target === 'all') {
      const users = await db.prepare('SELECT sub FROM profiles').all<{ sub: string }>()
      for (const u of users.results) {
        await addNotification(db, u.sub, title, message, 'info')
      }
    } else {
      await addNotification(db, target, title, message, 'info')
    }
    return c.json({ ok: true })
  })

  app.get('/api/admin/totp/setup', async (c) => {
    const db = c.env.DB
    const admin = c.get('admin')
    const row = await db.prepare('SELECT totp_secret, totp_enabled FROM admin_users WHERE id = ?').bind(admin.id).first<any>()
    const secret = row?.totp_secret || generateTotpSecret()
    if (!row?.totp_secret) {
      await db.prepare('UPDATE admin_users SET totp_secret = ? WHERE id = ?').bind(secret, admin.id).run()
    }
    const uri = `otpauth://totp/ApryadiGoal:${admin.username}?secret=${secret}&issuer=ApryadiGoal&digits=6&period=30`
    const code = await totpCode(secret)
    return c.json({ secret, uri, enabled: Boolean(row?.totp_enabled), currentCode: code })
  })

  app.post('/api/admin/totp/enable', async (c) => {
    const db = c.env.DB
    const admin = c.get('admin')
    const body: any = await c.req.json().catch(() => null)
    const code = String(body?.code || '').trim()
    const row = await db.prepare('SELECT totp_secret FROM admin_users WHERE id = ?').bind(admin.id).first<any>()
    if (!row) return c.json({ error: 'Not found.' }, 404)
    const ok = await verifyTotp(row.totp_secret, code)
    if (!ok) return c.json({ error: 'Kode 2FA tidak valid.' }, 400)
    await db.prepare('UPDATE admin_users SET totp_enabled = 1 WHERE id = ?').bind(admin.id).run()
    return c.json({ ok: true })
  })

  app.post('/api/admin/totp/disable', async (c) => {
    const db = c.env.DB
    const admin = c.get('admin')
    const body: any = await c.req.json().catch(() => null)
    const code = String(body?.code || '').trim()
    const row = await db.prepare('SELECT totp_secret, totp_enabled FROM admin_users WHERE id = ?').bind(admin.id).first<any>()
    if (row?.totp_enabled) {
      const ok = await verifyTotp(row.totp_secret, code)
      if (!ok) return c.json({ error: 'Kode 2FA tidak valid.' }, 400)
    }
    await db.prepare('UPDATE admin_users SET totp_enabled = 0 WHERE id = ?').bind(admin.id).run()
    return c.json({ ok: true })
  })

  // ---------- notFound / error ----------
  app.notFound((c) =>
    c.req.path === '/api' || c.req.path.startsWith('/api/')
      ? c.json({ error: 'Endpoint not found.' }, 404)
      : c.env.ASSETS.fetch(c.req.raw),
  )
  app.onError((error, c) => {
    // Server-side detail stays in logs: the client only sees a generic message.
    console.error('API error', c.req.method, c.req.path, error)
    return c.json({ error: 'Something went wrong. Please try again.' }, 500)
  })

  return app
}
