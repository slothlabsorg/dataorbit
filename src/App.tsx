import { useState, useEffect } from 'react'
import type { Screen, DbConnection } from '@/types'
import { api } from '@/lib/tauri'
import { mockConnections } from '@/mock/data'
import { Shell } from '@/components/layout/Shell'
import { AddConnectionWizard } from '@/components/ui/AddConnectionWizard'
import { Home } from '@/screens/Home'
import { Browse } from '@/screens/Browse'
import { Explore } from '@/screens/Explore'
import { Stream } from '@/screens/Stream'
import { QueryHistory } from '@/screens/QueryHistory'
import { Settings } from '@/screens/Settings'
import { Docs } from '@/screens/Docs'
import { Support } from '@/screens/Support'

function getUrlParam(key: string): string | null {
  try { return new URL(window.location.href).searchParams.get(key) } catch { return null }
}
const URL_SCREEN = (getUrlParam('screen') as Screen | null) ?? 'home'
const URL_MOCK   = getUrlParam('mock') === '1'

let connIdCounter = 10

export default function App() {
  const [screen, setScreen]               = useState<Screen>(URL_SCREEN)
  const [connections, setConnections]     = useState<DbConnection[]>([])
  const [activeConnId, setActiveConnId]   = useState<string | null>(null)
  const [activeTable, setActiveTable]     = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [wizardOpen, setWizardOpen]       = useState(false)
  const [isLoading, setIsLoading]         = useState(true)

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
    if (screen !== 'stream') setScreen('browse')
  }

  function handleAddConnection(conn: Omit<DbConnection, 'id' | 'status'>) {
    const newConn: DbConnection = {
      ...conn,
      id: `conn-${++connIdCounter}`,
      status: 'disconnected',
    }
    setConnections(prev => [...prev, newConn])
    setActiveConnId(newConn.id)
  }

  const activeConn = connections.find(c => c.id === activeConnId) ?? null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-base">
        <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <>
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
        onAddConnection={() => setWizardOpen(true)}
      >
        {screen === 'home'    && (
          <Home
            connections={connections}
            onSelectConnection={handleSelectConnection}
            onAddConnection={() => setWizardOpen(true)}
          />
        )}
        {screen === 'browse'  && (
          <Browse
            activeConnection={activeConn}
            activeTable={activeTable}
            onSelectTable={handleSelectTable}
          />
        )}
        {screen === 'explore' && (
          <Explore
            activeConnection={activeConn}
            activeTable={activeTable}
          />
        )}
        {screen === 'stream'  && (
          <Stream
            activeConnection={activeConn}
            activeTable={activeTable}
          />
        )}
        {screen === 'history' && <QueryHistory />}
        {screen === 'settings' && <Settings />}
        {screen === 'docs'    && <Docs />}
        {screen === 'support' && <Support />}
      </Shell>

      {wizardOpen && (
        <AddConnectionWizard
          onClose={() => setWizardOpen(false)}
          onSave={handleAddConnection}
        />
      )}
    </>
  )
}
