import { useState } from 'react'
import { request } from './api'

type AuthStep = 'login' | 'register' | 'verify' | 'forgot' | 'reset'

export function AuthPage({ showToast, inline }: any) {
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

export function SetupPage() {
  return (
    <div className="login-page">
      <div className="login-card glass">
        <h1>Setup</h1>
        <p className="muted">Aplikasi sedang disiapkan. Coba lagi nanti.</p>
      </div>
    </div>
  )
}
