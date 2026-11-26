// Node entry that mounts the existing Hono app with a PostgreSQL-backed D1 facade.
import { createApp } from '../worker/app'
import { resolveDb } from './db'

const inner = createApp()

export function createNodeApp() {
  return {
    async fetch(request: Request, env?: Record<string, unknown>, ctx?: unknown): Promise<Response> {
      const { db, storage, describe } = await resolveDb()
      const merged = {
        ...(process.env as Record<string, unknown>),
        ...(env || {}),
        DB: db,
        APRYADI_STORAGE: storage,
        APRYADI_STORAGE_DESCRIBE: describe,
      }
      return inner.fetch(request, merged as never, ctx as never)
    },
  }
}
