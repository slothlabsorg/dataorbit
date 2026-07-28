import { useState, useEffect, useRef, useMemo } from 'react'
import { api } from '@/lib/tauri'
import { downloadJson, downloadCsv } from '@/lib/export'
import { motion, AnimatePresence } from 'framer-motion'
import type { DbConnection, QueryResult, TableMeta } from '@/types'
import type { MonitoredRow } from '@/screens/LiveMonitor'
import { JsonTree } from '@/components/ui/JsonTree'
import { RcuBadge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import type { ToastType } from '@/components/ui/Toast'

interface BrowseProps {
  activeConnection: DbConnection | null
  activeTable: string | null
  onSelectTable: (connId: string, table: string) => void
  onRefreshTables?: (connId: string, tables: TableMeta[]) => void
  onUpdateTableSchema?: (connId: string, schema: TableMeta) => void
  showToast?: (msg: string, type: ToastType) => void
  onOpenExplore?: () => void
  onAddMonitorRow?: (row: MonitoredRow) => void
}

type ViewMode = 'table' | 'json'
type SortDir = 'asc' | 'desc'

// ── JSON editor helpers ───────────────────────────────────────────────────────

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlightJson(raw: string): string {
  const escaped = escapeHtml(raw)
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    match => {
      if (/^"/.test(match)) {
        return /:$/.test(match)
          ? `<span style="color:#a78bfa">${match}</span>`   // key — purple
          : `<span style="color:#86efac">${match}</span>`   // string — green
      }
      if (/true|false/.test(match)) return `<span style="color:#f9a8d4">${match}</span>` // bool — pink
      if (/null/.test(match))       return `<span style="color:#6b7280">${match}</span>` // null — muted
      return `<span style="color:#fde68a">${match}</span>` // number — yellow
    }
  )
}

function sanitizeDisplay(val: unknown): string {
  const str = val === null || val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
  // Replace control characters with middot
  return str.replace(/[\x00-\x1F\x7F]/g, '\u00b7')
}

function jsonLintError(s: string): string | null {
  try { JSON.parse(s); return null } catch (e) { return e instanceof Error ? e.message : String(e) }
}

// ── JSON Editor Panel ─────────────────────────────────────────────────────────

function JsonEditor({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: string
  onSave: (val: Record<string, unknown>) => void
  onCancel: () => void
  saving: boolean
}) {
  const [text, setText] = useState(() => {
    try { return JSON.stringify(JSON.parse(initial), null, 2) } catch { return initial }
  })
  const error = jsonLintError(text)
  const highlighted = highlightJson(text)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // keep pre scroll in sync with textarea
  function handleScroll() {
    const pre = taRef.current?.previousSibling as HTMLElement | null
    if (pre) pre.scrollTop = taRef.current!.scrollTop
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle flex-shrink-0">
        <span className="text-text-primary text-xs font-semibold">Edit item</span>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="text-text-muted text-xs hover:text-text-primary">Cancel</button>
          <Button
            variant="primary" size="xs"
            onClick={() => { const parsed = JSON.parse(text); onSave(parsed) }}
            disabled={!!error || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Editor with syntax highlight overlay */}
      <div className="flex-1 relative overflow-hidden font-mono text-xs">
        {/* Highlighted layer (read-only, behind textarea) */}
        <pre
          aria-hidden
          className="absolute inset-0 p-3 overflow-auto whitespace-pre pointer-events-none leading-5 text-text-secondary"
          dangerouslySetInnerHTML={{ __html: highlightJson(text) + '\n' }}
          style={{ fontSize: '11px' }}
        />
        {/* Transparent textarea on top */}
        <textarea
          ref={taRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onScroll={handleScroll}
          spellCheck={false}
          className="absolute inset-0 w-full h-full p-3 bg-transparent text-transparent caret-text-primary outline-none resize-none leading-5 overflow-auto"
          style={{ fontSize: '11px', caretColor: '#a78bfa' }}
        />
      </div>
      {error && (
        <div className="px-3 py-1.5 bg-danger/8 border-t border-danger/20 text-[10px] text-danger font-mono flex-shrink-0">
          {error}
        </div>
      )}
      {/* Silence the "highlighted" variable warning */}
      {highlighted.length === 0 && null}
    </div>
  )
}

// ── Schema panel ──────────────────────────────────────────────────────────────

function SchemaPanel({ table, onClose, onIndexClick }: { table: TableMeta; onClose: () => void; onIndexClick?: (indexName: string) => void }) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="overflow-hidden border-b border-border-subtle bg-bg-elevated/60"
    >
      <div className="px-4 py-2.5 flex gap-6 items-start text-[11px]">
        <div className="space-y-0.5">
          <p className="text-text-muted">pk <code className="text-text-secondary font-mono">{table.partitionKey ?? '—'}</code></p>
          {table.sortKey && <p className="text-text-muted">sk <code className="text-text-secondary font-mono">{table.sortKey}</code></p>}
        </div>
        <div className="space-y-0.5">
          {table.itemCount != null && <p className="text-text-muted">{table.itemCount.toLocaleString()} items</p>}
          {table.billingMode && <p className="text-text-muted">{table.billingMode === 'PAY_PER_REQUEST' ? 'on-demand' : 'provisioned'}</p>}
        </div>
        {(table.indexes?.length ?? 0) > 0 && (
          <div className="flex-1">
            <p className="text-text-muted mb-1">Indexes</p>
            <div className="flex flex-wrap gap-1.5">
              {table.indexes!.map(idx => (
                <button
                  key={idx.name}
                  onClick={() => onIndexClick?.(idx.name)}
                  className="px-1.5 py-0.5 rounded bg-bg-surface border border-border-subtle text-text-secondary hover:border-primary/40 hover:bg-primary/5 transition-colors cursor-pointer"
                  title="Explore with this index"
                >
                  <span className="text-primary">{idx.type}</span> {idx.name}
                  <span className="text-text-muted"> · pk:{idx.partitionKey}{idx.sortKey ? ` sk:${idx.sortKey}` : ''}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <button onClick={onClose} className="ml-auto text-text-muted hover:text-text-primary text-xs flex-shrink-0">✕</button>
      </div>
    </motion.div>
  )
}

// ── Table selector tabs ───────────────────────────────────────────────────────

function TableSelector({ conn, activeTable, onSelect, onRefresh, refreshing, schemaOpen, onToggleSchema }: {
  conn: DbConnection
  activeTable: string | null
  onSelect: (t: string) => void
  onRefresh: () => void
  refreshing: boolean
  schemaOpen: boolean
  onToggleSchema: () => void
}) {
  const [filter, setFilter] = useState('')
  const tables = conn.tables ?? []
  const filtered = filter.trim()
    ? tables.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()))
    : tables

  return (
    <div className="border-b border-border-subtle bg-bg-elevated flex-shrink-0">
      {/* Filter row */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <div className="relative flex-1 min-w-0">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={`Filter ${tables.length} tables…`}
            className="w-full bg-bg-surface border border-border-subtle rounded-md pl-6 pr-3 py-1 text-[11px] text-text-secondary placeholder:text-text-muted outline-none focus:border-primary/40 transition-colors"
          />
          {filter && (
            <button onClick={() => setFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {activeTable && (
            <button
              onClick={onToggleSchema}
              className={`px-2 py-1 rounded text-[10px] transition-colors border ${
                schemaOpen ? 'border-primary/40 text-primary bg-primary/8' : 'border-border text-text-muted hover:text-text-secondary'
              }`}
            >
              Schema
            </button>
          )}
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-surface transition-colors disabled:opacity-50"
            title="Refresh tables"
          >
            <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
            </svg>
          </button>
        </div>
      </div>
      {/* Table chips row — only shown when there are results */}
      {filtered.length > 0 && (
        <div className="flex gap-1 overflow-x-auto px-3 pb-1.5 hide-scrollbar">
          {filtered.slice(0, 30).map(t => (
            <button
              key={t.name}
              onClick={() => onSelect(t.name)}
              title={t.name}
              className={`flex-shrink-0 px-2.5 py-0.5 rounded-md text-[11px] font-mono transition-colors max-w-[180px] truncate ${
                activeTable === t.name
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface'
              }`}
            >
              {t.name}
            </button>
          ))}
          {filtered.length > 30 && (
            <span className="flex-shrink-0 text-[10px] text-text-muted self-center px-1">
              +{filtered.length - 30} more — use filter
            </span>
          )}
        </div>
      )}
      {filtered.length === 0 && filter && (
        <p className="text-[11px] text-text-muted px-3 pb-2 italic">No tables match &quot;{filter}&quot;</p>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function Browse({ activeConnection, activeTable, onSelectTable, onRefreshTables, onUpdateTableSchema, showToast, onOpenExplore, onAddMonitorRow }: BrowseProps) {
  const [result, setResult]         = useState<QueryResult | null>(null)
  const [loading, setLoading]       = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [viewMode, setViewMode]     = useState<ViewMode>('table')
  const [schemaOpen, setSchemaOpen] = useState(true)
  const [sortDir, setSortDir]       = useState<SortDir>('desc')
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null)
  const [saving, setSaving]         = useState(false)
  const [deletingRow, setDeletingRow] = useState<Record<string, unknown> | null>(null)
  const lastKeyRef = useRef<Record<string, unknown> | undefined>(undefined)

  // Client-side sort
  const [clientSortField, setClientSortField] = useState<string | null>(null)
  const [clientSortDir, setClientSortDir] = useState<'asc' | 'desc'>('desc')

  const table = activeConnection?.tables?.find(t => t.name === activeTable) ?? null

  // Load schema on-demand then fetch rows
  useEffect(() => {
    if (!activeConnection || !activeTable) { setResult(null); return }
    setSelectedRow(null)
    setEditingRow(null)
    lastKeyRef.current = undefined

    const tbl = activeConnection.tables?.find(t => t.name === activeTable)
    if (!tbl?.partitionKey) {
      // Need schema first
      api.getTableSchema(activeConnection.id, activeTable)
        .then(schema => { onUpdateTableSchema?.(activeConnection.id, schema) })
        .catch(() => {})
    }
    loadRows(false)
  }, [activeConnection?.id, activeTable])

  // Re-fetch when schema arrives (partitionKey becomes available)
  useEffect(() => {
    if (table?.partitionKey && !result && activeTable && !loading) {
      loadRows(false)
    }
  }, [table?.partitionKey])

  async function loadRows(more: boolean) {
    if (!activeConnection || !activeTable) return
    const tbl = activeConnection.tables?.find(t => t.name === activeTable)
    if (!tbl) return
    more ? setLoadingMore(true) : setLoading(true)
    try {
      const res = await api.queryTable({
        connectionId:      activeConnection.id,
        table:             activeTable,
        partitionKeyField: tbl.partitionKey ?? '',
        sortKeyField:      tbl.sortKey,
        filters:           [],
        limit:             50,
        scanIndexForward:  sortDir === 'asc',
        exclusiveStartKey: more ? lastKeyRef.current : undefined,
      })
      lastKeyRef.current = res.lastEvaluatedKey as Record<string, unknown> | undefined
      if (more && result) {
        setResult({ ...res, rows: [...result.rows, ...res.rows], count: result.rows.length + res.rows.length })
      } else {
        setResult(res)
      }
    } catch (e) {
      showToast?.(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      more ? setLoadingMore(false) : setLoading(false)
    }
  }

  async function handleRefresh() {
    if (!activeConnection || refreshing) return
    setRefreshing(true)
    try {
      const tables = await api.listTables(activeConnection.id)
      onRefreshTables?.(activeConnection.id, tables)
    } catch { /* ignore */ }
    finally { setRefreshing(false) }
  }

  async function handleSaveEdit(updated: Record<string, unknown>) {
    if (!activeConnection || !activeTable) return
    setSaving(true)
    try {
      await api.putItem(activeConnection.id, activeTable, updated)
      setEditingRow(null)
      showToast?.('Item saved', 'success')
      loadRows(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      showToast?.(msg.includes('AccessDenied') ? 'No write permission on this table' : msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row: Record<string, unknown>) {
    if (!activeConnection || !activeTable || !table) return
    // Build key from pk + sk
    const key: Record<string, unknown> = {}
    if (table.partitionKey && row[table.partitionKey] !== undefined) key[table.partitionKey] = row[table.partitionKey]
    if (table.sortKey && row[table.sortKey] !== undefined) key[table.sortKey] = row[table.sortKey]
    try {
      await api.deleteItem(activeConnection.id, activeTable, key)
      setDeletingRow(null)
      setSelectedRow(null)
      showToast?.('Item deleted', 'success')
      loadRows(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      showToast?.(msg.includes('AccessDenied') ? 'No delete permission on this table' : msg, 'error')
    }
  }

  if (!activeConnection) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState variant="empty" title="No connection selected" description="Select a connection from the sidebar to browse your data." />
      </div>
    )
  }

  const rows = result?.rows ?? []
  const hasMore = !!lastKeyRef.current

  // Client-side sort applied to loaded rows
  const sortedRows = useMemo(() => {
    if (!clientSortField || !rows.length) return rows
    return [...rows].sort((a, b) => {
      const av = String((a as Record<string, unknown>)[clientSortField] ?? '')
      const bv = String((b as Record<string, unknown>)[clientSortField] ?? '')
      const cmp = av.localeCompare(bv)
      return clientSortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, clientSortField, clientSortDir])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TableSelector
        conn={activeConnection}
        activeTable={activeTable}
        onSelect={t => onSelectTable(activeConnection.id, t)}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        schemaOpen={schemaOpen}
        onToggleSchema={() => setSchemaOpen(o => !o)}
      />

      <AnimatePresence>
        {schemaOpen && table && (
          <SchemaPanel table={table} onClose={() => setSchemaOpen(false)} onIndexClick={() => onOpenExplore?.()} />
        )}
      </AnimatePresence>

      {activeTable && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle bg-bg-elevated flex-shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {loading ? (
              <span className="text-text-muted text-xs">Loading…</span>
            ) : result ? (
              <>
                <span className="text-text-muted text-xs">{result.count} rows</span>
                {result.rcuConsumed != null && <RcuBadge rcu={result.rcuConsumed} />}
                {result.executionMs != null && (
                  <span className="text-text-muted text-xs font-mono">{result.executionMs}ms</span>
                )}
              </>
            ) : null}
          </div>

          {/* Sort direction — only relevant when table has a sort key */}
          {table?.sortKey && (
            <button
              onClick={() => { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); setTimeout(() => loadRows(false), 0) }}
              className="px-2 py-1 rounded border border-border text-xs text-text-muted hover:border-primary/40 hover:text-text-secondary transition-colors font-mono"
              title={`Sort by ${table.sortKey}`}
            >
              {table.sortKey} {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          )}

          {/* Client-side sort by any field */}
          {rows.length > 0 && (
            <div className="flex items-center gap-1 text-[11px]">
              <span className="text-text-muted">Sort:</span>
              <select
                value={clientSortField ?? ''}
                onChange={e => setClientSortField(e.target.value || null)}
                className="bg-bg-surface border border-border rounded px-1.5 py-0.5 text-text-secondary text-[11px] outline-none"
              >
                <option value="">(none)</option>
                {Object.keys((rows[0] as Record<string, unknown>) ?? {}).map(col => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
              {clientSortField && (
                <button onClick={() => setClientSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                  className="text-text-muted hover:text-primary">
                  {clientSortDir === 'asc' ? '↑' : '↓'}
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-1 bg-bg-surface rounded-lg p-0.5">
            {(['table', 'json'] as ViewMode[]).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  viewMode === m ? 'bg-bg-overlay text-text-primary' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {rows.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => downloadJson(rows, `${activeTable ?? 'export'}.json`)}
                className="px-2 py-1 rounded border border-border text-[10px] text-text-muted hover:border-primary/40 hover:text-primary transition-colors"
                title="Export JSON"
              >
                JSON ↓
              </button>
              <button
                onClick={() => downloadCsv(rows as Record<string, unknown>[], `${activeTable ?? 'export'}.csv`)}
                className="px-2 py-1 rounded border border-border text-[10px] text-text-muted hover:border-primary/40 hover:text-primary transition-colors"
                title="Export CSV"
              >
                CSV ↓
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-hidden flex">
        {/* Main content */}
        <div className={`flex flex-col overflow-hidden ${editingRow ? 'flex-1' : 'w-full'}`}>
          {!activeTable ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState variant="empty" title="Select a table" description="Choose a table from the tabs above." />
            </div>
          ) : loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} height={32} />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState variant="empty" title="No items" description="This table is empty or the query returned no results." />
            </div>
          ) : viewMode === 'json' ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {sortedRows.map((row, i) => (
                <div key={i} className="rounded-lg border border-border bg-bg-surface p-3">
                  <JsonTree data={row as Record<string, unknown>} defaultExpanded={false} />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="flex-1 overflow-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="sticky top-0 bg-bg-elevated border-b border-border z-10">
                    <tr>
                      {Object.keys(rows[0] ?? {}).map(col => (
                        <th key={col} className="text-left px-3 py-2 text-text-muted font-semibold whitespace-nowrap border-r border-border-subtle last:border-r-0">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row, i) => (
                      <tr
                        key={i}
                        onClick={() => { setSelectedRow(selectedRow === i ? null : i); setEditingRow(null) }}
                        className={`border-b border-border-subtle cursor-pointer transition-colors ${
                          selectedRow === i ? 'bg-primary/8' : 'hover:bg-bg-surface'
                        }`}
                      >
                        {Object.entries(row as Record<string, unknown>).map(([col, val]) => {
                          const str = sanitizeDisplay(val)
                          return (
                            <td key={col} className="px-3 py-1.5 text-text-secondary whitespace-nowrap max-w-[220px] overflow-hidden text-ellipsis border-r border-border-subtle last:border-r-0" title={str}>
                              {str}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Load more */}
              {hasMore && (
                <div className="px-4 py-2 border-t border-border-subtle flex-shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => loadRows(true)} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : `Load more`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Row detail / edit panel */}
        <AnimatePresence>
          {selectedRow !== null && !editingRow && sortedRows[selectedRow] && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 300, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-l border-border bg-bg-elevated flex-shrink-0 overflow-hidden flex flex-col"
            >
              <div className="w-[300px] flex flex-col h-full">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle flex-shrink-0">
                  <span className="text-text-secondary text-xs font-semibold">Row {selectedRow + 1}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditingRow(sortedRows[selectedRow] as Record<string, unknown>)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted hover:border-primary/40 hover:text-primary transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (!activeConnection || !activeTable || !table) return
                        const rowData = sortedRows[selectedRow] as Record<string, unknown>
                        const pkField = table.partitionKey ?? ''
                        const skField = table.sortKey
                        const pkValue = rowData[pkField] != null ? String(rowData[pkField]) : ''
                        const skValue = skField && rowData[skField] != null ? String(rowData[skField]) : undefined
                        onAddMonitorRow?.({
                          id: `${activeConnection.id}:${activeTable}:${pkValue}${skValue ? ':' + skValue : ''}`,
                          connectionId: activeConnection.id,
                          tableName: activeTable,
                          pkField,
                          pkValue,
                          skField,
                          skValue,
                          region: activeConnection.awsRegion,
                        })
                      }}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted hover:border-success/40 hover:text-success transition-colors"
                      title="Watch Live"
                    >
                      👁 Live
                    </button>
                    <button
                      onClick={() => setDeletingRow(sortedRows[selectedRow] as Record<string, unknown>)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-danger/30 text-danger/70 hover:bg-danger/10 transition-colors"
                    >
                      Delete
                    </button>
                    <button onClick={() => setSelectedRow(null)} className="text-text-muted hover:text-text-primary">✕</button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  <JsonTree data={sortedRows[selectedRow] as Record<string, unknown>} defaultExpanded={true} />
                </div>
              </div>
            </motion.div>
          )}

          {editingRow && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 380, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-l border-border bg-bg-elevated flex-shrink-0 overflow-hidden flex flex-col"
            >
              <div className="w-[380px] h-full">
                <JsonEditor
                  initial={JSON.stringify(editingRow, null, 2)}
                  onSave={handleSaveEdit}
                  onCancel={() => setEditingRow(null)}
                  saving={saving}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deletingRow && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setDeletingRow(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-bg-base border border-border rounded-xl p-5 max-w-sm w-full shadow-xl">
                <h3 className="text-text-primary font-semibold text-sm mb-2">Delete item?</h3>
                <p className="text-text-muted text-xs mb-4">This action cannot be undone.</p>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setDeletingRow(null)}>Cancel</Button>
                  <Button variant="secondary" size="sm" onClick={() => handleDelete(deletingRow)} className="border-danger/50 text-danger hover:bg-danger/10">
                    Delete
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

export default Browse
