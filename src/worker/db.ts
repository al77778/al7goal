import type { Transaction, SavedAccount, AppNotification, Profile, AuditLog } from '../shared/types'
import { accountSchema } from './userAuth'

const schema = [
  `CREATE TABLE IF NOT EXISTS profiles (
    sub TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    joined_at BIGINT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    type TEXT NOT NULL,
    amount BIGINT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'success',
    balance_before BIGINT NOT NULL DEFAULT 0,
    balance_after BIGINT NOT NULL DEFAULT 0,
    counterparty TEXT NOT NULL DEFAULT '',
    reference TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS tx_owner_created ON transactions(owner_sub, created_at DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS saved_accounts (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    name TEXT NOT NULL,
    account_number TEXT NOT NULL,
    bank TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sa_owner ON saved_accounts(owner_sub, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'info',
    read INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS notif_owner_created ON notifications(owner_sub, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    totp_secret TEXT NOT NULL DEFAULT '',
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    expires_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    admin_username TEXT NOT NULL,
    action TEXT NOT NULL,
    target_sub TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    amount BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS audit_created ON audit_logs(created_at DESC)`,
  ...accountSchema,
]

const ready = new WeakMap<D1Database, Promise<void>>()
export function ensureSchema(db: D1Database): Promise<void> {
  let pending = ready.get(db)
  if (!pending) {
    pending = db
      .batch(schema.map((sql) => db.prepare(sql)))
      .then(() => undefined)
      .catch((error) => {
        ready.delete(db)
        throw error
      })
    ready.set(db, pending)
  }
  return pending
}

// ---------- row mappers ----------
export type TxRow = {
  id: string; owner_sub: string; type: string; amount: number; note: string
  status: string; balance_before: number; balance_after: number
  counterparty: string; reference: string; created_at: number
}
export const mapTx = (row: TxRow): Transaction => ({
  id: row.id,
  type: row.type as Transaction['type'],
  amount: row.amount,
  note: row.note,
  status: row.status as Transaction['status'],
  balanceBefore: row.balance_before,
  balanceAfter: row.balance_after,
  counterparty: row.counterparty,
  reference: row.reference,
  createdAt: row.created_at,
})

export type SavedAccountRow = {
  id: string; owner_sub: string; name: string; account_number: string; bank: string; created_at: number
}
export const mapSavedAccount = (row: SavedAccountRow): SavedAccount => ({
  id: row.id,
  name: row.name,
  accountNumber: row.account_number,
  bank: row.bank,
  createdAt: row.created_at,
})

export type NotificationRow = {
  id: string; owner_sub: string; title: string; message: string; kind: string; read: number; created_at: number
}
export const mapNotification = (row: NotificationRow): AppNotification => ({
  id: row.id,
  title: row.title,
  message: row.message,
  kind: row.kind,
  read: Boolean(row.read),
  createdAt: row.created_at,
})

export type ProfileRow = {
  sub: string; name: string; email: string; phone: string; joined_at: number; avatar_url: string
}
export const mapProfile = (row: ProfileRow): Profile => ({
  sub: row.sub,
  name: row.name,
  email: row.email,
  phone: row.phone,
  joinedAt: row.joined_at,
  avatarUrl: row.avatar_url,
})

export type AuditRow = {
  id: string; admin_id: string; admin_username: string; action: string; target_sub: string
  reason: string; note: string; amount: number; created_at: number
}
export const mapAudit = (row: AuditRow): AuditLog => ({
  id: row.id,
  adminUsername: row.admin_username,
  action: row.action,
  targetSub: row.target_sub,
  reason: row.reason,
  note: row.note,
  amount: row.amount,
  createdAt: row.created_at,
})

// ---------- helpers ----------
export async function getBalance(db: D1Database, sub: string): Promise<number> {
  const row = await db
    .prepare('SELECT balance_after FROM transactions WHERE owner_sub = ? ORDER BY created_at DESC, id DESC LIMIT 1')
    .bind(sub)
    .first<{ balance_after: number }>()
  return row?.balance_after ?? 0
}

export async function computeSummary(db: D1Database, sub: string): Promise<{
  total: number; available: number; totalIn: number; totalOut: number; totalSaved: number; count: number
}> {
  const bal = await getBalance(db, sub)
  const inRow = await db
    .prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE owner_sub = ? AND status='success' AND type IN ('deposit','transfer_in','qris_in','admin_adjustment')`)
    .bind(sub).first<{ s: number }>()
  const outRow = await db
    .prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE owner_sub = ? AND status='success' AND type IN ('withdraw','transfer_out','qris_out')`)
    .bind(sub).first<{ s: number }>()
  const savedRow = await db
    .prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE owner_sub = ? AND status='success' AND type='deposit'`)
    .bind(sub).first<{ s: number }>()
  const countRow = await db
    .prepare('SELECT COUNT(*) AS c FROM transactions WHERE owner_sub = ?')
    .bind(sub).first<{ c: number }>()
  return {
    total: bal,
    available: bal,
    totalIn: inRow?.s ?? 0,
    totalOut: outRow?.s ?? 0,
    totalSaved: savedRow?.s ?? 0,
    count: countRow?.c ?? 0,
  }
}
