// Client-side export helpers — JSON and CSV download without a Tauri file dialog.
// Uses a Blob + anchor[download] pattern, compatible with Tauri's WebView.

export function downloadJson(rows: unknown[], filename = 'export.json') {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
  triggerDownload(blob, filename)
}

export function downloadCsv(rows: Record<string, unknown>[], filename = 'export.csv') {
  if (rows.length === 0) {
    triggerDownload(new Blob([''], { type: 'text/csv' }), filename)
    return
  }
  const cols = Object.keys(rows[0])
  const lines = [
    cols.map(csvCell).join(','),
    ...rows.map(row => cols.map(c => csvCell(String(row[c] ?? ''))).join(',')),
  ]
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' })
  triggerDownload(blob, filename)
}

function csvCell(val: string): string {
  if (/[",\r\n]/.test(val)) return `"${val.replace(/"/g, '""')}"`
  return val
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
