import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Screen, DbConnection, DbType } from '@/types'
import { StatusDot } from '@/components/ui/Badge'

interface SidebarProps {
  screen: Screen
  onNavigate: (screen: Screen) => void
  collapsed: boolean
  onToggleCollapse: () => void
  connections: DbConnection[]
  activeConnectionId?: string | null
  activeTable?: string | null
  onSelectConnection: (id: string) => void
  onSelectTable: (connId: string, table: string) => void
  onAddConnection: () => void
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconDb({ type }: { type: DbType }) {
  const colors: Record<DbType, string> = {
    dynamodb:    'text-warning',
    influxdb:    'text-info',
    timescaledb: 'text-success',
    cassandra:   'text-danger',
    scylladb:    'text-accent',
  }
  return (
    <svg className={`w-3.5 h-3.5 ${colors[type]}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  )
}

function IconTable() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M3 9h18M3 15h18M9 3v18"/>
    </svg>
  )
}

function IconPlus() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  )
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )
}

function IconSettings() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  )
}

function IconBook() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
    </svg>
  )
}

function IconHeart() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
    </svg>
  )
}

function IconCollapse({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  )
}

// ── Connection tree item ───────────────────────────────────────────────────────

function ConnectionItem({
  conn,
  isActive,
  activeTable,
  collapsed,
  onSelect,
  onSelectTable,
}: {
  conn: DbConnection
  isActive: boolean
  activeTable?: string | null
  collapsed: boolean
  onSelect: () => void
  onSelectTable: (table: string) => void
}) {
  const [open, setOpen] = useState(isActive)
  const hasTables = (conn.tables?.length ?? 0) > 0

  return (
    <div>
      <button
        onClick={() => {
          onSelect()
          if (hasTables) setOpen(o => !o)
        }}
        className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md transition-colors text-left ${
          isActive
            ? 'bg-primary/10 text-text-primary'
            : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface'
        }`}
        style={{ width: collapsed ? '36px' : 'calc(100% - 8px)', margin: '0 4px' }}
        title={collapsed ? conn.name : undefined}
      >
        <span className="flex-shrink-0"><IconDb type={conn.dbType} /></span>
        {!collapsed && (
          <>
            <span className="flex-1 text-xs font-medium truncate">{conn.name}</span>
            <StatusDot status={conn.status} />
            {hasTables && (
              <span className="flex-shrink-0 text-text-muted ml-0.5">
                <IconChevron open={open} />
              </span>
            )}
          </>
        )}
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && open && hasTables && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="ml-4 pl-2 border-l border-border-subtle py-0.5 space-y-0.5">
              {conn.tables!.map(t => (
                <button
                  key={t.name}
                  onClick={() => onSelectTable(t.name)}
                  className={`flex items-center gap-1.5 w-full px-2 py-1 rounded transition-colors text-left ${
                    activeTable === t.name && isActive
                      ? 'bg-primary/8 text-primary'
                      : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface'
                  }`}
                >
                  <IconTable />
                  <span className="text-[11px] font-mono truncate">{t.name}</span>
                  {t.streamEnabled && (
                    <span className="ml-auto w-1 h-1 rounded-full bg-success flex-shrink-0" title="Streams enabled" />
                  )}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Nav items ─────────────────────────────────────────────────────────────────

function IconHome() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )
}

function IconBrowse() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M3 9h18M9 21V9"/>
    </svg>
  )
}

function IconExplore() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      <line x1="11" y1="8" x2="11" y2="14"/>
      <line x1="8" y1="11" x2="14" y2="11"/>
    </svg>
  )
}

function IconStream() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  )
}

function IconHistory() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="12 8 12 12 14 14"/>
      <path d="M3.05 11a9 9 0 11.5 4m-.5-4v-4h4"/>
    </svg>
  )
}

const topNav = [
  { id: 'home'    as Screen, label: 'Home',    icon: <IconHome /> },
  { id: 'browse'  as Screen, label: 'Browse',  icon: <IconBrowse /> },
  { id: 'explore' as Screen, label: 'Explore', icon: <IconExplore /> },
  { id: 'stream'  as Screen, label: 'Stream',  icon: <IconStream /> },
  { id: 'history' as Screen, label: 'History', icon: <IconHistory /> },
]

const bottomNav = [
  { id: 'settings' as Screen, label: 'Settings', icon: <IconSettings /> },
  { id: 'docs'     as Screen, label: 'Docs',     icon: <IconBook /> },
  { id: 'support'  as Screen, label: 'Support',  icon: <IconHeart /> },
]

// ── Sidebar ────────────────────────────────────────────────────────────────────

export function Sidebar({
  screen, onNavigate, collapsed, onToggleCollapse,
  connections, activeConnectionId, activeTable,
  onSelectConnection, onSelectTable, onAddConnection,
}: SidebarProps) {
  const w = collapsed ? 48 : 200

  return (
    <motion.div
      className="flex flex-col h-full bg-bg-elevated border-r border-border flex-shrink-0 overflow-hidden"
      animate={{ width: w }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Top nav */}
      <div className="py-2 border-b border-border-subtle flex-shrink-0">
        {topNav.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex items-center gap-3 w-full transition-colors rounded-lg mx-1 px-3 py-1.5 ${
              screen === item.id
                ? 'bg-primary/10 text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface'
            }`}
            style={{ width: 'calc(100% - 8px)' }}
            title={collapsed ? item.label : undefined}
          >
            <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{item.icon}</span>
            {!collapsed && <span className="text-xs font-medium whitespace-nowrap">{item.label}</span>}
          </button>
        ))}
      </div>

      {/* Connections section */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 min-h-0">
        {/* Header */}
        {!collapsed && (
          <div className="flex items-center justify-between px-3 mb-1">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Connections</span>
            <button
              onClick={onAddConnection}
              className="text-text-muted hover:text-primary transition-colors"
              title="Add connection"
            >
              <IconPlus />
            </button>
          </div>
        )}
        {collapsed && (
          <div className="flex justify-center mb-1">
            <button
              onClick={onAddConnection}
              className="p-1.5 text-text-muted hover:text-primary transition-colors rounded-md hover:bg-bg-surface"
              title="Add connection"
            >
              <IconPlus />
            </button>
          </div>
        )}

        {/* Connection list */}
        <div className="space-y-0.5 px-1">
          {connections.map(conn => (
            <ConnectionItem
              key={conn.id}
              conn={conn}
              isActive={conn.id === activeConnectionId}
              activeTable={activeTable}
              collapsed={collapsed}
              onSelect={() => onSelectConnection(conn.id)}
              onSelectTable={(t) => onSelectTable(conn.id, t)}
            />
          ))}
        </div>
      </div>

      {/* Bottom nav */}
      <div className="py-2 border-t border-border-subtle flex-shrink-0">
        {bottomNav.map(item => {
          const isSupport = item.id === 'support'
          const isActive = screen === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`flex items-center gap-3 w-full transition-colors rounded-lg mx-1 px-3 py-2 ${
                isActive
                  ? isSupport ? 'bg-rose-500/10 text-rose-400' : 'bg-primary/10 text-primary'
                  : isSupport
                    ? 'text-rose-400/70 hover:text-rose-400 hover:bg-rose-500/10'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface'
              }`}
              style={{ width: 'calc(100% - 8px)' }}
              title={collapsed ? item.label : undefined}
            >
              <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{item.icon}</span>
              {!collapsed && <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>}
            </button>
          )
        })}

        {/* Collapse button */}
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-3 w-full px-3 py-2 text-text-muted hover:text-text-primary hover:bg-bg-surface transition-colors rounded-lg mx-1 mt-1"
          style={{ width: 'calc(100% - 8px)' }}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
            <IconCollapse collapsed={collapsed} />
          </span>
          {!collapsed && <span className="text-xs whitespace-nowrap">Collapse</span>}
        </button>
      </div>
    </motion.div>
  )
}

export default Sidebar
