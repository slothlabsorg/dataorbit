// ── Screens ──────────────────────────────────────────────────────────────────
export type Screen = 'home' | 'browse' | 'explore' | 'stream' | 'history' | 'settings' | 'docs' | 'support'

// ── Database types ────────────────────────────────────────────────────────────
export type DbType = 'dynamodb' | 'influxdb' | 'timescaledb' | 'cassandra' | 'scylladb'
export type ConnStatus = 'connected' | 'disconnected' | 'connecting' | 'error'

// ── Connection ────────────────────────────────────────────────────────────────
export interface DbConnection {
  id: string
  name: string
  dbType: DbType
  status: ConnStatus
  // DynamoDB
  awsRegion?: string
  awsProfile?: string       // links to a CloudOrbit session
  endpoint?: string         // custom endpoint (e.g. http://localhost:8000 for DynamoDB Local)
  // Generic
  host?: string
  port?: number
  database?: string
  username?: string
  // Meta
  lastConnected?: string    // ISO
  isFavorite?: boolean
  color?: string            // user-assigned accent color
  tables?: TableMeta[]
}

// ── Table / Collection ────────────────────────────────────────────────────────
export interface TableMeta {
  name: string
  itemCount?: number
  sizeBytes?: number
  partitionKey?: string
  sortKey?: string
  indexes?: IndexMeta[]
  billingMode?: 'PAY_PER_REQUEST' | 'PROVISIONED'
  streamEnabled?: boolean
  /** Known attribute names for this table (used for field autocomplete in query builder) */
  attributes?: string[]
}

export interface IndexMeta {
  name: string
  type: 'GSI' | 'LSI'
  partitionKey: string
  sortKey?: string
  projection: 'ALL' | 'KEYS_ONLY' | 'INCLUDE'
}

// ── Data rows ─────────────────────────────────────────────────────────────────
export type DynamoValue =
  | { S: string }
  | { N: string }
  | { BOOL: boolean }
  | { NULL: boolean }
  | { B: string }
  | { L: DynamoValue[] }
  | { M: Record<string, DynamoValue> }
  | { SS: string[] }
  | { NS: string[] }

export type DataRow = Record<string, DynamoValue | string | number | boolean | null>

// ── Query / Filter ────────────────────────────────────────────────────────────
export type FilterOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'begins_with' | 'contains' | 'exists' | 'not_exists' | 'between' | 'in'

export interface FilterChip {
  id: string
  field: string
  op: FilterOp
  value: string
  valueEnd?: string         // for between
}

export interface QueryDef {
  connectionId: string
  table: string
  indexName?: string           // GSI / LSI name; omit for table query
  partitionKeyField?: string   // pk of chosen index (or table)
  sortKeyField?: string        // sk of chosen index (or table)
  filters: FilterChip[]
  limit: number
  scanIndexForward?: boolean
  exclusiveStartKey?: Record<string, unknown>
}

export interface QueryResult {
  rows: DataRow[]
  count: number
  scannedCount: number
  rcuConsumed?: number
  lastEvaluatedKey?: Record<string, unknown>
  indexUsed?: string
  warnings?: string[]
  executionMs?: number
}

// ── Stream ────────────────────────────────────────────────────────────────────
export type StreamEventType = 'INSERT' | 'MODIFY' | 'REMOVE'

export interface StreamEvent {
  id: string
  time: Date
  type: StreamEventType
  table: string
  newItem?: DataRow
  oldItem?: DataRow
  diff?: Record<string, { old: unknown; new: unknown }>
}

// ── Cross-table join ──────────────────────────────────────────────────────────
export type JoinType = 'inner' | 'left' | 'left_anti' | 'right' | 'right_anti'

export interface JoinKeyMap {
  leftField: string
  rightField: string
}

export interface JoinDef {
  connectionId: string
  leftTable: string
  rightTable: string
  joinKeys: JoinKeyMap[]
  joinType: JoinType
  leftFilters: FilterChip[]
  rightFilters: FilterChip[]
  limit: number
}

export interface JoinResultRow {
  _joinSide: 'both' | 'left_only' | 'right_only'
  left: DataRow | null
  right: DataRow | null
}

export interface JoinResult {
  rows: JoinResultRow[]
  leftScanned: number
  rightScanned: number
  matched: number
  leftOnly: number
  rightOnly: number
  executionMs: number
  warnings?: string[]
}

// ── Time Trace ────────────────────────────────────────────────────────────────

export type TraceOp = '=' | 'begins_with' | 'contains'

export interface TraceCondition {
  id: string
  field: string
  op: TraceOp
  value: string
}

/**
 * A single record found during a trace — one row from one table with its
 * resolved timestamp so it can be placed on the timeline.
 */
export interface TraceMatch {
  table:          string
  row:            DataRow
  timestamp:      number        // unix ms, inferred from the row
  timestampField: string        // which field was used as timestamp source
}

export interface TraceResult {
  entityField:    string
  entityOp:       TraceOp
  entityValue:    string
  extraConditions: TraceCondition[]
  matches:        TraceMatch[]   // sorted ascending by timestamp
  missingTables:  string[]       // tables searched where entity was NOT found
  tablesSearched: string[]       // all tables that were searched
  totalScanned:   number
  executionMs:    number
}

// ── Query History ─────────────────────────────────────────────────────────────
export interface HistoryEntry {
  id: string
  time: Date
  connectionId: string
  connectionName: string
  table: string
  filters: FilterChip[]
  result: { count: number; scannedCount: number; rcuConsumed?: number; executionMs: number }
  isSaved?: boolean
  savedName?: string
}
