// Cloudflare bindings used by this project, declared globally.
//
// They are pulled into every compilation through the `/// <reference>` in
// src/shared/types.ts, so the repository typechecks both under workerd and under
// a plain DOM/Node tsconfig (Vercel runs `tsc` over the project by itself).
// Kept structural so both D1 and the PostgreSQL facade in src/server/pgD1.ts fit.

interface D1Meta {
  changes?: number
  last_row_id?: number
  [key: string]: unknown
}

interface D1Result<T = Record<string, unknown>> {
  results: T[]
  success: boolean
  meta: D1Meta
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run(): Promise<{ success: boolean; meta: D1Meta }>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>
  exec(query: string): Promise<unknown>
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}
