const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

export const isMac     = /Mac OS X/.test(ua)
export const isLinux   = /Linux/.test(ua) && !/Android/.test(ua)
export const isWindows = /Windows NT/.test(ua)

// macOS shows native traffic lights overlaid on the webview — no custom controls needed
export const needsWindowControls = isLinux || isWindows
