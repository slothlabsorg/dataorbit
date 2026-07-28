import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { Screen, DbConnection, TableMeta, HistoryEntry } from '@/types'
import { api } from '@/lib/tauri'
import { useConnectionHealth } from '@/hooks/useConnectionHealth'
import { mockConnections } from '@/mock/data'
import { Shell } from '@/components/layout/Shell'
import { AddConnectionWizard, type WizardInitial } from '@/components/ui/AddConnectionWizard'
import { Home } from '@/screens/Home'
import { Orbit } from '@/screens/Orbit'
import { Browse } from '@/screens/Browse'
import { Explore } from '@/screens/Explore'
import { Stream } from '@/screens/Stream'
import { LiveMonitor, type MonitoredRow } from '@/screens/LiveMonitor'
import { QueryHistory } from '@/screens/QueryHistory'
import { Settings } from '@/screens/Settings'
import { Docs } from '@/screens/Docs'
import { Support } from '@/screens/Support'
import { UpdaterModal } from '@/components/UpdaterModal'
import { News } from '@/screens/News'
import { loadNews, markRead, getUnreadIds } from '@/lib/news'
import { MOCK_FEED } from '@/data/news-mock'
import type { NewsItem } from '@/types/news'
import { ToastContainer, useToast } from '@/components/ui/Toast'

function getUrlParam(key: string): string | null {
  try { return new URL(window.location.href).searchParams.get(key) } catch { return null }
}
const URL_SCREEN          = (getUrlParam('screen') as Screen | null) ?? 'orbit'
const URL_MOCK            = getUrlParam('mock') === '1'
const URL_UPDATER         = getUrlParam('updater') === '1'
const URL_NEWS            = getUrlParam('news') === '1'
const URL_MOCK_NEWS       = getUrlParam('mockNews') === '1' || URL_NEWS
const URL_MOCK_UPDATE     = getUrlParam('mockUpdate') === '1'
const URL_MOCK_UPDATE_VER = getUrlParam('mockUpdateVersion') ?? '1.1.0'
const URL_PREVIEW_UPDATE  = getUrlParam('preview_update') !== null

const MOCK_NEWS_INFO = {
  version: '1.1.0',
  body: `## What's new in v1.1.0\n\n- SQLite support — browse local SQLite databases with no server required\n- Timescale time-bucket query builder support\n- Table search in the sidebar\n- Export query results to CSV / JSON\n- Connection health indicator in the sidebar`,
}

let connIdCounter = 10  // fallback counter for non-Tauri dev mode only

export default function App() {
  const [screen, setScreen]               = useState<Screen>(URL_SCREEN)
  const [connections, setConnections]     = useState<DbConnection[]>([])
  const [activeConnId, setActiveConnId]   = useState<string | null>(null)
  const [activeTable, setActiveTable]     = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [wizardOpen, setWizardOpen]       = useState(false)
  const [wizardInitial, setWizardInitial] = useState<WizardInitial | undefined>()
  const [editingConnId, setEditingConnId] = useState<string | undefined>()
  const [connErrors, setConnErrors]       = useState<Record<string, string>>({})
  const [sessionAlerts, setSessionAlerts] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading]         = useState(true)
  const [updateInfo, setUpdateInfo]       = useState<{ version: string; body: string | null } | null>(
    URL_NEWS ? MOCK_NEWS_INFO : URL_MOCK_UPDATE ? { version: URL_MOCK_UPDATE_VER, body: null } : null
  )
  const [updaterDismissed, setUpdaterDismissed] = useState(() => {
    const v = URL_MOCK_UPDATE ? URL_MOCK_UPDATE_VER : ''
    if (!v) return false
    try { return localStorage.getItem('dataorbit.updaterDismissed') === v } catch { return false }
  })
  const validItems = MOCK_FEED.items.filter(i => !i.expiresAt || new Date(i.expiresAt).getTime() > Date.now())
  const [newsItems, setNewsItems]         = useState<NewsItem[]>(() => URL_MOCK_NEWS ? validItems : [])
  const [newsUnread, setNewsUnread]       = useState(() =>
    URL_MOCK_NEWS ? getUnreadIds(validItems).length : 0
  )
  const { toasts, show: showToast, dismiss: dismissToast } = useToast()
  const [monitoredRows, setMonitoredRows] = useState<MonitoredRow[]>([])
  const pendingExploreIndexRef = useRef<string | null>(null)
  const pendingHistoryRerunRef = useRef<HistoryEntry | null>(null)

  // ── Query History persistence ───────────────────────────────────────────────
  const HISTORY_KEY = 'dataorbit.queryHistory'

  const [queryHistory, setQueryHistory] = useState<HistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return parsed.map((e: HistoryEntry) => ({ ...e, time: new Date(e.time) }))
    } catch { return [] }
  })

  function addHistoryEntry(entry: HistoryEntry) {
    setQueryHistory(prev => {
      const next = [entry, ...prev].slice(0, 200)
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  function toggleSaveHistory(id: string, name?: string) {
    setQueryHistory(prev => {
      const next = prev.map(e =>
        e.id === id ? { ...e, isSaved: !e.isSaved, savedName: name ?? e.savedName } : e
      )
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  function deleteHistoryEntry(id: string) {
    setQueryHistory(prev => {
      const next = prev.filter(e => e.id !== id)
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  function handleHistoryRerun(entry: HistoryEntry) {
    // Navigate to Explore and set up the pending rerun
    pendingHistoryRerunRef.current = entry
    setActiveConnId(entry.connectionId)
    setActiveTable(entry.table)
    setScreen('explore')
  }

  function handleAddMonitorRow(row: MonitoredRow) {
    setMonitoredRows(prev => {
      if (prev.find(r => r.id === row.id)) return prev
      return [...prev.slice(-4), row]  // max 5 rows
    })
    setScreen('monitor')
  }

  // Load connections on mount
  useEffect(() => {
    const load = async () => {
      if (URL_MOCK) {
        setConnections(mockConnections)
        setActiveConnId(mockConnections[0].id)
        setActiveTable(mockConnections[0].tables?.[0]?.name ?? null)
        setIsLoading(false)
        return
      }

      try {
        const conns = await api.listConnections()
        setConnections(conns)
        if (conns.length > 0) setActiveConnId(conns[0].id)
      } catch {
        // Not in Tauri or no connections yet — start fresh
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  function handleSelectConnection(id: string) {
    setActiveConnId(id)
    setActiveTable(null)
    // Navigate to browse when selecting a connection
    if (screen === 'home') setScreen('browse')
  }

  function handleSelectTable(connId: string, table: string) {
    setActiveConnId(connId)
    setActiveTable(table)
    // Track recent tables for Orbit ordering
    addRecentTable(connId, table)
    // Stay in Explore or Stream when user clicks a table — they want to query it there
    if (screen === 'home' || screen === 'orbit' || screen === 'history') setScreen('browse')
  }

  function addRecentTable(connId: string, tableName: string) {
    const key = `${connId}:${tableName}`
    try {
      const raw = localStorage.getItem('dataorbit.recentTables')
      const list: string[] = raw ? JSON.parse(raw) : []
      const next = [key, ...list.filter(k => k !== key)].slice(0, 20)
      localStorage.setItem('dataorbit.recentTables', JSON.stringify(next))
    } catch {}
  }

  async function handleAddConnection(conn: Omit<DbConnection, 'id' | 'status'>) {
    // If editing an existing connection, delete the old one first
    const replacingId = editingConnId
    if (replacingId) {
      try { await api.deleteConnection(replacingId) } catch { /* ok */ }
      setConnections(prev => prev.filter(c => c.id !== replacingId))
      setEditingConnId(undefined)
    }

    let saved: DbConnection
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { tables: _t, ...connToSave } = conn
      saved = await api.saveConnection(connToSave)
    } catch (e) {
      console.error('saveConnection failed:', e)
      // Not in Tauri or serialization error — in-memory fallback (dev only)
      const newConn: DbConnection = { ...conn, id: `conn-${++connIdCounter}`, status: 'disconnected' }
      setConnections(prev => [...prev, newConn])
      setActiveConnId(newConn.id)
      return
    }

    let tables: TableMeta[] = []
    let status: DbConnection['status'] = 'error'
    let errMsg = ''
    try {
      tables = await api.listTables(saved.id)
      status = 'connected'
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e)
    }

    const fullConn: DbConnection = { ...saved, status, tables }
    setConnections(prev => [...prev, fullConn])
    if (errMsg) {
      setConnErrors(prev => ({ ...prev, [saved.id]: errMsg }))
    } else if (tables.length === 0) {
      const region = saved.awsRegion ?? 'us-east-1'
      setConnErrors(prev => ({
        ...prev,
        [saved.id]: `No tables found in ${region}. Verify the region is correct or that your AWS session is active (run CloudOrbit login if needed).`,
      }))
    }
    setActiveConnId(saved.id)
    setScreen('browse')
  }

  function handleQuickConnect(profile: string, region: string) {
    setWizardInitial({ name: profile, awsProfile: profile, awsRegion: region })
    setWizardOpen(true)
  }

  async function handleConnectConnection(id: string) {
    setConnections(prev => prev.map(c => c.id === id ? { ...c, status: 'connecting' } : c))
    setConnErrors(prev => { const n = { ...prev }; delete n[id]; return n })
    try {
      const tables = await api.listTables(id)
      setConnections(prev => prev.map(c => c.id === id ? { ...c, status: 'connected', tables } : c))
      if (tables.length === 0) {
        const conn = connections.find(c => c.id === id)
        const region = conn?.awsRegion ?? 'us-east-1'
        setConnErrors(prev => ({
          ...prev,
          [id]: `No tables found in ${region}. Verify the region is correct or that your AWS session is active (run CloudOrbit login if needed).`,
        }))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setConnections(prev => prev.map(c => c.id === id ? { ...c, status: 'error' } : c))
      setConnErrors(prev => ({ ...prev, [id]: msg }))
    }
  }

  function handleDisconnectConnection(id: string) {
    setConnections(prev => prev.map(c =>
      c.id === id ? { ...c, status: 'disconnected', tables: [] } : c
    ))
    setConnErrors(prev => { const n = { ...prev }; delete n[id]; return n })
    setSessionAlerts(prev => { const n = { ...prev }; delete n[id]; return n })
    if (activeConnId === id) setActiveTable(null)
  }

  // Passive health check — pings active connections every 60s
  useConnectionHealth(connections, {
    onDegraded: (id, error) => {
      setConnections(prev => prev.map(c => c.id === id ? { ...c, status: 'error' } : c))
      setSessionAlerts(prev => ({ ...prev, [id]: error }))
    },
    onRecovered: (id) => {
      setSessionAlerts(prev => { const n = { ...prev }; delete n[id]; return n })
    },
  })

  // ── News feed ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (URL_MOCK || URL_MOCK_NEWS) return
    loadNews().then(items => {
      setNewsItems(items)
      setNewsUnread(getUnreadIds(items).length)
    })
  }, [])

  // Refresh news when window gains focus (with 5-min debounce)
  useEffect(() => {
    if (URL_MOCK || URL_MOCK_NEWS) return
    let lastFetch = 0
    const MIN_INTERVAL = 5 * 60 * 1000 // 5 min

    const onFocus = () => {
      if (Date.now() - lastFetch > MIN_INTERVAL) {
        lastFetch = Date.now()
        loadNews().then(items => {
          setNewsItems(items)
          setNewsUnread(getUnreadIds(items).length)
        }).catch(() => {})
      }
    }

    window.addEventListener('focus', onFocus)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onFocus()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // Bell items: synthetic update entry (when dismissed) + one per kind from news
  const bellItems = useMemo(() => {
    type BellItem = { id: string; kind: 'update-available' | 'release' | 'announcement'; title: string; body?: string; date: string; url?: string }
    const items: BellItem[] = []
    if (updateInfo && updaterDismissed) {
      items.push({ id: 'update-available', kind: 'update-available', title: `v${updateInfo.version} is available`, body: 'Click to install the latest update', date: new Date().toISOString() })
    }
    const seen = new Set<string>()
    for (const n of newsItems.filter(i => i.type !== 'ad')) {
      const kind = n.type === 'changelog' ? 'release' : 'announcement'
      if (seen.has(kind)) continue
      seen.add(kind)
      items.push({ id: n.id, kind, title: n.title, body: n.body.split('\n').filter(Boolean)[0] ?? '', date: n.publishedAt, url: n.action?.url })
    }
    return items
  }, [newsItems, updateInfo, updaterDismissed])

  const handleNewsMarkRead = useCallback(() => {
    const ids = newsItems.map(i => i.id)
    markRead(ids)
    setNewsUnread(0)
  }, [newsItems])

  function handleOpenWizardForConn(id: string) {
    const conn = connections.find(c => c.id === id)
    if (!conn) return
    setEditingConnId(id)
    setWizardInitial({
      name:       conn.name,
      awsProfile: conn.awsProfile,
      awsRegion:  conn.awsRegion,
      endpoint:   conn.endpoint,
    })
    setWizardOpen(true)
  }

  async function handleDeleteConnection(id: string) {
    try {
      await api.deleteConnection(id)
    } catch {
      // Not in Tauri — still remove from local state
    }
    setConnections(prev => prev.filter(c => c.id !== id))
    if (activeConnId === id) {
      setActiveConnId(null)
      setActiveTable(null)
      setScreen('home')
    }
  }

  const activeConn = connections.find(c => c.id === activeConnId) ?? null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-base">
        <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  const alertEntries = Object.entries(sessionAlerts)

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {(!URL_MOCK || URL_UPDATER || URL_MOCK_UPDATE || URL_PREVIEW_UPDATE) && (
        <UpdaterModal
          dismissed={updaterDismissed}
          onDismiss={() => {
            if (updateInfo?.version) {
              try { localStorage.setItem('dataorbit.updaterDismissed', updateInfo.version) } catch {}
            }
            setUpdaterDismissed(true)
          }}
          onUpdateAvailable={(version, body) => {
            setUpdateInfo({ version, body })
            try {
              if (localStorage.getItem('dataorbit.updaterDismissed') === version) {
                setUpdaterDismissed(true)
              }
            } catch {}
          }}
        />
      )}
      {/* Session expiry alerts */}
      {alertEntries.map(([id, msg]) => {
        const conn = connections.find(c => c.id === id)
        if (!conn) return null
        return (
          <div key={id} className="flex items-center justify-between gap-3 px-4 py-1.5 bg-warning/10 border-b border-warning/30 text-xs flex-shrink-0">
            <span className="text-warning font-medium truncate">
              Session expired: <span className="font-semibold">{conn.name}</span>
              {msg && msg !== 'ping timeout' && <span className="text-warning/70 ml-1">— {msg.slice(0, 80)}</span>}
            </span>
            <button
              onClick={() => handleOpenWizardForConn(id)}
              className="text-warning hover:text-warning/80 font-semibold whitespace-nowrap"
            >
              Reconnect →
            </button>
          </div>
        )
      })}
      <div className="flex-1 min-h-0">
        <Shell
          screen={screen}
          onNavigate={setScreen}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed(c => !c)}
          connections={connections}
          activeConnectionId={activeConnId}
          activeTable={activeTable}
          onSelectConnection={handleSelectConnection}
          onSelectTable={handleSelectTable}
          onAddConnection={() => { setWizardInitial(undefined); setWizardOpen(true) }}
          onDeleteConnection={handleDeleteConnection}
          newsUnread={newsUnread}
          monitorCount={monitoredRows.length}
          bellItems={bellItems}
          onNewsMarkRead={handleNewsMarkRead}
          onTriggerUpdate={() => setUpdaterDismissed(false)}
        >
          {screen === 'home'    && (
            <Home
              connections={connections}
              connErrors={connErrors}
              onSelectConnection={handleSelectConnection}
              onAddConnection={() => { setWizardInitial(undefined); setWizardOpen(true) }}
              onDeleteConnection={handleDeleteConnection}
              onConnectConnection={handleConnectConnection}
              onEditConnection={handleOpenWizardForConn}
            />
          )}
          {screen === 'orbit'   && (
            <Orbit
              connections={connections}
              connErrors={connErrors}
              onSelectConnection={handleSelectConnection}
              onSelectTable={handleSelectTable}
              onAddConnection={() => { setWizardInitial(undefined); setWizardOpen(true) }}
              onConnectConnection={handleConnectConnection}
              onDisconnectConnection={handleDisconnectConnection}
              onEditConnection={handleOpenWizardForConn}
              onQuickConnect={handleQuickConnect}
              onNavigate={setScreen}
            />
          )}
          {screen === 'browse'  && (
            <Browse
              activeConnection={activeConn}
              activeTable={activeTable}
              onSelectTable={handleSelectTable}
              onRefreshTables={(connId, tables) =>
                setConnections(prev => prev.map(c => c.id === connId ? { ...c, tables } : c))
              }
              onUpdateTableSchema={(connId, schema) =>
                setConnections(prev => prev.map(c =>
                  c.id === connId ? { ...c, tables: (c.tables ?? []).map(t => t.name === schema.name ? { ...t, ...schema } : t) } : c
                ))
              }
              showToast={showToast}
              onAddMonitorRow={handleAddMonitorRow}
              onOpenExplore={(indexName?: string) => {
                pendingExploreIndexRef.current = indexName ?? null
                setScreen('explore')
              }}
            />
          )}
          {screen === 'explore' && (
            <Explore
              activeConnection={activeConn}
              activeTable={activeTable}
              initialIndex={pendingExploreIndexRef.current ?? undefined}
              pendingRerun={pendingHistoryRerunRef.current}
              onClearPendingRerun={() => { pendingHistoryRerunRef.current = null }}
              onAddHistory={addHistoryEntry}
              onUpdateSchema={(connId, tableName, attrs) =>
                setConnections(prev => prev.map(c =>
                  c.id === connId ? {
                    ...c,
                    tables: (c.tables ?? []).map(t =>
                      t.name === tableName ? { ...t, attributes: attrs } : t
                    )
                  } : c
                ))
              }
              onAddMonitorRow={handleAddMonitorRow}
            />
          )}
          {screen === 'stream'  && (
            <Stream
              activeConnection={activeConn}
              activeTable={activeTable}
            />
          )}
          {screen === 'monitor' && (
            <LiveMonitor
              activeConnection={activeConn}
              monitoredRows={monitoredRows}
              onRemoveRow={id => setMonitoredRows(prev => prev.filter(r => r.id !== id))}
            />
          )}
          {screen === 'history' && (
            <QueryHistory
              entries={queryHistory}
              onRunQuery={handleHistoryRerun}
              onToggleSave={toggleSaveHistory}
              onDelete={deleteHistoryEntry}
            />
          )}
          {screen === 'news'    && <News onVisit={() => setNewsUnread(0)} />}
          {screen === 'settings' && <Settings />}
          {screen === 'docs'    && <Docs />}
          {screen === 'support' && <Support />}
        </Shell>
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      {wizardOpen && (
        <AddConnectionWizard
          onClose={() => { setWizardOpen(false); setWizardInitial(undefined); setEditingConnId(undefined) }}
          onSave={handleAddConnection}
          initialValues={wizardInitial}
        />
      )}
    </div>
  )
}
