// Per-process database for the Node/Vercel target.
import { createD1, type D1Like } from './pgD1'
import { createPgClient, createPgliteClient, databaseUrl, hasDatabaseUrl } from './pg'

export type Storage = 'postgres' | 'ephemeral'

type Resolved = { db: D1Like; storage: Storage; describe: string }

let cached: Promise<Resolved> | undefined

export function resolveDb(): Promise<Resolved> {
  if (!cached) {
    cached = (async () => {
      if (hasDatabaseUrl()) {
        const client = await createPgClient(databaseUrl())
        return { db: createD1(client), storage: 'postgres' as const, describe: 'PostgreSQL (DATABASE_URL)' }
      }
      const client = await createPgliteClient(process.env.PGLITE_DIR || '/tmp/apryadigoal-pg')
      return {
        db: createD1(client),
        storage: 'ephemeral' as const,
        describe: 'PGlite (PostgreSQL di /tmp, data sementara)',
      }
    })().catch((error) => {
      cached = undefined
      throw error
    })
  }
  return cached
}
