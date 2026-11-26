// A D1-compatible facade over PostgreSQL, so the existing Worker routes and SQL
// run unchanged on Node/Vercel. Placeholders are rewritten `?` -> `$1..$n`.
import type { Client, FieldMeta } from './pg'

const NUMERIC_TYPES = new Set([20, 21, 23, 1700]) // int8, int2, int4, numeric
const NUMERIC_COLUMNS = /^(count|sum|c|s|amount|balance_before|balance_after|total|total_in|total_out|users|transactions)$/i

function convertRow(row: Record<string, any>, fields?: FieldMeta[]): Record<string, any> {
  if (!row) return row
  if (fields?.length) {
    const out: Record<string, any> = {}
    for (const field of fields) {
      const value = row[field.name]
      out[field.name] =
        value === null || value === ''
          ? value
          : field.dataTypeID && NUMERIC_TYPES.has(field.dataTypeID)
            ? Number(value)
            : value
    }
    return out
  }
  const out: Record<string, any> = {}
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') out[key] = Number(value)
    else if (typeof value === 'string' && NUMERIC_COLUMNS.test(key) && /^-?\d+$/.test(value)) out[key] = Number(value)
    else out[key] = value
  }
  return out
}

/** Rewrite `?` placeholders outside single-quoted literals into `$n`. */
export function toPostgres(sql: string): string {
  let out = ''
  let quoted = false
  let index = 0
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]
    if (char === "'") {
      out += char
      if (quoted && sql[i + 1] === "'") {
        out += "'"
        i += 1
        continue
      }
      quoted = !quoted
      continue
    }
    if (char === '?' && !quoted) {
      index += 1
      out += `$${index}`
      continue
    }
    out += char
  }
  return out
}

type Row = Record<string, any>

class Statement {
  constructor(
    private readonly client: Client,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    return new Statement(this.client, this.sql, params)
  }

  private async execute(): Promise<{ rows: Row[]; affectedRows?: number }> {
    const res = await this.client.query(toPostgres(this.sql), this.params)
    return { rows: (res.rows || []).map((row) => convertRow(row, res.fields)), affectedRows: res.affectedRows }
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    const { rows } = await this.execute()
    const row = rows[0]
    if (!row) return null
    if (column) return ((row[column] as T) ?? null)
    return row as T
  }

  async all<T = Row>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    const { rows } = await this.execute()
    return { results: rows as T[], success: true, meta: {} }
  }

  async run(): Promise<{ success: true; meta: { changes?: number } }> {
    const { affectedRows } = await this.execute()
    return { success: true, meta: { changes: affectedRows } }
  }

  /** Internal: used by batch() without going through the public API. */
  raw(): { sql: string; params: unknown[] } {
    return { sql: this.sql, params: this.params }
  }
}

export type D1Like = {
  prepare(sql: string): Statement
  batch(statements: Statement[]): Promise<unknown[]>
  exec(sql: string): Promise<void>
}

export function createD1(client: Client): D1Like {
  return {
    prepare(sql: string) {
      return new Statement(client, sql)
    },
    async batch(statements: Statement[]) {
      const out: unknown[] = []
      await client.query('BEGIN')
      try {
        for (const statement of statements) {
          const { sql, params } = statement.raw()
          const res = await client.query(toPostgres(sql), params)
          out.push({
            success: true,
            results: (res.rows || []).map((row) => convertRow(row, res.fields)),
            meta: { changes: res.affectedRows },
          })
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      }
      return out
    },
    async exec(sql: string) {
      await client.query(sql)
    },
  }
}
