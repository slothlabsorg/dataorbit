import { motion } from 'framer-motion'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
}

export function Toggle({ checked, onChange, disabled = false, label }: ToggleProps) {
  return (
    <label className={`inline-flex items-center gap-2 cursor-pointer select-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
          checked ? 'bg-primary' : 'bg-bg-overlay border border-border'
        }`}
      >
        <motion.span
          className="absolute left-0 top-0.5 w-4 h-4 bg-white rounded-full"
          animate={{ x: checked ? 18 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </button>
      {label && <span className="text-text-secondary text-sm">{label}</span>}
    </label>
  )
}

export default Toggle
