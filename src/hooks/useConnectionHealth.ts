import { useEffect, useRef } from 'react'
import type { DbConnection } from '@/types'
import { api } from '@/lib/tauri'

const PING_INTERVAL_MS = 60_000  // check every 60s
const PING_TIMEOUT_MS  = 10_000  // consider dead if no response in 10s

interface Handlers {
  onDegraded: (id: string, error: string) => void
  onRecovered: (id: string) => void
}

export function useConnectionHealth(
  connections: DbConnection[],
  { onDegraded, onRecovered }: Handlers,
) {
  const handlersRef = useRef({ onDegraded, onRecovered })
  handlersRef.current = { onDegraded, onRecovered }

  useEffect(() => {
    // Only ping connections that are currently 'connected'
    const active = connections.filter(c => c.status === 'connected')
    if (active.length === 0) return

    let cancelled = false

    async function pingAll() {
      if (cancelled) return
      for (const conn of active) {
        if (cancelled) break
        try {
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('ping timeout')), PING_TIMEOUT_MS)
          )
          await Promise.race([api.pingConnection(conn.id), timeout])
          handlersRef.current.onRecovered(conn.id)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          handlersRef.current.onDegraded(conn.id, msg)
        }
      }
    }

    const timer = setInterval(pingAll, PING_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [connections.map(c => `${c.id}:${c.status}`).join(',')])
}
