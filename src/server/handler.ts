// Node entry that mounts the existing Hono app with a PostgreSQL-backed D1 facade.
import { createApp } from '../worker/app.js'
import { resolveClient, type Storage } from './db.js'
import { createD1 } from './pgD1.js'

const inner = createApp()

// The connection is opened on first database use, so static checks such as
// /api/health stay fast, and a database failure surfaces as a JSON error from
// Hono instead of crashing the whole serverless invocation.
const ready = resolveClient()
ready.catch(() => {
  // Requests that need the database report the error; nothing else should.
})
const db = createD1(ready.then((resolved) => resolved.client))

const state: { storage: Storage; describe: string } = {
  storage: 'ephemeral',
  describe: 'PGlite (PostgreSQL di /tmp, data sementara)',
}
ready
  .then((resolved) => {
    state.storage = resolved.storage
    state.describe = resolved.describe
  })
  .catch(() => {})

export function createNodeApp() {
  return {
    async fetch(request: Request, env?: Record<string, unknown>, ctx?: unknown): Promise<Response> {
      const merged = {
        ...(process.env as Record<string, unknown>),
        ...(env || {}),
        DB: db,
        get APRYADI_STORAGE() {
          return state.storage
        },
        get APRYADI_STORAGE_DESCRIBE() {
          return state.describe
        },
      }
      return inner.fetch(request, merged as never, ctx as never)
    },
  }
}
