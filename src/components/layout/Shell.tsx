import React, { useState, useCallback } from 'react'
import type { Screen, DbConnection } from '@/types'
import { Titlebar } from './Titlebar'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'

type BellItem = { id: string; kind: 'update-available' | 'release' | 'announcement'; title: string; body?: string; date: string; url?: string }

interface ShellProps {
  screen: Screen
  onNavigate: (screen: Screen) => void
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  connections: DbConnection[]
  activeConnectionId: string | null
  activeTable: string | null
  onSelectConnection: (id: string) => void
  onSelectTable: (connId: string, table: string) => void
  onAddConnection: () => void
  onDeleteConnection: (id: string) => void
  newsUnread?: number
  monitorCount?: number
  bellItems?: BellItem[]
  onNewsMarkRead?: () => void
  onTriggerUpdate?: () => void
  children: React.ReactNode
}

export function Shell({
  screen, onNavigate, sidebarCollapsed, onToggleSidebar,
  connections, activeConnectionId, activeTable,
  onSelectConnection, onSelectTable, onAddConnection, onDeleteConnection,
  newsUnread, monitorCount, bellItems, onNewsMarkRead, onTriggerUpdate,
  children,
}: ShellProps) {
  const activeConn = connections.find(c => c.id === activeConnectionId) ?? null
  const activeTableMeta = activeConn?.tables?.find(t => t.name === activeTable) ?? null

  // ── Resizable sidebar ───────────────────────────────────────────────────────
  const [sidebarW, setSidebarW] = useState(() => {
    try { return Number(localStorage.getItem('dataorbit.sidebarWidth')) || 200 } catch { return 200 }
  })
  const MIN_W = 160, MAX_W = 400

  const handleSidebarDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarW
    const move = (ev: MouseEvent) => {
      const next = Math.max(MIN_W, Math.min(MAX_W, startW + ev.clientX - startX))
      setSidebarW(next)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      try { localStorage.setItem('dataorbit.sidebarWidth', String(sidebarW)) } catch {}
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [sidebarW])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Titlebar
        activeConnection={activeConn}
        bellItems={bellItems}
        newsUnread={newsUnread}
        onNewsMarkRead={onNewsMarkRead}
        onTriggerUpdate={onTriggerUpdate}
      />

      <div className="flex flex-1 overflow-hidden">
        <div style={{ width: sidebarCollapsed ? 48 : sidebarW, flexShrink: 0, transition: 'width 0.15s ease' }}>
          <Sidebar
            screen={screen}
            onNavigate={onNavigate}
            collapsed={sidebarCollapsed}
            onToggleCollapse={onToggleSidebar}
            connections={connections}
            activeConnectionId={activeConnectionId}
            activeTable={activeTable}
            onSelectConnection={onSelectConnection}
            onSelectTable={onSelectTable}
            onAddConnection={onAddConnection}
            onDeleteConnection={onDeleteConnection}
            newsUnread={newsUnread}
            monitorCount={monitorCount}
          />
        </div>

        {/* Drag handle */}
        {!sidebarCollapsed && (
          <div
            onMouseDown={handleSidebarDrag}
            className="w-1 flex-shrink-0 cursor-col-resize hover:bg-primary/40 transition-colors bg-transparent"
            style={{ userSelect: 'none' }}
          />
        )}

        <div className="flex-1 min-w-0 overflow-hidden">
          {children}
        </div>
      </div>

      <StatusBar activeConnection={activeConn} activeTable={activeTableMeta} />
    </div>
  )
}

export default Shell
