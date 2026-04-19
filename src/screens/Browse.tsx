import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { DbConnection, DataRow, QueryResult, TableMeta } from '@/types'
import { JsonTree } from '@/components/ui/JsonTree'
import { RcuBadge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { mockRows } from '@/mock/data'

interface BrowseProps {
  activeConnection: DbConnection | null
  activeTable: string | null
  onSelectTable: (connId: string, table: string) => void
}

type ViewMode = 'table' | 'json'

function TableSelector({ conn, activeTable, onSelect }: {
  conn: DbConnection
  activeTable: string | null
  onSelect: (t: string) => void
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle bg-bg-elevated overflow-x-auto">
      <span className="text-text-muted text-xs flex-shrink-0">Table:</span>
      {(conn.tables ?? []).map(t => (
        <button
          key={t.name}
          onClick={() => onSelect(t.name)}
          className={`flex-shrink-0 px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
            activeTable === t.name
              ? 'bg-primary/15 text-primary border border-primary/30'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface'
          }`}
        >
          {t.name}
        </button>
      ))}
      {(conn.tables?.length ?? 0) === 0 && (
        <span className="text-text-muted text-xs italic">No tables — connect to refresh</span>
      )}
    </div>
  )
}

function TableMetaBar({ table }: { table: TableMeta }) {
  return (
    <div className="flex items-center gap-4 px-4 py-1.5 border-b border-border-subtle bg-bg-base/50 text-[11px] text-text-muted overflow-x-auto">
      <span>pk: <code className="font-mono text-text-secondary">{table.partitionKey}</code></span>
      {table.sortKey && <span>sk: <code className="font-mono text-text-secondary">{table.sortKey}</code></span>}
      {table.billingMode && <span className="font-mono">{table.billingMode === 'PAY_PER_REQUEST' ? 'on-demand' : 'provisioned'}</span>}
      {table.itemCount != null && <span>{table.itemCount.toLocaleString()} items</span>}
      {(table.indexes?.length ?? 0) > 0 && (
        <span>{table.indexes!.length} index{table.indexes!.length !== 1 ? 'es' : ''}</span>
      )}
      {table.streamEnabled && (
        <span className="flex items-center gap-1">
          <span className="w-1 h-1 rounded-full bg-success animate-pulse" />
          stream
        </span>
      )}
    </div>
  )
}

function DataTable({ rows, viewMode }: { rows: DataRow[]; viewMode: ViewMode }) {
  const [selectedRow, setSelectedRow] = useState<number | null>(null)

  if (viewMode === 'json') {
    return (
      <div className="h-full overflow-y-auto p-4 space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="rounded-lg border border-border bg-bg-surface p-3">
            <JsonTree data={row} defaultExpanded={false} />
          </div>
        ))}
      </div>
    )
  }

  const cols = rows.length > 0 ? Object.keys(rows[0]) : []

  return (
    <div className="h-full flex overflow-hidden">
      {/* Grid */}
      <div className={`overflow-auto ${selectedRow !== null ? 'flex-1' : 'w-full'}`}>
        <table className="w-full text-xs font-mono">
          <thead className="sticky top-0 bg-bg-elevated border-b border-border z-10">
            <tr>
              {cols.map(col => (
                <th key={col} className="text-left px-3 py-2 text-text-muted font-semibold whitespace-nowrap border-r border-border-subtle last:border-r-0">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                onClick={() => setSelectedRow(selectedRow === i ? null : i)}
                className={`border-b border-border-subtle cursor-pointer transition-colors ${
                  selectedRow === i ? 'bg-primary/8' : 'hover:bg-bg-surface'
                }`}
              >
                {cols.map(col => {
                  const val = row[col]
                  const str = val === null || val === undefined ? '' :
                              typeof val === 'object' ? JSON.stringify(val) : String(val)
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

      {/* Row detail panel */}
      <AnimatePresence>
        {selectedRow !== null && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-l border-border bg-bg-elevated flex-shrink-0 overflow-hidden"
          >
            <div className="w-[280px] h-full overflow-y-auto p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-text-secondary text-xs font-semibold">Row {selectedRow + 1}</span>
                <button onClick={() => setSelectedRow(null)} className="text-text-muted hover:text-text-primary text-xs">✕</button>
              </div>
              <JsonTree data={rows[selectedRow]} defaultExpanded={true} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function Browse({ activeConnection, activeTable, onSelectTable }: BrowseProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [loading] = useState(false)

  if (!activeConnection) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          variant="empty"
          title="No connection selected"
          description="Select a connection from the sidebar to browse your data."
        />
      </div>
    )
  }

  const table = activeConnection.tables?.find(t => t.name === activeTable) ?? null

  // Mock data for now — real impl calls queryTable
  const result: QueryResult | null = activeTable ? {
    rows: mockRows,
    count: mockRows.length,
    scannedCount: mockRows.length,
    rcuConsumed: 0.5,
    executionMs: 34,
  } : null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Table selector tabs */}
      <TableSelector
        conn={activeConnection}
        activeTable={activeTable}
        onSelect={(t) => onSelectTable(activeConnection.id, t)}
      />

      {/* Table meta info */}
      {table && <TableMetaBar table={table} />}

      {/* Toolbar */}
      {activeTable && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle bg-bg-elevated flex-shrink-0">
          <div className="flex-1 flex items-center gap-2">
            <span className="text-text-muted text-xs">
              {result ? `${result.count} items` : ''}
            </span>
            {result?.rcuConsumed != null && <RcuBadge rcu={result.rcuConsumed} />}
            {result?.executionMs != null && (
              <span className="text-text-muted text-xs font-mono">{result.executionMs}ms</span>
            )}
          </div>
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
          <Button variant="secondary" size="xs">↻ Refresh</Button>
          <Button variant="secondary" size="xs">⤓ Export</Button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {!activeTable ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              variant="empty"
              title="Select a table"
              description="Choose a table from the tabs above to start browsing."
            />
          </div>
        ) : loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} height={32} />
            ))}
          </div>
        ) : result ? (
          <DataTable rows={result.rows} viewMode={viewMode} />
        ) : null}
      </div>
    </div>
  )
}

export default Browse
