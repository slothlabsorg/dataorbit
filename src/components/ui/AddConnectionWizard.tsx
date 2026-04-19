import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { DbType, DbConnection } from '@/types'
import Button from './Button'
import { Modal } from './Modal'

interface AddConnectionWizardProps {
  onClose: () => void
  onSave: (conn: Omit<DbConnection, 'id' | 'status'>) => void
}

type Step = 'type' | 'config' | 'test'

const DB_TYPES: { type: DbType; label: string; desc: string; available: boolean }[] = [
  { type: 'dynamodb',    label: 'DynamoDB',    desc: 'AWS fully managed NoSQL — key-value & document', available: true },
  { type: 'influxdb',    label: 'InfluxDB',    desc: 'Time-series database for metrics & events',     available: false },
  { type: 'timescaledb', label: 'TimescaleDB', desc: 'PostgreSQL-based time-series database',         available: false },
  { type: 'cassandra',   label: 'Cassandra',   desc: 'Wide-column store for high availability',       available: false },
  { type: 'scylladb',    label: 'ScyllaDB',    desc: 'High-performance Cassandra-compatible DB',      available: false },
]

const TYPE_COLORS: Record<DbType, string> = {
  dynamodb:    'border-warning/40 hover:border-warning/70',
  influxdb:    'border-info/40',
  timescaledb: 'border-success/40',
  cassandra:   'border-danger/40',
  scylladb:    'border-accent/40',
}

const TYPE_ACTIVE: Record<DbType, string> = {
  dynamodb:    'border-warning bg-warning/8',
  influxdb:    'border-info bg-info/8',
  timescaledb: 'border-success bg-success/8',
  cassandra:   'border-danger bg-danger/8',
  scylladb:    'border-accent bg-accent/8',
}

// ── Step 1: DB type selection ──────────────────────────────────────────────────

function StepType({ selected, onSelect }: { selected: DbType | null; onSelect: (t: DbType) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-text-secondary text-xs">Select the database you want to connect to.</p>
      <div className="grid grid-cols-1 gap-2">
        {DB_TYPES.map(({ type, label, desc, available }) => {
          const isSelected = selected === type
          return (
            <button
              key={type}
              onClick={() => available && onSelect(type)}
              disabled={!available}
              className={`relative flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                !available
                  ? 'opacity-40 cursor-not-allowed border-border bg-bg-surface'
                  : isSelected
                    ? `${TYPE_ACTIVE[type]} cursor-pointer`
                    : `border-border bg-bg-surface ${TYPE_COLORS[type]} cursor-pointer`
              }`}
            >
              {!available && (
                <span className="absolute top-2 right-2 text-[9px] bg-bg-overlay border border-border px-1.5 py-0.5 rounded-full text-text-muted font-medium">
                  Coming soon
                </span>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-sm font-semibold">{label}</p>
                <p className="text-text-muted text-xs mt-0.5 leading-relaxed">{desc}</p>
              </div>
              {isSelected && (
                <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Step 2: DynamoDB configuration ─────────────────────────────────────────────

interface DynamoConfig {
  name: string
  awsRegion: string
  authMethod: 'profile' | 'keys' | 'env'
  awsProfile: string
  accessKeyId: string
  secretAccessKey: string
  endpoint: string
}

const AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1',
  'ap-northeast-1', 'ap-northeast-2', 'ap-southeast-1', 'ap-southeast-2',
  'sa-east-1', 'ca-central-1',
]

function StepConfigDynamo({ cfg, onChange }: { cfg: DynamoConfig; onChange: (c: Partial<DynamoConfig>) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">Connection name</label>
        <input
          className="field-input"
          placeholder="e.g. nexus-prod"
          value={cfg.name}
          onChange={e => onChange({ name: e.target.value })}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">AWS Region</label>
        <select
          className="field-input"
          value={cfg.awsRegion}
          onChange={e => onChange({ awsRegion: e.target.value })}
        >
          {AWS_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-secondary mb-2">Authentication</label>
        <div className="grid grid-cols-3 gap-2">
          {(['profile', 'keys', 'env'] as const).map(method => (
            <button
              key={method}
              onClick={() => onChange({ authMethod: method })}
              className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                cfg.authMethod === method
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-bg-surface text-text-secondary hover:border-primary/50'
              }`}
            >
              {method === 'profile' ? '~/.aws profile' : method === 'keys' ? 'Access keys' : 'ENV vars'}
            </button>
          ))}
        </div>
      </div>

      {cfg.authMethod === 'profile' && (
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">AWS Profile</label>
          <input
            className="field-input"
            placeholder="default"
            value={cfg.awsProfile}
            onChange={e => onChange({ awsProfile: e.target.value })}
          />
          <p className="text-text-muted text-[11px] mt-1">Profile from <code className="font-mono">~/.aws/credentials</code>. Works great with CloudOrbit sessions.</p>
        </div>
      )}

      {cfg.authMethod === 'keys' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Access Key ID</label>
            <input
              className="field-input font-mono"
              placeholder="AKIAIOSFODNN7EXAMPLE"
              value={cfg.accessKeyId}
              onChange={e => onChange({ accessKeyId: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Secret Access Key</label>
            <input
              className="field-input font-mono"
              type="password"
              placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
              value={cfg.secretAccessKey}
              onChange={e => onChange({ secretAccessKey: e.target.value })}
            />
          </div>
        </div>
      )}

      {cfg.authMethod === 'env' && (
        <div className="rounded-lg border border-border bg-bg-surface p-3">
          <p className="text-text-secondary text-xs leading-relaxed">
            Uses <code className="font-mono text-primary">AWS_ACCESS_KEY_ID</code> and{' '}
            <code className="font-mono text-primary">AWS_SECRET_ACCESS_KEY</code> from your environment.
          </p>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">
          Custom endpoint <span className="text-text-muted font-normal">(optional)</span>
        </label>
        <input
          className="field-input font-mono"
          placeholder="http://localhost:8000  (for DynamoDB Local)"
          value={cfg.endpoint}
          onChange={e => onChange({ endpoint: e.target.value })}
        />
      </div>
    </div>
  )
}

// ── Step 3: Test connection ────────────────────────────────────────────────────

function StepTest({ status, error }: { status: 'idle' | 'testing' | 'ok' | 'error'; error?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-4">
      {status === 'idle' && (
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-bg-surface2 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <p className="text-text-secondary text-sm">Ready to test your connection</p>
          <p className="text-text-muted text-xs mt-1">We'll try to list your DynamoDB tables.</p>
        </div>
      )}
      {status === 'testing' && (
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
          <p className="text-text-secondary text-sm">Connecting…</p>
        </div>
      )}
      {status === 'ok' && (
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <p className="text-text-primary text-sm font-semibold">Connection successful</p>
          <p className="text-text-muted text-xs mt-1">You can save this connection.</p>
        </div>
      )}
      {status === 'error' && (
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-danger/10 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          </div>
          <p className="text-text-primary text-sm font-semibold">Connection failed</p>
          {error && <p className="text-danger text-xs mt-1 font-mono max-w-xs text-center">{error}</p>}
        </div>
      )}
    </div>
  )
}

// ── Wizard ─────────────────────────────────────────────────────────────────────

const defaultDynamo: DynamoConfig = {
  name: '',
  awsRegion: 'us-east-1',
  authMethod: 'profile',
  awsProfile: 'default',
  accessKeyId: '',
  secretAccessKey: '',
  endpoint: '',
}

const STEP_LABELS: Record<Step, string> = {
  type:   'Database type',
  config: 'Configure',
  test:   'Test & save',
}

export function AddConnectionWizard({ onClose, onSave }: AddConnectionWizardProps) {
  const [step, setStep]             = useState<Step>('type')
  const [dbType, setDbType]         = useState<DbType | null>(null)
  const [dynamo, setDynamo]         = useState<DynamoConfig>(defaultDynamo)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testError, setTestError]   = useState<string>()

  const steps: Step[] = ['type', 'config', 'test']
  const stepIdx = steps.indexOf(step)

  async function handleTest() {
    setTestStatus('testing')
    setTestError(undefined)
    // Simulate — real impl will call Tauri command
    await new Promise(r => setTimeout(r, 1200))
    if (!dynamo.name) {
      setTestStatus('error')
      setTestError('Connection name is required')
      return
    }
    setTestStatus('ok')
  }

  function handleSave() {
    if (!dbType) return
    onSave({
      name: dynamo.name || 'New connection',
      dbType,
      awsRegion: dynamo.awsRegion || undefined,
      awsProfile: dynamo.authMethod === 'profile' ? (dynamo.awsProfile || 'default') : undefined,
      endpoint: dynamo.endpoint || undefined,
      isFavorite: false,
      tables: [],
    })
    onClose()
  }

  const canAdvance =
    step === 'type'   ? dbType !== null :
    step === 'config' ? dynamo.name.trim().length > 0 :
    false

  return (
    <Modal open onClose={onClose} title="Add Connection" width="w-[520px]">
      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-5">
        {steps.map((s, i) => (
          <React.Fragment key={s}>
            <div className={`flex items-center gap-1.5 ${i < stepIdx ? 'text-primary' : i === stepIdx ? 'text-text-primary' : 'text-text-muted'}`}>
              <div className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${
                i < stepIdx  ? 'bg-primary text-white' :
                i === stepIdx ? 'bg-primary/20 text-primary' :
                'bg-bg-surface2 text-text-muted'
              }`}>
                {i < stepIdx ? '✓' : i + 1}
              </div>
              <span className="text-xs font-medium hidden sm:block">{STEP_LABELS[s]}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px mx-1 ${i < stepIdx ? 'bg-primary/40' : 'bg-border-subtle'}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.15 }}
        >
          {step === 'type'   && <StepType selected={dbType} onSelect={(t) => { setDbType(t); setStep('config') }} />}
          {step === 'config' && dbType === 'dynamodb' && <StepConfigDynamo cfg={dynamo} onChange={p => setDynamo(d => ({ ...d, ...p }))} />}
          {step === 'test'   && <StepTest status={testStatus} error={testError} />}
        </motion.div>
      </AnimatePresence>

      {/* Footer */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-border-subtle">
        <Button
          variant="ghost"
          size="sm"
          onClick={stepIdx === 0 ? onClose : () => setStep(steps[stepIdx - 1])}
        >
          {stepIdx === 0 ? 'Cancel' : '← Back'}
        </Button>
        <div className="flex items-center gap-2">
          {step === 'test' && testStatus !== 'ok' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleTest}
              disabled={testStatus === 'testing'}
            >
              {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
            </Button>
          )}
          {step !== 'test' && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setStep(steps[stepIdx + 1])}
              disabled={!canAdvance}
            >
              Continue →
            </Button>
          )}
          {step === 'test' && testStatus === 'ok' && (
            <Button variant="primary" size="sm" onClick={handleSave}>
              Save connection
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default AddConnectionWizard
