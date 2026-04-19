import type { DbType, ConnStatus } from '@/types'

export function DbTypeBadge({ type }: { type: DbType }) {
  const map: Record<DbType, { label: string; className: string }> = {
    dynamodb:    { label: 'DynamoDB',    className: 'bg-warning/10 text-warning border-warning/25' },
    influxdb:    { label: 'InfluxDB',    className: 'bg-info/10 text-info border-info/25' },
    timescaledb: { label: 'TimescaleDB', className: 'bg-success/10 text-success border-success/25' },
    cassandra:   { label: 'Cassandra',   className: 'bg-danger/10 text-danger border-danger/25' },
    scylladb:    { label: 'ScyllaDB',    className: 'bg-accent/10 text-accent border-accent/25' },
  }
  const { label, className } = map[type]
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${className}`}>
      {label}
    </span>
  )
}

export function StatusDot({ status }: { status: ConnStatus }) {
  const map: Record<ConnStatus, string> = {
    connected:    'bg-success shadow-[0_0_6px_rgba(52,211,153,0.6)]',
    disconnected: 'bg-text-muted',
    connecting:   'bg-warning animate-pulse',
    error:        'bg-danger',
  }
  return <div className={`w-2 h-2 rounded-full flex-shrink-0 ${map[status]}`} />
}

export function RcuBadge({ rcu }: { rcu: number }) {
  const color = rcu > 100 ? 'text-danger border-danger/30 bg-danger/8' :
                rcu > 20  ? 'text-warning border-warning/30 bg-warning/8' :
                'text-success border-success/30 bg-success/8'
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono ${color}`}>
      ⚡ {rcu} RCU
    </span>
  )
}

export function EventTypeBadge({ type }: { type: 'INSERT' | 'MODIFY' | 'REMOVE' }) {
  const map = {
    INSERT: 'text-success border-success/30 bg-success/8',
    MODIFY: 'text-warning border-warning/30 bg-warning/8',
    REMOVE: 'text-danger border-danger/30 bg-danger/8',
  }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold tracking-wider ${map[type]}`}>
      {type}
    </span>
  )
}
