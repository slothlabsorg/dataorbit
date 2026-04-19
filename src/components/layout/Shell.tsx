import React from 'react'
import type { Screen, DbConnection } from '@/types'
import { Titlebar } from './Titlebar'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'

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
  children: React.ReactNode
}

export function Shell({
  screen, onNavigate, sidebarCollapsed, onToggleSidebar,
  connections, activeConnectionId, activeTable,
  onSelectConnection, onSelectTable, onAddConnection,
  children,
}: ShellProps) {
  const activeConn = connections.find(c => c.id === activeConnectionId) ?? null
  const activeTableMeta = activeConn?.tables?.find(t => t.name === activeTable) ?? null

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Titlebar activeConnection={activeConn} />

      <div className="flex flex-1 overflow-hidden">
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
        />

        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      </div>

      <StatusBar activeConnection={activeConn} activeTable={activeTableMeta} />
    </div>
  )
}

export default Shell
