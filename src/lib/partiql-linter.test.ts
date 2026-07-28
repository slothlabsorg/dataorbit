import { describe, it, expect } from 'vitest'
import { lintPartiQL, getSuggestions } from './partiql-linter'
import type { TableMeta } from '@/types'

const VISIT_TABLE: TableMeta = {
  name: 'stg01-video-management-visits',
  partitionKey: 'id',
  itemCount: 10000,
  indexes: [
    { name: 'conferenceId', type: 'GSI', partitionKey: 'conferenceId', projection: 'ALL' },
    { name: 'tenantKeyAndEncounterId', type: 'GSI', partitionKey: 'tenantKey', sortKey: 'encounterId', projection: 'ALL' },
  ],
  attributes: ['conferenceId', 'tenantKey', 'ehrType', 'createdOn'],
}

const EVENT_TABLE: TableMeta = {
  name: 'stg01-video-management-event-log',
  partitionKey: 'PK',
  sortKey: 'SK',
  itemCount: 686000,
  indexes: [],
}

const TABLES = [VISIT_TABLE, EVENT_TABLE]
const TABLE_NAMES = TABLES.map(t => t.name)

// ── SELECT linting ────────────────────────────────────────────────────────────

describe('lintPartiQL — SELECT', () => {
  it('no WHERE → full scan error', () => {
    const diags = lintPartiQL('SELECT * FROM "stg01-video-management-visits"', TABLES, TABLE_NAMES)
    expect(diags.some(d => d.level === 'error' && /scan/.test(d.message.toLowerCase()))).toBe(true)
  })

  it('WHERE with PK = value → no scan error', () => {
    const diags = lintPartiQL(
      `SELECT * FROM "stg01-video-management-visits" WHERE id = '123'`,
      TABLES, TABLE_NAMES
    )
    expect(diags.some(d => d.level === 'error' && /scan/.test(d.message.toLowerCase()))).toBe(false)
  })

  it('WHERE with PK IN → no scan error', () => {
    const diags = lintPartiQL(
      `SELECT * FROM "stg01-video-management-visits" WHERE id IN ['a', 'b']`,
      TABLES, TABLE_NAMES
    )
    expect(diags.some(d => d.level === 'error' && /scan/.test(d.message.toLowerCase()))).toBe(false)
  })

  it('WHERE with PK > value → error (range on PK not allowed)', () => {
    const diags = lintPartiQL(
      `SELECT * FROM "stg01-video-management-visits" WHERE id > '100'`,
      TABLES, TABLE_NAMES
    )
    expect(diags.some(d => d.level === 'error' && /partition key/.test(d.message.toLowerCase()))).toBe(true)
  })

  it('WHERE with non-PK field only → scan warning', () => {
    const diags = lintPartiQL(
      `SELECT * FROM "stg01-video-management-visits" WHERE ehrType = 'standard'`,
      TABLES, TABLE_NAMES
    )
    expect(diags.some(d => d.level === 'warning' && /scan/.test(d.message.toLowerCase()))).toBe(true)
  })

  it('no LIMIT → warning', () => {
    const diags = lintPartiQL(
      `SELECT * FROM "stg01-video-management-visits" WHERE id = '123'`,
      TABLES, TABLE_NAMES
    )
    expect(diags.some(d => d.level === 'warning' && /limit/i.test(d.message))).toBe(true)
  })

  it('with LIMIT → no limit warning', () => {
    const diags = lintPartiQL(
      `SELECT * FROM "stg01-video-management-visits" WHERE id = '123' LIMIT 50`,
      TABLES, TABLE_NAMES
    )
    expect(diags.some(d => d.level === 'warning' && /limit/i.test(d.message))).toBe(false)
  })

  it('unknown table → info diagnostic', () => {
    const diags = lintPartiQL(
      `SELECT * FROM "nonexistent-table" WHERE id = '123'`,
      TABLES, TABLE_NAMES
    )
    expect(diags.some(d => d.level === 'info' && /not found/.test(d.message.toLowerCase()))).toBe(true)
  })

  it('GSI index in FROM → resolves GSI PK', () => {
    const diags = lintPartiQL(
      `SELECT * FROM "stg01-video-management-visits"."conferenceId" WHERE conferenceId = 'TEST~xxx' LIMIT 50`,
      TABLES, TABLE_NAMES
    )
    // Should NOT produce a scan error since conferenceId = value hits the GSI PK
    expect(diags.some(d => d.level === 'error' && /scan/.test(d.message.toLowerCase()))).toBe(false)
  })

  it('JOIN → error', () => {
    const diags = lintPartiQL('SELECT * FROM "t1" JOIN "t2" ON t1.id = t2.id', TABLES, TABLE_NAMES)
    expect(diags.some(d => d.level === 'error' && /JOIN/.test(d.message))).toBe(true)
  })

  it('GROUP BY → error', () => {
    const diags = lintPartiQL(
      `SELECT tenantKey FROM "stg01-video-management-visits" GROUP BY tenantKey`,
      TABLES, TABLE_NAMES
    )
    expect(diags.some(d => d.level === 'error' && /GROUP BY/.test(d.message))).toBe(true)
  })

  it('empty statement → no diagnostics', () => {
    expect(lintPartiQL('', TABLES, TABLE_NAMES)).toHaveLength(0)
    expect(lintPartiQL('   ', TABLES, TABLE_NAMES)).toHaveLength(0)
  })
})

// ── INSERT linting ────────────────────────────────────────────────────────────

describe('lintPartiQL — INSERT', () => {
  it('valid INSERT VALUE → no errors', () => {
    const diags = lintPartiQL(
      `INSERT INTO "stg01-video-management-visits" VALUE { 'id': '123', 'tenantKey': 'TEST' }`,
      TABLES, TABLE_NAMES
    )
    expect(diags.filter(d => d.level === 'error')).toHaveLength(0)
  })

  it('INSERT without VALUE → error', () => {
    const diags = lintPartiQL(
      `INSERT INTO "stg01-video-management-visits" SET id = '123'`,
      TABLES, TABLE_NAMES
    )
    expect(diags.some(d => d.level === 'error' && /VALUE/.test(d.message))).toBe(true)
  })
})

// ── UPDATE linting ────────────────────────────────────────────────────────────

describe('lintPartiQL — UPDATE', () => {
  it('UPDATE with WHERE pk = → no error', () => {
    const diags = lintPartiQL(
      `UPDATE "stg01-video-management-visits" SET ehrType = 'epic' WHERE id = '123'`,
      TABLES, TABLE_NAMES
    )
    expect(diags.filter(d => d.level === 'error')).toHaveLength(0)
  })

  it('UPDATE without WHERE → error', () => {
    const diags = lintPartiQL(
      `UPDATE "stg01-video-management-visits" SET ehrType = 'epic'`,
      TABLES, TABLE_NAMES
    )
    expect(diags.some(d => d.level === 'error' && /WHERE/.test(d.message))).toBe(true)
  })

  it('UPDATE without SET or REMOVE → error', () => {
    const diags = lintPartiQL(
      `UPDATE "stg01-video-management-visits" WHERE id = '123'`,
      TABLES, TABLE_NAMES
    )
    expect(diags.some(d => d.level === 'error' && /SET|REMOVE/.test(d.message))).toBe(true)
  })
})

// ── DELETE linting ────────────────────────────────────────────────────────────

describe('lintPartiQL — DELETE', () => {
  it('DELETE with WHERE pk = → no error', () => {
    const diags = lintPartiQL(
      `DELETE FROM "stg01-video-management-visits" WHERE id = '123'`,
      TABLES, TABLE_NAMES
    )
    expect(diags.filter(d => d.level === 'error')).toHaveLength(0)
  })

  it('DELETE without WHERE → error', () => {
    const diags = lintPartiQL(
      `DELETE FROM "stg01-video-management-visits"`,
      TABLES, TABLE_NAMES
    )
    expect(diags.some(d => d.level === 'error' && /WHERE/.test(d.message))).toBe(true)
  })
})

// ── Autocomplete suggestions ──────────────────────────────────────────────────

describe('getSuggestions', () => {
  it('after FROM " → returns table names', () => {
    const sql = 'SELECT * FROM "'
    const suggestions = getSuggestions(sql, sql.length, TABLES, TABLE_NAMES)
    expect(suggestions.some(s => s.label === 'stg01-video-management-visits')).toBe(true)
    expect(suggestions.every(s => s.kind === 'table')).toBe(true)
  })

  it('after WHERE → returns field names of table in FROM', () => {
    const sql = 'SELECT * FROM "stg01-video-management-visits" WHERE '
    const suggestions = getSuggestions(sql, sql.length, TABLES, TABLE_NAMES)
    expect(suggestions.some(s => s.label === 'id')).toBe(true)
    expect(suggestions.some(s => s.label === 'conferenceId')).toBe(true)
  })

  it('after WHERE with partial field → filtered suggestions', () => {
    const sql = 'SELECT * FROM "stg01-video-management-visits" WHERE conf'
    const suggestions = getSuggestions(sql, sql.length, TABLES, TABLE_NAMES)
    expect(suggestions.every(s => s.label.toLowerCase().startsWith('conf'))).toBe(true)
  })

  it('empty statement → keyword suggestions', () => {
    const suggestions = getSuggestions('', 0, TABLES, TABLE_NAMES)
    expect(suggestions.some(s => s.label === 'SELECT')).toBe(true)
    expect(suggestions.some(s => s.label === 'INSERT')).toBe(true)
  })
})
