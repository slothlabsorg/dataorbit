/**
 * PartiQL linter for DynamoDB.
 *
 * DynamoDB supports a strict subset of PartiQL:
 *   SELECT * FROM "table"[."index"] [WHERE condition] [ORDER BY key [DESC|ASC]] [LIMIT n]
 *   INSERT INTO "table" VALUE { ... }
 *   UPDATE "table" SET attr = val [REMOVE attr] WHERE pk = val
 *   DELETE FROM "table" WHERE pk = val
 *
 * Rules enforced:
 *  - SELECT without WHERE → full scan (error)
 *  - SELECT WHERE condition uses non-PK with > < >= <= → full scan (warning)
 *  - SELECT WHERE pk uses > < >= <=  → full scan (error — DynamoDB PK only supports = and IN)
 *  - SELECT without LIMIT → potentially large result (warning)
 *  - JOIN keyword → not supported (error)
 *  - GROUP BY → not supported in DynamoDB PartiQL (error)
 *  - UNION / INTERSECT / EXCEPT → not supported (error)
 *  - Unknown table name → info
 *  - UPDATE/DELETE/INSERT without WHERE pk condition → warning
 */

import type { TableMeta } from '@/types'

export type DiagLevel = 'error' | 'warning' | 'info'

export interface Diagnostic {
  level:      DiagLevel
  message:    string
  hint?:      string
  /** 0-based character offset in the statement string */
  start?:     number
  end?:       number
}

// ── Tokenizer helpers ─────────────────────────────────────────────────────────

function upperWords(sql: string): string[] {
  return sql.trim().toUpperCase().split(/\s+/)
}

function firstKeyword(sql: string): string {
  return upperWords(sql)[0] ?? ''
}

/** Extract the table name from FROM "tableName" or FROM tableName */
function extractFromTable(sql: string): { table: string; index?: string } | null {
  // FROM "table"."index" or FROM "table" or FROM table
  const m = sql.match(/FROM\s+"([^"]+)"(?:\."([^"]+)")?/i)
    ?? sql.match(/FROM\s+(\S+)/i)
  if (!m) return null
  return { table: m[1], index: m[2] }
}

/** Extract WHERE clause text */
function extractWhere(sql: string): string | null {
  const m = sql.match(/WHERE\s+(.+?)(?:ORDER\s+BY|LIMIT|$)/is)
  return m ? m[1].trim() : null
}

/** Check if WHERE condition pins the partition key with = or IN */
function whereUsesPkEquality(where: string, pkField: string): boolean {
  // Match: pkField = 'val' OR pkField IN [...]
  const re = new RegExp(`\\b${escapeRegex(pkField)}\\s*=|\\b${escapeRegex(pkField)}\\s+IN\\s*\\[`, 'i')
  return re.test(where)
}

/** Check if WHERE uses a non-equality operator on the PK (which causes a scan) */
function whereUsesPkRange(where: string, pkField: string): boolean {
  const re = new RegExp(`\\b${escapeRegex(pkField)}\\s*[<>]`, 'i')
  return re.test(where)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasKeyword(sql: string, kw: string): boolean {
  return new RegExp(`\\b${kw}\\b`, 'i').test(sql)
}

function hasLimit(sql: string): boolean {
  return hasKeyword(sql, 'LIMIT')
}

// ── Main linter ───────────────────────────────────────────────────────────────

export function lintPartiQL(
  sql:    string,
  tables: TableMeta[],
  knownTableNames?: string[],
): Diagnostic[] {
  const diags: Diagnostic[] = []
  const stmt  = sql.trim()
  if (!stmt) return diags

  const kw = firstKeyword(stmt)

  // ── Unsupported constructs ────────────────────────────────────────────────
  if (hasKeyword(stmt, 'JOIN')) {
    diags.push({
      level:   'error',
      message: 'JOIN is not supported in DynamoDB PartiQL.',
      hint:    'Use DataOrbit\'s Cross-join tab for cross-table joins (executed client-side).',
    })
  }
  if (hasKeyword(stmt, 'GROUP BY')) {
    diags.push({
      level:   'error',
      message: 'GROUP BY is not supported in DynamoDB PartiQL.',
      hint:    'Use DataOrbit\'s export + external tools for aggregations.',
    })
  }
  for (const kwd of ['UNION', 'INTERSECT', 'EXCEPT']) {
    if (hasKeyword(stmt, kwd)) {
      diags.push({ level: 'error', message: `${kwd} is not supported in DynamoDB PartiQL.` })
    }
  }

  // ── Multi-statement detection ─────────────────────────────────────────────
  if (stmt.includes(';')) {
    diags.push({
      level:   'warning',
      message: 'Semicolons detected. DataOrbit executes one statement at a time.',
      hint:    'Split into separate executions.',
    })
  }

  // ── Per-statement linting ─────────────────────────────────────────────────
  if (kw === 'SELECT') {
    lintSelect(stmt, tables, knownTableNames ?? [], diags)
  } else if (kw === 'INSERT') {
    lintInsert(stmt, diags)
  } else if (kw === 'UPDATE') {
    lintUpdate(stmt, tables, diags)
  } else if (kw === 'DELETE') {
    lintDelete(stmt, tables, diags)
  } else if (kw) {
    diags.push({
      level:   'error',
      message: `Unknown statement type: ${kw}. DynamoDB supports SELECT, INSERT, UPDATE, DELETE.`,
    })
  }

  return diags
}

// ── SELECT ────────────────────────────────────────────────────────────────────

function lintSelect(
  sql:       string,
  tables:    TableMeta[],
  tableNames: string[],
  diags:     Diagnostic[],
): void {
  const fromInfo = extractFromTable(sql)

  // Unknown table
  if (fromInfo && tableNames.length > 0 && !tableNames.includes(fromInfo.table)) {
    diags.push({
      level:   'info',
      message: `Table "${fromInfo.table}" not found in the current connection.`,
      hint:    'Check the table name. Names are case-sensitive.',
    })
  }

  // Resolve table metadata
  const tableMeta = fromInfo
    ? tables.find(t => t.name === fromInfo.table)
    : undefined

  const pkField = fromInfo?.index
    ? tableMeta?.indexes?.find(i => i.name === fromInfo.index)?.partitionKey
    : tableMeta?.partitionKey

  const whereClause = extractWhere(sql)

  if (!whereClause) {
    // No WHERE at all → full scan
    diags.push({
      level:   'error',
      message: 'No WHERE clause — this will perform a full table scan.',
      hint:    pkField
        ? `Add: WHERE ${pkField} = 'your-value'`
        : 'Add a WHERE clause with the partition key using = or IN.',
    })
  } else if (pkField) {
    if (whereUsesPkRange(whereClause, pkField)) {
      diags.push({
        level:   'error',
        message: `Partition key "${pkField}" can only use = or IN, not range operators.`,
        hint:    `DynamoDB requires equality on the partition key. Use: WHERE ${pkField} = 'value'`,
      })
    } else if (!whereUsesPkEquality(whereClause, pkField)) {
      // WHERE exists but doesn't pin the PK → scan
      diags.push({
        level:   'warning',
        message: `WHERE clause does not filter by partition key "${pkField}" — this may result in a full table scan.`,
        hint:    `Add: ${pkField} = 'value' to the WHERE clause to use a Query instead of Scan.`,
      })
    }
  }

  if (!hasLimit(sql)) {
    diags.push({
      level:   'warning',
      message: 'No LIMIT specified — the result set could be very large.',
      hint:    'Add LIMIT 50 (or your desired page size) at the end of the query.',
    })
  }

  // ORDER BY on non-key → client-side sort (info)
  if (hasKeyword(sql, 'ORDER BY')) {
    const orderMatch = sql.match(/ORDER\s+BY\s+(\w+)/i)
    if (orderMatch) {
      const orderField = orderMatch[1]
      const skField = tableMeta?.sortKey
      if (skField && orderField.toLowerCase() !== skField.toLowerCase()) {
        diags.push({
          level:   'info',
          message: `ORDER BY "${orderField}" is a non-sort-key field — DynamoDB will sort in memory, which requires reading all matching items first.`,
        })
      }
    }
  }
}

// ── INSERT ────────────────────────────────────────────────────────────────────

function lintInsert(sql: string, diags: Diagnostic[]): void {
  if (!hasKeyword(sql, 'VALUE') && !hasKeyword(sql, 'VALUES')) {
    diags.push({
      level:   'error',
      message: 'INSERT statement must use VALUE { ... } syntax.',
      hint:    'Example: INSERT INTO "MyTable" VALUE { \'id\': \'123\', \'name\': \'test\' }',
    })
  }
}

// ── UPDATE ────────────────────────────────────────────────────────────────────

function lintUpdate(sql: string, tables: TableMeta[], diags: Diagnostic[]): void {
  if (!hasKeyword(sql, 'WHERE')) {
    diags.push({
      level:   'error',
      message: 'UPDATE requires a WHERE clause with the partition key.',
      hint:    'DynamoDB UPDATE must identify a single item: WHERE pk = \'value\'',
    })
    return
  }
  if (!hasKeyword(sql, 'SET') && !hasKeyword(sql, 'REMOVE')) {
    diags.push({
      level:   'error',
      message: 'UPDATE must specify SET or REMOVE to change attributes.',
    })
  }
  const fromInfo = extractFromTable(sql.replace(/^UPDATE/i, 'SELECT * FROM'))
  if (fromInfo) {
    const tableMeta = tables.find(t => t.name === fromInfo.table)
    const pkField = tableMeta?.partitionKey
    if (pkField) {
      const whereClause = extractWhere(sql)
      if (whereClause && !whereUsesPkEquality(whereClause, pkField)) {
        diags.push({
          level:   'warning',
          message: `WHERE clause should pin the partition key "${pkField}" with = for a targeted update.`,
        })
      }
    }
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

function lintDelete(sql: string, tables: TableMeta[], diags: Diagnostic[]): void {
  if (!hasKeyword(sql, 'WHERE')) {
    diags.push({
      level:   'error',
      message: 'DELETE requires a WHERE clause with the partition key.',
      hint:    'DynamoDB DELETE must identify a single item: WHERE pk = \'value\'',
    })
    return
  }
  // Resolve PK
  const fromInfo = extractFromTable(sql.replace(/^DELETE/i, 'SELECT * FROM'))
  if (fromInfo) {
    const tableMeta = tables.find(t => t.name === fromInfo.table)
    const pkField = tableMeta?.partitionKey
    if (pkField) {
      const whereClause = extractWhere(sql)
      if (whereClause && !whereUsesPkEquality(whereClause, pkField)) {
        diags.push({
          level:   'warning',
          message: `WHERE clause should pin the partition key "${pkField}" with = for a targeted delete.`,
        })
      }
    }
  }
}

// ── Autocomplete suggestions ──────────────────────────────────────────────────

export interface Suggestion {
  label:      string
  detail?:    string
  insertText: string
  kind:       'keyword' | 'table' | 'field' | 'function' | 'snippet'
}

const KEYWORDS: Suggestion[] = [
  { label: 'SELECT',   insertText: 'SELECT * FROM ""',           kind: 'keyword', detail: 'Read items from a table or index' },
  { label: 'INSERT',   insertText: "INSERT INTO \"\" VALUE {}",  kind: 'keyword', detail: 'Add a new item' },
  { label: 'UPDATE',   insertText: "UPDATE \"\" SET  WHERE ",    kind: 'keyword', detail: 'Modify attributes of an existing item' },
  { label: 'DELETE',   insertText: "DELETE FROM \"\" WHERE ",    kind: 'keyword', detail: 'Remove an item' },
  { label: 'WHERE',    insertText: 'WHERE ',                     kind: 'keyword' },
  { label: 'LIMIT',    insertText: 'LIMIT 50',                   kind: 'keyword', detail: 'Limit the number of results' },
  { label: 'ORDER BY', insertText: 'ORDER BY  DESC',             kind: 'keyword' },
  { label: 'AND',      insertText: 'AND ',                       kind: 'keyword' },
  { label: 'OR',       insertText: 'OR ',                        kind: 'keyword' },
  { label: 'IN',       insertText: "IN ['', '']",                kind: 'keyword', detail: 'Match one of multiple values' },
  { label: 'BETWEEN',  insertText: "BETWEEN '' AND ''",          kind: 'keyword' },
  { label: 'IS MISSING',    insertText: 'IS MISSING',            kind: 'keyword', detail: 'Attribute does not exist' },
  { label: 'IS NOT MISSING',insertText: 'IS NOT MISSING',        kind: 'keyword', detail: 'Attribute exists' },
  // Functions
  { label: 'begins_with', insertText: "begins_with(, '')", kind: 'function', detail: 'String prefix match' },
  { label: 'contains',    insertText: "contains(, '')",    kind: 'function', detail: 'String contains substring' },
  { label: 'attribute_exists',     insertText: 'attribute_exists()',    kind: 'function' },
  { label: 'attribute_not_exists', insertText: 'attribute_not_exists()', kind: 'function' },
  { label: 'size',        insertText: 'size()',             kind: 'function', detail: 'Length of a string or set' },
]

/**
 * Get autocomplete suggestions for the current cursor position.
 * @param sql Full statement text
 * @param cursorPos Character offset of the cursor
 * @param tables Known tables for the connection
 * @param tableNames All table names in the connection
 */
export function getSuggestions(
  sql:         string,
  cursorPos:   number,
  tables:      TableMeta[],
  tableNames:  string[],
): Suggestion[] {
  const before = sql.slice(0, cursorPos)
  const lastWordMatch = before.match(/\S+$/)
  const lastWord = lastWordMatch ? lastWordMatch[0] : ''
  const lastWordUpper = lastWord.toUpperCase()

  // After FROM " → suggest table names
  if (/FROM\s+"[^"]*$/i.test(before)) {
    return tableNames.map(name => ({
      label:      name,
      insertText: name,
      kind:       'table' as const,
      detail:     tables.find(t => t.name === name)
        ? `pk: ${tables.find(t => t.name === name)!.partitionKey}`
        : undefined,
    }))
  }

  // After WHERE or AND/OR → suggest field names of the current table
  const fromInfo = extractFromTable(sql)
  if (fromInfo && /(?:WHERE|AND|OR|SET|REMOVE)\s+\w*$/i.test(before)) {
    const tableMeta = tables.find(t => t.name === fromInfo.table)
    if (tableMeta) {
      const fields: string[] = [
        ...(tableMeta.partitionKey ? [tableMeta.partitionKey] : []),
        ...(tableMeta.sortKey ? [tableMeta.sortKey] : []),
        ...(tableMeta.attributes ?? []),
        ...(tableMeta.indexes?.flatMap(i => [i.partitionKey, i.sortKey].filter(Boolean)) ?? []) as string[],
      ]
      const unique = [...new Set(fields)]
      return unique
        .filter(f => f.toLowerCase().startsWith(lastWord.toLowerCase()) || lastWord === '')
        .map(f => ({
          label:      f,
          insertText: f,
          kind:       'field' as const,
          detail:     tableMeta.partitionKey === f ? 'partition key'
            : tableMeta.sortKey === f ? 'sort key'
            : undefined,
        }))
    }
  }

  // Default: keyword/function suggestions filtered by prefix
  return KEYWORDS.filter(k =>
    k.label.startsWith(lastWordUpper) || lastWordUpper === ''
  )
}
