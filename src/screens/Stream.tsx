import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { DbConnection, StreamEvent } from '@/types'
import { EmptyState } from '@/components/ui/EmptyState'
import { EventTypeBadge } from '@/components/ui/Badge'
import { JsonTree } from '@/components/ui/JsonTree'
import Button from '@/components/ui/Button'
import { formatRelative } from '@/lib/time'
import { mockStreamEvents } from '@/mock/data'

interface StreamProps {
  activeConnection: DbConnection | null
  activeTable: string | null
}

export function Stream({ activeConnection, activeTable }: StreamProps) {
  const [events, setEvents]   = useState<StreamEvent[]>([])
  const [running, setRunning] = useState(false)
  const [selected, setSelected] = useState<StreamEvent | null>(null)
  const [filter, setFilter]   = useState<'' | 'INSERT' | 'MODIFY' | 'REMOVE'>('')
  const [paused, setPaused]   = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  function startStream() {
    setRunning(true)
    setPaused(false)
    // Seed with mock events
    setEvents(mockStreamEvents)
    // Simulate new events arriving
    let idx = 0
    timerRef.current = setInterval(() => {
      if (paused) return
      idx++
      const mock = mockStreamEvents[idx % mockStreamEvents.length]
      setEvents(prev => [{
        ...mock,
        id: `ev-live-${Date.now()}`,
        time: new Date(),
      }, ...prev].slice(0, 200)) // cap at 200 events
    }, 2500)
  }

  function stopStream() {
    setRunning(false)
    if (timerRef.current) clearInterval(timerRef.current)
  }

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  if (!activeConnection) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState variant="stream" title="No connection selected" description="Select a DynamoDB connection to tail its streams." />
      </div>
    )
  }

  if (!activeTable) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState variant="stream" title="Select a table" description="Choose a table with Streams enabled from the sidebar." />
      </div>
    )
  }

  const table = activeConnection.tables?.find(t => t.name === activeTable)
  if (!table?.streamEnabled && !running) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          variant="stream"
          title="Streams not enabled"
          description={`The table "${activeTable}" does not have DynamoDB Streams enabled. Enable it in the AWS console first.`}
        />
      </div>
    )
  }

  const filtered = filter ? events.filter(e => e.type === filter) : events

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border-subtle bg-bg-elevated flex-shrink-0">
        <div className="flex items-center gap-2">
          {!running ? (
            <Button variant="primary" size="sm" onClick={startStream}>▶ Start stream</Button>
          ) : (
            <>
              <Button variant="danger" size="sm" onClick={stopStream}>■ Stop</Button>
              <Button variant="secondary" size="sm" onClick={() => setPaused(p => !p)}>
                {paused ? '▶ Resume' : '⏸ Pause'}
              </Button>
            </>
          )}
        </div>

        {running && (
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${paused ? 'bg-warning' : 'bg-success animate-pulse'}`} />
            <span className={`text-xs ${paused ? 'text-warning' : 'text-success'}`}>
              {paused ? 'Paused' : 'Live'}
            </span>
          </div>
        )}

        <span className="text-text-muted text-xs font-mono">{activeTable}</span>

        <div className="ml-auto flex items-center gap-1">
          {(['', 'INSERT', 'MODIFY', 'REMOVE'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                filter === f ? 'bg-bg-overlay text-text-primary' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {f || 'All'}
            </button>
          ))}
        </div>

        {events.length > 0 && (
          <Button variant="ghost" size="xs" onClick={() => setEvents([])}>Clear</Button>
        )}

        <span className="text-text-muted text-xs">{filtered.length} events</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Event list */}
        <div className={`overflow-y-auto ${selected ? 'flex-1' : 'w-full'}`}>
          {!running && events.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-text-muted">
                <div className="text-4xl mb-3 opacity-30">≋</div>
                <p className="text-sm">Start the stream to see live changes</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-text-muted text-sm">No {filter} events yet</div>
          ) : (
            <AnimatePresence initial={false}>
              {filtered.map(ev => (
                <motion.div
                  key={ev.id}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setSelected(selected?.id === ev.id ? null : ev)}
                  className={`flex items-start gap-3 px-4 py-2.5 border-b border-border-subtle cursor-pointer transition-colors ${
                    selected?.id === ev.id ? 'bg-primary/8' : 'hover:bg-bg-surface'
                  }`}
                >
                  <EventTypeBadge type={ev.type} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-text-secondary text-xs font-mono font-medium truncate">
                        {ev.newItem
                          ? Object.entries(ev.newItem).slice(0, 2).map(([k, v]) => `${k}:${v}`).join(' · ')
                          : ev.oldItem
                          ? Object.entries(ev.oldItem).slice(0, 2).map(([k, v]) => `${k}:${v}`).join(' · ')
                          : ev.id
                        }
                      </span>
                    </div>
                    {ev.diff && (
                      <div className="flex items-center gap-2 mt-0.5">
                        {Object.entries(ev.diff).map(([k, { old: o, new: n }]) => (
                          <span key={k} className="text-[11px] text-text-muted font-mono">
                            {k}: <span className="text-danger">{String(o)}</span>→<span className="text-success">{String(n)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-text-muted text-[11px] font-mono flex-shrink-0">{formatRelative(ev.time)}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {selected && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 300, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-l border-border bg-bg-elevated flex-shrink-0 overflow-hidden"
            >
              <div className="w-[300px] h-full overflow-y-auto p-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <EventTypeBadge type={selected.type} />
                    <span className="text-text-muted text-xs">{formatRelative(selected.time)}</span>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-text-muted hover:text-text-primary text-xs">✕</button>
                </div>

                {selected.type === 'MODIFY' && selected.diff && (
                  <div className="mb-3">
                    <p className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-1.5">Changes</p>
                    <div className="space-y-1">
                      {Object.entries(selected.diff).map(([k, { old: o, new: n }]) => (
                        <div key={k} className="flex items-center gap-1.5 text-xs font-mono">
                          <span className="text-text-secondary">{k}:</span>
                          <span className="text-danger line-through opacity-70">{String(o)}</span>
                          <span className="text-text-muted">→</span>
                          <span className="text-success">{String(n)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selected.newItem && (
                  <div className="mb-3">
                    <p className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-1.5">
                      {selected.type === 'MODIFY' ? 'New image' : 'Item'}
                    </p>
                    <JsonTree data={selected.newItem} defaultExpanded={true} />
                  </div>
                )}
                {selected.oldItem && (
                  <div>
                    <p className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-1.5">
                      {selected.type === 'MODIFY' ? 'Old image' : 'Deleted item'}
                    </p>
                    <JsonTree data={selected.oldItem} defaultExpanded={true} />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default Stream
