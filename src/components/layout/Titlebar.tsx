import React from 'react'
import type { DbConnection } from '@/types'

interface TitlebarProps {
  activeConnection?: DbConnection | null
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

export function Titlebar({ activeConnection }: TitlebarProps) {
  return (
    <div
      data-tauri-drag-region
      className="h-12 flex items-center px-4 border-b border-border-subtle bg-bg-base flex-shrink-0 select-none"
      style={{ paddingLeft: '80px' }}
    >
      {/* Center — brand */}
      <div className="flex-1 flex items-center justify-center gap-2">
        <AppLogo />
        <span className="font-display font-bold text-text-primary text-sm tracking-wide">DataOrbit</span>
      </div>

      {/* Right — active connection */}
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
  )
}

export default Titlebar
