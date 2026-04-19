import React from 'react'

interface CalloutProps {
  variant?: 'info' | 'warning' | 'danger' | 'success'
  title?: string
  children: React.ReactNode
}

export function Callout({ variant = 'info', title, children }: CalloutProps) {
  const styles = {
    info:    'bg-primary/8 border-primary/25 text-primary',
    warning: 'bg-warning/8 border-warning/25 text-warning',
    danger:  'bg-danger/8 border-danger/25 text-danger',
    success: 'bg-success/8 border-success/25 text-success',
  }
  const icons = {
    info:    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 8v4M12 16h.01"/>,
    warning: <><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    danger:  <><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>,
    success: <><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>,
  }

  return (
    <div className={`flex gap-3 p-3 rounded-lg border text-xs ${styles[variant]}`}>
      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {icons[variant]}
      </svg>
      <div className="flex-1">
        {title && <p className="font-semibold mb-0.5">{title}</p>}
        <div className="text-text-secondary leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

export default Callout
