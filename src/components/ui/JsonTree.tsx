import { useState } from 'react'

interface JsonTreeProps {
  data: unknown
  depth?: number
  defaultExpanded?: boolean
}

function JsonValue({ value, depth, defaultExpanded }: { value: unknown; depth: number; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded || depth < 2)

  if (value === null) return <span className="text-text-muted font-mono text-xs">null</span>
  if (value === undefined) return <span className="text-text-muted font-mono text-xs">undefined</span>
  if (typeof value === 'boolean') return <span className="text-accent font-mono text-xs">{value.toString()}</span>
  if (typeof value === 'number') return <span className="text-warning font-mono text-xs">{value}</span>
  if (typeof value === 'string') return <span className="text-success font-mono text-xs">"{value}"</span>

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-text-muted font-mono text-xs">[]</span>
    return (
      <span>
        <button onClick={() => setExpanded(e => !e)} className="text-text-muted hover:text-text-primary text-xs font-mono">
          {expanded ? '▾' : '▸'} [{value.length}]
        </button>
        {expanded && (
          <div className="ml-3 border-l border-border-subtle pl-2 mt-0.5 space-y-0.5">
            {value.map((v, i) => (
              <div key={i} className="flex items-start gap-1">
                <span className="text-text-muted font-mono text-xs flex-shrink-0">{i}:</span>
                <JsonValue value={v} depth={depth + 1} defaultExpanded={defaultExpanded} />
              </div>
            ))}
          </div>
        )}
      </span>
    )
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span className="text-text-muted font-mono text-xs">{'{}'}</span>
    return (
      <span>
        <button onClick={() => setExpanded(e => !e)} className="text-text-muted hover:text-text-primary text-xs font-mono">
          {expanded ? '▾' : '▸'} {'{'}…{'}'}
        </button>
        {expanded && (
          <div className="ml-3 border-l border-border-subtle pl-2 mt-0.5 space-y-0.5">
            {entries.map(([k, v]) => (
              <div key={k} className="flex items-start gap-1">
                <span className="text-text-secondary font-mono text-xs flex-shrink-0">{k}:</span>
                <JsonValue value={v} depth={depth + 1} defaultExpanded={defaultExpanded} />
              </div>
            ))}
          </div>
        )}
      </span>
    )
  }

  return <span className="text-text-primary font-mono text-xs">{String(value)}</span>
}

export function JsonTree({ data, depth = 0, defaultExpanded = false }: JsonTreeProps) {
  return (
    <div className="font-mono text-xs leading-relaxed">
      <JsonValue value={data} depth={depth} defaultExpanded={defaultExpanded} />
    </div>
  )
}

export default JsonTree
