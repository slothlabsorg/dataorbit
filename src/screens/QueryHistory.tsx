import { useState } from 'react'
import { motion } from 'framer-motion'
import type { HistoryEntry } from '@/types'
import { RcuBadge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatRelative } from '@/lib/time'
import { mockHistory } from '@/mock/data'

interface QueryHistoryProps {
  onRunQuery?: (entry: HistoryEntry) => void
}

const OP_LABELS: Record<string, string> = {
  '=': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥',
  'begins_with': 'begins_with', 'contains': 'contains',
  'exists': 'exists', 'not_exists': 'not_exists', 'between': 'between', 'in': 'in',
}

export function QueryHistory({ onRunQuery }: QueryHistoryProps) {
  const [entries] = useState<HistoryEntry[]>(mockHistory)
  const [search, setSearch] = useState('')

  const filtered = entries.filter(e =>
    e.table.toLowerCase().includes(search.toLowerCase()) ||
    e.connectionName.toLowerCase().includes(search.toLowerCase()) ||
    e.savedName?.toLowerCase().includes(search.toLowerCase())
  )

  if (entries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          variant="empty"
          title="No query history yet"
          description="Run a query in Explore and it will appear here."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar */}
      <div className="px-4 py-3 border-b border-border-subtle bg-bg-elevated flex-shrink-0">
        <input
          className="field-input"
          placeholder="Search history…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-sm">No results</div>
        ) : (
          filtered.map((entry, i) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="px-4 py-3 border-b border-border-subtle hover:bg-bg-surface transition-colors group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {/* Title row */}
                  <div className="flex items-center gap-2 mb-0.5">
                    {entry.isSaved && <span className="text-warning text-xs">★</span>}
                    <span className="text-text-primary text-sm font-medium truncate">
                      {entry.savedName ?? `${entry.connectionName} / ${entry.table}`}
                    </span>
                  </div>

                  {/* Connection + table */}
                  {entry.savedName && (
                    <p className="text-text-muted text-xs font-mono mb-1">
                      {entry.connectionName} · {entry.table}
                    </p>
                  )}

                  {/* Filters */}
                  {entry.filters.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {entry.filters.map(f => (
                        <span key={f.id} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-bg-surface2 border border-border-subtle text-[11px] font-mono text-text-secondary">
                          {f.field} {OP_LABELS[f.op] ?? f.op} {f.op !== 'exists' && f.op !== 'not_exists' ? f.value : ''}
                          {f.op === 'between' && f.valueEnd ? ` → ${f.valueEnd}` : ''}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-text-muted text-xs italic">Full scan (no filters)</span>
                  )}

                  {/* Stats */}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-text-muted text-[11px]">
                      {entry.result.count} rows / {entry.result.scannedCount} scanned
                    </span>
                    {entry.result.rcuConsumed != null && <RcuBadge rcu={entry.result.rcuConsumed} />}
                    <span className="text-text-muted text-[11px] font-mono">{entry.result.executionMs}ms</span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <span className="text-text-muted text-[11px]">{formatRelative(entry.time)}</span>
                  <button
                    onClick={() => onRunQuery?.(entry)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-primary hover:text-primary/80 font-medium"
                  >
                    Run again →
                  </button>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  )
}

export default QueryHistory
