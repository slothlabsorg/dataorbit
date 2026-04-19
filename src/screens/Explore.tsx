import { useState, useMemo, useEffect } from 'react'
import type { DbConnection, FilterChip, FilterOp, QueryResult, QueryDef, JoinType, JoinResult, JoinResultRow, TraceCondition, TraceMatch, TraceResult, TraceOp } from '@/types'
import { EmptyState } from '@/components/ui/EmptyState'
import { RcuBadge } from '@/components/ui/Badge'
import { JsonTree } from '@/components/ui/JsonTree'
import { Callout } from '@/components/ui/Callout'
import Button from '@/components/ui/Button'
import { mockRows, mockRegistryRows, mockAlertRows, mockLocationRows } from '@/mock/data'
import { api } from '@/lib/tauri'

const MOCK_MODE = (() => {
  try { return new URL(window.location.href).searchParams.get('mock') === '1' } catch { return false }
})()

interface ExploreProps {
  activeConnection: DbConnection | null
  activeTable: string | null
}

const OPS: FilterOp[] = ['=', '!=', '<', '<=', '>', '>=', 'begins_with', 'contains', 'exists', 'not_exists', 'between', 'in']

const OP_LABELS: Record<FilterOp, string> = {
  '=': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥',
  'begins_with': 'begins_with', 'contains': 'contains',
  'exists': 'exists', 'not_exists': 'not_exists',
  'between': 'between', 'in': 'in',
}

let chipId = 0

type OpMode = 'Query' | 'Scan' | 'IndexQuery' | 'IndexScan'

// ── Client-side filtering ─────────────────────────────────────────────────────

function applyFilter(rows: typeof mockRows, chips: FilterChip[]): typeof mockRows {
  if (chips.length === 0) return rows
  return rows.filter(row =>
    chips.every(chip => {
      const raw = row[chip.field]
      const str = raw == null ? '' : String(raw)
      const num = Number(raw)
      switch (chip.op) {
        case '=':          return str === chip.value
        case '!=':         return str !== chip.value
        case '<':          return num < Number(chip.value)
        case '<=':         return num <= Number(chip.value)
        case '>':          return num > Number(chip.value)
        case '>=':         return num >= Number(chip.value)
        case 'begins_with': return str.startsWith(chip.value)
        case 'contains':   return str.includes(chip.value)
        case 'exists':     return raw != null
        case 'not_exists': return raw == null
        case 'between':    return num >= Number(chip.value) && num <= Number(chip.valueEnd ?? chip.value)
        case 'in':         return chip.value.split(',').map(s => s.trim()).includes(str)
        default:           return true
      }
    })
  )
}

function detectOpMode(chips: FilterChip[], pkField: string, isIndex = false): OpMode {
  const hasPkEq = chips.some(c => c.field === pkField && c.op === '=')
  if (isIndex) return hasPkEq ? 'IndexQuery' : 'IndexScan'
  return hasPkEq ? 'Query' : 'Scan'
}

function estimateRcu(mode: OpMode, itemCount: number): { label: string; high: boolean } {
  switch (mode) {
    case 'Query':      return { label: '~0.5 RCU',                                              high: false }
    case 'IndexQuery': return { label: '~2 RCU',                                                high: false }
    case 'Scan':       return { label: `~${((itemCount * 0.5) / 4).toLocaleString()} RCU`,      high: true  }
    case 'IndexScan':  return { label: `~${((itemCount * 0.3) / 4).toLocaleString()} RCU`,      high: true  }
  }
}

function getMockTableRows(tableName: string): typeof mockRows {
  if (tableName === 'DeviceRegistry')  return mockRegistryRows
  if (tableName === 'SensorAlerts')    return mockAlertRows
  if (tableName === 'DeviceLocations') return mockLocationRows
  return mockRows
}

// ── Index suggestion ──────────────────────────────────────────────────────────

interface IndexSuggestion {
  field:           string
  tableItemCount:  number
  expectedMatches: number
  rcuBefore:       number
  rcuAfter:        number
  savings:         number
}

/**
 * Returns an index recommendation when a Scan is inefficient and a specific
 * field is filtered with `=`.  Only fires when:
 *   - opMode is Scan or IndexScan
 *   - table has ≥ 5 000 items
 *   - selectivity < 15%  (few items match relative to items scanned)
 *   - expected savings ≥ 50%
 */
function computeSuggestion(
  chips:          FilterChip[],
  opMode:         OpMode,
  pkField:        string,
  result:         QueryResult,
  tableItemCount: number,
): IndexSuggestion | null {
  if (opMode !== 'Scan' && opMode !== 'IndexScan') return null
  if (tableItemCount < 5_000)                      return null
  if (result.scannedCount === 0)                   return null

  // Find the first = filter on a non-PK field
  const eqChip = chips.find(c => c.op === '=' && c.field !== pkField)
  if (!eqChip) return null

  const selectivity = result.count / result.scannedCount
  if (selectivity > 0.15) return null

  // Extrapolate to full table
  const expectedMatches = Math.max(1, Math.round(selectivity * tableItemCount))
  const rcuBefore = Math.max(1, Math.ceil(tableItemCount  * 0.5 / 4))
  const rcuAfter  = Math.max(1, Math.ceil(expectedMatches * 0.5 / 4))
  const savings   = Math.round((1 - rcuAfter / rcuBefore) * 100)

  if (savings < 50) return null

  return { field: eqChip.field, tableItemCount, expectedMatches, rcuBefore, rcuAfter, savings }
}

function IndexRecommendation({ s, tableName }: { s: IndexSuggestion; tableName: string }) {
  const [showFix, setShowFix] = useState(false)
  const indexName = `${s.field}-index`
  const pct = ((s.expectedMatches / s.tableItemCount) * 100).toFixed(2)
  const cliCmd = [
    `aws dynamodb update-table \\`,
    `  --table-name ${tableName} \\`,
    `  --billing-mode PAY_PER_REQUEST \\`,
    `  --attribute-definitions AttributeName=${s.field},AttributeType=S \\`,
    `  --global-secondary-index-updates '[{`,
    `    "Create": {`,
    `      "IndexName": "${indexName}",`,
    `      "KeySchema": [{"AttributeName":"${s.field}","KeyType":"HASH"}],`,
    `      "Projection": {"ProjectionType":"ALL"}`,
    `    }`,
    `  }]'`,
  ].join('\n')

  return (
    <div className="mx-4 mt-2 mb-1 rounded-xl border border-primary/30 bg-primary/5 p-3 flex-shrink-0">
      <div className="flex items-start gap-2">
        <span className="text-primary flex-shrink-0 mt-0.5 text-sm">💡</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-semibold text-primary">Index opportunity</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/15 text-success border border-success/20 font-semibold">
              ~{s.savings}% cheaper
            </span>
          </div>
          <p className="text-xs text-text-secondary mb-2">
            Scanned{' '}
            <strong className="text-text-primary">{s.tableItemCount.toLocaleString()}</strong> items to return{' '}
            <strong className="text-text-primary">{s.expectedMatches.toLocaleString()}</strong>{' '}
            ({pct}% selectivity).{' '}
            A GSI on{' '}
            <code className="font-mono text-primary">{s.field}</code>{' '}
            would convert this scan to a cheap indexed lookup.
          </p>
          <div className="flex items-center gap-4 text-[11px] mb-2 flex-wrap">
            <span className="text-text-muted">
              Without GSI:{' '}
              <span className="text-danger font-mono font-semibold">{s.rcuBefore.toLocaleString()} RCU</span>
            </span>
            <span className="text-text-muted">→</span>
            <span className="text-text-muted">
              With GSI on <code className="font-mono text-primary">{s.field}</code>:{' '}
              <span className="text-success font-mono font-semibold">{s.rcuAfter.toLocaleString()} RCU</span>
            </span>
          </div>
          <button
            onClick={() => setShowFix(f => !f)}
            className="text-[11px] text-primary/70 hover:text-primary transition-colors"
          >
            {showFix ? '▾ Hide fix' : '▸ How to add this index'}
          </button>
          {showFix && (
            <div className="mt-2 bg-bg-elevated rounded-lg border border-border-subtle p-2">
              <p className="text-[10px] text-text-muted mb-1.5">
                AWS CLI — adds a GSI to the existing table (works on real AWS; for DynamoDB Local recreate the table with the schema below):
              </p>
              <pre className="text-[10px] font-mono text-text-secondary overflow-x-auto whitespace-pre leading-relaxed">{cliCmd}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function FilterChipBadge({ chip, onRemove }: { chip: FilterChip; onRemove: () => void }) {
  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-primary/30 bg-primary/8 text-xs">
      <span className="text-text-secondary font-mono">{chip.field}</span>
      <span className="text-text-muted">{OP_LABELS[chip.op]}</span>
      {chip.op !== 'exists' && chip.op !== 'not_exists' && (
        <span className="text-text-primary font-mono">{chip.value}</span>
      )}
      {chip.op === 'between' && chip.valueEnd && (
        <><span className="text-text-muted">→</span><span className="text-text-primary font-mono">{chip.valueEnd}</span></>
      )}
      <button onClick={onRemove} className="ml-0.5 text-text-muted hover:text-danger transition-colors">✕</button>
    </div>
  )
}

function FilterBuilder({ onAdd, attributes }: { onAdd: (chip: FilterChip) => void; attributes?: string[] }) {
  const [field, setField]   = useState('')
  const [op, setOp]         = useState<FilterOp>('=')
  const [value, setValue]   = useState('')
  const [value2, setValue2] = useState('')

  function handleAdd() {
    if (!field.trim()) return
    onAdd({ id: `chip-${++chipId}`, field: field.trim(), op, value, valueEnd: op === 'between' ? value2 : undefined })
    setField(''); setValue(''); setValue2('')
  }

  const noValue = op === 'exists' || op === 'not_exists'
  const listId  = attributes && attributes.length > 0 ? 'field-attr-list' : undefined

  return (
    <div className="flex items-end gap-2 flex-wrap">
      {listId && (
        <datalist id={listId}>
          {attributes!.map(a => <option key={a} value={a} />)}
        </datalist>
      )}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-text-muted">Field</label>
        <input list={listId} className="field-input w-32" placeholder="deviceId" value={field}
          onChange={e => setField(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-text-muted">Operator</label>
        <select className="field-input w-32" value={op} onChange={e => setOp(e.target.value as FilterOp)}>
          {OPS.map(o => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
        </select>
      </div>
      {!noValue && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-text-muted">Value</label>
          <input className="field-input w-36" placeholder="sensor-4421" value={value}
            onChange={e => setValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} />
        </div>
      )}
      {op === 'between' && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-text-muted">End value</label>
          <input className="field-input w-36" placeholder="end" value={value2}
            onChange={e => setValue2(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} />
        </div>
      )}
      <Button variant="secondary" size="sm" onClick={handleAdd} disabled={!field.trim()}>+ Add filter</Button>
    </div>
  )
}

// ── Single-table query tab ────────────────────────────────────────────────────

function QueryTab({ activeConnection, activeTable }: ExploreProps) {
  const [chips, setChips]       = useState<FilterChip[]>([])
  const [limit, setLimit]       = useState(50)
  const [ascending, setAscending] = useState(true)
  const [result, setResult]     = useState<QueryResult | null>(null)
  const [allFiltered, setAllFiltered] = useState<typeof mockRows>([])
  const [loading, setLoading]   = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table')
  const [page, setPage]         = useState(0)
  const [pendingConfirmScan, setPendingConfirmScan] = useState(false)
  const [suggestion, setSuggestion] = useState<IndexSuggestion | null>(null)
  const [queryError, setQueryError] = useState<string | null>(null)

  if (!activeConnection) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState variant="empty" title="No connection selected"
          description="Select a connection and table from the sidebar to start exploring." />
      </div>
    )
  }
  if (!activeTable) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState variant="search" title="Select a table"
          description="Choose a table from the sidebar to build a query." />
      </div>
    )
  }

  const table    = activeConnection.tables?.find(t => t.name === activeTable)
  const pkField  = table?.partitionKey ?? 'pk'
  const skField  = table?.sortKey
  const isPkFilter = chips.some(c => c.field === pkField && c.op === '=')
  const opMode   = detectOpMode(chips, pkField)
  const rcu      = estimateRcu(opMode, table?.itemCount ?? 1000)

  const isTimestampSk = skField === 'timestamp'

  function applyTimePreset(hours: number) {
    const end   = Date.now()
    const start = end - hours * 3_600_000
    setChips(cs => [
      ...cs.filter(c => c.field !== skField),
      { id: `chip-${++chipId}`, field: skField!, op: 'between', value: String(start), valueEnd: String(end) },
    ])
  }

  const largeScan = opMode === 'Scan' && (table?.itemCount ?? 0) > 100_000

  async function executeRun() {
    setLoading(true)
    setPendingConfirmScan(false)
    setPage(0)
    setSuggestion(null)
    setQueryError(null)

    if (!MOCK_MODE && activeConnection?.id) {
      // ── Real DynamoDB path ───────────────────────────────────────────────
      try {
        const def: QueryDef = {
          connectionId:      activeConnection.id,
          table:             activeTable!,
          partitionKeyField: pkField,
          sortKeyField:      skField,
          filters:           chips,
          limit,
          scanIndexForward:  ascending,
        }
        const raw = await api.queryTable(def)
        setResult(raw)
        setAllFiltered([])  // pagination not available in real mode yet
        setSuggestion(computeSuggestion(chips, opMode, pkField, raw, table?.itemCount ?? 0))
      } catch (e) {
        setQueryError(e instanceof Error ? e.message : String(e))
      }
      setLoading(false)
      return
    }

    // ── Mock path ────────────────────────────────────────────────────────
    await new Promise(r => setTimeout(r, 280))

    const tableRows = getMockTableRows(activeTable ?? '')
    const filtered  = applyFilter(tableRows, chips)
    const sorted    = ascending ? filtered : [...filtered].reverse()
    const paged     = sorted.slice(0, limit)

    setAllFiltered(sorted)
    const mockResult: QueryResult = {
      rows: paged,
      count: paged.length,
      scannedCount: tableRows.length,
      rcuConsumed: isPkFilter ? 0.5 * Math.max(1, paged.length) : Math.ceil(tableRows.length * 0.5 / 4),
      executionMs: 20 + Math.floor(Math.random() * 40),
      warnings: opMode === 'Scan'
        ? [`Full table scan — no ${pkField} = filter. ${tableRows.length.toLocaleString()} items scanned.`]
        : chips.some(c => c.op === 'contains')
        ? ['contains() is a FilterExpression — applied after reading the partition.']
        : undefined,
    }
    setResult(mockResult)
    setSuggestion(computeSuggestion(chips, opMode, pkField, mockResult, table?.itemCount ?? tableRows.length))
    setLoading(false)
  }

  async function handleRun() {
    setResult(null)
    setSuggestion(null)
    setQueryError(null)
    if (largeScan) {
      setPendingConfirmScan(true)
      return
    }
    await executeRun()
  }

  function handleLoadMore() {
    const nextPage = page + 1
    const nextRows = allFiltered.slice(0, limit * (nextPage + 1))
    setPage(nextPage)
    setResult(prev => prev ? { ...prev, rows: nextRows, count: nextRows.length } : prev)
  }

  const hasMore = result != null && allFiltered.length > result.rows.length

  // Pre-run cost hint (computed from current chips, no fetch needed)
  const preRunHint = useMemo(() => {
    const mode = detectOpMode(chips, pkField)
    const est  = estimateRcu(mode, table?.itemCount ?? 1000)
    return { mode, est }
  }, [chips, pkField, table?.itemCount])

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Builder panel */}
      <div className="px-4 py-3 border-b border-border-subtle bg-bg-elevated space-y-3 flex-shrink-0">

        {/* Table label */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-text-primary font-semibold text-sm">{activeTable}</span>
            {table?.partitionKey && (
              <span className="text-text-muted text-xs">pk: <code className="font-mono text-text-secondary">{table.partitionKey}</code></span>
            )}
            {table?.sortKey && (
              <span className="text-text-muted text-xs">sk: <code className="font-mono text-text-secondary">{table.sortKey}</code></span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-text-muted text-xs">Limit</label>
            <select className="field-input w-20 py-1" value={limit} onChange={e => setLimit(Number(e.target.value))}>
              {[25, 50, 100, 250, 500].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            {/* Sort direction */}
            <button
              onClick={() => setAscending(a => !a)}
              title="Toggle sort direction"
              className="px-2 py-1 rounded border border-border text-xs text-text-muted hover:border-primary/40 hover:text-text-secondary transition-colors font-mono"
            >
              {ascending ? '↑ ASC' : '↓ DESC'}
            </button>
            <Button variant="primary" size="sm" onClick={handleRun} disabled={loading}>
              {loading ? 'Running…' : '▶ Run'}
            </Button>
            {/* Cost estimator (pre-run) */}
            <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
              preRunHint.est.high
                ? 'bg-danger/8 border-danger/20 text-danger'
                : 'bg-success/8 border-success/20 text-success'
            }`} title="Estimated RCU before running">
              {preRunHint.mode} · {preRunHint.est.label}
            </span>
          </div>
        </div>

        {/* Active chips */}
        <div className="flex items-center gap-2 flex-wrap min-h-[30px]">
          {chips.map(chip => (
            <FilterChipBadge key={chip.id} chip={chip}
              onRemove={() => { setChips(cs => cs.filter(c => c.id !== chip.id)); setResult(null) }} />
          ))}
          {chips.length > 0 && (
            <button onClick={() => { setChips([]); setResult(null) }}
              className="text-text-muted text-xs hover:text-danger transition-colors">
              Clear all
            </button>
          )}
        </div>

        {/* Filter builder */}
        <FilterBuilder onAdd={chip => setChips(cs => [...cs, chip])} attributes={table?.attributes} />

        {/* Time-range presets (only when sk = timestamp) */}
        {isTimestampSk && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-muted">Time presets:</span>
            {[
              { label: 'Last 1h',  h: 1   },
              { label: 'Last 6h',  h: 6   },
              { label: 'Last 24h', h: 24  },
              { label: 'Last 7d',  h: 168 },
            ].map(({ label, h }) => (
              <button key={h} onClick={() => applyTimePreset(h)}
                className="px-2 py-0.5 text-[11px] rounded border border-border text-text-muted hover:border-primary/40 hover:text-primary transition-colors">
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Scan warning */}
        {opMode === 'Scan' && chips.length > 0 && (
          <Callout variant="warning" title="Scan detected">
            No <code className="font-mono">{pkField} =</code> filter — full table scan.
            Add partition key filter to use a Query ({rcu.label}).
          </Callout>
        )}
      </div>

      {/* Results area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {result && (
          <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border-subtle bg-bg-base/50 text-[11px] text-text-muted flex-shrink-0">
            <span><strong className="text-text-primary">{result.count}</strong> of {allFiltered.length > 0 ? allFiltered.length : result.count} returned</span>
            <span>{result.scannedCount.toLocaleString()} scanned</span>
            {result.rcuConsumed != null && <RcuBadge rcu={result.rcuConsumed} />}
            <span className="font-mono">{result.executionMs}ms</span>
            {result.warnings?.map((w, i) => <span key={i} className="text-warning">⚠ {w}</span>)}
            <div className="ml-auto flex items-center gap-1 bg-bg-surface rounded-lg p-0.5">
              {(['table', 'json'] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${viewMode === m ? 'bg-bg-overlay text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Index recommendation — shown after a scan with low selectivity */}
        {suggestion && result && !loading && (
          <IndexRecommendation s={suggestion} tableName={activeTable ?? ''} />
        )}

        {/* Query error */}
        {queryError && !loading && (
          <div className="mx-4 mt-2 mb-1 rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger flex-shrink-0">
            <span className="font-semibold">Query failed: </span>{queryError}
          </div>
        )}

        {/* Scan confirmation dialog — shown when large table scan is attempted */}
        {pendingConfirmScan && !loading && (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="rounded-xl border border-warning/40 bg-warning/6 p-6 max-w-md w-full">
              <p className="text-warning font-semibold mb-1">⚠ Full table scan</p>
              <p className="text-sm text-text-secondary mb-1">
                No <code className="font-mono text-warning">{pkField} =</code> filter detected.
                This will read <strong className="text-text-primary">{(table?.itemCount ?? 0).toLocaleString()}</strong> items
                from <code className="font-mono text-text-primary">{activeTable}</code>.
              </p>
              <p className="text-sm text-text-muted mb-4">
                Estimated cost: <span className="text-danger font-semibold">{preRunHint.est.label}</span>.
                Add a <code className="font-mono">{pkField} =</code> filter to use a cheap Query instead.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPendingConfirmScan(false)}
                  className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:border-border-active hover:text-text-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={executeRun}
                  className="px-3 py-1.5 rounded-lg border border-danger/40 bg-danger/8 text-xs text-danger hover:bg-danger/15 transition-colors font-semibold"
                >
                  Run anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {!result && !loading && !pendingConfirmScan && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-text-muted">
              <p className="text-sm">Build your query above and press Run</p>
              <p className="text-xs mt-1">Current mode: <span className={preRunHint.est.high ? 'text-warning' : 'text-success'}>{preRunHint.mode}</span> · {preRunHint.est.label}</p>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        )}

        {result && !loading && result.rows.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-text-muted">
              <p className="text-sm">No items matched your filters</p>
              <p className="text-xs mt-1">{result.scannedCount} items scanned</p>
            </div>
          </div>
        )}

        {result && !loading && result.rows.length > 0 && viewMode === 'table' && (
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs font-mono">
              <thead className="sticky top-0 bg-bg-elevated border-b border-border z-10">
                <tr>
                  {Object.keys(result.rows[0]).map(col => (
                    <th key={col} className="text-left px-3 py-2 text-text-muted font-semibold whitespace-nowrap border-r border-border-subtle last:border-r-0">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border-subtle hover:bg-bg-surface cursor-pointer">
                    {Object.values(row).map((val, j) => {
                      const str = val === null ? 'null' : typeof val === 'object' ? JSON.stringify(val) : String(val)
                      return (
                        <td key={j} className="px-3 py-1.5 text-text-secondary whitespace-nowrap max-w-[180px] overflow-hidden text-ellipsis border-r border-border-subtle last:border-r-0" title={str}>
                          {str}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Pagination */}
            {hasMore && (
              <div className="px-4 py-3 border-t border-border-subtle flex items-center gap-3">
                <Button variant="secondary" size="sm" onClick={handleLoadMore}>
                  Load more ({allFiltered.length - result.rows.length} remaining)
                </Button>
                <span className="text-[11px] text-text-muted">
                  Showing {result.rows.length} of {allFiltered.length}
                </span>
              </div>
            )}
          </div>
        )}

        {result && !loading && result.rows.length > 0 && viewMode === 'json' && (
          <div className="flex-1 overflow-auto p-4 space-y-2">
            {result.rows.map((row, i) => (
              <div key={i} className="rounded-lg border border-border bg-bg-surface p-3">
                <JsonTree data={row} defaultExpanded={false} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Cross-table join tab ──────────────────────────────────────────────────────

const JOIN_DEFS: { type: JoinType; label: string; desc: string }[] = [
  { type: 'inner',      label: 'INNER',      desc: 'Only rows with a matching key in both tables' },
  { type: 'left',       label: 'LEFT',       desc: 'All left rows; right fields are — when no match' },
  { type: 'left_anti',  label: 'LEFT ANTI',  desc: 'Left rows with NO match in right — find missing entries' },
  { type: 'right',      label: 'RIGHT',      desc: 'All right rows; left fields are — when no match' },
  { type: 'right_anti', label: 'RIGHT ANTI', desc: 'Right rows with NO match in left' },
]

function runJoin(
  leftRows: typeof mockRows,
  rightRows: typeof mockRows,
  leftField: string,
  rightField: string,
  joinType: JoinType,
): JoinResultRow[] {
  const rightMap = new Map<string, (typeof mockRows)[0]>()
  for (const row of rightRows) {
    const key = String(row[rightField] ?? '')
    if (!rightMap.has(key)) rightMap.set(key, row)
  }

  const result: JoinResultRow[] = []
  const matchedRightKeys = new Set<string>()

  for (const leftRow of leftRows) {
    const key = String(leftRow[leftField] ?? '')
    const rightRow = rightMap.get(key)
    if (rightRow) {
      matchedRightKeys.add(key)
      if (joinType !== 'left_anti' && joinType !== 'right_anti') {
        result.push({ _joinSide: 'both', left: leftRow, right: rightRow })
      }
    } else {
      if (joinType === 'left' || joinType === 'left_anti') {
        result.push({ _joinSide: 'left_only', left: leftRow, right: null })
      }
    }
  }

  if (joinType === 'right' || joinType === 'right_anti') {
    for (const [key, rightRow] of rightMap) {
      if (!matchedRightKeys.has(key)) {
        result.push({ _joinSide: 'right_only', left: null, right: rightRow })
      }
    }
  }

  return result
}

function CrossJoinTab({ connection }: { connection: DbConnection }) {
  const tables = connection.tables ?? []
  const tableNames = tables.map(t => t.name)

  const [leftTable,  setLeftTable]  = useState(tableNames[0] ?? '')
  const [rightTable, setRightTable] = useState(tableNames[2] ?? tableNames[1] ?? tableNames[0] ?? '')
  const [leftField,  setLeftField]  = useState('deviceId')
  const [rightField, setRightField] = useState('deviceId')
  const [joinType,   setJoinType]   = useState<JoinType>('left_anti')
  const [result,     setResult]     = useState<JoinResult | null>(null)
  const [loading,    setLoading]    = useState(false)

  const sameTable = leftTable === rightTable

  async function handleRun() {
    setLoading(true)
    await new Promise(r => setTimeout(r, 300))

    const leftRows  = getMockTableRows(leftTable)
    const rightRows = getMockTableRows(rightTable)
    const rows = runJoin(leftRows, rightRows, leftField, rightField, joinType)

    setResult({
      rows,
      leftScanned: leftRows.length,
      rightScanned: rightRows.length,
      matched:   rows.filter(r => r._joinSide === 'both').length,
      leftOnly:  rows.filter(r => r._joinSide === 'left_only').length,
      rightOnly: rows.filter(r => r._joinSide === 'right_only').length,
      executionMs: 12,
      warnings: joinType !== 'inner'
        ? ['Client-side join — both tables fully scanned before merging']
        : undefined,
    })
    setLoading(false)
  }

  const leftCols     = Object.keys(getMockTableRows(leftTable)[0]  ?? {})
  const rightCols    = Object.keys(getMockTableRows(rightTable)[0] ?? {})
  const rightOnlyCols = rightCols.filter(c => !leftCols.includes(c))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-4 border-b border-border-subtle bg-bg-elevated space-y-4 flex-shrink-0">

        {/* Table + key selectors */}
        <div className="flex items-start gap-3">
          <div className="flex-1 space-y-2">
            <p className="text-[11px] font-semibold text-primary uppercase tracking-wider">Left table</p>
            <select className="field-input w-full" value={leftTable} onChange={e => setLeftTable(e.target.value)}>
              {tableNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-muted">Join key</label>
              <input className="field-input" value={leftField} onChange={e => setLeftField(e.target.value)} placeholder="deviceId" />
            </div>
          </div>
          <div className="flex flex-col items-center justify-center pt-8 gap-0.5 px-2">
            <span className="text-xl text-text-muted select-none">⟗</span>
            <span className="text-[10px] text-text-muted">=</span>
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-[11px] font-semibold text-violet-400 uppercase tracking-wider">Right table</p>
            <select className="field-input w-full" value={rightTable} onChange={e => setRightTable(e.target.value)}>
              {tableNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-muted">Join key</label>
              <input className="field-input" value={rightField} onChange={e => setRightField(e.target.value)} placeholder="deviceId" />
            </div>
          </div>
        </div>

        {/* Join type */}
        <div>
          <p className="text-[11px] text-text-muted uppercase tracking-wider mb-2">Join type</p>
          <div className="flex gap-2 flex-wrap">
            {JOIN_DEFS.map(jd => (
              <button key={jd.type} onClick={() => setJoinType(jd.type)} title={jd.desc}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  joinType === jd.type
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border text-text-muted hover:border-border-active hover:text-text-secondary'
                }`}>
                {jd.label}
                {jd.type === 'left_anti' && <span className="ml-1 text-[10px] text-warning">★</span>}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-text-muted mt-1.5 italic">
            {JOIN_DEFS.find(j => j.type === joinType)?.desc}
          </p>
        </div>

        {/* Run + stats */}
        <div className="flex items-center gap-3">
          <Button variant="primary" size="sm" onClick={handleRun} disabled={loading || sameTable}>
            {loading ? 'Joining…' : '⟗ Run join'}
          </Button>
          {sameTable && <span className="text-xs text-warning">Select two different tables</span>}
          {result && !loading && (
            <div className="flex items-center gap-3 text-[11px] text-text-muted">
              <span className="text-primary font-semibold">{result.matched} matched</span>
              {result.leftOnly  > 0 && <span className="text-warning">{result.leftOnly} left-only</span>}
              {result.rightOnly > 0 && <span className="text-violet-400">{result.rightOnly} right-only</span>}
              <span>· {result.leftScanned}+{result.rightScanned} scanned · {result.executionMs}ms</span>
            </div>
          )}
        </div>

        {result?.warnings && (
          <p className="text-[11px] text-warning">⚠ {result.warnings[0]}</p>
        )}
      </div>

      {/* Results */}
      {!result && !loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-text-muted">
            <p className="text-sm">Configure tables and join type, then press Run join</p>
            <p className="text-xs mt-1">
              Try <span className="text-warning font-medium">LEFT ANTI</span> to find entries in one table missing from another
            </p>
          </div>
        </div>
      )}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      )}
      {result && !loading && (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-bg-elevated border-b border-border z-10">
              <tr>
                <th className="text-left px-3 py-2 text-text-muted font-semibold whitespace-nowrap border-r border-border-subtle w-16">side</th>
                {leftCols.map(col => (
                  <th key={`L_${col}`} className="text-left px-3 py-2 text-primary/80 font-semibold whitespace-nowrap border-r border-border-subtle">{col}</th>
                ))}
                {rightOnlyCols.map(col => (
                  <th key={`R_${col}`} className="text-left px-3 py-2 text-violet-400/80 font-semibold whitespace-nowrap border-r border-border-subtle last:border-r-0">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className={`border-b border-border-subtle ${
                  row._joinSide === 'left_only'  ? 'bg-warning/5' :
                  row._joinSide === 'right_only' ? 'bg-violet-500/5' : ''
                }`}>
                  <td className="px-3 py-1.5 border-r border-border-subtle whitespace-nowrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      row._joinSide === 'both'       ? 'bg-primary/10 text-primary' :
                      row._joinSide === 'left_only'  ? 'bg-warning/15 text-warning' :
                                                        'bg-violet-500/15 text-violet-400'
                    }`}>
                      {row._joinSide === 'both' ? 'MATCH' : row._joinSide === 'left_only' ? 'LEFT' : 'RIGHT'}
                    </span>
                  </td>
                  {leftCols.map(col => {
                    const val = row.left?.[col]
                    const str = val == null ? '—' : String(val)
                    return (
                      <td key={`L_${col}`}
                        className={`px-3 py-1.5 whitespace-nowrap max-w-[160px] overflow-hidden text-ellipsis border-r border-border-subtle ${val == null ? 'text-text-muted' : 'text-text-secondary'}`}
                        title={str}>{str}</td>
                    )
                  })}
                  {rightOnlyCols.map(col => {
                    const val = row.right?.[col]
                    const str = val == null ? '—' : String(val)
                    return (
                      <td key={`R_${col}`}
                        className={`px-3 py-1.5 whitespace-nowrap max-w-[160px] overflow-hidden text-ellipsis border-r border-border-subtle last:border-r-0 ${val == null ? 'text-text-muted' : 'text-violet-300'}`}
                        title={str}>{str}</td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Time Trace helpers ────────────────────────────────────────────────────────

const TIMESTAMP_CANDIDATES = [
  'timestamp', 'createdAt', 'updatedAt', 'eventTime', 'ts', 'time',
  'insertedAt', 'processedAt', 'signupAt', 'registeredAt', 'lastLoginAt',
  'installedAt', 'resolvedAt', 'date',
]

const TRACE_TABLE_COLORS = [
  { dot: 'bg-primary',    label: 'text-primary',    border: 'border-primary/25',    bg: 'bg-primary/5'    },
  { dot: 'bg-violet-400', label: 'text-violet-400', border: 'border-violet-400/25', bg: 'bg-violet-400/5' },
  { dot: 'bg-amber-400',  label: 'text-amber-400',  border: 'border-amber-400/25',  bg: 'bg-amber-400/5'  },
  { dot: 'bg-sky-400',    label: 'text-sky-400',    border: 'border-sky-400/25',    bg: 'bg-sky-400/5'    },
  { dot: 'bg-rose-400',   label: 'text-rose-400',   border: 'border-rose-400/25',   bg: 'bg-rose-400/5'   },
]

function getTraceColor(tableIndex: number) {
  return TRACE_TABLE_COLORS[tableIndex % TRACE_TABLE_COLORS.length]
}

function detectTimestamp(row: Record<string, unknown>): { ts: number; field: string } {
  for (const field of TIMESTAMP_CANDIDATES) {
    const val = row[field]
    if (val == null) continue
    if (typeof val === 'number' && val > 1_000_000_000) {
      return { ts: val > 1e12 ? val : val * 1000, field }
    }
    if (typeof val === 'string') {
      const d = new Date(val)
      if (!isNaN(d.getTime())) return { ts: d.getTime(), field }
      const n = parseFloat(val)
      if (!isNaN(n) && n > 1_000_000_000) return { ts: n > 1e12 ? n : n * 1000, field }
    }
  }
  return { ts: Date.now(), field: 'n/a' }
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 0) return new Date(ts).toLocaleTimeString()
  const s = Math.floor(diff / 1000)
  if (s < 60)   return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)   return `${m}m ${s % 60}s ago`
  const h = Math.floor(m / 60)
  if (h < 24)   return `${h}h ${m % 60}m ago`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h ago`
}

function formatDelta(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = (ms / 1000).toFixed(1)
  if (ms < 60_000) return `${s}s`
  const m = Math.floor(ms / 60_000)
  const rs = Math.floor((ms % 60_000) / 1000)
  return `${m}m ${rs}s`
}

function matchesCondition(row: Record<string, unknown>, field: string, op: TraceOp, value: string): boolean {
  // 'contains' without a known field → search all string-valued fields
  if (op === 'contains') {
    const v = value.toLowerCase()
    return Object.values(row).some(rv => String(rv ?? '').toLowerCase().includes(v))
  }
  const raw = row[field]
  if (raw == null) return false
  const str = String(raw)
  if (op === '=')           return str === value
  if (op === 'begins_with') return str.startsWith(value)
  return false
}

function getPreviewFields(row: Record<string, unknown>, tsField: string): [string, string][] {
  const SKIP = new Set([tsField, 'createdAt', 'updatedAt', 'timestamp'])
  return Object.entries(row)
    .filter(([k]) => !SKIP.has(k))
    .slice(0, 5)
    .map(([k, v]) => [k, v === null || v === undefined ? '—' : String(v)])
}

async function runTrace(
  connection: DbConnection,
  entityField: string,
  entityOp: TraceOp,
  entityValue: string,
  extraConditions: TraceCondition[],
  tables: string[],
): Promise<TraceResult> {
  const matches: TraceMatch[] = []
  const missingTables: string[] = []
  let totalScanned = 0
  const t0 = performance.now()

  for (const tableName of tables) {
    const tableMeta = connection.tables?.find(t => t.name === tableName)
    let rows: Record<string, unknown>[]

    if (MOCK_MODE) {
      const allRows = getMockTableRows(tableName) as Record<string, unknown>[]
      totalScanned += allRows.length
      rows = allRows.filter(row => {
        if (!matchesCondition(row, entityField, entityOp, entityValue)) return false
        return extraConditions.every(c => matchesCondition(row, c.field, '=', c.value))
      })
    } else {
      // Build filter chips for the real query
      const chips: FilterChip[] = [
        { id: 'trace-pk', field: entityField, op: entityOp as FilterOp, value: entityValue },
        ...extraConditions.map((c, i) => ({
          id: `trace-extra-${i}`,
          field: c.field,
          op: '=' as FilterOp,
          value: c.value,
        })),
      ]
      try {
        const res = await api.queryTable({
          connectionId:      connection.id,
          table:             tableName,
          partitionKeyField: tableMeta?.partitionKey ?? entityField,
          sortKeyField:      tableMeta?.sortKey,
          filters:           chips,
          limit:             500,
        })
        rows = res.rows as Record<string, unknown>[]
        totalScanned += res.scannedCount
      } catch {
        rows = []
      }
    }

    if (rows.length === 0) {
      missingTables.push(tableName)
    } else {
      for (const row of rows) {
        const { ts, field } = detectTimestamp(row)
        matches.push({ table: tableName, row: row as TraceMatch['row'], timestamp: ts, timestampField: field })
      }
    }
  }

  matches.sort((a, b) => a.timestamp - b.timestamp)

  return {
    entityField,
    entityOp,
    entityValue,
    extraConditions,
    matches,
    missingTables,
    tablesSearched: tables,
    totalScanned,
    executionMs: Math.round(performance.now() - t0),
  }
}

// ── TraceTimeline ─────────────────────────────────────────────────────────────

function TraceTimeline({
  result,
  tableColorIndex,
}: {
  result: TraceResult
  tableColorIndex: Map<string, number>
}) {
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set())

  function toggle(i: number) {
    setExpandedSet(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">

      {/* Stats bar */}
      <div className="flex items-center gap-4 text-[11px] text-text-muted mb-4 flex-wrap">
        <span>
          <strong className="text-text-primary">{result.matches.length}</strong> event{result.matches.length !== 1 ? 's' : ''}{' '}
          across{' '}
          <strong className="text-text-primary">{result.tablesSearched.length - result.missingTables.length}</strong>{' '}
          of{' '}
          <strong className="text-text-primary">{result.tablesSearched.length}</strong>{' '}
          tables
        </span>
        <span>{result.totalScanned.toLocaleString()} items scanned</span>
        <span className="font-mono">{result.executionMs}ms</span>
        <span className="font-mono text-primary">
          {result.entityField} {result.entityOp} {result.entityValue}
        </span>
      </div>

      {/* Missing tables callout */}
      {result.missingTables.length > 0 && (
        <div className="mb-4 rounded-xl border border-warning/35 bg-warning/5 p-3">
          <p className="text-xs font-semibold text-warning mb-1">
            Entity not found in {result.missingTables.length} table{result.missingTables.length !== 1 ? 's' : ''}
            {' '}— possible propagation failure
          </p>
          <p className="text-xs text-text-secondary mb-1">
            <code className="font-mono text-text-primary">
              {result.entityField} {result.entityOp === '=' ? '=' : result.entityOp}{' '}{result.entityValue}
            </code>{' '}
            was not found in:{' '}
            {result.missingTables.map((t, i) => (
              <span key={t}>
                <code className="font-mono text-warning">{t}</code>
                {i < result.missingTables.length - 1 ? ', ' : ''}
              </span>
            ))}
          </p>
          <p className="text-[11px] text-text-muted">
            This indicates the event was not written to these tables — check the pipeline for dropped writes.
          </p>
        </div>
      )}

      {/* Empty timeline */}
      {result.matches.length === 0 && (
        <div className="text-center py-10 text-text-muted">
          <p className="text-sm">Entity not found in any searched table</p>
          <p className="text-xs mt-1">Try a different field name, value, or operator</p>
        </div>
      )}

      {/* Timeline */}
      {result.matches.length > 0 && (
        <div className="relative">
          {/* Vertical connector line */}
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border-subtle pointer-events-none" />

          <div className="space-y-0.5">
            {result.matches.map((match, i) => {
              const prev     = i > 0 ? result.matches[i - 1] : null
              const delta    = prev ? match.timestamp - prev.timestamp : null
              const colorIdx = tableColorIndex.get(match.table) ?? i
              const color    = getTraceColor(colorIdx)
              const expanded = expandedSet.has(i)
              const preview  = getPreviewFields(match.row as Record<string, unknown>, match.timestampField)

              return (
                <div key={i}>
                  {/* Delta between consecutive events */}
                  {delta !== null && delta >= 0 && (
                    <div className="ml-6 py-0.5 text-[10px] text-text-muted font-mono flex items-center gap-1">
                      <span className="text-border-subtle">│</span>
                      <span className="text-primary/50">+{formatDelta(delta)}</span>
                    </div>
                  )}

                  {/* Event card */}
                  <div className="flex items-start gap-3">
                    {/* Timeline dot */}
                    <div className={`w-3.5 h-3.5 rounded-full ${color.dot} flex-shrink-0 mt-2.5 z-10 ring-2 ring-bg-base`} />

                    {/* Card */}
                    <button
                      onClick={() => toggle(i)}
                      className={`flex-1 min-w-0 rounded-xl border ${color.border} ${color.bg} p-3 text-left hover:brightness-110 transition-all`}
                    >
                      {/* Header row */}
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`text-[10px] font-bold uppercase tracking-wide ${color.label}`}>
                          {match.table}
                        </span>
                        <span className="text-[10px] text-text-muted font-mono">
                          {formatRelative(match.timestamp)}
                        </span>
                        <span className="text-[10px] text-border-subtle">·</span>
                        <span className="text-[10px] text-text-muted font-mono">
                          {match.timestampField}: {new Date(match.timestamp).toISOString().replace('T', ' ').slice(0, 19)}
                        </span>
                        <span className="ml-auto text-[10px] text-text-muted">
                          {expanded ? '▾' : '▸'}
                        </span>
                      </div>

                      {/* Preview fields */}
                      <div className="flex items-center gap-3 flex-wrap text-[11px]">
                        {preview.map(([k, v]) => (
                          <span key={k} className="flex items-center gap-1">
                            <span className="text-text-muted">{k}:</span>
                            <span className="font-mono text-text-secondary truncate max-w-[120px]" title={v}>{v}</span>
                          </span>
                        ))}
                      </div>

                      {/* Expanded full row */}
                      {expanded && (
                        <div className="mt-2 pt-2 border-t border-border-subtle/50">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 text-[11px]">
                            {Object.entries(match.row).map(([k, v]) => (
                              <div key={k} className="flex gap-1 min-w-0">
                                <span className="text-text-muted flex-shrink-0">{k}:</span>
                                <span className="font-mono text-text-secondary truncate" title={String(v ?? '')}>
                                  {v === null || v === undefined ? '—' : String(v)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── TraceTab ──────────────────────────────────────────────────────────────────

const TRACE_OPS: { value: TraceOp; label: string; hint: string }[] = [
  { value: '=',           label: '= exact',       hint: 'Exact match — efficient Query if field is PK' },
  { value: 'begins_with', label: 'begins_with',   hint: 'Prefix match — good for composite keys like US::zone::id' },
  { value: 'contains',    label: 'contains (any)', hint: 'Finds value in any string field — searches whole row' },
]

let traceCondId = 0

function TraceTab({ activeConnection }: { activeConnection: DbConnection | null }) {
  const [entityField, setEntityField] = useState('deviceId')
  const [entityOp, setEntityOp]       = useState<TraceOp>('=')
  const [entityValue, setEntityValue] = useState('')
  const [extraConds, setExtraConds]   = useState<TraceCondition[]>([])
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [result, setResult]           = useState<TraceResult | null>(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)

  const allTables = activeConnection?.tables?.map(t => t.name) ?? []

  // Stable table→color index based on position in the connection's table list
  const tableColorIndex = useMemo(() => {
    const m = new Map<string, number>()
    allTables.forEach((name, i) => m.set(name, i))
    return m
  }, [allTables.join(',')])

  // Default all tables selected when connection changes
  useEffect(() => {
    setSelectedTables([])
    setResult(null)
    setError(null)
  }, [activeConnection?.id])

  const tablesToSearch = selectedTables.length > 0 ? selectedTables : allTables

  function toggleTable(name: string) {
    setSelectedTables(prev =>
      prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name]
    )
  }

  function addExtraCond() {
    setExtraConds(c => [...c, { id: `tc-${++traceCondId}`, field: '', op: '=', value: '' }])
  }

  function updateExtraCond(id: string, patch: Partial<TraceCondition>) {
    setExtraConds(c => c.map(x => x.id === id ? { ...x, ...patch } : x))
  }

  async function handleTrace() {
    if (!entityValue.trim() || !activeConnection) return
    setLoading(true)
    setResult(null)
    setError(null)

    const validExtra = extraConds.filter(c => c.field.trim() && c.value.trim())

    try {
      const r = await runTrace(
        activeConnection,
        entityField.trim(),
        entityOp,
        entityValue.trim(),
        validExtra,
        tablesToSearch,
      )
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }

  if (!activeConnection) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState variant="empty" title="No connection selected"
          description="Select a DynamoDB connection from the sidebar to use Time Trace." />
      </div>
    )
  }

  const selectedOpHint = TRACE_OPS.find(o => o.value === entityOp)?.hint ?? ''
  const canTrace = entityValue.trim().length > 0

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Search panel */}
      <div className="px-4 py-4 border-b border-border-subtle bg-bg-elevated space-y-3 flex-shrink-0">

        {/* Primary entity search */}
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-text-muted">Field</label>
            <input
              className="field-input w-32"
              value={entityField}
              onChange={e => setEntityField(e.target.value)}
              placeholder="deviceId"
              list="trace-field-list"
            />
            <datalist id="trace-field-list">
              {activeConnection.tables?.flatMap(t => t.attributes ?? []).filter((v, i, a) => a.indexOf(v) === i).map(a => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-text-muted">Operator</label>
            <select
              className="field-input w-36"
              value={entityOp}
              onChange={e => setEntityOp(e.target.value as TraceOp)}
            >
              {TRACE_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-text-muted">Value</label>
            <input
              className="field-input w-44"
              value={entityValue}
              onChange={e => setEntityValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canTrace && handleTrace()}
              placeholder="sensor-0012"
            />
          </div>
          <Button variant="primary" size="sm" onClick={handleTrace} disabled={loading || !canTrace}>
            {loading ? 'Tracing…' : '⏱ Trace'}
          </Button>
        </div>

        {/* Operator hint */}
        {selectedOpHint && (
          <p className="text-[11px] text-text-muted italic">{selectedOpHint}</p>
        )}

        {/* AND conditions */}
        {extraConds.length > 0 && (
          <div className="space-y-1.5">
            {extraConds.map(cond => (
              <div key={cond.id} className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted font-semibold uppercase">AND</span>
                <input
                  className="field-input w-28"
                  placeholder="field"
                  value={cond.field}
                  onChange={e => updateExtraCond(cond.id, { field: e.target.value })}
                />
                <span className="text-[11px] text-text-muted">=</span>
                <input
                  className="field-input w-32"
                  placeholder="value"
                  value={cond.value}
                  onChange={e => updateExtraCond(cond.id, { value: e.target.value })}
                />
                <button
                  onClick={() => setExtraConds(c => c.filter(x => x.id !== cond.id))}
                  className="text-text-muted hover:text-danger transition-colors text-xs"
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Controls row: AND + table selection */}
        <div className="flex items-start gap-4 flex-wrap">
          {extraConds.length < 3 && (
            <button
              onClick={addExtraCond}
              className="text-[11px] text-text-muted hover:text-primary transition-colors"
            >
              + AND condition
            </button>
          )}

          {allTables.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-text-muted">Tables:</span>
              {allTables.map((name, i) => {
                const color   = getTraceColor(tableColorIndex.get(name) ?? i)
                const checked = selectedTables.length === 0 || selectedTables.includes(name)
                return (
                  <button
                    key={name}
                    onClick={() => toggleTable(name)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors font-medium ${
                      checked
                        ? `${color.border} ${color.bg} ${color.label}`
                        : 'border-border text-text-muted opacity-40'
                    }`}
                  >
                    {name}
                  </button>
                )
              })}
              {selectedTables.length > 0 && (
                <button
                  onClick={() => setSelectedTables([])}
                  className="text-[10px] text-text-muted hover:text-primary transition-colors"
                >
                  All
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {error && (
          <div className="mx-4 mt-3 rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger flex-shrink-0">
            <span className="font-semibold">Trace failed: </span>{error}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-text-muted max-w-xs">
              <div className="text-3xl mb-3 opacity-40">⏱</div>
              <p className="text-sm font-medium text-text-secondary mb-1">Cross-table event timeline</p>
              <p className="text-xs">Enter an entity key above — DataOrbit will search all tables and build a chronological timeline showing where and when the entity appears.</p>
              <div className="mt-4 text-[11px] space-y-1 text-left bg-bg-surface rounded-lg p-3 border border-border-subtle">
                <p className="text-text-muted font-semibold mb-1.5">Try these:</p>
                <p><code className="text-primary">deviceId = sensor-0012</code> — trace a WARN event with missing alert</p>
                <p><code className="text-primary">deviceId = sensor-4421</code> — trace a healthy sensor lifecycle</p>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-text-muted">
              <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-3" />
              <p className="text-xs">Searching {tablesToSearch.length} table{tablesToSearch.length !== 1 ? 's' : ''}…</p>
            </div>
          </div>
        )}

        {result && !loading && (
          <TraceTimeline result={result} tableColorIndex={tableColorIndex} />
        )}
      </div>
    </div>
  )
}

// ── Explore root ──────────────────────────────────────────────────────────────

export function Explore({ activeConnection, activeTable }: ExploreProps) {
  const [tab, setTab] = useState<'query' | 'join' | 'trace'>('query')

  if (!activeConnection && tab === 'query' && !activeTable) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState variant="empty" title="No connection selected"
          description="Select a connection from the sidebar to start exploring." />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-border-subtle bg-bg-elevated flex-shrink-0">
        {([
          { id: 'query', label: 'Query',       badge: null    },
          { id: 'join',  label: 'Cross-join',  badge: null    },
          { id: 'trace', label: 'Time Trace',  badge: 'new'   },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
              tab === t.id ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'
            }`}>
            {t.label}
            {t.badge && (
              <span className="ml-1.5 px-1 py-0.5 text-[10px] rounded bg-primary/15 text-primary">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'query' && <QueryTab activeConnection={activeConnection} activeTable={activeTable} />}
        {tab === 'join' && activeConnection && <CrossJoinTab connection={activeConnection} />}
        {tab === 'join' && !activeConnection && (
          <div className="h-full flex items-center justify-center">
            <EmptyState variant="empty" title="No connection selected"
              description="Select a DynamoDB connection to use cross-table joins." />
          </div>
        )}
        {tab === 'trace' && <TraceTab activeConnection={activeConnection} />}
      </div>
    </div>
  )
}

export default Explore
