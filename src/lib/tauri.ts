// Safe invoke — works in browser (no Tauri) for dev/testing
type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

function getInvoke(): TauriInvoke {
  const w = window as Window & { __TAURI__?: { core?: { invoke?: TauriInvoke } } }
  return w.__TAURI__?.core?.invoke ?? ((_cmd, _args) => {
    console.warn('Tauri not available — using mock data')
    return Promise.reject(new Error('not-in-tauri'))
  })
}

export const invoke: TauriInvoke = (cmd, args) => getInvoke()(cmd, args)

import type { DbConnection, TableMeta, QueryDef, QueryResult } from '@/types'

export const api = {
  // ── Connections ──────────────────────────────────────────────────────────
  listConnections: () =>
    invoke<DbConnection[]>('list_connections'),

  saveConnection: (conn: Omit<DbConnection, 'id' | 'status' | 'tables'>) =>
    invoke<DbConnection>('save_connection', { conn }),

  deleteConnection: (id: string) =>
    invoke<void>('delete_connection', { id }),

  testConnection: (id: string) =>
    invoke<{ ok: boolean; error?: string }>('test_connection', { id }),

  // ── DynamoDB ─────────────────────────────────────────────────────────────
  listTables: (connectionId: string) =>
    invoke<TableMeta[]>('list_tables', { connection_id: connectionId }),

  queryTable: (def: QueryDef) =>
    invoke<QueryResult>('query_table', { def }),

  getTableSchema: (connectionId: string, table: string) =>
    invoke<TableMeta>('get_table_schema', { connection_id: connectionId, table }),

  // ── Stream ────────────────────────────────────────────────────────────────
  startStream: (connectionId: string, table: string) =>
    invoke<void>('start_stream', { connection_id: connectionId, table }),

  stopStream: (connectionId: string) =>
    invoke<void>('stop_stream', { connection_id: connectionId }),
}
