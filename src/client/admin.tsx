import { useEffect, useState } from 'react'
import type { Transaction, AuditLog } from '../shared/types'
import { request, fmt, TX_LABEL } from './api'

// ---------- Admin ----------

export function AdminLoginPage({ onLogin, showToast }: any) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [needs2fa, setNeeds2fa] = useState(false)
  async function submit() {
    setBusy(true)
    try {
      const r: any = await request('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, totp }),
      })
      onLogin(r.admin)
      showToast('Admin login berhasil')
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : 'err'
      if (msg.includes('2FA')) setNeeds2fa(true)
      showToast(msg, 'error')
    } finally { setBusy(false) }
  }
  return (
    <div className="login-page">
      <div className="login-card glass">
        <h1>Admin Login</h1>
        <p className="tagline">ApryadiGoal Admin Panel</p>
        <div className="form-row"><label>Username</label><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="apryadi" /></div>
        <div className="form-row"><label>Password</label>
          <div className="pw-wrap">
            <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="toggle-pw" onClick={() => setShowPw(!showPw)}>👁</button>
          </div>
        </div>
        {needs2fa && <div className="form-row"><label>Kode 2FA</label><input value={totp} onChange={(e) => setTotp(e.target.value)} placeholder="000000" /></div>}
        <button className="btn" disabled={busy} onClick={submit}>{busy ? '...' : 'Masuk'}</button>
        <button className="btn ghost" style={{ marginLeft: 8 }} onClick={() => window.location.reload()}>Kembali</button>
      </div>
    </div>
  )
}

export function AdminShell({ admin, page, setPage, onLogout, showToast }: any) {
  const [stats, setStats] = useState<any>(null)
  const [users, setUsers] = useState<any[]>([])
  const [txs, setTxs] = useState<Transaction[]>([])
  const [pending, setPending] = useState<Transaction[]>([])
  const [failed, setFailed] = useState<Transaction[]>([])
  const [audit, setAudit] = useState<AuditLog[]>([])
  const [selectedUser, setSelectedUser] = useState<any>(null)

  useEffect(() => {
    void request<any>('/api/admin/stats').then(setStats).catch(() => {})
  }, [])
  useEffect(() => {
    if (page === 'users') void request<{ users: any[] }>('/api/admin/users').then((r) => setUsers(r.users)).catch(() => {})
    if (page === 'transactions') void request<{ transactions: Transaction[] }>('/api/admin/transactions').then((r) => setTxs(r.transactions)).catch(() => {})
    if (page === 'pending') void request<{ transactions: Transaction[] }>('/api/admin/pending').then((r) => setPending(r.transactions)).catch(() => {})
    if (page === 'failed') void request<{ transactions: Transaction[] }>('/api/admin/failed').then((r) => setFailed(r.transactions)).catch(() => {})
    if (page === 'audit') void request<{ logs: AuditLog[] }>('/api/admin/audit').then((r) => setAudit(r.logs)).catch(() => {})
  }, [page])

  const adminItems = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'users', label: 'Pengguna', icon: '👥' },
    { id: 'transactions', label: 'Transaksi', icon: '📜' },
    { id: 'pending', label: 'Pending', icon: '⏳' },
    { id: 'failed', label: 'Transaksi Gagal', icon: '⚠️' },
    { id: 'audit', label: 'Audit Log', icon: '🛡️' },
    { id: 'notify', label: 'Notifikasi', icon: '📣' },
    { id: 'security', label: 'Keamanan/2FA', icon: '🔐' },
  ]

  return (
    <div className="app-shell admin-layout">
      <aside className="sidebar open">
        <div className="brand"><div className="logo" style={{ background: 'linear-gradient(135deg,#EF4444,#DC2626)' }}>A</div><div><h1>Admin Panel</h1><p>{admin.username}</p></div></div>
        {adminItems.map((it) => (
          <button key={it.id} className={`nav-item ${page === it.id ? 'active' : ''}`} onClick={() => setPage(it.id)}>
            <span className="icon">{it.icon}</span><span>{it.label}</span>
          </button>
        ))}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(0,217,255,0.12)' }}>
          <button className="nav-item" onClick={onLogout}><span className="icon">🚪</span><span>Logout Admin</span></button>
        </div>
      </aside>
      <main className="main-content">
        {page === 'overview' && (
          <div>
            <h2 className="section-title">Dashboard Admin</h2>
            <p className="section-sub">Ringkasan sistem</p>
            {stats && (
              <div className="grid cols-4">
                <div className="card glass"><h3>Jumlah Pengguna</h3><div className="value">{stats.users}</div></div>
                <div className="card glass"><h3>Total Transaksi</h3><div className="value">{stats.transactions}</div></div>
                <div className="card glass"><h3>Pending</h3><div className="value" style={{ color: 'var(--warn)' }}>{stats.pending}</div></div>
                <div className="card glass"><h3>Volume</h3><div className="value">{fmt(stats.volume)}</div></div>
              </div>
            )}
          </div>
        )}
        {page === 'users' && (
          <div>
            <h2 className="section-title">Kelola Pengguna</h2>
            <p className="section-sub">Daftar pengguna dan saldo</p>
            <div className="card glass">
              <table className="table">
                <thead><tr><th>Nama</th><th>Email</th><th>Saldo</th><th>Tx</th><th>Aksi</th></tr></thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.sub}>
                      <td>{u.name || '-'}</td>
                      <td className="small">{u.email}</td>
                      <td>{fmt(u.balance)}</td>
                      <td>{u.txCount}</td>
                      <td><button className="btn ghost small" onClick={() => setSelectedUser(u)}>Detail/Adjust</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && <div className="empty-state">Belum ada pengguna</div>}
            </div>
            {selectedUser && <AdjustModal user={selectedUser} onClose={() => setSelectedUser(null)} onDone={() => { setSelectedUser(null); void request<{ users: any[] }>('/api/admin/users').then((r) => setUsers(r.users)) }} showToast={showToast} />}
          </div>
        )}
        {page === 'transactions' && (
          <div>
            <h2 className="section-title">Laporan Transaksi</h2>
            <div className="card glass">
              <table className="table">
                <thead><tr><th>Tanggal</th><th>User</th><th>Jenis</th><th>Nominal</th><th>Status</th></tr></thead>
                <tbody>
                  {txs.map((t) => (
                    <tr key={t.id}>
                      <td className="small">{new Date(t.createdAt).toLocaleString('id-ID')}</td>
                      <td className="small muted">{t.id.slice(0, 6)}</td>
                      <td>{TX_LABEL[t.type] || t.type}</td>
                      <td>{fmt(t.amount)}</td>
                      <td><span className={`badge ${t.status}`}>{t.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {page === 'pending' && (
          <div>
            <h2 className="section-title">Transaksi Pending</h2>
            <div className="card glass">
              <table className="table">
                <thead><tr><th>ID</th><th>Jenis</th><th>Nominal</th><th>Aksi</th></tr></thead>
                <tbody>
                  {pending.map((t) => (
                    <tr key={t.id}>
                      <td className="small">{t.id.slice(0, 8)}</td>
                      <td>{TX_LABEL[t.type] || t.type}</td>
                      <td>{fmt(t.amount)}</td>
                      <td className="row">
                        <button className="btn success small" onClick={async () => { await request(`/api/admin/transactions/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'success', reason: 'Approved by admin' }) }); showToast('Disetujui'); void request<{ transactions: Transaction[] }>('/api/admin/pending').then((r) => setPending(r.transactions)) }}>Approve</button>
                        <button className="btn danger small" onClick={async () => { await request(`/api/admin/transactions/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'failed', reason: 'Rejected by admin' }) }); showToast('Ditolak'); void request<{ transactions: Transaction[] }>('/api/admin/pending').then((r) => setPending(r.transactions)) }}>Reject</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pending.length === 0 && <div className="empty-state">Tidak ada pending</div>}
            </div>
          </div>
        )}
        {page === 'failed' && (
          <div>
            <h2 className="section-title">Laporan Kesalahan</h2>
            <p className="section-sub">Transaksi yang berstatus gagal</p>
            <div className="card glass">
              <table className="table">
                <thead><tr><th>Tanggal</th><th>ID</th><th>Jenis</th><th>Nominal</th><th>Pihak</th></tr></thead>
                <tbody>
                  {failed.map((t) => (
                    <tr key={t.id}>
                      <td className="small">{new Date(t.createdAt).toLocaleString('id-ID')}</td>
                      <td className="small">{t.id.slice(0, 8)}</td>
                      <td>{TX_LABEL[t.type] || t.type}</td>
                      <td>{fmt(t.amount)}</td>
                      <td className="small">{t.counterparty || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {failed.length === 0 && <div className="empty-state">Tidak ada transaksi gagal</div>}
            </div>
          </div>
        )}
        {page === 'audit' && (
          <div>
            <h2 className="section-title">Audit Log</h2>
            <div className="card glass">
              <table className="table">
                <thead><tr><th>Tanggal</th><th>Admin</th><th>Aksi</th><th>Target</th><th>Alasan</th><th>Nominal</th></tr></thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td className="small">{new Date(a.createdAt).toLocaleString('id-ID')}</td>
                      <td>{a.adminUsername}</td>
                      <td>{a.action}</td>
                      <td className="small">{a.targetSub.slice(0, 8)}</td>
                      <td className="small">{a.reason}</td>
                      <td>{a.amount ? fmt(a.amount) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {page === 'notify' && <NotifyPanel showToast={showToast} />}
        {page === 'security' && <SecurityPanel showToast={showToast} />}
      </main>
    </div>
  )
}

function AdjustModal({ user, onClose, onDone, showToast }: any) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit() {
    if (!reason) { showToast('Alasan wajib', 'error'); return }
    const amt = Number(amount)
    if (!amt) { showToast('Nominal wajib', 'error'); return }
    setBusy(true)
    try {
      await request(`/api/admin/users/${user.sub}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'adjust_balance', amount: amt, reason, note }),
      })
      showToast('Saldo disesuaikan')
      onDone()
    } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
    finally { setBusy(false) }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal glass" onClick={(e) => e.stopPropagation()}>
        <h2>Adjust Saldo — {user.name || user.email}</h2>
        <p className="small muted">Saldo saat ini: {fmt(user.balance)}</p>
        <div className="form-row"><label>Nominal (+/-)</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100000 atau -50000" /></div>
        <div className="form-row"><label>Alasan (wajib)</label><input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="form-row"><label>Catatan</label><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></div>
        <div className="row">
          <button className="btn" disabled={busy} onClick={submit}>{busy ? '...' : 'Simpan'}</button>
          <button className="btn ghost" onClick={onClose}>Batal</button>
        </div>
      </div>
    </div>
  )
}

function NotifyPanel({ showToast }: any) {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [target, setTarget] = useState('all')
  const [busy, setBusy] = useState(false)
  async function send() {
    if (!title || !message) { showToast('Judul dan pesan wajib', 'error'); return }
    setBusy(true)
    try {
      await request('/api/admin/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, message, target }),
      })
      showToast('Notifikasi terkirim')
      setTitle(''); setMessage('')
    } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
    finally { setBusy(false) }
  }
  return (
    <div>
      <h2 className="section-title">Kirim Notifikasi</h2>
      <div className="card glass" style={{ maxWidth: 520 }}>
        <div className="form-row"><label>Target (sub atau "all")</label><input value={target} onChange={(e) => setTarget(e.target.value)} /></div>
        <div className="form-row"><label>Judul</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="form-row"><label>Pesan</label><textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} /></div>
        <button className="btn" disabled={busy} onClick={send}>{busy ? '...' : 'Kirim'}</button>
      </div>
    </div>
  )
}

function SecurityPanel({ showToast }: any) {
  const [data, setData] = useState<any>(null)
  const [code, setCode] = useState('')
  useEffect(() => {
    void request<any>('/api/admin/totp/setup').then(setData).catch(() => {})
  }, [])
  async function enable() {
    try {
      await request('/api/admin/totp/enable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      showToast('2FA diaktifkan')
      void request<any>('/api/admin/totp/setup').then(setData)
    } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
  }
  async function disable() {
    try {
      await request('/api/admin/totp/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      showToast('2FA dinonaktifkan')
      void request<any>('/api/admin/totp/setup').then(setData)
    } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
  }
  return (
    <div>
      <h2 className="section-title">Keamanan & 2FA</h2>
      <div className="card glass" style={{ maxWidth: 520 }}>
        {data && (
          <>
            <p className="small muted">Status: {data.enabled ? 'Aktif' : 'Nonaktif'}</p>
            <p className="small muted">Secret: <code>{data.secret}</code></p>
            <p className="small muted">Kode saat ini (demo): <code>{data.currentCode}</code></p>
            <div style={{ margin: '12px 0' }}>
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(data.uri)}`} alt="QR" />
            </div>
            <div className="form-row"><label>Kode 2FA</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" /></div>
            <div className="row">
              <button className="btn" onClick={enable}>Aktifkan</button>
              <button className="btn danger" onClick={disable}>Nonaktifkan</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
