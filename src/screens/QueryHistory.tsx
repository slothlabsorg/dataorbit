import { useState } from 'react'
import { motion } from 'framer-motion'
import type { HistoryEntry } from '@/types'
import { RcuBadge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatRelative } from '@/lib/time'

interface QueryHistoryProps {
  entries: HistoryEntry[]
  onRunQuery?: (entry: HistoryEntry) => void
  onToggleSave?: (id: string, name?: string) => void
  onDelete?: (id: string) => void
}

const OP_LABELS: Record<string, string> = {
  '=': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥',
  'begins_with': 'begins_with', 'contains': 'contains',
  'exists': 'exists', 'not_exists': 'not_exists', 'between': 'between', 'in': 'in',
}

export function QueryHistory({ entries, onRunQuery, onToggleSave, onDelete }: QueryHistoryProps) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'all' | 'saved'>('all')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')

  const baseEntries = tab === 'saved' ? entries.filter(e => e.isSaved) : entries

  const filtered = baseEntries.filter(e =>
    e.table.toLowerCase().includes(search.toLowerCase()) ||
    e.connectionName.toLowerCase().includes(search.toLowerCase()) ||
    (e.savedName?.toLowerCase().includes(search.toLowerCase()) ?? false)
  )

  function handleSave(id: string) {
    if (saveName.trim()) {
      onToggleSave?.(id, saveName.trim())
      setSavingId(null)
      setSaveName('')
    }
  }

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
      {/* Toolbar: Search + Tabs */}
      <div className="px-4 py-3 border-b border-border-subtle bg-bg-elevated flex-shrink-0 space-y-2">
        <input
          className="field-input w-full"
          placeholder="Search history by table, connection, or saved name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTab('all')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              tab === 'all' ? 'bg-primary/15 text-primary border border-primary/30' : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface'
            }`}
          >
            All ({entries.length})
          </button>
          <button
            onClick={() => setTab('saved')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              tab === 'saved' ? 'bg-warning/15 text-warning border border-warning/30' : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface'
            }`}
          >
            ★ Saved ({entries.filter(e => e.isSaved).length})
          </button>
        </div>
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
                  {/* Action buttons */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* Save/unsave button */}
                    {entry.isSaved ? (
                      <button
                        onClick={() => onToggleSave?.(entry.id)}
                        className="text-[11px] text-warning hover:text-warning/80 font-medium px-1.5 py-0.5 rounded border border-warning/30 bg-warning/8"
                        title="Remove from saved"
                      >
                        ★ Saved
                      </button>
                    ) : savingId === entry.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={saveName}
                          onChange={e => setSaveName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSave(entry.id); if (e.key === 'Escape') { setSavingId(null); setSaveName('') } }}
                          placeholder="Query name…"
                          className="bg-bg-surface border border-primary/40 rounded px-2 py-0.5 text-[11px] outline-none w-28"
                        />
                        <button onClick={() => handleSave(entry.id)} disabled={!saveName.trim()} className="text-[11px] text-primary hover:text-primary/80 disabled:opacity-40">Save</button>
                        <button onClick={() => { setSavingId(null); setSaveName('') }} className="text-[11px] text-text-muted hover:text-text-primary">✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setSavingId(entry.id); setSaveName('') }}
                        className="text-[11px] text-text-muted hover:text-warning font-medium px-1.5 py-0.5 rounded border border-border hover:border-warning/40 transition-colors"
                        title="Save query"
                      >
                        ☆ Save
                      </button>
                    )}
                    {/* Re-run button */}
                    <button
                      onClick={() => onRunQuery?.(entry)}
                      className="text-[11px] text-primary hover:text-primary/80 font-medium px-1.5 py-0.5 rounded border border-primary/30 bg-primary/8 transition-colors"
                    >
                      Run again →
                    </button>
                    {/* Delete button */}
                    <button
                      onClick={() => onDelete?.(entry.id)}
                      className="text-[11px] text-text-muted hover:text-danger font-medium px-1.5 py-0.5 rounded border border-border hover:border-danger/40 transition-colors"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
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
