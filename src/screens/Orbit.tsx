import { motion } from 'framer-motion'
import type { DbConnection, Screen } from '@/types'
import { api } from '@/lib/tauri'
import { DbTypeBadge, StatusDot } from '@/components/ui/Badge'
import Button from '@/components/ui/Button'

// ── Release widget ────────────────────────────────────────────────────────────

const APP_VERSION = '1.0.0'
const RELEASES_URL = 'https://github.com/slothlabsorg/dataorbit/releases'

function ReleaseWidget() {
  return (
    <div
      className="rounded-xl border border-border bg-bg-elevated px-4 py-3 flex items-center justify-between gap-4"
      data-testid="release-widget"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 16 12 12 8 16"/>
            <line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-text-secondary text-xs">
            <span className="font-semibold text-text-primary">DataOrbit v{APP_VERSION}</span>
            {' '}· Early access
          </p>
          <p className="text-text-muted text-[10px] leading-relaxed mt-0.5">
            We ship updates continuously. Check releases for the latest features &amp; fixes.
          </p>
        </div>
      </div>
      <a
        href={RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 px-2.5 py-1.5 rounded-lg border border-border text-[11px] text-text-muted hover:border-primary/40 hover:text-primary transition-colors whitespace-nowrap"
        data-testid="release-widget-link"
      >
        Releases →
      </a>
    </div>
  )
}

interface OrbitProps {
  connections: DbConnection[]
  connErrors: Record<string, string>
  onSelectConnection: (id: string) => void
  onSelectTable: (connId: string, table: string) => void
  onAddConnection: () => void
  onConnectConnection: (id: string) => void
  onDisconnectConnection: (id: string) => void
  onEditConnection: (id: string) => void
  onQuickConnect: (profile: string, region: string) => void
  onNavigate: (screen: Screen) => void
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function StatTile({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 min-w-0 flex flex-col gap-1 bg-bg-elevated border border-border rounded-xl px-4 py-3"
    >
      <span className="text-[10px] text-text-muted font-semibold uppercase tracking-wider">{label}</span>
      <span className={`text-2xl font-display font-bold ${tone}`}>{value}</span>
    </motion.div>
  )
}

// ── Connection card ───────────────────────────────────────────────────────────

function ConnCard({ conn, onBrowse, onExplore, onConnect, onEdit, onDisconnect, errorMsg }: {
  conn: DbConnection; onBrowse: () => void; onExplore: () => void; onConnect: () => void; onEdit: () => void; onDisconnect: () => void; errorMsg?: string
}) {
  const totalItems = conn.tables?.reduce((a, t) => a + (t.itemCount ?? 0), 0) ?? 0
  const tableCount = conn.tables?.length ?? 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-bg-elevated border border-border rounded-xl p-4 flex flex-col gap-3 hover:border-primary/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {conn.isFavorite && <span className="text-warning text-sm leading-none flex-shrink-0">★</span>}
          <span className="text-text-primary font-semibold text-sm truncate">{conn.name}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <StatusDot status={conn.status} />
          <span className={`text-[11px] capitalize ${
            conn.status === 'connected' ? 'text-success' :
            conn.status === 'error'     ? 'text-danger'  : 'text-text-muted'
          }`}>{conn.status}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <DbTypeBadge type={conn.dbType} />
        {conn.awsRegion && <span className="text-text-muted text-[11px] font-mono">{conn.awsRegion}</span>}
        {conn.endpoint  && <span className="text-text-muted text-[11px] font-mono truncate max-w-[130px]">{conn.endpoint}</span>}
      </div>
      <div className="space-y-1.5">
        {errorMsg && (
          <p className="text-danger text-[10px] font-mono leading-snug break-all">{errorMsg}</p>
        )}
        <div className="flex items-center gap-3 text-[11px] text-text-muted">
          {tableCount > 0
            ? <><span><span className="text-text-secondary font-semibold font-mono">{tableCount}</span> tables</span>
                 <span><span className="text-text-secondary font-semibold font-mono">{formatNum(totalItems)}</span> items</span></>
            : <span>{conn.status === 'connecting' ? 'Connecting…' : conn.status === 'error' ? 'Connection failed' : 'No tables loaded'}</span>
          }
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1 border-t border-border-subtle">
        {conn.status === 'error' ? (
          <Button variant="secondary" size="sm" onClick={onEdit}>Edit &amp; retry</Button>
        ) : conn.status === 'disconnected' || conn.status === 'connecting' ? (
          <Button variant="primary" size="sm" onClick={onConnect} disabled={conn.status === 'connecting'}>
            {conn.status === 'connecting' ? 'Connecting…' : 'Connect'}
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={onBrowse}>Browse</Button>
            <Button variant="ghost" size="sm" onClick={onExplore}>Explore</Button>
            <button
              onClick={onDisconnect}
              className="ml-auto text-[10px] text-text-muted hover:text-danger transition-colors px-1"
              title="Disconnect"
            >
              Disconnect
            </button>
          </>
        )}
      </div>
    </motion.div>
  )
}

// ── Support strip ─────────────────────────────────────────────────────────────

function SupportStrip() {
  const items = [
    { label: '⭐ Star on GitHub', href: 'https://github.com/slothlabsorg/dataorbit', accent: 'hover:border-warning/50 hover:text-warning' },
    { label: '☕ Buy us a coffee', href: 'https://ko-fi.com/slothlabs', accent: 'hover:border-success/50 hover:text-success' },
    { label: '🐛 Report a bug', href: 'https://github.com/slothlabsorg/dataorbit/issues', accent: 'hover:border-danger/50 hover:text-danger' },
    { label: '💬 Discord', href: 'https://discord.gg/slothlabs', accent: 'hover:border-accent/50 hover:text-accent' },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ label, href, accent }) => (
        <a
          key={href}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-bg-elevated text-text-muted text-xs transition-colors ${accent}`}
        >
          {label}
        </a>
      ))}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyOrbit({ onAddConnection }: { onAddConnection: () => void }) {
  const [imgFailed, setImgFailed] = useState(false)
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 gap-6">
      {/* Logo */}
      <div className="flex flex-col items-center gap-5">
        {!imgFailed ? (
          <img
            src="/images/slothy-dataorbit.png"
            alt="DataOrbit"
            className="w-40 h-40 object-contain"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <svg width="96" height="96" viewBox="0 0 24 24" fill="none" className="text-primary/40">
            <circle cx="12" cy="12" r="3" fill="currentColor"/>
            <ellipse cx="12" cy="12" rx="10" ry="4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeDasharray="3 2"/>
          </svg>
        )}
        <div className="text-center">
          <h1 className="text-text-primary font-display font-bold text-xl">Welcome to DataOrbit</h1>
          <p className="text-text-muted text-xs mt-1.5">A DynamoDB desktop client that actually makes sense.</p>
        </div>
        <Button variant="primary" size="sm" onClick={onAddConnection}>+ Add connection</Button>
      </div>

      {/* Support info */}
      <div className="w-full max-w-md space-y-3">
        <ReleaseWidget />
        <p className="text-center text-text-muted text-[11px]">
          DataOrbit is free and open source — built by <strong className="text-text-secondary">SlothLabs</strong>
        </p>
        <SupportStrip />
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'

type RichProfile = { name: string; region: string | null; hasCredentials: boolean }

function useAwsProfiles() {
  const [profiles, setProfiles] = useState<RichProfile[]>([])
  useEffect(() => {
    api.listAwsProfilesRich()
      .then(setProfiles)
      .catch(() => {})
  }, [])
  return profiles
}

const AWS_REGIONS = [
  'us-east-1','us-east-2','us-west-1','us-west-2',
  'eu-west-1','eu-west-2','eu-west-3','eu-central-1','eu-north-1',
  'ap-northeast-1','ap-northeast-2','ap-northeast-3',
  'ap-southeast-1','ap-southeast-2','ap-south-1',
  'sa-east-1','ca-central-1','me-south-1','af-south-1',
]

function SessionCard({
  profile,
  onConnect,
}: {
  profile: RichProfile
  onConnect: (region: string) => void
}) {
  const [region, setRegion] = useState(profile.region ?? 'us-east-1')

  return (
    <div className="flex flex-col gap-3 p-3 rounded-xl border border-border bg-bg-elevated hover:border-primary/40 transition-colors">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-lg bg-success/10 border border-success/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-3 h-3 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <span className="text-text-primary text-xs font-semibold truncate min-w-0">{profile.name}</span>
      </div>

      {/* Region selector */}
      <select
        value={region}
        onChange={e => setRegion(e.target.value)}
        onClick={e => e.stopPropagation()}
        className="w-full bg-bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-text-secondary outline-none focus:border-primary/50 transition-colors font-mono"
      >
        {AWS_REGIONS.map(r => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>

      {/* Connect */}
      <button
        onClick={() => onConnect(region)}
        className="w-full py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
      >
        Connect →
      </button>
    </div>
  )
}

// Cards for AWS profiles that have live credentials but no connection yet
function AwsSessionCards({
  profiles,
  existingProfiles,
  onQuickConnect,
}: {
  profiles: RichProfile[]
  existingProfiles: Set<string>
  onQuickConnect: (profile: RichProfile, region: string) => void
}) {
  const available = profiles.filter(p => p.hasCredentials && !existingProfiles.has(p.name))
  if (available.length === 0) return null

  return (
    <div>
      <h2 className="text-text-primary font-display font-bold text-sm mb-3 flex items-center gap-2">
        <svg className="w-3.5 h-3.5 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        Available AWS sessions
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {available.map(p => (
          <SessionCard
            key={p.name}
            profile={p}
            onConnect={region => onQuickConnect(p, region)}
          />
        ))}
      </div>
    </div>
  )
}

export function Orbit({ connections, connErrors, onSelectConnection, onSelectTable, onAddConnection, onConnectConnection, onDisconnectConnection, onEditConnection, onQuickConnect, onNavigate }: OrbitProps) {
  const awsProfiles = useAwsProfiles()
  const connected   = connections.filter(c => c.status === 'connected').length
  const totalTables = connections.reduce((a, c) => a + (c.tables?.length ?? 0), 0)
  const totalItems  = connections.reduce((a, c) => a + (c.tables?.reduce((b, t) => b + (t.itemCount ?? 0), 0) ?? 0), 0)

  const displayConns = connections.filter(c => c.isFavorite).length > 0
    ? connections.filter(c => c.isFavorite)
    : connections

  const quickTables = connections.flatMap(c =>
    (c.tables ?? []).map(t => ({ conn: c, table: t }))
  ).slice(0, 8)

  const existingProfiles = new Set(connections.map(c => c.awsProfile).filter(Boolean) as string[])

  function handleQuickConnect(profile: RichProfile, region: string) {
    onQuickConnect(profile.name, region)
  }

  if (connections.length === 0 && awsProfiles.filter(p => p.hasCredentials).length === 0) {
    return <EmptyOrbit onAddConnection={onAddConnection} />
  }

  if (connections.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="px-6 py-5 space-y-6 max-w-4xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-text-primary font-display font-bold text-lg">Welcome to DataOrbit</h1>
              <p className="text-text-muted text-xs mt-0.5">Connect to an AWS session to get started.</p>
            </div>
            <Button variant="primary" size="sm" onClick={onAddConnection}>+ Add connection</Button>
          </div>
          <AwsSessionCards
            profiles={awsProfiles}
            existingProfiles={existingProfiles}
            onQuickConnect={handleQuickConnect}
          />
          <div className="pt-2 border-t border-border-subtle space-y-2">
            <p className="text-text-muted text-[11px]">DataOrbit is free &amp; open source — built by <strong className="text-text-secondary">SlothLabs</strong></p>
            <SupportStrip />
          </div>
        </div>
      </div>
    )
  }

  function openBrowse(connId: string)  { onSelectConnection(connId); onNavigate('browse') }
  function openExplore(connId: string) { onSelectConnection(connId); onNavigate('explore') }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-5 space-y-6 max-w-4xl">

        {/* Stats band */}
        <div className="flex gap-3">
          <StatTile label="Connections" value={connections.length}    tone="text-text-primary" />
          <StatTile label="Connected"   value={connected}             tone={connected > 0 ? 'text-success' : 'text-text-muted'} />
          <StatTile label="Tables"      value={totalTables}           tone="text-primary" />
          <StatTile label="Items"       value={formatNum(totalItems)} tone="text-text-primary" />
        </div>

        {/* Connections */}
        <div>
          <h2 className="text-text-primary font-display font-bold text-sm mb-3 flex items-center gap-2">
            {connections.some(c => c.isFavorite) ? <><span className="text-warning">★</span> Favorites</> : 'Connections'}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {displayConns.map((conn, i) => (
              <motion.div key={conn.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <ConnCard
                  conn={conn}
                  errorMsg={connErrors[conn.id]}
                  onBrowse={() => openBrowse(conn.id)}
                  onExplore={() => openExplore(conn.id)}
                  onConnect={() => onConnectConnection(conn.id)}
                  onDisconnect={() => onDisconnectConnection(conn.id)}
                  onEdit={() => onEditConnection(conn.id)}
                />
              </motion.div>
            ))}
          </div>
        </div>

        {/* Quick-access tables */}
        {quickTables.length > 0 && (
          <div>
            <h2 className="text-text-primary font-display font-bold text-sm mb-3">Tables</h2>
            <div className="bg-bg-elevated border border-border rounded-xl overflow-hidden">
              {quickTables.map(({ conn, table }, i) => (
                <button
                  key={`${conn.id}-${table.name}`}
                  onClick={() => { onSelectTable(conn.id, table.name); onNavigate('browse') }}
                  className={`flex items-center gap-2 w-full px-4 py-2.5 hover:bg-bg-surface transition-colors text-left group ${i > 0 ? 'border-t border-border-subtle' : ''}`}
                >
                  <svg className="w-3 h-3 text-text-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
                  </svg>
                  <span className="font-mono text-xs text-text-secondary group-hover:text-text-primary transition-colors truncate">{table.name}</span>
                  <span className="ml-auto text-[10px] text-text-muted flex-shrink-0">{conn.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Available AWS sessions (profiles with credentials not yet connected) */}
        <AwsSessionCards
          profiles={awsProfiles}
          existingProfiles={existingProfiles}
          onQuickConnect={handleQuickConnect}
        />

        {/* Release widget */}
        <ReleaseWidget />

        {/* Support strip */}
        <div className="pt-2 border-t border-border-subtle space-y-2">
          <p className="text-text-muted text-[11px]">
            DataOrbit is free &amp; open source — built by <strong className="text-text-secondary">SlothLabs</strong>
          </p>
          <SupportStrip />
        </div>

      </div>
    </div>
  )
}

export default Orbit
