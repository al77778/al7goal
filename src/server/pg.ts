// PostgreSQL clients for the Vercel/Node target.
// A real connection string (DATABASE_URL) gives durable storage; without one the
// demo falls back to PGlite, a real Postgres compiled to WASM living in /tmp.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type FieldMeta = { name: string; dataTypeID?: number }
export type QueryResult = { rows: Record<string, any>[]; fields?: FieldMeta[]; affectedRows?: number }

export type Client = {
  query(text: string, params?: unknown[]): Promise<QueryResult>
  end?(): Promise<void>
}

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)
}

export function databaseUrl(): string {
  return (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim()
}

function needsSsl(url: string): boolean {
  if (/sslmode=disable/i.test(url)) return false
  return (
    /sslmode=(require|verify-ca|verify-full)/i.test(url) ||
    /(neon\.tech|supabase\.co|render\.com|vercel-storage|aws\.neon)/i.test(url)
  )
}

export async function createPgClient(url: string): Promise<Client> {
  const pg = (await import('pg')).default
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX || 3),
    ssl: needsSsl(url) ? { rejectUnauthorized: false } : undefined,
  })
  return {
    async query(text, params = []) {
      const res = await pool.query({ text, values: params as any[] })
      return {
        rows: res.rows as Record<string, any>[],
        fields: res.fields?.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
        affectedRows: res.rowCount ?? undefined,
      }
    },
    end: () => pool.end(),
  }
}

/**
 * Where the PGlite package stores its WASM payload. A serverless bundler can
 * inline the library, so `import.meta.url` no longer points at the package
 * directory and PGlite's own `new URL('pglite.wasm', import.meta.url)` fails.
 * We look the files up ourselves and hand them to PGlite instead.
 */
function pgliteAssetDirs(): string[] {
  const dirs = new Set<string>()
  const add = (dir: string) => dirs.add(dir)
  for (const base of [process.cwd(), '/var/task']) {
    add(join(base, 'node_modules/@electric-sql/pglite/dist'))
  }
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    add(join(here, 'node_modules/@electric-sql/pglite/dist'))
    add(here)
  } catch {
    // Bundled as CommonJS without import.meta.url: the paths above still apply.
  }
  return [...dirs]
}

type PgliteAssets = {
  pgliteWasmModule: WebAssembly.Module
  initdbWasmModule?: WebAssembly.Module
  fsBundle: Blob
}

async function loadPgliteAssets(): Promise<PgliteAssets | undefined> {
  for (const dir of pgliteAssetDirs()) {
    const wasmPath = join(dir, 'pglite.wasm')
    const dataPath = join(dir, 'pglite.data')
    if (!existsSync(wasmPath) || !existsSync(dataPath)) continue
    const initdbPath = join(dir, 'initdb.wasm')
    const [wasm, data, initdb] = await Promise.all([
      readFile(wasmPath),
      readFile(dataPath),
      existsSync(initdbPath) ? readFile(initdbPath) : Promise.resolve(undefined),
    ])
    return {
      pgliteWasmModule: new WebAssembly.Module(wasm),
      initdbWasmModule: initdb ? new WebAssembly.Module(initdb) : undefined,
      fsBundle: new Blob([data]),
    }
  }
  return undefined
}

export async function createPgliteClient(dataDir: string): Promise<Client> {
  const { PGlite } = await import('@electric-sql/pglite')
  const assets = await loadPgliteAssets()
  const db = await PGlite.create(dataDir, assets)
  return {
    async query(text, params = []) {
      const res: any = await db.query(text, params)
      return {
        rows: res.rows ?? [],
        fields: res.fields?.map((f: any) => ({ name: f.name, dataTypeID: f.dataTypeID })),
        affectedRows: res.affectedRows,
      }
    },
    end: () => db.close(),
  }
}
