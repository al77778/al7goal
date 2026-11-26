import type { Transaction } from '../shared/types'

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = (await response.json().catch(() => {
    throw new Error('Could not reach the server. Please try again.')
  })) as T & { error?: string }
  if (!response.ok) throw new Error(body.error || 'Request failed.')
  return body
}

export const fmt = (n: number) => 'Rp' + (n || 0).toLocaleString('id-ID')

export function printHtml(title: string, inner: string) {
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

export function receiptHtml(tx: Transaction) {
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

export const TX_LABEL: Record<string, string> = {
  deposit: 'Tambah Tabungan',
  withdraw: 'Tarik Saldo',
  transfer_out: 'Kirim Uang',
  transfer_in: 'Terima Uang',
  qris_in: 'QRIS Masuk',
  qris_out: 'QRIS Keluar',
  admin_adjustment: 'Penyesuaian Admin',
}
