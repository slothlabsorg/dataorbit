import { useState, useEffect, useRef, useCallback } from 'react'
import type { DbConnection, QueryDef } from '@/types'
import { api } from '@/lib/tauri'
import { EmptyState } from '@/components/ui/EmptyState'

export interface MonitoredRow {
  id: string                    // unique identifier for this monitor
  connectionId: string
  tableName: string
  pkField: string
  pkValue: string
  skField?: string
  skValue?: string
  indexName?: string
  region?: string
}

interface RowVersion {
  timestamp: number
  data: Record<string, unknown>
}

interface RowState {
  monitor: MonitoredRow
  versions: RowVersion[]
  polling: boolean
  error: string | null
  intervalSecs: number
}

function computeDiff(
  prev: Record<string, unknown>,
  curr: Record<string, unknown>,
): { key: string; prev: unknown; curr: unknown; status: 'added' | 'removed' | 'changed' | 'same' }[] {
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(curr)])
  return [...allKeys].map(key => {
    if (!(key in prev)) return { key, prev: undefined, curr: curr[key], status: 'added' as const }
    if (!(key in curr)) return { key, prev: prev[key], curr: undefined, status: 'removed' as const }
    const ps = JSON.stringify(prev[key])
    const cs = JSON.stringify(curr[key])
    if (ps !== cs) return { key, prev: prev[key], curr: curr[key], status: 'changed' as const }
    return { key, prev: prev[key], curr: curr[key], status: 'same' as const }
  }).sort((a, b) => {
    const order = { changed: 0, added: 1, removed: 2, same: 3 }
    return order[a.status] - order[b.status]
  })
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function DiffView({ prev, curr }: { prev: Record<string, unknown>; curr: Record<string, unknown> }) {
  const diff = computeDiff(prev, curr)
  const changes = diff.filter(d => d.status !== 'same')
  const same    = diff.filter(d => d.status === 'same')
  const [showAll, setShowAll] = useState(false)

  return (
    <div className="font-mono text-[11px] space-y-0.5">
      {changes.map(d => (
        <div key={d.key} className={`flex gap-2 px-2 py-0.5 rounded ${
          d.status === 'added'   ? 'bg-success/10 text-success' :
          d.status === 'removed' ? 'bg-danger/10 text-danger' :
          'bg-warning/10 text-warning'
        }`}>
          <span className="w-3 flex-shrink-0">
            {d.status === 'added' ? '+' : d.status === 'removed' ? '-' : '~'}
          </span>
          <span className="text-text-secondary flex-shrink-0 min-w-[100px] truncate">{d.key}:</span>
          <span className="flex-1 min-w-0">
            {d.status === 'changed' ? (
              <>
                <span className="line-through opacity-50 mr-2">{formatVal(d.prev)}</span>
                <span>{formatVal(d.curr)}</span>
              </>
            ) : (
              formatVal(d.status === 'removed' ? d.prev : d.curr)
            )}
          </span>
        </div>
      ))}
      {same.length > 0 && (
        <button
          onClick={() => setShowAll(s => !s)}
          className="text-text-muted hover:text-text-secondary transition-colors w-full text-left px-2 py-0.5"
        >
          {showAll ? '▾' : '▸'} {same.length} unchanged field{same.length !== 1 ? 's' : ''}
        </button>
      )}
      {showAll && same.map(d => (
        <div key={d.key} className="flex gap-2 px-2 py-0.5 text-text-muted opacity-60">
          <span className="w-3 flex-shrink-0"> </span>
          <span className="flex-shrink-0 min-w-[100px] truncate">{d.key}:</span>
          <span className="flex-1 min-w-0 truncate">{formatVal(d.curr)}</span>
        </div>
      ))}
    </div>
  )
}

function RowMonitor({
  state,
  onRemove,
  onUpdateInterval,
}: {
  state: RowState
  onRemove: () => void
  onUpdateInterval: (secs: number) => void
}) {
  const { monitor, versions, polling, error, intervalSecs } = state

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle flex-shrink-0 bg-bg-elevated">
        <div className="flex items-center gap-1.5">
          {polling && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
            </span>
          )}
          <span className="text-xs font-semibold text-text-primary font-mono">{monitor.tableName}</span>
        </div>
        <span className="text-[11px] text-text-muted font-mono">
          {monitor.pkField}={monitor.pkValue.slice(0, 40)}{monitor.pkValue.length > 40 ? '…' : ''}
          {monitor.skField && ` / ${monitor.skField}=${monitor.skValue?.slice(0, 30)}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={intervalSecs}
            onChange={e => onUpdateInterval(Number(e.target.value))}
            className="text-[10px] bg-bg-surface border border-border rounded px-1.5 py-0.5 text-text-muted"
          >
            <option value={1}>1s</option>
            <option value={2}>2s</option>
            <option value={5}>5s</option>
            <option value={10}>10s</option>
            <option value={30}>30s</option>
          </select>
          <span className="text-[10px] text-text-muted">{versions.length} version{versions.length !== 1 ? 's' : ''}</span>
          <button onClick={onRemove} className="text-text-muted hover:text-danger transition-colors text-xs">✕</button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-2 px-3 py-2 rounded border border-danger/30 bg-danger/5 text-[11px] text-danger flex-shrink-0">
          {error}
        </div>
      )}

      {/* Versions timeline */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {versions.length === 0 && (
          <div className="text-center text-text-muted py-8">
            <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-2" />
            <p className="text-xs">Waiting for first poll…</p>
          </div>
        )}

        {versions.slice().reverse().map((ver, i, arr) => {
          const prevVer = arr[i + 1]
          const isLatest = i === 0
          const time = new Date(ver.timestamp).toLocaleTimeString()

          return (
            <div key={ver.timestamp} className={`rounded-xl border p-3 ${
              isLatest ? 'border-primary/30 bg-primary/5' : 'border-border-subtle bg-bg-elevated'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] font-bold uppercase tracking-wide ${
                  isLatest ? 'text-primary' : 'text-text-muted'
                }`}>
                  {isLatest ? '● LATEST' : `v${arr.length - i}`}
                </span>
                <span className="text-[10px] text-text-muted font-mono">{time}</span>
              </div>
              {prevVer ? (
                <DiffView prev={prevVer.data} curr={ver.data} />
              ) : (
                <div className="font-mono text-[11px] space-y-0.5">
                  {Object.entries(ver.data).slice(0, 8).map(([k, v]) => (
                    <div key={k} className="flex gap-2 px-2 py-0.5 text-text-muted">
                      <span className="flex-shrink-0 min-w-[100px] truncate">{k}:</span>
                      <span className="flex-1 min-w-0 truncate text-text-secondary">{formatVal(v)}</span>
                    </div>
                  ))}
                  {Object.keys(ver.data).length > 8 && (
                    <p className="text-[10px] text-text-muted px-2">+{Object.keys(ver.data).length - 8} more fields</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface LiveMonitorProps {
  activeConnection: DbConnection | null
  monitoredRows: MonitoredRow[]
  onRemoveRow: (id: string) => void
}

export function LiveMonitor({ activeConnection, monitoredRows, onRemoveRow }: LiveMonitorProps) {
  const [states, setStates] = useState<Map<string, RowState>>(new Map())
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const intervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

  // Sync monitoredRows → states
  useEffect(() => {
    setStates(prev => {
      const next = new Map(prev)
      // Add new
      for (const row of monitoredRows) {
        if (!next.has(row.id)) {
          next.set(row.id, { monitor: row, versions: [], polling: false, error: null, intervalSecs: 2 })
        }
      }
      // Remove dropped
      for (const id of next.keys()) {
        if (!monitoredRows.find(r => r.id === id)) next.delete(id)
      }
      return next
    })
    if (monitoredRows.length > 0 && !activeTab) {
      setActiveTab(monitoredRows[0].id)
    }
  }, [monitoredRows]) // eslint-disable-line react-hooks/exhaustive-deps

  const poll = useCallback(async (rowId: string) => {
    setStates(prev => {
      const state = prev.get(rowId)
      if (!state || !activeConnection) return prev
      const { monitor } = state
      const filters = [
        { id: 'pk', field: monitor.pkField, op: '=' as const, value: monitor.pkValue },
        ...(monitor.skField && monitor.skValue
          ? [{ id: 'sk', field: monitor.skField, op: '=' as const, value: monitor.skValue }]
          : []),
      ]
      // Fire off poll asynchronously
      api.queryTable({
        connectionId:      monitor.connectionId,
        table:             monitor.tableName,
        partitionKeyField: monitor.pkField,
        sortKeyField:      monitor.skField,
        filters,
        limit:             1,
      } as QueryDef).then(result => {
        if (result.rows.length === 0) return
        const data = result.rows[0] as Record<string, unknown>
        setStates(p => {
          const s = p.get(rowId)
          if (!s) return p
          const next = new Map(p)
          const lastData = s.versions[s.versions.length - 1]?.data
          if (lastData && JSON.stringify(lastData) === JSON.stringify(data)) return p
          next.set(rowId, { ...s, versions: [...s.versions.slice(-49), { timestamp: Date.now(), data }], error: null })
          return next
        })
      }).catch(e => {
        setStates(p => {
          const s = p.get(rowId)
          if (!s) return p
          const next = new Map(p)
          next.set(rowId, { ...s, error: e instanceof Error ? e.message : String(e) })
          return next
        })
      })
      return prev
    })
  }, [activeConnection])

  // Start/stop polling when monitoredRows change
  useEffect(() => {
    // Start polling for new rows
    for (const row of monitoredRows) {
      if (!intervalsRef.current.has(row.id)) {
        poll(row.id)
        const state = states.get(row.id)
        const secs = state?.intervalSecs ?? 2
        const iv = setInterval(() => poll(row.id), secs * 1000)
        intervalsRef.current.set(row.id, iv)
        setStates(prev => {
          const s = prev.get(row.id); if (!s) return prev
          const next = new Map(prev); next.set(row.id, { ...s, polling: true }); return next
        })
      }
    }
    // Stop polling for removed rows
    const activeIds = new Set(monitoredRows.map(r => r.id))
    for (const [id, iv] of intervalsRef.current) {
      if (!activeIds.has(id)) {
        clearInterval(iv)
        intervalsRef.current.delete(id)
      }
    }
  }, [monitoredRows, poll, states])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const iv of intervalsRef.current.values()) clearInterval(iv)
    }
  }, [])

  function handleUpdateInterval(id: string, secs: number) {
    const iv = intervalsRef.current.get(id)
    if (iv) { clearInterval(iv); intervalsRef.current.delete(id) }
    const newIv = setInterval(() => poll(id), secs * 1000)
    intervalsRef.current.set(id, newIv)
    setStates(prev => {
      const s = prev.get(id); if (!s) return prev
      const next = new Map(prev); next.set(id, { ...s, intervalSecs: secs }); return next
    })
  }

  if (monitoredRows.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          variant="empty"
          title="No rows being monitored"
          description="Right-click any row in Browse or Explore and select Watch Live to start monitoring it."
        />
      </div>
    )
  }

  const activeState = activeTab ? states.get(activeTab) : null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-border-subtle bg-bg-elevated overflow-x-auto flex-shrink-0">
        {monitoredRows.map(row => {
          const s = states.get(row.id)
          const hasChanges = (s?.versions.length ?? 0) > 1
          return (
            <button
              key={row.id}
              onClick={() => setActiveTab(row.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-mono border-b-2 transition-colors whitespace-nowrap ${
                activeTab === row.id ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'
              }`}
            >
              {s?.polling && (
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse flex-shrink-0" />
              )}
              {row.tableName.split('-').pop()}
              <span className="text-[9px] text-text-muted">/{row.pkValue.slice(0, 12)}</span>
              {hasChanges && (
                <span className="w-1.5 h-1.5 rounded-full bg-warning flex-shrink-0" title="Has changes" />
              )}
              <button
                onClick={e => { e.stopPropagation(); onRemoveRow(row.id) }}
                className="ml-1 text-text-muted hover:text-danger transition-colors"
              >×</button>
            </button>
          )
        })}
      </div>

      {/* Active monitor */}
      <div className="flex-1 overflow-hidden">
        {activeState ? (
          <RowMonitor
            state={activeState}
            onRemove={() => onRemoveRow(activeTab!)}
            onUpdateInterval={secs => handleUpdateInterval(activeTab!, secs)}
          />
        ) : null}
      </div>
    </div>
  )
}

export default LiveMonitor
