import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface OldNewsItem {
  id: string
  kind: 'update-available' | 'release' | 'announcement'
  title: string
  body?: string
  date: string
  url?: string
}

interface Props {
  items: OldNewsItem[]
  unreadCount: number
  loading: boolean
  onMarkAllRead: () => void
  // Optional: when the user clicks the "Update now" item we route them to
  // the existing UpdateBanner install flow rather than re-implementing it.
  onTriggerUpdate?: () => void
}

function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return ''
  const diff = Date.now() - ts
  const min = 60_000, hr = 60 * min, day = 24 * hr
  if (diff < min)        return 'just now'
  if (diff < hr)         return `${Math.floor(diff / min)}m ago`
  if (diff < day)        return `${Math.floor(diff / hr)}h ago`
  if (diff < 7 * day)    return `${Math.floor(diff / day)}d ago`
  return new Date(iso).toLocaleDateString()
}

function kindLabel(kind: OldNewsItem['kind']): { label: string; cls: string } {
  switch (kind) {
    case 'update-available': return { label: 'Update',       cls: 'bg-warning/15 text-warning border-warning/30' }
    case 'release':          return { label: 'Release',      cls: 'bg-primary/15 text-primary border-primary/30' }
    case 'announcement':     return { label: 'Announcement', cls: 'bg-bg-surface text-text-secondary border-border' }
  }
}

export function NewsBell({ items, unreadCount, loading, onMarkAllRead, onTriggerUpdate }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Mark-all-read fires once the dropdown has been open for ~600ms — gives
  // the user a moment to glance at the dot before it disappears, but
  // doesn't require an explicit click on every item.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => onMarkAllRead(), 600)
    return () => clearTimeout(t)
  }, [open, onMarkAllRead])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`News${unreadCount ? ` — ${unreadCount} unread` : ''}`}
        title={unreadCount ? `${unreadCount} unread` : 'News'}
        onClick={() => setOpen(o => !o)}
        data-testid="news-bell"
        className="relative p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-surface transition-colors"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
        </svg>
        {unreadCount > 0 && (
          <span
            data-testid="news-bell-dot"
            className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-danger ring-2 ring-bg-base"
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="dropdown"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            data-testid="news-dropdown"
            className="absolute right-0 mt-2 w-[360px] z-50 rounded-lg border border-border bg-bg-elevated shadow-2xl overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">What's new</span>
              {unreadCount > 0 && (
                <span className="text-[10px] text-text-muted">{unreadCount} unread</span>
              )}
            </div>

            <div className="max-h-[420px] overflow-y-auto">
              {loading && items.length === 0 && (
                <div className="px-3 py-6 text-center text-text-muted text-xs">Loading…</div>
              )}
              {!loading && items.length === 0 && (
                <div className="px-3 py-6 text-center text-text-muted text-xs">
                  No news yet. New releases will appear here.
                </div>
              )}
              {items.map(item => {
                const k = kindLabel(item.kind)
                const clickable = item.kind === 'update-available' || item.url
                const onClick = () => {
                  if (item.kind === 'update-available' && onTriggerUpdate) {
                    onTriggerUpdate()
                    setOpen(false)
                  } else if (item.url) {
                    window.open(item.url, '_blank', 'noopener,noreferrer')
                  }
                }
                return (
                  <div
                    key={item.id}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? onClick : undefined}
                    onKeyDown={clickable ? (e => { if (e.key === 'Enter') onClick() }) : undefined}
                    data-testid={`news-item-${item.kind}`}
                    className={`px-3 py-2.5 border-b border-border-subtle last:border-b-0 ${
                      clickable ? 'cursor-pointer hover:bg-bg-surface' : ''
                    } transition-colors`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${k.cls}`}>
                        {k.label}
                      </span>
                      <span className="text-[10px] text-text-muted ml-auto">{timeAgo(item.date)}</span>
                    </div>
                    <p className="text-[12px] font-semibold text-text-primary leading-tight mb-0.5">{item.title}</p>
                    {item.body && (
                      <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-3">
                        {item.body.split('\n')[0]}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
