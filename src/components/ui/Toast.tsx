import { useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const show = useCallback((message: string, type: ToastType = 'info') => {
    const id = `toast-${++counter.current}`
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, show, dismiss }
}

// ── Container rendered at app root ───────────────────────────────────────────

export function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed bottom-6 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className={`pointer-events-auto flex items-start gap-2.5 px-3 py-2.5 rounded-xl shadow-lg border text-xs max-w-xs ${
              t.type === 'success' ? 'bg-bg-elevated border-success/30 text-success' :
              t.type === 'error'   ? 'bg-bg-elevated border-danger/30 text-danger'   :
              'bg-bg-elevated border-border text-text-secondary'
            }`}
          >
            <span className="flex-shrink-0 mt-px">
              {t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}
            </span>
            <span className="flex-1 leading-snug">{t.message}</span>
            <button onClick={() => onDismiss(t.id)} className="flex-shrink-0 opacity-50 hover:opacity-100 ml-1">×</button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
