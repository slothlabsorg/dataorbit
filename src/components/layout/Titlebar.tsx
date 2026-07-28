import React from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { DbConnection } from '@/types'
import { isMac, needsWindowControls } from '@/lib/platform'
import { NewsBell } from '@/components/ui/NewsBell'

type BellItem = { id: string; kind: 'update-available' | 'release' | 'announcement'; title: string; body?: string; date: string; url?: string }

// `data-tauri-drag-region` alone doesn't reliably move the window on Tauri 2
// macOS with titleBarStyle: Overlay — startDragging() is the documented path.
function startDragOnMouseDown(e: React.MouseEvent) {
  if (e.button !== 0) return
  const target = e.target as HTMLElement
  if (target.closest('button, a, input, select, textarea, [role="button"]')) return
  try {
    void getCurrentWindow().startDragging()
  } catch {
    /* not in Tauri runtime */
  }
}

interface TitlebarProps {
  activeConnection?: DbConnection | null
  bellItems?: BellItem[]
  newsUnread?: number
  onNewsMarkRead?: () => void
  onTriggerUpdate?: () => void
  onNavigateToNews?: () => void
}

function AppLogo() {
  const [failed, setFailed] = React.useState(false)
  if (failed) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-primary">
        <circle cx="12" cy="12" r="3" fill="currentColor"/>
        <ellipse cx="12" cy="12" rx="10" ry="4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeDasharray="3 2"/>
      </svg>
    )
  }
  return (
    <img
      src="/images/dataorbit-icon.png"
      alt="DataOrbit"
      width={22} height={22}
      className="rounded-md object-cover flex-shrink-0"
      onError={() => setFailed(true)}
    />
  )
}

function WindowControls() {
  const min   = () => { void getCurrentWindow().minimize().catch(() => {}) }
  const max   = () => { void getCurrentWindow().toggleMaximize().catch(() => {}) }
  const close = () => { void getCurrentWindow().close().catch(() => {}) }
  return (
    <div className="flex items-center ml-3 -mr-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button onClick={min} aria-label="Minimize"
        className="w-10 h-12 flex items-center justify-center text-text-muted hover:bg-bg-surface hover:text-text-primary transition-colors">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M0 5h10" stroke="currentColor" strokeWidth="1"/></svg>
      </button>
      <button onClick={max} aria-label="Maximize"
        className="w-10 h-12 flex items-center justify-center text-text-muted hover:bg-bg-surface hover:text-text-primary transition-colors">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1"/></svg>
      </button>
      <button onClick={close} aria-label="Close"
        className="w-10 h-12 flex items-center justify-center text-text-muted hover:bg-danger hover:text-white transition-colors">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1"/></svg>
      </button>
    </div>
  )
}

export function Titlebar({ activeConnection, bellItems = [], newsUnread = 0, onNewsMarkRead, onTriggerUpdate, onNavigateToNews }: TitlebarProps) {
  return (
    <div
      data-tauri-drag-region
      onMouseDown={startDragOnMouseDown}
      className="h-12 flex items-center px-4 border-b border-border-subtle bg-bg-base flex-shrink-0 select-none"
      style={isMac ? { paddingLeft: '80px' } : undefined}
    >
      {/* Left — window controls on Linux/Windows */}
      {needsWindowControls && <WindowControls />}

      {/* Center — brand */}
      <div className="flex-1 flex items-center justify-center gap-2">
        <AppLogo />
        <span className="font-display font-bold text-text-primary text-sm tracking-wide">DataOrbit</span>
      </div>

      {/* Right — news bell + active connection */}
      <div className="flex items-center gap-2">
        <NewsBell
          items={bellItems}
          unreadCount={newsUnread}
          loading={false}
          onMarkAllRead={onNewsMarkRead ?? (() => {})}
          onTriggerUpdate={onTriggerUpdate}
          onNavigateToNews={onNavigateToNews}
        />

        <div className="flex items-center gap-3">
          {activeConnection ? (
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${
                activeConnection.status === 'connected'   ? 'bg-success' :
                activeConnection.status === 'connecting'  ? 'bg-warning animate-pulse' :
                activeConnection.status === 'error'       ? 'bg-danger' :
                'bg-text-muted'
              }`} />
              <span className="text-text-muted text-xs truncate max-w-[140px]">{activeConnection.name}</span>
            </div>
          ) : (
            <span className="text-text-muted text-xs">No connection</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default Titlebar
