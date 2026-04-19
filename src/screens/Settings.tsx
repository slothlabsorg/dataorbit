import React, { useState } from 'react'
import Toggle from '@/components/ui/Toggle'
import { Callout } from '@/components/ui/Callout'

interface SettingRowProps {
  label: string
  description?: string
  children: React.ReactNode
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border-subtle last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-text-primary text-sm font-medium">{label}</p>
        {description && <p className="text-text-muted text-xs mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="flex-shrink-0 flex items-center">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-2">{title}</h3>
      <div className="rounded-xl border border-border bg-bg-surface px-4">{children}</div>
    </div>
  )
}

export function Settings() {
  const [animationsEnabled, setAnimations] = useState(true)
  const [compactMode, setCompact]          = useState(false)
  const [autoConnect, setAutoConnect]      = useState(true)
  const [streamSound, setStreamSound]      = useState(false)
  const [rcuWarning, setRcuWarning]        = useState(true)
  const [rcuThreshold, setRcuThreshold]    = useState(100)
  const [defaultLimit, setDefaultLimit]    = useState(50)

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-5 max-w-xl">
        <h1 className="text-text-primary font-display font-bold text-lg mb-5">Settings</h1>

        <Section title="Appearance">
          <SettingRow label="Animations" description="Motion and transitions throughout the UI.">
            <Toggle checked={animationsEnabled} onChange={setAnimations} />
          </SettingRow>
          <SettingRow label="Compact mode" description="Reduce row height in data tables.">
            <Toggle checked={compactMode} onChange={setCompact} />
          </SettingRow>
        </Section>

        <Section title="Connections">
          <SettingRow label="Auto-connect on startup" description="Reconnect all saved connections when DataOrbit opens.">
            <Toggle checked={autoConnect} onChange={setAutoConnect} />
          </SettingRow>
        </Section>

        <Section title="Query defaults">
          <SettingRow label="Default row limit" description="Maximum items fetched per query.">
            <select
              className="field-input w-24"
              value={defaultLimit}
              onChange={e => setDefaultLimit(Number(e.target.value))}
            >
              {[25, 50, 100, 250, 500].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </SettingRow>
          <SettingRow label="RCU cost warning" description="Show a warning when a query would consume more than the threshold.">
            <Toggle checked={rcuWarning} onChange={setRcuWarning} />
          </SettingRow>
          {rcuWarning && (
            <SettingRow label="RCU warning threshold">
              <input
                type="number"
                className="field-input w-24 font-mono"
                min={1}
                max={10000}
                value={rcuThreshold}
                onChange={e => setRcuThreshold(Number(e.target.value))}
              />
            </SettingRow>
          )}
        </Section>

        <Section title="Streams">
          <SettingRow label="Sound on new event" description="Play a subtle chime when a new stream event arrives.">
            <Toggle checked={streamSound} onChange={setStreamSound} />
          </SettingRow>
        </Section>

        <Section title="About">
          <SettingRow label="Version">
            <span className="text-text-muted text-xs font-mono">0.1.0</span>
          </SettingRow>
          <SettingRow label="Part of">
            <span className="text-text-muted text-xs">SlothLabs family · CloudOrbit + DataOrbit</span>
          </SettingRow>
        </Section>

        <Callout variant="info" title="Settings are stored locally">
          All settings are saved on your machine and never leave your device.
        </Callout>
      </div>
    </div>
  )
}

export default Settings
