import { useEffect, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import type { Transaction, BalanceSummary, SavedAccount, AppNotification, Profile, AuditLog, Session } from '../shared/types'
import './style.css'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = (await response.json().catch(() => {
    throw new Error('Could not reach the server. Please try again.')
  })) as T & { error?: string }
  if (!response.ok) throw new Error(body.error || 'Request failed.')
  return body
}

const fmt = (n: number) => 'Rp' + (n || 0).toLocaleString('id-ID')

function printHtml(title: string, inner: string) {
  const win = window.open('', '_blank', 'width=720,height=900')
  if (!win) return
  win.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${title}</title>
  <style>
    body{font-family:system-ui,sans-serif;color:#0b1220;padding:32px;max-width:640px;margin:0 auto}
    h1{font-size:20px;margin:0 0 4px} .brand{color:#0066FF;font-weight:800;letter-spacing:-.02em}
    .muted{color:#5b6b82;font-size:12px} table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{text-align:left;padding:8px;border-bottom:1px solid #e2e8f0;font-size:13px}
    .label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#5b6b82}
    .row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}
    .tag{display:inline-block;padding:2px 8px;border-radius:999px;background:#e8f0ff;color:#0066FF;font-size:11px}
  </style></head><body>${inner}</body></html>`)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 250)
}

function receiptHtml(tx: Transaction) {
  return `<div class="brand">ApryadiGoal</div>
  <h1>Bukti Transaksi</h1>
  <p class="muted">Tabung Sekarang, Kelola Uangmu! — dokumen mode DEMO</p>
  <div class="row"><span class="label">ID Transaksi</span><span>${tx.id}</span></div>
  <div class="row"><span class="label">Referensi</span><span>${tx.reference || '-'}</span></div>
  <div class="row"><span class="label">Tanggal</span><span>${new Date(tx.createdAt).toLocaleString('id-ID')}</span></div>
  <div class="row"><span class="label">Jenis</span><span>${TX_LABEL[tx.type] || tx.type}</span></div>
  <div class="row"><span class="label">Nominal</span><span>${fmt(tx.amount)}</span></div>
  <div class="row"><span class="label">Pihak</span><span>${tx.counterparty || '-'}</span></div>
  <div class="row"><span class="label">Keterangan</span><span>${tx.note || '-'}</span></div>
  <div class="row"><span class="label">Status</span><span class="tag">${tx.status}</span></div>
  <div class="row"><span class="label">Saldo Sebelum</span><span>${fmt(tx.balanceBefore)}</span></div>
  <div class="row"><span class="label">Saldo Sesudah</span><span>${fmt(tx.balanceAfter)}</span></div>`
}

const TX_LABEL: Record<string, string> = {
  deposit: 'Tambah Tabungan',
  withdraw: 'Tarik Saldo',
  transfer_out: 'Kirim Uang',
  transfer_in: 'Terima Uang',
  qris_in: 'QRIS Masuk',
  qris_out: 'QRIS Keluar',
  admin_adjustment: 'Penyesuaian Admin',
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [page, setPage] = useState('beranda')
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  // admin state
  const [admin, setAdmin] = useState<{ id: string; username: string; role: string } | null>(null)
  const [adminPage, setAdminPage] = useState('overview')

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const s = await request<Session>('/api/session')
        if (!live) return
        setSession(s)
        if (s.isAdmin) {
          const r = await request<{ admin: any }>('/api/admin/session')
          if (live && r.admin) setAdmin(r.admin)
        }
      } catch (e) {
        if (live) showToast(e instanceof Error ? e.message : 'Load failed', 'error')
      } finally {
        if (live) setLoaded(true)
      }
    })()
    return () => { live = false }
  }, [])

  if (!loaded) {
    return <div className="login-page"><div className="spinner" style={{ width: 32, height: 32 }} /></div>
  }

  const enabled = Boolean(session?.user && session.database)

  // Not signed in (hosted) and not local
  if (!session?.database) {
    return <SetupPage />
  }
  if (!session?.user && session?.mode !== 'local') {
    return <AuthPage showToast={showToast} />
  }

  // Admin login gate if admin requested but not logged in
  if (page === 'admin-login' && !admin) {
    return <AdminLoginPage         onLogin={(a: { id: string; username: string; role: string }) => { setAdmin(a); setPage('admin') }} showToast={showToast} />
  }

  if (admin && (page === 'admin' || page.startsWith('admin-'))) {
    return (
      <AdminShell
        admin={admin}
        page={adminPage}
        setPage={setAdminPage}
        onLogout={async () => {
          await request('/api/admin/logout', { method: 'POST' })
          setAdmin(null)
          setPage('beranda')
          showToast('Admin logged out')
        }}
        showToast={showToast}
      />
    )
  }

  if (page === 'masuk') {
    return <AuthPage showToast={showToast} />
  }

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={(p: string) => { setPage(p); setSidebarOpen(false) }} open={sidebarOpen} setOpen={setSidebarOpen} session={session} admin={admin} onAdminClick={() => setPage('admin-login')} />
      <main className="main-content">
        {session?.storage === 'ephemeral' && (
          <div className="demo-banner">
            Mode DEMO · data disimpan di PostgreSQL sementara (folder /tmp). Atur variabel <code>DATABASE_URL</code> di Vercel agar data permanen.
          </div>
        )}
        <TopBar
          session={session}
          onMenu={() => setSidebarOpen(true)}
          onBell={() => setPage('notifikasi')}
          onSearch={(q: string) => { setSearchQ(q); setPage('riwayat') }}
        />
        {page === 'beranda' && <DashboardPage showToast={showToast} enabled={enabled} session={session} />}
        {page === 'saldo' && <SaldoPage showToast={showToast} enabled={enabled} />}
        {page === 'tambah' && <TambahPage showToast={showToast} enabled={enabled} />}
        {page === 'tarik' && <TarikPage showToast={showToast} enabled={enabled} />}
        {page === 'kirim' && <KirimPage showToast={showToast} enabled={enabled} />}
        {page === 'terima' && <TerimaPage showToast={showToast} enabled={enabled} />}
        {page === 'riwayat' && <RiwayatPage key={searchQ} initialQ={searchQ} showToast={showToast} enabled={enabled} />}
        {page === 'laporan' && <LaporanPage showToast={showToast} enabled={enabled} />}
        {page === 'profil' && <ProfilPage showToast={showToast} enabled={enabled} session={session} />}
        {page === 'pengaturan' && <PengaturanPage showToast={showToast} enabled={enabled} session={session} admin={admin} />}
        {page === 'bantuan' && <BantuanPage />}
        {page === 'notifikasi' && <NotifikasiPage showToast={showToast} enabled={enabled} />}
        {page === 'pencarian' && <RiwayatPage key={searchQ} initialQ={searchQ} showToast={showToast} enabled={enabled} />}
      </main>
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}

// ---------- Sidebar ----------
function Sidebar({ page, setPage, open, setOpen, session, admin, onAdminClick }: any) {
  const items = [
    { id: 'beranda', label: 'Beranda', icon: '🏠' },
    { id: 'saldo', label: 'Saldo Saya', icon: '💰' },
    { id: 'tambah', label: 'Tambah Tabungan', icon: '➕' },
    { id: 'tarik', label: 'Tarik Saldo', icon: '🏧' },
    { id: 'kirim', label: 'Kirim Uang', icon: '💸' },
    { id: 'terima', label: 'Terima Uang', icon: '📥' },
    { id: 'riwayat', label: 'Riwayat Transaksi', icon: '📜' },
    { id: 'pencarian', label: 'Pencarian', icon: '🔍' },
    { id: 'laporan', label: 'Laporan Keuangan', icon: '📊' },
    { id: 'profil', label: 'Profil', icon: '👤' },
    { id: 'pengaturan', label: 'Pengaturan', icon: '⚙️' },
    { id: 'bantuan', label: 'Bantuan', icon: '❓' },
  ]
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand">
        <div className="logo">A</div>
        <div>
          <h1>ApryadiGoal</h1>
          <p>Tabung Sekarang, Kelola Uangmu!</p>
        </div>
      </div>
      {items.map((it) => (
        <button key={it.id} className={`nav-item ${page === it.id ? 'active' : ''}`} onClick={() => setPage(it.id)}>
          <span className="icon">{it.icon}</span>
          <span>{it.label}</span>
        </button>
      ))}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(0,217,255,0.12)' }}>
        <button className="nav-item" onClick={onAdminClick}>
          <span className="icon">🛠️</span><span>Admin Panel</span>
        </button>
        {session?.user && (
          <button
            className="nav-item"
            onClick={async () => {
              try { await request('/api/auth/logout', { method: 'POST' }) } catch {}
              window.location.reload()
            }}
          >
            <span className="icon">🚪</span><span>Logout</span>
          </button>
        )}
        <button className="nav-item" onClick={() => setPage('masuk')}>
          <span className="icon">🔑</span><span>Masuk / Daftar Akun</span>
        </button>
      </div>
    </aside>
  )
}

function TopBar({ session, onMenu, onBell, onSearch }: any) {
  return (
    <div className="topbar">
      <button className="btn ghost" onClick={onMenu} style={{ display: 'none' }} id="menuBtn">☰</button>
      <style>{`@media (max-width:720px){#menuBtn{display:inline-block !important;}}`}</style>
      <input
        className="search"
        placeholder="Cari transaksi, nominal, tanggal..."
        onKeyDown={(e) => { if (e.key === 'Enter') onSearch((e.target as HTMLInputElement).value) }}
      />
      <div className="user">
        <button className="btn ghost small" onClick={onBell} title="Notifikasi">🔔</button>
        <div className="avatar">{(session?.user?.name || 'U').charAt(0).toUpperCase()}</div>
        <span className="small">{session?.user?.name || session?.user?.email || 'Local Preview'}</span>
      </div>
    </div>
  )
}

// ---------- Pages ----------

type AuthStep = 'login' | 'register' | 'verify' | 'forgot' | 'reset'

function AuthPage({ showToast, inline }: any) {
  const [step, setStep] = useState<AuthStep>('login')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [demoCode, setDemoCode] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr('')
    try { await fn() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Terjadi kesalahan.') }
    finally { setBusy(false) }
  }
  const done = () => { window.location.reload() }

  return (
    <div className="login-page">
      <form className="login-card glass" onSubmit={(e) => {
        e.preventDefault()
        if (step === 'login') void run(async () => {
          if (!identifier || !password) throw new Error('Isi semua kolom.')
          await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) })
          done()
        })
        if (step === 'register') void run(async () => {
          if (password !== confirm) throw new Error('Konfirmasi password tidak sama.')
          const r: any = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, phone, password }) })
          setDemoCode(r.demoCode || '')
          setIdentifier(email)
          setStep('verify')
        })
        if (step === 'verify') void run(async () => {
          await request('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: identifier, code }) })
          done()
        })
        if (step === 'forgot') void run(async () => {
          const r: any = await request('/api/auth/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier }) })
          setDemoCode(r.demoCode || '')
          setStep('reset')
        })
        if (step === 'reset') void run(async () => {
          if (password !== confirm) throw new Error('Konfirmasi password tidak sama.')
          await request('/api/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, code, password }) })
          showToast('Password berhasil direset, silakan masuk.')
          setStep('login'); setPassword(''); setConfirm(''); setCode('')
        })
      }}>
        <h1>ApryadiGoal</h1>
        <p className="tagline">Tabung Sekarang, Kelola Uangmu!</p>

        {step === 'login' && (<>
          <div className="form-row"><label>Email atau Nomor HP</label><input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" /></div>
          <div className="form-row"><label>Password</label>
            <div className="pw-wrap">
              <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              <button type="button" className="toggle-pw" onClick={() => setShowPw(!showPw)}>{showPw ? '🙈' : '👁'}</button>
            </div>
          </div>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Memproses...' : 'Masuk'}</button>
          <div className="row small" style={{ marginTop: 12, justifyContent: 'space-between' }}>
            <button type="button" className="btn ghost small" onClick={() => setStep('register')}>Daftar Akun</button>
            <button type="button" className="btn ghost small" onClick={() => setStep('forgot')}>Lupa Password?</button>
          </div>
        </>)}

        {step === 'register' && (<>
          <div className="form-row"><label>Nama Lengkap</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="form-row"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="form-row"><label>Nomor HP</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08123456789" /></div>
          <div className="form-row"><label>Password (min. 8 karakter)</label>
            <div className="pw-wrap">
              <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="toggle-pw" onClick={() => setShowPw(!showPw)}>{showPw ? '🙈' : '👁'}</button>
            </div>
          </div>
          <div className="form-row"><label>Konfirmasi Password</label><input type={showPw ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Memproses...' : 'Buat Akun'}</button>
          <button type="button" className="btn ghost small" style={{ marginTop: 10 }} onClick={() => setStep('login')}>Kembali ke Login</button>
        </>)}

        {step === 'verify' && (<>
          <p className="small muted">Masukkan 6 digit kode OTP yang dikirim ke email Anda.</p>
          {demoCode && <p className="small" style={{ color: 'var(--cyan)' }}>Kode demo: <code>{demoCode}</code></p>}
          <div className="form-row"><label>Kode OTP</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" inputMode="numeric" /></div>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Memverifikasi...' : 'Verifikasi'}</button>
          <button type="button" className="btn ghost small" style={{ marginTop: 10 }} onClick={() => void run(async () => {
            const r: any = await request('/api/auth/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: identifier }) })
            setDemoCode(r.demoCode || '')
          })}>Kirim Ulang Kode</button>
        </>)}

        {step === 'forgot' && (<>
          <p className="small muted">Masukkan email atau nomor HP terdaftar untuk menerima kode reset.</p>
          <div className="form-row"><label>Email atau Nomor HP</label><input value={identifier} onChange={(e) => setIdentifier(e.target.value)} /></div>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? '...' : 'Kirim Kode Reset'}</button>
          <button type="button" className="btn ghost small" style={{ marginTop: 10 }} onClick={() => setStep('login')}>Kembali</button>
        </>)}

        {step === 'reset' && (<>
          {demoCode && <p className="small" style={{ color: 'var(--cyan)' }}>Kode demo: <code>{demoCode}</code></p>}
          <div className="form-row"><label>Kode Reset</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" inputMode="numeric" /></div>
          <div className="form-row"><label>Password Baru</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div className="form-row"><label>Konfirmasi Password Baru</label><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? '...' : 'Reset Password'}</button>
        </>)}

        {err && <p className="small danger-text" style={{ marginTop: 12 }}>{err}</p>}
      </form>
    </div>
  )
}
function SetupPage() {
  return (
    <div className="login-page">
      <div className="login-card glass">
        <h1>Setup</h1>
        <p className="muted">Aplikasi sedang disiapkan. Coba lagi nanti.</p>
      </div>
    </div>
  )
}

function DashboardPage({ showToast, enabled }: any) {
  const [balance, setBalance] = useState<BalanceSummary | null>(null)
  const [txs, setTxs] = useState<Transaction[]>([])
  const [chartTxs, setChartTxs] = useState<Transaction[]>([])
  const [period, setPeriod] = useState('month')
  useEffect(() => {
    if (!enabled) return
    void (async () => {
      try {
        const b = await request<{ balance: BalanceSummary }>('/api/balance')
        setBalance(b.balance)
        const r = await request<{ transactions: Transaction[] }>('/api/transactions?limit=10')
        setTxs(r.transactions)
      } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
    })()
  }, [enabled])
  useEffect(() => {
    if (!enabled) return
    const map: Record<string, string> = { day: 'today', week: 'week', month: 'month', year: 'year' }
    void request<{ transactions: Transaction[] }>(`/api/reports?period=${map[period] || 'month'}`)
      .then((r) => setChartTxs(r.transactions))
      .catch(() => setChartTxs([]))
  }, [enabled, period])
  return (
    <div>
      <h2 className="section-title">Beranda</h2>
      <p className="section-sub">Ringkasan keuangan Anda</p>
      <div className="grid cols-5">
        <div className="card glass stat-card"><h3>Total Saldo</h3><div className="value">{balance ? fmt(balance.total) : '—'}</div></div>
        <div className="card glass stat-card"><h3>Total Uang Masuk</h3><div className="value success-text">{balance ? fmt(balance.totalIn) : '—'}</div></div>
        <div className="card glass stat-card"><h3>Total Uang Keluar</h3><div className="value danger-text">{balance ? fmt(balance.totalOut) : '—'}</div></div>
        <div className="card glass stat-card"><h3>Total Ditabung</h3><div className="value">{balance ? fmt(balance.totalSaved) : '—'}</div></div>
        <div className="card glass stat-card"><h3>Jumlah Transaksi</h3><div className="value">{balance ? balance.count : '—'}</div></div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 20 }}>
        <div className="card glass">
          <h3 style={{ color: 'var(--text)', fontSize: 15, marginBottom: 12 }}>Perkembangan Saldo</h3>
          <Chart txs={chartTxs} />
          <div className="row" style={{ marginTop: 10 }}>
            {['day', 'week', 'month', 'year'].map((p) => (
              <button key={p} className={`chip ${period === p ? 'selected' : ''}`} onClick={() => setPeriod(p)}>{p}</button>
            ))}
          </div>
        </div>
        <div className="card glass">
          <h3 style={{ color: 'var(--text)', fontSize: 15, marginBottom: 12 }}>Transaksi Terbaru</h3>
          {txs.length === 0 ? <div className="empty-state">Belum ada transaksi</div> : (
            <table className="table"><tbody>
              {txs.slice(0, 6).map((t) => (
                <tr key={t.id}>
                  <td>{TX_LABEL[t.type] || t.type}</td>
                  <td className={t.type.includes('in') || t.type === 'deposit' ? 'success-text' : 'danger-text'}>{fmt(t.amount)}</td>
                  <td className="muted small">{new Date(t.createdAt).toLocaleDateString('id-ID')}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </div>
    </div>
  )
}

function Chart({ txs }: { txs: Transaction[] }) {
  if (!txs.length) return <div className="empty-state" style={{ height: 200 }}>Belum ada data</div>
  // build cumulative balance points
  const sorted = [...txs].reverse()
  const pts = sorted.map((t, i) => ({ x: i, y: t.balanceAfter }))
  const maxY = Math.max(...pts.map((p) => p.y), 1)
  const minY = Math.min(...pts.map((p) => p.y), 0)
  const range = maxY - minY || 1
  const w = 500, h = 180
  const path = pts.map((p, i) => {
    const x = (i / Math.max(pts.length - 1, 1)) * w
    const y = h - ((p.y - minY) / range) * h
    return `${i === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" preserveAspectRatio="none">
      <defs>
        <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#00D9FF" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#0066FF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path + ` L${w},${h} L0,${h} Z`} fill="url(#g)" />
      <path d={path} fill="none" stroke="#00D9FF" strokeWidth="2.5" />
    </svg>
  )
}

function SaldoPage({ showToast, enabled }: any) {
  const [balance, setBalance] = useState<BalanceSummary | null>(null)
  const [txs, setTxs] = useState<Transaction[]>([])
  useEffect(() => {
    if (!enabled) return
    void (async () => {
      try {
        const b = await request<{ balance: BalanceSummary }>('/api/balance')
        setBalance(b.balance)
        const r = await request<{ transactions: Transaction[] }>('/api/transactions?limit=50')
        setTxs(r.transactions)
      } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
    })()
  }, [enabled])
  return (
    <div>
      <h2 className="section-title">Saldo Saya</h2>
      <p className="section-sub">Kelola saldo Anda</p>
      <div className="grid cols-4">
        <div className="card glass"><h3>Total Saldo</h3><div className="value">{balance ? fmt(balance.total) : '—'}</div></div>
        <div className="card glass"><h3>Saldo Tersedia</h3><div className="value">{balance ? fmt(balance.available) : '—'}</div></div>
        <div className="card glass"><h3>Total Masuk</h3><div className="value success-text">{balance ? fmt(balance.totalIn) : '—'}</div></div>
        <div className="card glass"><h3>Total Keluar</h3><div className="value danger-text">{balance ? fmt(balance.totalOut) : '—'}</div></div>
      </div>
      <div className="card glass" style={{ marginTop: 20 }}>
        <h3 style={{ color: 'var(--text)', fontSize: 15, marginBottom: 12 }}>Riwayat Perubahan Saldo</h3>
        <table className="table">
          <thead><tr><th>Tanggal</th><th>Jenis</th><th>Nominal</th><th>Sebelum</th><th>Sesudah</th><th>Status</th></tr></thead>
          <tbody>
            {txs.map((t) => (
              <tr key={t.id}>
                <td className="small">{new Date(t.createdAt).toLocaleString('id-ID')}</td>
                <td>{TX_LABEL[t.type] || t.type}</td>
                <td className={t.type.includes('in') || t.type === 'deposit' ? 'success-text' : 'danger-text'}>{fmt(t.amount)}</td>
                <td className="muted small">{fmt(t.balanceBefore)}</td>
                <td className="small">{fmt(t.balanceAfter)}</td>
                <td><span className={`badge ${t.status}`}>{t.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {txs.length === 0 && <div className="empty-state">Belum ada data</div>}
      </div>
    </div>
  )
}

function TambahPage({ showToast, enabled }: any) {
  const [amount, setAmount] = useState<number | ''>('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const presets = [5000, 10000, 20000, 50000, 100000, 200000]
  async function submit() {
    if (!enabled || busy) return
    const amt = Number(amount)
    if (!amt || amt <= 0) { showToast('Nominal tidak valid', 'error'); return }
    setBusy(true)
    try {
      await request('/api/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, note, date: date || undefined }),
      })
      showToast('Tabungan berhasil ditambahkan (DEMO)')
      setAmount(''); setNote(''); setDate('')
    } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
    finally { setBusy(false) }
  }
  return (
    <div>
      <h2 className="section-title">Tambah Tabungan</h2>
      <p className="section-sub">Tambahkan uang ke saldo Anda <span className="badge demo">DEMO</span></p>
      <div className="card glass" style={{ maxWidth: 520 }}>
        <div className="form-row">
          <label>Pilih Nominal</label>
          <div className="chips">
            {presets.map((p) => (
              <button key={p} className={`chip ${amount === p ? 'selected' : ''}`} onClick={() => setAmount(p)}>{fmt(p)}</button>
            ))}
            <button className={`chip ${amount !== '' && !presets.includes(Number(amount)) ? 'selected' : ''}`} onClick={() => setAmount('')}>Lainnya</button>
          </div>
        </div>
        <div className="form-row">
          <label>Nominal Uang</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))} placeholder="0" />
        </div>
        <div className="form-row">
          <label>Tanggal Transaksi</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Catatan</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </div>
        <button className="btn" disabled={busy || !amount} onClick={submit}>{busy ? 'Memproses...' : 'Konfirmasi Penambahan'}</button>
      </div>
    </div>
  )
}

function TarikPage({ showToast, enabled }: any) {
  const [amount, setAmount] = useState('')
  const [dest, setDest] = useState('')
  const [note, setNote] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit() {
    if (!enabled || busy) return
    const amt = Number(amount)
    if (!amt || amt <= 0) { showToast('Nominal tidak valid', 'error'); return }
    if (!pin) { showToast('PIN diperlukan', 'error'); return }
    setBusy(true)
    try {
      await request('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, destination: dest, note, pin }),
      })
      showToast('Penarikan berhasil')
      setAmount(''); setDest(''); setNote(''); setPin('')
    } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
    finally { setBusy(false) }
  }
  return (
    <div>
      <h2 className="section-title">Tarik Saldo</h2>
      <p className="section-sub">Tarik uang dari saldo Anda</p>
      <div className="card glass" style={{ maxWidth: 520 }}>
        <div className="form-row"><label>Nominal Penarikan</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></div>
        <div className="form-row"><label>Rekening Tujuan</label><input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="Nomor rekening tujuan" /></div>
        <div className="form-row"><label>Catatan</label><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></div>
        <div className="form-row"><label>PIN Transaksi</label><input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" /></div>
        <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Memproses...' : 'Konfirmasi Penarikan'}</button>
      </div>
    </div>
  )
}

function KirimPage({ showToast, enabled }: any) {
  const [accounts, setAccounts] = useState<SavedAccount[]>([])
  const [recipient, setRecipient] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [bank, setBank] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!enabled) return
    void request<{ accounts: SavedAccount[] }>('/api/saved-accounts').then((r) => setAccounts(r.accounts)).catch(() => {})
  }, [enabled])
  async function submit() {
    if (!enabled || busy) return
    const amt = Number(amount)
    if (!amt || amt <= 0) { showToast('Nominal tidak valid', 'error'); return }
    if (!recipient) { showToast('Nomor rekening tujuan diperlukan', 'error'); return }
    if (!pin) { showToast('PIN diperlukan', 'error'); return }
    setBusy(true)
    try {
      const r: any = await request('/api/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, recipient, recipientName, bank, note, pin }),
      })
      showToast(`Transfer berhasil${r.transaction?.fee ? ` (biaya Rp${r.transaction.fee.toLocaleString('id-ID')})` : ''}`)
      setAmount(''); setRecipient(''); setRecipientName(''); setBank(''); setNote(''); setPin('')
    } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
    finally { setBusy(false) }
  }
  function useAccount(a: SavedAccount) {
    setRecipient(a.accountNumber); setRecipientName(a.name); setBank(a.bank)
  }
  return (
    <div>
      <h2 className="section-title">Kirim Uang</h2>
      <p className="section-sub">Transfer ke rekening tujuan</p>
      <div className="grid cols-2">
        <div className="card glass">
          <h3 style={{ color: 'var(--text)', fontSize: 15, marginBottom: 12 }}>Rekening Tersimpan</h3>
          {accounts.length === 0 ? <div className="empty-state">Belum ada rekening tersimpan</div> : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {accounts.map((a) => (
                <li key={a.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(0,217,255,0.08)', cursor: 'pointer' }} onClick={() => useAccount(a)}>
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  <div className="small muted">{a.bank} • {a.accountNumber}</div>
                </li>
              ))}
            </ul>
          )}
          <SaveAccountForm onSaved={(a: SavedAccount) => setAccounts((p) => [a, ...p])} showToast={showToast} enabled={enabled} />
        </div>
        <div className="card glass">
          <div className="form-row"><label>Nomor Rekening Tujuan</label><input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="1234567890" /></div>
          <div className="form-row"><label>Nama Penerima</label><input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Nama penerima" /></div>
          <div className="form-row"><label>Pilihan Bank</label>
            <select value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="">Pilih bank</option>
              {['BCA', 'BNI', 'BRI', 'Mandiri', 'CIMB', 'Permata', 'Danamon'].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Nominal Transfer</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></div>
          <div className="form-row"><label>Catatan Transfer</label><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></div>
          <div className="form-row"><label>PIN Transaksi</label><input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" /></div>
          <div className="small muted" style={{ marginBottom: 10 }}>Biaya transaksi: Rp2.500 untuk transfer &lt; Rp100.000, gratis di atasnya.</div>
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Memproses...' : 'Konfirmasi Transfer'}</button>
        </div>
      </div>
    </div>
  )
}

function SaveAccountForm({ onSaved, showToast, enabled }: any) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [num, setNum] = useState('')
  const [bank, setBank] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!enabled || busy) return
    if (!name || !num) { showToast('Nama dan nomor wajib', 'error'); return }
    setBusy(true)
    try {
      const r: any = await request('/api/saved-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, accountNumber: num, bank }),
      })
      onSaved(r.account)
      setName(''); setNum(''); setBank(''); setOpen(false)
      showToast('Rekening tersimpan')
    } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
    finally { setBusy(false) }
  }
  if (!open) return <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>+ Tambah Rekening</button>
  return (
    <div style={{ marginTop: 12, padding: 12, border: '1px solid rgba(0,217,255,0.2)', borderRadius: 12 }}>
      <div className="form-row"><label>Nama</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-row"><label>Nomor Rekening</label><input value={num} onChange={(e) => setNum(e.target.value)} /></div>
      <div className="form-row"><label>Bank</label><input value={bank} onChange={(e) => setBank(e.target.value)} /></div>
      <div className="row">
        <button className="btn" disabled={busy} onClick={save}>{busy ? '...' : 'Simpan'}</button>
        <button className="btn ghost" onClick={() => setOpen(false)}>Batal</button>
      </div>
    </div>
  )
}

function TerimaPage({ showToast, enabled }: any) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [payment, setPayment] = useState<any>(null)
  const [status, setStatus] = useState('pending')
  const [history, setHistory] = useState<Transaction[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!enabled) return
    void request<{ transactions: Transaction[] }>('/api/transactions?type=qris_in&limit=20').then((r) => setHistory(r.transactions)).catch(() => {})
  }, [enabled])
  async function create() {
    if (!enabled || busy) return
    setBusy(true)
    try {
      const amt = amount ? Number(amount) : 0
      const r: any = await request('/api/receive/qris', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt || undefined, note }),
      })
      setPayment(r.payment)
      setStatus('pending')
      showToast('Permintaan pembayaran dibuat (DEMO)')
    } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
    finally { setBusy(false) }
  }
  async function confirm() {
    if (!payment) return
    setBusy(true)
    try {
      // if amount 0, ask
      if (!payment.amount) {
        const a = prompt('Masukkan nominal pembayaran yang diterima:')
        if (!a) { setBusy(false); return }
        await request(`/api/receive/confirm/${payment.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: Number(a) }),
        })
      } else {
        await request(`/api/receive/confirm/${payment.id}`, { method: 'POST' })
      }
      setStatus('success')
      showToast('Pembayaran diterima (DEMO)')
      const r = await request<{ transactions: Transaction[] }>('/api/transactions?type=qris_in&limit=20')
      setHistory(r.transactions)
    } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
    finally { setBusy(false) }
  }
  return (
    <div>
      <h2 className="section-title">Terima Uang</h2>
      <p className="section-sub">QRIS pembayaran <span className="badge demo">DEMO</span></p>
      <div className="grid cols-2">
        <div className="card glass">
          <div className="form-row"><label>Nominal Pembayaran (opsional)</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0 = bebas" /></div>
          <div className="form-row"><label>Catatan</label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <button className="btn" disabled={busy} onClick={create}>{busy ? '...' : 'Buat Permintaan Pembayaran'}</button>
          {payment && (
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <div style={{ background: '#fff', padding: 16, borderRadius: 12, display: 'inline-block' }}>
                <div style={{ width: 160, height: 160, background: 'repeating-linear-gradient(45deg,#000,#000 4px,#fff 4px,#fff 8px)', borderRadius: 8 }} />
              </div>
              <div className="small muted" style={{ marginTop: 8 }}>Ref: {payment.reference}</div>
              <div className="small" style={{ marginTop: 4 }}>Nominal: {payment.amount ? fmt(payment.amount) : 'Bebas'}</div>
              <div style={{ marginTop: 8 }}><span className={`badge ${status}`}>{status}</span></div>
              {status === 'pending' && <button className="btn success" style={{ marginTop: 10 }} disabled={busy} onClick={confirm}>Simulasikan Pembayaran Berhasil</button>}
            </div>
          )}
        </div>
        <div className="card glass">
          <h3 style={{ color: 'var(--text)', fontSize: 15, marginBottom: 12 }}>Riwayat Pembayaran Masuk</h3>
          <table className="table">
            <thead><tr><th>Tanggal</th><th>Ref</th><th>Nominal</th><th>Status</th></tr></thead>
            <tbody>
              {history.map((t) => (
                <tr key={t.id}>
                  <td className="small">{new Date(t.createdAt).toLocaleDateString('id-ID')}</td>
                  <td className="small">{t.reference}</td>
                  <td className="success-text">{fmt(t.amount)}</td>
                  <td><span className={`badge ${t.status}`}>{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.length === 0 && <div className="empty-state">Belum ada pembayaran</div>}
        </div>
      </div>
    </div>
  )
}

function RiwayatPage({ showToast, enabled, initialQ = '' }: any) {
  const [txs, setTxs] = useState<Transaction[]>([])
  const [q, setQ] = useState(initialQ)
  const [type, setType] = useState('all')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('newest')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    if (!enabled) return
    setBusy(true)
    try {
      const params = new URLSearchParams({ q, type, status, sort, limit: '300' })
      const r = await request<{ transactions: Transaction[] }>(`/api/transactions?${params}`)
      setTxs(r.transactions)
    } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
    finally { setBusy(false) }
  }, [enabled, q, type, status, sort])
  useEffect(() => { void load() }, [load])
  return (
    <div>
      <h2 className="section-title">Riwayat Transaksi</h2>
      <p className="section-sub">Semua aktivitas keuangan</p>
      <div className="card glass" style={{ marginBottom: 16 }}>
        <div className="row">
          <input placeholder="Cari nama/nominal/keterangan" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 2 }} />
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ flex: 1 }}>
            <option value="all">Semua Jenis</option>
            <option value="in">Uang Masuk</option>
            <option value="out">Uang Keluar</option>
            <option value="deposit">Tambah Tabungan</option>
            <option value="withdraw">Penarikan</option>
            <option value="transfer_out">Transfer</option>
            <option value="qris_in">Pembayaran QRIS</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ flex: 1 }}>
            <option value="all">Semua Status</option>
            <option value="success">Berhasil</option>
            <option value="pending">Pending</option>
            <option value="failed">Gagal</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ flex: 1 }}>
            <option value="newest">Terbaru</option>
            <option value="oldest">Terlama</option>
            <option value="amount_desc">Nominal Terbesar</option>
            <option value="amount_asc">Nominal Terkecil</option>
          </select>
          <button className="btn ghost" onClick={() => { setQ(''); setType('all'); setStatus('all'); setSort('newest') }}>Reset</button>
        </div>
      </div>
      <div className="card glass">
        <table className="table">
          <thead><tr><th>ID</th><th>Tanggal</th><th>Jenis</th><th>Nominal</th><th>Keterangan</th><th>Status</th><th>Sebelum</th><th>Sesudah</th><th>Bukti</th></tr></thead>
          <tbody>
            {txs.map((t) => (
              <tr key={t.id}>
                <td className="small muted">{t.id.slice(0, 8)}</td>
                <td className="small">{new Date(t.createdAt).toLocaleString('id-ID')}</td>
                <td>{TX_LABEL[t.type] || t.type}</td>
                <td className={t.type.includes('in') || t.type === 'deposit' || t.type === 'admin_adjustment' ? 'success-text' : 'danger-text'}>{fmt(t.amount)}</td>
                <td className="small">{t.note || t.counterparty}</td>
                <td><span className={`badge ${t.status}`}>{t.status}</span></td>
                <td className="small muted">{fmt(t.balanceBefore)}</td>
                <td className="small">{fmt(t.balanceAfter)}</td>
                <td><button className="btn ghost small" onClick={() => printHtml('Bukti Transaksi', receiptHtml(t))}>Unduh</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {txs.length === 0 && <div className="empty-state">Tidak ada transaksi</div>}
        {busy && <div className="small muted">Memuat...</div>}
      </div>
    </div>
  )
}

function LaporanPage({ showToast, enabled }: any) {
  const [txs, setTxs] = useState<Transaction[]>([])
  const [balance, setBalance] = useState<BalanceSummary | null>(null)
  const [period, setPeriod] = useState('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  useEffect(() => {
    if (!enabled) return
    void (async () => {
      try {
        const params = new URLSearchParams({ period })
        if (period === 'custom' && from && to) { params.set('from', String(new Date(from).getTime())); params.set('to', String(new Date(to).getTime())) }
        const r = await request<{ transactions: Transaction[]; summary: BalanceSummary }>(`/api/reports?${params}`)
        setTxs(r.transactions); setBalance(r.summary)
      } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
    })()
  }, [enabled, period, from, to])
  function exportCSV() {
    const rows = [['ID', 'Tanggal', 'Jenis', 'Nominal', 'Status', 'Keterangan']]
    txs.forEach((t) => rows.push([t.id, new Date(t.createdAt).toISOString(), t.type, String(t.amount), t.status, t.note]))
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'laporan-apryadigoal.csv'; a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div>
      <h2 className="section-title">Laporan Keuangan</h2>
      <p className="section-sub">Statistik dan analisis keuangan</p>
      <div className="row" style={{ marginBottom: 16 }}>
        {['today', 'week', 'month', 'year', 'custom'].map((p) => (
          <button key={p} className={`chip ${period === p ? 'selected' : ''}`} onClick={() => setPeriod(p)}>{p === 'today' ? 'Hari Ini' : p === 'week' ? 'Minggu Ini' : p === 'month' ? 'Bulan Ini' : p === 'year' ? 'Tahun Ini' : 'Pilih Tanggal'}</button>
        ))}
        {period === 'custom' && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        <button className="btn ghost" onClick={exportCSV}>Ekspor CSV (Excel)</button>
        <button
          className="btn ghost"
          onClick={() =>
            printHtml(
              'Laporan Keuangan ApryadiGoal',
              `<div class="brand">ApryadiGoal</div><h1>Laporan Keuangan</h1>
               <p class="muted">Periode: ${period} — dicetak ${new Date().toLocaleString('id-ID')}</p>
               <div class="row"><span>Total Masuk</span><span>${fmt(balance?.totalIn || 0)}</span></div>
               <div class="row"><span>Total Keluar</span><span>${fmt(balance?.totalOut || 0)}</span></div>
               <div class="row"><span>Total Ditabung</span><span>${fmt(balance?.totalSaved || 0)}</span></div>
               <div class="row"><span>Saldo Sekarang</span><span>${fmt(balance?.total || 0)}</span></div>
               <table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Nominal</th><th>Status</th></tr></thead><tbody>
               ${txs.map((t) => `<tr><td>${new Date(t.createdAt).toLocaleDateString('id-ID')}</td><td>${TX_LABEL[t.type] || t.type}</td><td>${fmt(t.amount)}</td><td>${t.status}</td></tr>`).join('')}
               </tbody></table>`,
            )
          }
        >
          Cetak / Simpan PDF
        </button>
      </div>
      {balance && (
        <div className="grid cols-4" style={{ marginBottom: 20 }}>
          <div className="card glass"><h3>Total Masuk</h3><div className="value success-text">{fmt(balance.totalIn)}</div></div>
          <div className="card glass"><h3>Total Keluar</h3><div className="value danger-text">{fmt(balance.totalOut)}</div></div>
          <div className="card glass"><h3>Total Ditabung</h3><div className="value">{fmt(balance.totalSaved)}</div></div>
          <div className="card glass"><h3>Saldo Sekarang</h3><div className="value">{fmt(balance.total)}</div></div>
        </div>
      )}
      <div className="card glass">
        <h3 style={{ color: 'var(--text)', fontSize: 15, marginBottom: 12 }}>Riwayat Transaksi</h3>
        <table className="table">
          <thead><tr><th>Tanggal</th><th>Jenis</th><th>Nominal</th><th>Status</th></tr></thead>
          <tbody>
            {txs.map((t) => (
              <tr key={t.id}>
                <td className="small">{new Date(t.createdAt).toLocaleDateString('id-ID')}</td>
                <td>{TX_LABEL[t.type] || t.type}</td>
                <td className={t.type.includes('in') || t.type === 'deposit' ? 'success-text' : 'danger-text'}>{fmt(t.amount)}</td>
                <td><span className={`badge ${t.status}`}>{t.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {txs.length === 0 && <div className="empty-state">Tidak ada data</div>}
      </div>
    </div>
  )
}
