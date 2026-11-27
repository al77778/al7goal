import { useEffect, useState, useCallback } from 'react'
import type { Transaction, BalanceSummary, SavedAccount, AppNotification, Profile, Session } from '../shared/types'
import { request, fmt, TX_LABEL, printHtml, receiptHtml } from './api'

export function DashboardPage({ showToast, enabled }: any) {
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

export function SaldoPage({ showToast, enabled }: any) {
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

export function TambahPage({ showToast, enabled }: any) {
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

export function TarikPage({ showToast, enabled }: any) {
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

export function KirimPage({ showToast, enabled }: any) {
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
  const amt = Number(amount) || 0
  const fee = amt > 0 && amt < 100000 ? 2500 : 0
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-icon" aria-hidden="true" />
        <div>
          <p className="eyebrow">Transfer Dana</p>
          <h2 className="section-title">Kirim Uang</h2>
          <p className="section-sub" style={{ margin: 0 }}>Transfer ke rekening tujuan dengan aman</p>
        </div>
      </div>
      <div className="grid cols-2">
        <div className="card glass panel">
          <div className="panel-head">
            <div>
              <h3>Rekening Tersimpan</h3>
              <p className="small muted">Ketuk rekening untuk mengisi formulir</p>
            </div>
            <span className="badge demo">{accounts.length} tersimpan</span>
          </div>
          {accounts.length === 0 ? (
            <div className="empty-motif">
              <div className="empty-icon">🏦</div>
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>Belum ada rekening tersimpan</div>
              <div className="small" style={{ marginTop: 4 }}>Simpan rekening favorit agar transfer berikutnya lebih cepat.</div>
            </div>
          ) : (
            <ul className="saved-list">
              {accounts.map((a) => (
                <li key={a.id}>
                  <button type="button" className="saved-item" onClick={() => useAccount(a)}>
                    <span className="avatar-sm">{(a.bank || a.name).slice(0, 2).toUpperCase()}</span>
                    <span className="saved-meta">
                      <span className="saved-name">{a.name}</span>
                      <span className="small muted">{a.bank || 'Bank'} • {a.accountNumber}</span>
                    </span>
                    <span className="saved-arrow">→</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <SaveAccountForm onSaved={(a: SavedAccount) => setAccounts((p) => [a, ...p])} showToast={showToast} enabled={enabled} />
        </div>
        <div className="card glass panel">
          <div className="panel-head">
            <div>
              <h3>Detail Transfer</h3>
              <p className="small muted">Lengkapi data penerima dan nominal</p>
            </div>
            <span className="badge pending">PIN wajib</span>
          </div>
          <div className="form-row">
            <label>Nominal Transfer</label>
            <div className="amount-field">
              <span>Rp</span>
              <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="grid cols-2 form-grid" style={{ marginBottom: 15 }}>
            <div className="form-row"><label>Nomor Rekening Tujuan</label><input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="1234567890" /></div>
            <div className="form-row"><label>Pilihan Bank</label>
              <select value={bank} onChange={(e) => setBank(e.target.value)}>
                <option value="">Pilih bank</option>
                {['BCA', 'BNI', 'BRI', 'Mandiri', 'CIMB', 'Permata', 'Danamon'].map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row"><label>Nama Penerima</label><input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Nama penerima" /></div>
          <div className="form-row"><label>Catatan Transfer</label><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Opsional" /></div>
          <div className="form-row"><label>PIN Transaksi</label><input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" /></div>
          <div className="summary">
            <div className="summary-row"><span>Nominal</span><span>{fmt(amt)}</span></div>
            <div className="summary-row"><span>Biaya admin</span><span>{amt === 0 ? '—' : fee ? fmt(fee) : 'Gratis'}</span></div>
            <div className="summary-row total"><span>Total</span><span>{fmt(amt + fee)}</span></div>
          </div>
          <div className="hint">Biaya Rp2.500 untuk transfer di bawah Rp100.000, gratis di atasnya.</div>
          <button className="btn btn-block" disabled={busy} onClick={submit}>{busy ? 'Memproses...' : 'Konfirmasi Transfer'}</button>
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
  if (!open) return <button className="btn ghost btn-block" style={{ marginTop: 14 }} onClick={() => setOpen(true)}>+ Tambah Rekening</button>
  return (
    <div style={{ marginTop: 14, padding: 14, border: '1px solid rgba(0,217,255,0.22)', borderRadius: 14, background: 'rgba(4,14,30,0.5)' }}>
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

export function TerimaPage({ showToast, enabled }: any) {
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

export function RiwayatPage({ showToast, enabled, initialQ = '' }: any) {
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

export function LaporanPage({ showToast, enabled }: any) {
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

export function ProfilPage({ showToast, enabled, session }: any) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [pin, setPin] = useState('')
  const [hasPin, setHasPin] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  useEffect(() => {
    if (!enabled) return
    void request<{ profile: Profile }>('/api/profile').then((r) => {
      setProfile(r.profile)
      if (r.profile) { setName(r.profile.name); setPhone(r.profile.phone); setAvatarUrl(r.profile.avatarUrl) }
    }).catch(() => {})
    void request<{ hasPin: boolean }>('/api/profile/pin-status').then((r) => setHasPin(r.hasPin)).catch(() => {})
  }, [enabled])
  async function save() {
    try {
      const r = await request<{ profile: Profile }>('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, avatarUrl }),
      })
      setProfile(r.profile)
      showToast('Profil diperbarui')
    } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
  }
  return (
    <div>
      <h2 className="section-title">Profil</h2>
      <p className="section-sub">Informasi akun Anda</p>
      <div className="card glass" style={{ maxWidth: 520 }}>
        <div className="form-row"><label>Nama Lengkap</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="form-row"><label>Email</label><input value={profile?.email || session?.user?.email || ''} disabled /></div>
        <div className="form-row"><label>Nomor HP</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="form-row"><label>URL Foto Profil</label><input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} /></div>
        <div className="form-row"><label>Tanggal Bergabung</label><input value={profile ? new Date(profile.joinedAt).toLocaleDateString('id-ID') : ''} disabled /></div>
        <button className="btn" onClick={save}>Simpan Perubahan</button>
      </div>
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card glass">
          <h3 style={{ color: 'var(--text)', fontSize: 15, marginBottom: 10 }}>PIN Transaksi</h3>
          <p className="small muted">Status: {hasPin ? 'sudah diatur' : 'belum diatur (PIN apa pun diterima di mode demo)'}</p>
          <div className="form-row"><label>PIN Baru (4-6 digit)</label><input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} /></div>
          <button
            className="btn"
            onClick={async () => {
              try {
                await request('/api/profile/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) })
                setHasPin(true); setPin('')
                showToast('PIN transaksi disimpan')
              } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
            }}
          >Simpan PIN</button>
        </div>
        <div className="card glass">
          <h3 style={{ color: 'var(--text)', fontSize: 15, marginBottom: 10 }}>Ganti Password</h3>
          <div className="form-row"><label>Password Saat Ini</label><input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} /></div>
          <div className="form-row"><label>Password Baru (min. 8 karakter)</label><input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} /></div>
          <button
            className="btn"
            onClick={async () => {
              try {
                await request('/api/profile/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }) })
                setCurrentPw(''); setNewPw('')
                showToast('Password diperbarui')
              } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
            }}
          >Perbarui Password</button>
        </div>
      </div>
    </div>
  )
}

export function PengaturanPage({ showToast, enabled, session, admin }: any) {
  const [notifs, setNotifs] = useState<AppNotification[]>([])
  useEffect(() => {
    if (!enabled) return
    void request<{ notifications: AppNotification[] }>('/api/notifications').then((r) => setNotifs(r.notifications)).catch(() => {})
  }, [enabled])
  async function markAll() {
    await request('/api/notifications/read-all', { method: 'POST' })
    setNotifs((p) => p.map((n) => ({ ...n, read: true })))
    showToast('Semua notifikasi dibaca')
  }
  return (
    <div>
      <h2 className="section-title">Pengaturan</h2>
      <p className="section-sub">Keamanan, notifikasi, tampilan</p>
      <div className="grid cols-2">
        <div className="card glass">
          <h3 style={{ color: 'var(--text)', fontSize: 15, marginBottom: 12 }}>Keamanan</h3>
          <p className="small muted">Ganti password melalui akun Freebuff Anda.</p>
          <p className="small muted">PIN transaksi digunakan saat tarik/transfer.</p>
        </div>
        <div className="card glass">
          <h3 style={{ color: 'var(--text)', fontSize: 15, marginBottom: 12 }}>Notifikasi</h3>
          <button className="btn ghost" onClick={markAll}>Tandai Semua Dibaca</button>
          <div style={{ marginTop: 12, maxHeight: 240, overflowY: 'auto' }}>
            {notifs.map((n) => (
              <div key={n.id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,217,255,0.08)' }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
                <div className="small muted">{n.message}</div>
                <div className="small muted">{new Date(n.createdAt).toLocaleString('id-ID')}</div>
              </div>
            ))}
            {notifs.length === 0 && <div className="empty-state">Tidak ada notifikasi</div>}
          </div>
        </div>
      </div>
      {admin && <div className="card glass" style={{ marginTop: 16 }}><p className="small">Admin aktif: {admin.username}</p></div>}
    </div>
  )
}

export function NotifikasiPage({ showToast, enabled }: any) {
  const [items, setItems] = useState<AppNotification[]>([])
  const load = useCallback(async () => {
    if (!enabled) return
    try {
      const r = await request<{ notifications: AppNotification[] }>('/api/notifications')
      setItems(r.notifications)
    } catch (e) { showToast(e instanceof Error ? e.message : 'err', 'error') }
  }, [enabled])
  useEffect(() => { void load() }, [load])
  async function markAll() {
    await request('/api/notifications/read-all', { method: 'POST' })
    setItems((p) => p.map((n) => ({ ...n, read: true })))
  }
  async function markOne(id: string) {
    await request(`/api/notifications/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ read: true }) })
    setItems((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }
  return (
    <div>
      <h2 className="section-title">Notifikasi</h2>
      <p className="section-sub">Aktivitas tabungan, penarikan, transfer, pembayaran, dan keamanan akun</p>
      <div className="card glass">
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="muted small">{items.filter((n) => !n.read).length} belum dibaca</span>
          <button className="btn ghost small right" onClick={markAll}>Tandai Semua Dibaca</button>
        </div>
        {items.length === 0 && <div className="empty-state">Belum ada notifikasi</div>}
        {items.map((n) => (
          <div key={n.id} style={{ padding: '12px 0', borderBottom: '1px solid rgba(0,217,255,0.08)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span>{n.kind === 'success' ? '✅' : n.kind === 'error' ? '⚠️' : '🔔'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: n.read ? 400 : 700, fontSize: 14 }}>{n.title}</div>
              <div className="small muted">{n.message}</div>
              <div className="small muted">{new Date(n.createdAt).toLocaleString('id-ID')}</div>
            </div>
            {!n.read && <button className="btn ghost small" onClick={() => void markOne(n.id)}>Tandai dibaca</button>}
          </div>
        ))}
      </div>
    </div>
  )
}

export function BantuanPage() {
  return (
    <div>
      <h2 className="section-title">Bantuan</h2>
      <p className="section-sub">Pusat bantuan ApryadiGoal</p>
      <div className="card glass">
        <h3 style={{ color: 'var(--text)', fontSize: 15 }}>FAQ</h3>
        <div className="small" style={{ marginTop: 8 }}>
          <p><strong>Bagaimana menambah tabungan?</strong> Menu Tambah Tabungan → pilih nominal → konfirmasi.</p>
          <p><strong>Apakah transfer sungguhan?</strong> Mode DEMO. Transfer sungguhan memerlukan integrasi payment provider resmi.</p>
          <p><strong>QRIS?</strong> Mode DEMO dengan label DEMO. QRIS resmi memerlukan provider pembayaran.</p>
        </div>
      </div>
    </div>
  )
}

