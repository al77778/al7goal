export type TxType =
  | 'deposit'
  | 'withdraw'
  | 'transfer_out'
  | 'transfer_in'
  | 'qris_in'
  | 'qris_out'
  | 'admin_adjustment'

export type TxStatus = 'success' | 'pending' | 'failed'

export type Transaction = {
  id: string
  type: TxType
  amount: number
  note: string
  status: TxStatus
  balanceBefore: number
  balanceAfter: number
  counterparty: string
  reference: string
  createdAt: number
}

export type BalanceSummary = {
  total: number
  available: number
  totalIn: number
  totalOut: number
  totalSaved: number
  count: number
}

export type SavedAccount = {
  id: string
  name: string
  accountNumber: string
  bank: string
  createdAt: number
}

export type AppNotification = {
  id: string
  title: string
  message: string
  kind: string
  read: boolean
  createdAt: number
}

export type Profile = {
  sub: string
  name: string
  email: string
  phone: string
  joinedAt: number
  avatarUrl: string
}

export type AdminUser = {
  id: string
  username: string
  role: 'admin' | 'superadmin'
}

export type AdminSession = {
  token: string
  admin: AdminUser
  expiresAt: number
}

export type Session = {
  user: { sub: string; name?: string; email?: string } | null
  mode: 'local' | 'freebuff' | 'setup'
  database: boolean
  isAdmin: boolean
  /** Where records live: D1 on Cloudflare, PostgreSQL on Node/Vercel. */
  storage?: 'd1' | 'postgres' | 'ephemeral' | 'none'
  storageNote?: string
}

export type AuditLog = {
  id: string
  adminUsername: string
  action: string
  targetSub: string
  reason: string
  note: string
  amount: number
  createdAt: number
}
