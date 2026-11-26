// PostgreSQL clients for the Vercel/Node target.
// A real connection string (DATABASE_URL) gives durable storage; without one the
// demo falls back to PGlite, a real Postgres compiled to WASM living in /tmp.
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

export async function createPgliteClient(dataDir: string): Promise<Client> {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = await PGlite.create(dataDir)
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
