import { motion } from 'framer-motion'
import type { DbConnection } from '@/types'
import { DbTypeBadge, StatusDot } from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'

interface HomeProps {
  connections: DbConnection[]
  onSelectConnection: (id: string) => void
  onAddConnection: () => void
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function ConnectionCard({ conn, onSelect }: { conn: DbConnection; onSelect: () => void }) {
  const totalItems  = conn.tables?.reduce((a, t) => a + (t.itemCount ?? 0), 0) ?? 0
  const totalBytes  = conn.tables?.reduce((a, t) => a + (t.sizeBytes ?? 0), 0) ?? 0
  const tableCount  = conn.tables?.length ?? 0
  const streamCount = conn.tables?.filter(t => t.streamEnabled).length ?? 0

  return (
    <motion.button
      onClick={onSelect}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className="text-left p-4 rounded-xl border border-border bg-bg-surface hover:border-primary/50 hover:bg-bg-surface2 transition-colors group"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {conn.color && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: conn.color }} />}
          <span className="text-text-primary font-semibold text-sm truncate">{conn.name}</span>
          {conn.isFavorite && <span className="text-warning text-xs">★</span>}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <StatusDot status={conn.status} />
          <span className={`text-[11px] capitalize ${
            conn.status === 'connected'   ? 'text-success' :
            conn.status === 'connecting'  ? 'text-warning' :
            conn.status === 'error'       ? 'text-danger'  :
            'text-text-muted'
          }`}>{conn.status}</span>
        </div>
      </div>

      {/* Type badge + region */}
      <div className="flex items-center gap-2 mb-3">
        <DbTypeBadge type={conn.dbType} />
        {conn.awsRegion && (
          <span className="text-text-muted text-[11px] font-mono">{conn.awsRegion}</span>
        )}
        {conn.host && (
          <span className="text-text-muted text-[11px] font-mono truncate">{conn.host}{conn.port ? `:${conn.port}` : ''}</span>
        )}
      </div>

      {/* Stats */}
      {tableCount > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-bg-base rounded-lg p-2 text-center">
            <p className="text-text-primary text-sm font-bold font-mono">{tableCount}</p>
            <p className="text-text-muted text-[10px]">tables</p>
          </div>
          <div className="bg-bg-base rounded-lg p-2 text-center">
            <p className="text-text-primary text-sm font-bold font-mono">
              {totalItems > 1_000_000 ? `${(totalItems / 1_000_000).toFixed(1)}M` :
               totalItems > 1_000 ? `${(totalItems / 1_000).toFixed(1)}K` : totalItems}
            </p>
            <p className="text-text-muted text-[10px]">items</p>
          </div>
          <div className="bg-bg-base rounded-lg p-2 text-center">
            <p className="text-text-primary text-sm font-bold font-mono">{formatBytes(totalBytes)}</p>
            <p className="text-text-muted text-[10px]">size</p>
          </div>
        </div>
      ) : (
        <p className="text-text-muted text-xs">No tables loaded yet</p>
      )}

      {/* Stream indicator */}
      {streamCount > 0 && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border-subtle">
          <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          <span className="text-[11px] text-success">{streamCount} stream{streamCount > 1 ? 's' : ''} active</span>
        </div>
      )}

      {/* Last connected */}
      {conn.lastConnected && (
        <p className="text-text-muted text-[10px] mt-2">
          Last connected {new Date(conn.lastConnected).toLocaleDateString()}
        </p>
      )}
    </motion.button>
  )
}

export function Home({ connections, onSelectConnection, onAddConnection }: HomeProps) {
  if (connections.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          variant="welcome"
          title="Welcome to DataOrbit"
          description="Add your first database connection to start browsing and querying your data."
          action={{ label: 'Add connection', onClick: onAddConnection }}
        />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-text-primary font-display font-bold text-lg">Connections</h1>
            <p className="text-text-muted text-xs mt-0.5">{connections.length} connection{connections.length !== 1 ? 's' : ''}</p>
          </div>
          <Button variant="primary" size="sm" onClick={onAddConnection}>+ Add connection</Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {connections.map((conn, i) => (
            <motion.div
              key={conn.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <ConnectionCard conn={conn} onSelect={() => onSelectConnection(conn.id)} />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Home
