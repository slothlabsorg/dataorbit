import type { DbConnection, TableMeta } from '@/types'

interface StatusBarProps {
  activeConnection?: DbConnection | null
  activeTable?: TableMeta | null
}

export function StatusBar({ activeConnection, activeTable }: StatusBarProps) {
  return (
    <div className="h-7 flex items-center justify-between px-4 border-t border-border-subtle bg-bg-base flex-shrink-0 select-none">
      <div className="flex items-center gap-4">
        {activeConnection ? (
          <>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${
                activeConnection.status === 'connected'  ? 'bg-success' :
                activeConnection.status === 'connecting' ? 'bg-warning animate-pulse' :
                activeConnection.status === 'error'      ? 'bg-danger' :
                'bg-text-muted'
              }`} />
              <span className="text-text-secondary text-[11px] font-medium">{activeConnection.name}</span>
            </div>
            {activeConnection.awsRegion && (
              <span className="text-text-muted text-[11px] font-mono">{activeConnection.awsRegion}</span>
            )}
            {activeConnection.host && (
              <span className="text-text-muted text-[11px] font-mono">{activeConnection.host}</span>
            )}
            {activeTable && (
              <>
                <span className="text-text-muted text-[11px]">/</span>
                <span className="text-text-secondary text-[11px] font-mono">{activeTable.name}</span>
                {activeTable.itemCount != null && (
                  <span className="text-text-muted text-[11px]">{activeTable.itemCount.toLocaleString()} items</span>
                )}
              </>
            )}
          </>
        ) : (
          <span className="text-text-muted text-[11px]">No active connection</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-text-muted text-[11px]">DataOrbit v0.1.0</span>
      </div>
    </div>
  )
}

export default StatusBar
