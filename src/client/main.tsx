// Always start at the sign-in screen until a user session exists.
if (!session?.user) {
  return <AuthPage showToast={showToast} />   // login / daftar / OTP / lupa password
}
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Session } from '../shared/types'
import './style.css'
import { request } from './api'
import {
  DashboardPage, SaldoPage, TambahPage, TarikPage, KirimPage, TerimaPage,
  RiwayatPage, LaporanPage, ProfilPage, PengaturanPage, NotifikasiPage, BantuanPage,
} from './pages'
import { AdminLoginPage, AdminShell } from './admin'
import { AuthPage, SetupPage } from './auth'

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

createRoot(document.getElementById('root')!).render(<App />)
