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
    invoke<TableMeta[]>('list_tables', { connectionId }),

  queryTable: (def: QueryDef) =>
    invoke<QueryResult>('query_table', { def }),

  getTableSchema: (connectionId: string, table: string) =>
    invoke<TableMeta>('get_table_schema', { connectionId, table }),

  // ── Stream ────────────────────────────────────────────────────────────────
  startStream: (connectionId: string, table: string) =>
    invoke<void>('start_stream', { connectionId, table }),

  stopStream: (connectionId: string) =>
    invoke<void>('stop_stream', { connectionId }),

  // ── AWS ───────────────────────────────────────────────────────────────────
  listAwsProfiles: () =>
    invoke<string[]>('list_aws_profiles'),

  listAwsProfilesRich: () =>
    invoke<{ name: string; region: string | null; hasCredentials: boolean }[]>('list_aws_profiles_rich'),

  testDynamo: (region: string, profile: string | null, endpoint: string | null) =>
    invoke<boolean>('test_dynamo_config', { region, profile, endpoint }),

  pingConnection: (id: string) =>
    invoke<{ ok: boolean; error?: string }>('test_connection', { id }),

  putItem: (connectionId: string, table: string, item: Record<string, unknown>) =>
    invoke<void>('put_item', { connectionId, table, item }),

  deleteItem: (connectionId: string, table: string, key: Record<string, unknown>) =>
    invoke<void>('delete_item', { connectionId, table, key }),

  // ── Shell ─────────────────────────────────────────────────────────────────
  openExternalUrl: async (url: string): Promise<void> => {
    try {
      await invoke<void>('open_external_url', { url })
    } catch {
      window.open(url, '_blank')
    }
  },

  executePartiQL: (connectionId: string, statement: string, limit?: number) =>
    invoke<{
      rows: Record<string, unknown>[]
      count: number
      executionMs: number
      warnings: string[]
      opHint: string
    }>('execute_partiql', { connectionId, statement, limit: limit ?? null }),
}
