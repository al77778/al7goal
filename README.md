# ApryadiGoal

**Tabung Sekarang, Kelola Uangmu!**

Aplikasi tabungan digital bertema dark futuristic fintech: saldo, tambah tabungan, tarik saldo,
kirim uang, terima uang (QRIS), riwayat transaksi, pencarian & filter, laporan keuangan,
notifikasi, profil, serta dashboard admin terpisah dengan 2FA.

Semua angka saldo berasal dari database di server (bukan `localStorage`). Setiap transaksi
menyimpan saldo sebelum dan sesudah sehingga dashboard, laporan, dan riwayat selalu konsisten.

> **Mode DEMO.** Tambah tabungan, tarik saldo, transfer, dan QRIS berjalan penuh terhadap database,
> tetapi belum memindahkan uang sungguhan. Label `DEMO` ditampilkan di halaman terkait. Integrasi
> uang sungguhan wajib memakai penyedia pembayaran resmi (lihat bagian *Menuju produksi*).

## Dua target deploy, satu basis kode

| Target | Runtime | Database | Perintah |
| --- | --- | --- | --- |
| Vercel | Node serverless (`api/*.ts`) | PostgreSQL (`DATABASE_URL`) | `npm run build:vercel` |
| Cloudflare / Freebuff Sites | Worker (workerd) | D1 (SQLite) | `npm run build` |

API-nya satu: `src/worker/app.ts` (Hono). Di Node, `src/server/pgD1.ts` menyediakan facade
kompatibel D1 di atas PostgreSQL (konversi `?` menjadi `$1`, transaksi untuk batch, normalisasi
int8), sehingga seluruh route dan query dipakai bersama tanpa duplikasi.

## Menjalankan

```sh
npm install
npm run dev        # http://localhost:3001 — Vite + Worker + D1 lokal
npm run dev:node   # http://localhost:3100 — Hono di Node + PostgreSQL/PGlite
npm test           # 7 integration test (Miniflare + D1 asli)
npm run typecheck  # tsc untuk client, worker, dan server Node
npm run build      # build client + worker (Cloudflare)
npm run build:vercel  # build client statis untuk Vercel
```

Tanpa `DATABASE_URL`, target Node memakai **PGlite** (PostgreSQL asli berbasis WASM) di `/tmp`:
aplikasi tetap berfungsi untuk demo, tetapi data bersifat sementara dan UI menampilkan banner.

Login admin awal dibuat otomatis saat login admin pertama:

- username: `apryadi`
- password: `megalodon123`
- role: `superadmin`

Kredensial ini ada karena diminta untuk mode demo. Ganti sebelum dipakai publik dan aktifkan 2FA
di **Admin → Keamanan/2FA**.

## Deploy ke Vercel

1. Import repo ini di Vercel. `vercel.json` memaksa **Framework Preset: Vite**, build command
   `npm run build:vercel`, dan output directory `dist/vercel` (jadi Vercel tidak lagi mencoba
   `next build`).
2. Siapkan PostgreSQL (Neon, Supabase, atau Vercel Postgres), lalu set environment variable
   `DATABASE_URL` untuk Production dan Preview.
3. Opsional: set `APP_ORIGIN` ke URL produksi, mis. `https://apryadigoal.vercel.app`.
4. Deploy. Skema tabel dibuat otomatis pada request pertama.
5. Login admin, ganti password, aktifkan 2FA.

## Struktur kode

```
api/                  Entry function Vercel (/api/*)
src/client/           UI React + tema CSS
src/worker/           Entrypoint Worker + API Hono + auth + skema + TOTP
src/server/           Adapter PostgreSQL untuk target Node/Vercel
src/shared/           Tipe bersama client/server
tests/                Integration test (Miniflare D1)
```

## Keamanan

- Prepared statement + parameter terikat di seluruh query (anti SQL injection).
- Password & PIN: PBKDF2-SHA256, salt acak per akun, perbandingan waktu-konstan.
- Sesi: cookie `httpOnly`, `SameSite=Lax`, `secure` di HTTPS, token tersimpan di server.
- Brute force: maksimal 6 percobaan gagal per identifier per 10 menit (akun & admin).
- CSRF: semua mutasi wajib lolos pemeriksaan same-origin.
- Validasi saldo di server: saldo tidak bisa negatif, nominal harus bilangan bulat positif.
- Peran & audit: `/api/admin/*` hanya untuk sesi admin; perubahan saldo admin wajib alasan +
  catatan dan tercatat di `audit_logs` (admin, waktu, target, nominal).
- 2FA admin: TOTP 6 digit (RFC 6238) dengan jendela ±30 detik.
- QRIS: status hanya berubah lewat endpoint konfirmasi server (pengganti webhook), saldo
  bertambah setelah status `success`.

## Menuju produksi (uang sungguhan)

1. Pilih penyedia pembayaran resmi yang mendukung QRIS + disbursement (Midtrans, Xendit, DOKU).
2. Simpan server key sebagai secret; jangan pernah di client.
3. Buat endpoint webhook dengan verifikasi signature, idempotency key, dan pencocokan nominal.
4. Ganti `POST /api/receive/confirm/:id` (simulasi) dengan handler webhook penyedia.
5. Untuk transfer keluar, gunakan disbursement API penyedia setelah PIN diverifikasi.

## Yang sudah diuji

`npm test`: health & penolakan akses tanpa login, tambah tabungan, penarikan melebihi saldo ditolak,
transfer + biaya, isolasi data antar pengguna, QRIS pending → konfirmasi → saldo bertambah,
penolakan origin asing pada route akun, seed & login admin.

Target Node/PostgreSQL juga diuji manual (curl, sesi cookie asli) terhadap PGlite: registrasi →
OTP → verifikasi → login, tambah tabungan, tarik saldo (termasuk penolakan saldo kurang),
riwayat transaksi, laporan, login admin, statistik admin, dan daftar pengguna.

Belum diuji: tampilan visual di browser tidak diperiksa lewat screenshot/klik otomatis, dan
pembayaran uang sungguhan memang belum terintegrasi.
