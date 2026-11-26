// Per-process database for the Node/Vercel target.
import { createD1, type D1Like } from './pgD1'
import { createPgClient, createPgliteClient, databaseUrl, hasDatabaseUrl, type Client } from './pg'

export type Storage = 'postgres' | 'ephemeral'

export type Resolved = { client: Client; storage: Storage; describe: string }

let cached: Promise<Resolved> | undefined

/** Opens the database connection at most once per serverless instance. */
export function resolveClient(): Promise<Resolved> {
  if (!cached) {
    cached = (async () => {
      if (hasDatabaseUrl()) {
        const client = await createPgClient(databaseUrl())
        return { client, storage: 'postgres' as const, describe: 'PostgreSQL (DATABASE_URL)' }
      }
      const client = await createPgliteClient(process.env.PGLITE_DIR || '/tmp/apryadigoal-pg')
      return {
        client,
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

export function resolveDb(): Promise<{ db: D1Like; storage: Storage; describe: string }> {
  return resolveClient().then(({ client, storage, describe }) => ({
    db: createD1(client),
    storage,
    describe,
  }))
}
